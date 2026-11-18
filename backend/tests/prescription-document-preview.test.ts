import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { test } from "node:test";
import express from "express";
import request from "supertest";

import { errorHandler } from "../src/middleware/error.middleware.js";
import { createPrescriptionDocumentPreviewRouter, type PrescriptionDocumentPreviewLogger } from "../src/routes/prescription-document-preview.routes.js";
import { createS3PrescriptionDocumentPreviewService } from "../src/services/prescription-document-preview.service.js";
import type { UserSupabaseClient } from "../src/config/supabase-user.js";

const OWNER="10000000-0000-4000-8000-000000000001";
const PRESCRIPTION="10000000-0000-4000-8000-000000000010";

function client(row:Record<string,unknown>|null,error:unknown=null):UserSupabaseClient {
  const terminal={maybeSingle:async()=>({data:row,error})};
  const chain:any={select:()=>chain,eq:()=>chain,maybeSingle:terminal.maybeSingle};
  return {from:()=>chain} as unknown as UserSupabaseClient;
}

const validRow={id:PRESCRIPTION,user_id:OWNER,storage_provider:"aws_s3",storage_bucket:"private-test",
  object_key:`private/prescriptions/${PRESCRIPTION}/source.pdf`,file_type:"application/pdf",file_size_bytes:14};

function app(row:Record<string,unknown>|null,options: {
  body?: unknown;
  send?: (signal?: AbortSignal) => Promise<unknown>;
  databaseError?: unknown;
  logger?: PrescriptionDocumentPreviewLogger;
  timeoutMs?: number;
}={}) {
  const service=createS3PrescriptionDocumentPreviewService({region:"ap-south-1",bucket:"private-test",maximumBytes:1024,
    ...(options.timeoutMs===undefined?{}:{timeoutMs:options.timeoutMs}),client:{async send(_command:unknown,sendOptions?:{abortSignal?:AbortSignal}){return options.send?options.send(sendOptions?.abortSignal):{Body:options.body??Readable.from([Buffer.from("%PDF-fictional")])};}} as never});
  const instance=express();
  instance.use(createPrescriptionDocumentPreviewRouter({async verifyAccessToken(token){if(token!=="valid") throw new Error();return {userId:OWNER};}},()=>client(row,options.databaseError),service,options.logger));
  instance.use(errorHandler); return instance;
}

test("serves only the authenticated owner's bounded private document",async()=>{
  const response=await request(app(validRow))
    .get(`/api/v1/prescriptions/${PRESCRIPTION}/document/preview`).set("authorization","Bearer valid");
  assert.equal(response.status,200); assert.equal(response.headers["cache-control"],"private, no-store, max-age=0");
  assert.match(response.headers["content-type"]??"",/^application\/pdf/); assert.equal(response.body.toString(),"%PDF-fictional");
});

test("denies unauthenticated and non-owned preview requests without storage access",async()=>{
  assert.equal((await request(app(null)).get(`/api/v1/prescriptions/${PRESCRIPTION}/document/preview`)).status,401);
  const missing=await request(app(null)).get(`/api/v1/prescriptions/${PRESCRIPTION}/document/preview`).set("authorization","Bearer valid");
  assert.equal(missing.status,404); assert.equal(missing.body.error.code,"PRESCRIPTION_NOT_FOUND");
});

test("fails closed for an oversized private object",async()=>{
  const row={id:PRESCRIPTION,user_id:OWNER,storage_provider:"aws_s3",storage_bucket:"private-test",object_key:"private/source.pdf",file_type:"application/pdf",file_size_bytes:1024};
  const response=await request(app(row,{body:Readable.from([Buffer.alloc(1025)])})).get(`/api/v1/prescriptions/${PRESCRIPTION}/document/preview`).set("authorization","Bearer valid");
  assert.equal(response.status,413); assert.equal(response.body.error.code,"DOCUMENT_TOO_LARGE");
});

test("translates database failures to 503 while an owner-scoped miss remains 404",async()=>{
  const failed=await request(app(null,{databaseError:{message:"private database detail"}}))
    .get(`/api/v1/prescriptions/${PRESCRIPTION}/document/preview`).set("authorization","Bearer valid");
  assert.equal(failed.status,503); assert.equal(failed.body.error.code,"DOCUMENT_PREVIEW_UNAVAILABLE");
  const missing=await request(app(null)).get(`/api/v1/prescriptions/${PRESCRIPTION}/document/preview`).set("authorization","Bearer valid");
  assert.equal(missing.status,404);
});

test("classifies S3 denial and missing objects without logging provider details or object keys",async()=>{
  for(const [name,category] of [["AccessDenied","access_denied"],["NoSuchKey","object_not_found"]] as const){
    const events:Parameters<PrescriptionDocumentPreviewLogger["warn"]>[0][]=[];
    const error=Object.assign(new Error("private provider detail"),{name,$metadata:{httpStatusCode:403}});
    const response=await request(app(validRow,{send:async()=>{throw error;},logger:{warn:event=>events.push(event)}}))
      .get(`/api/v1/prescriptions/${PRESCRIPTION}/document/preview`).set("authorization","Bearer valid");
    assert.equal(response.status,503); assert.equal(events.length,1); assert.equal(events[0]?.category,category);
    assert.equal(events[0]?.providerStatusClass,"4xx");
    const serialized=JSON.stringify(events); assert.doesNotMatch(serialized,/private provider detail|private\/prescriptions/);
  }
});

test("classifies provider timeout and malformed response safely",async()=>{
  const timeoutEvents:Parameters<PrescriptionDocumentPreviewLogger["warn"]>[0][]=[];
  const timeout=await request(app(validRow,{timeoutMs:5,send:signal=>new Promise((_resolve,reject)=>signal?.addEventListener("abort",()=>reject(Object.assign(new Error("aborted"),{name:"AbortError"})),{once:true})),logger:{warn:event=>timeoutEvents.push(event)}}))
    .get(`/api/v1/prescriptions/${PRESCRIPTION}/document/preview`).set("authorization","Bearer valid");
  assert.equal(timeout.status,503); assert.equal(timeoutEvents[0]?.category,"timeout");
  const malformedEvents:Parameters<PrescriptionDocumentPreviewLogger["warn"]>[0][]=[];
  const malformed=await request(app(validRow,{body:{},logger:{warn:event=>malformedEvents.push(event)}}))
    .get(`/api/v1/prescriptions/${PRESCRIPTION}/document/preview`).set("authorization","Bearer valid");
  assert.equal(malformed.status,503); assert.equal(malformedEvents[0]?.category,"malformed_response");
});

test("classifies a failing provider stream separately from request setup",async()=>{
  const events:Parameters<PrescriptionDocumentPreviewLogger["warn"]>[0][]=[];
  const body={async *[Symbol.asyncIterator](){yield Buffer.from("part");throw Object.assign(new Error("private stream detail"),{name:"InternalError",$metadata:{httpStatusCode:500}});}};
  const response=await request(app(validRow,{body,logger:{warn:event=>events.push(event)}}))
    .get(`/api/v1/prescriptions/${PRESCRIPTION}/document/preview`).set("authorization","Bearer valid");
  assert.equal(response.status,503); assert.equal(events[0]?.stage,"storage_stream");
  assert.equal(events[0]?.category,"provider"); assert.equal(events[0]?.providerStatusClass,"5xx");
  assert.doesNotMatch(JSON.stringify(events),/private stream detail/);
});

test("destroys the storage stream when preview consumption is cancelled",async()=>{
  let destroyed=false;
  const body={destroy(){destroyed=true;},async *[Symbol.asyncIterator](){yield Buffer.from("part");await new Promise(resolve=>setTimeout(resolve,20));yield Buffer.from("rest");}};
  const service=createS3PrescriptionDocumentPreviewService({region:"ap-south-1",bucket:"private-test",maximumBytes:1024,
    client:{async send(){return {Body:body};}} as never});
  const controller=new AbortController();
  const pending=service.load(client(validRow),OWNER,PRESCRIPTION,controller.signal);
  setTimeout(()=>controller.abort(),5);
  await assert.rejects(pending,error=>error instanceof Error && "category" in error && error.category==="cancelled");
  assert.equal(destroyed,true);
});
