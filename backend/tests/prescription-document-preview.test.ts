import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { test } from "node:test";
import express from "express";
import request from "supertest";

import { errorHandler } from "../src/middleware/error.middleware.js";
import { createPrescriptionDocumentPreviewRouter } from "../src/routes/prescription-document-preview.routes.js";
import { createS3PrescriptionDocumentPreviewService } from "../src/services/prescription-document-preview.service.js";
import type { UserSupabaseClient } from "../src/config/supabase-user.js";

const OWNER="10000000-0000-4000-8000-000000000001";
const PRESCRIPTION="10000000-0000-4000-8000-000000000010";

function client(row:Record<string,unknown>|null):UserSupabaseClient {
  const terminal={maybeSingle:async()=>({data:row,error:null})};
  const chain:any={select:()=>chain,eq:()=>chain,maybeSingle:terminal.maybeSingle};
  return {from:()=>chain} as unknown as UserSupabaseClient;
}

function app(row:Record<string,unknown>|null,body=Buffer.from("%PDF-fictional")) {
  const service=createS3PrescriptionDocumentPreviewService({region:"ap-south-1",bucket:"private-test",maximumBytes:1024,
    client:{async send(){return {Body:Readable.from([body])};}} as never});
  const instance=express();
  instance.use(createPrescriptionDocumentPreviewRouter({async verifyAccessToken(token){if(token!=="valid") throw new Error();return {userId:OWNER};}},()=>client(row),service));
  instance.use(errorHandler); return instance;
}

test("serves only the authenticated owner's bounded private document",async()=>{
  const response=await request(app({id:PRESCRIPTION,user_id:OWNER,storage_provider:"aws_s3",storage_bucket:"private-test",
    object_key:`private/prescriptions/${PRESCRIPTION}/source.pdf`,file_type:"application/pdf",file_size_bytes:14}))
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
  const response=await request(app(row,Buffer.alloc(1025))).get(`/api/v1/prescriptions/${PRESCRIPTION}/document/preview`).set("authorization","Bearer valid");
  assert.equal(response.status,413); assert.equal(response.body.error.code,"DOCUMENT_TOO_LARGE");
});
