import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool, type PoolClient } from "pg";

import { createInitialReviewFromIntelligence } from "../src/services/prescription-review-initializer.js";
import { PrescriptionReviewService } from "../src/services/prescription-review.service.js";
import { PostgresPrescriptionReviewRepository } from "../src/repositories/postgres-prescription-review.repository.js";
import { LocalConfirmedReviewIntelligenceClient } from "../src/services/confirmed-review-intelligence.client.js";
import { validateIntelligenceResponseV1 } from "../src/services/intelligence-contract-v1.validator.js";
import type { UserSupabaseClient } from "../src/config/supabase-user.js";

const required = (name: string) => { const value=process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value; };
const UUIDS={ owner:"91000000-0000-4000-8000-000000000001", other:"91000000-0000-4000-8000-000000000002",
  prescription:"92000000-0000-4000-8000-000000000001", evidence:"93000000-0000-4000-8000-000000000001",
  ocrJob:"94000000-0000-4000-8000-000000000001", job1:"94000000-0000-4000-8000-000000000002", job2:"94000000-0000-4000-8000-000000000003" };

class RpcClient {
  constructor(private pool: Pool, private role: "authenticated"|"meddecode_scoped_worker", private owner?: string) {}
  rpc=async (name:string,args:Record<string,unknown>) => {
    if (!/^meddecode_[a-z0-9_]+_v1$/.test(name)) return {data:null,error:{message:"rejected"}};
    const client=await this.pool.connect();
    try { await client.query("BEGIN"); await client.query(`SET LOCAL ROLE ${this.role}`);
      if(this.owner) await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[this.owner]);
      const keys=Object.keys(args); const values=keys.map(k=>{
        const value=args[k]; return typeof value==="object" && value!==null ? JSON.stringify(value) : value;
      });
      const sql=`SELECT public.${name}(${keys.map((_,i)=>`$${i+1}`).join(",")}) AS value`;
      const result=await client.query(sql,values); await client.query("COMMIT");
      const data=result.rows[0]?.value??null;
      return {data,error:null};
    } catch(error) { await client.query("ROLLBACK"); const message=error instanceof Error?error.message:"rpc_failed";
      console.error(`PHASE1D4_RPC_FAILED:${name}:${message}`); return {data:null,error:{message}}; }
    finally { client.release(); }
  };
}

async function workerCall(client:PoolClient,sql:string,values:unknown[]) {
  await client.query("BEGIN"); try { await client.query("SET LOCAL ROLE meddecode_scoped_worker"); const out=await client.query(sql,values); await client.query("COMMIT"); return out; }
  catch(error){await client.query("ROLLBACK");throw error;}
}

async function main(){
  if(required("PHASE1D4_DATABASE")!=="meddecode_phase1d4_20261115" || required("PGHOST")!=="127.0.0.1") throw new Error("LOCAL_DATABASE_GUARD_FAILED");
  const pool=new Pool({host:"127.0.0.1",port:55439,database:process.env.PHASE1D4_DATABASE,user:process.env.PHASE1D4_ADMIN_USER??"scoped_cluster_admin",max:2});
  const workerPool=new Pool({host:"127.0.0.1",port:55439,database:process.env.PHASE1D4_DATABASE,user:"meddecode_scoped_login",max:1});
  try {
    const source=JSON.parse(await readFile(required("PHASE1D4_CONTRACT"),"utf8")); source.job_id=UUIDS.ocrJob; source.prescription_id=UUIDS.prescription;
    const ocr=validateIntelligenceResponseV1(source,{jobId:UUIDS.ocrJob,prescriptionId:UUIDS.prescription});
    if(ocr.status==="failed") throw new Error("OCR_CONTRACT_FAILED");
    const initial=createInitialReviewFromIntelligence({result:ocr,evidenceSetId:UUIDS.evidence,evidenceSchemaVersion:"1.0",
      documentSha256:createHash("sha256").update(await readFile(required("PHASE1D4_DOCUMENT"))).digest("hex"),now:new Date().toISOString()});
    const admin=await pool.connect();
    try { await admin.query("INSERT INTO public.users(id) VALUES($1),($2)",[UUIDS.owner,UUIDS.other]);
      await admin.query("INSERT INTO public.prescriptions(id,user_id,storage_provider,object_key,status) VALUES($1,$2,'local','fictional/phase1d4.pdf','processing')",[UUIDS.prescription,UUIDS.owner]);
      await admin.query("INSERT INTO public.ai_jobs(id,user_id,prescription_id,job_type,status) VALUES($1,$2,$3,'prescription_analysis','queued')",[UUIDS.ocrJob,UUIDS.owner,UUIDS.prescription]);
      await admin.query("INSERT INTO public.meddecode_scoped_worker_scope(job_id,prescription_id,user_id,worker_login,worker_instance_id,enabled,expires_at) VALUES($1,$2,$3,'meddecode_scoped_login','phase1d4-worker',true,clock_timestamp()+interval '1 hour')",[UUIDS.ocrJob,UUIDS.prescription,UUIDS.owner]);
    } finally {admin.release();}
    const worker=await workerPool.connect();
    try { await workerCall(worker,"SELECT public.meddecode_initialize_prescription_review_v1($1,$2,$3,$4,$5,$6)",[
      UUIDS.ocrJob,UUIDS.prescription,{evidenceSetId:UUIDS.evidence,schemaVersion:"1.0",documentSha256:initial.evidence.documentSha256,pageCount:1,providerCount:1,payload:{}},
      initial,JSON.stringify(initial.medicines.map(m=>({medicineId:m.medicineId,origin:m.origin,status:m.status,position:m.position,original:m.original,current:m.current,provenance:m.provenance,addedByCommandId:m.addedByCommandId,removedAt:m.removedAt}))),
      JSON.stringify({eventId:randomUUID(),type:"draft_created",medicineId:null,changedFields:[],idempotencyKey:"phase1d4-init",occurredAt:initial.createdAt})]);
    } finally {worker.release();}
    const userRepo=new PostgresPrescriptionReviewRepository(new RpcClient(pool,"authenticated",UUIDS.owner) as unknown as UserSupabaseClient);
    const service=new PrescriptionReviewService(userRepo); let review=await service.getReview(UUIDS.owner,UUIDS.prescription); assert.equal(review.revisionNumber,1);
    const medicine=review.medicines[0]!;
    review=await service.applyDraft(UUIDS.owner,UUIDS.prescription,{expectedRevisionNumber:1,expectedLockVersion:review.lockVersion,
      operation:{type:"edit_fields",medicineId:medicine.medicineId,updates:{medicineName:"Examplemed Revision One",strengthValue:"10",strengthUnit:"mg"}},now:new Date().toISOString()});
    const staleLock=review.lockVersion;
    const confirmed1=await service.confirm(UUIDS.owner,UUIDS.prescription,{expectedRevisionNumber:1,expectedLockVersion:review.lockVersion,idempotencyKey:"phase1d4-confirm-1",now:new Date().toISOString()});
    const replay1=await service.confirm(UUIDS.owner,UUIDS.prescription,{expectedRevisionNumber:1,expectedLockVersion:confirmed1.review.lockVersion,idempotencyKey:"phase1d4-confirm-1",now:new Date().toISOString()});
    assert.equal(replay1.review.canonicalInputFingerprint?.value,confirmed1.review.canonicalInputFingerprint?.value);
    await assert.rejects(() => service.applyDraft(UUIDS.owner,UUIDS.prescription,{expectedRevisionNumber:1,expectedLockVersion:staleLock,
      operation:{type:"edit_fields",medicineId:medicine.medicineId,updates:{medicineName:"Stale edit must fail"}},now:new Date().toISOString()}));
    const python=new LocalConfirmedReviewIntelligenceClient({pythonExecutable:required("MEDDECODE_PYTHON"),intelligenceDirectory:required("MEDDECODE_INTELLIGENCE_DIR"),timeoutMs:30000});
    const result1=await python.analyzeConfirmed({jobId:UUIDS.job1,prescriptionId:UUIDS.prescription,review:confirmed1.review});
    await finalize(pool,workerPool,confirmed1.review,UUIDS.job1,result1);
    review=await service.reopen(UUIDS.owner,UUIDS.prescription,{expectedRevisionNumber:1,expectedLockVersion:confirmed1.review.lockVersion,now:new Date().toISOString()});
    review=await service.applyDraft(UUIDS.owner,UUIDS.prescription,{expectedRevisionNumber:2,expectedLockVersion:review.lockVersion,
      operation:{type:"edit_fields",medicineId:review.medicines[0]!.medicineId,updates:{medicineName:"Examplemed Revision Two",strengthValue:"20"}},now:new Date().toISOString()});
    const confirmed2=await service.confirm(UUIDS.owner,UUIDS.prescription,{expectedRevisionNumber:2,expectedLockVersion:review.lockVersion,idempotencyKey:"phase1d4-confirm-2",now:new Date().toISOString()});
    const result2=await python.analyzeConfirmed({jobId:UUIDS.job2,prescriptionId:UUIDS.prescription,review:confirmed2.review});
    await finalize(pool,workerPool,confirmed2.review,UUIDS.job2,result2);
    const check=await pool.query("SELECT count(*)::int total,count(*) FILTER(WHERE is_current)::int current,max(job_id::text) FILTER(WHERE is_current) current_job FROM public.prescription_intelligence_results WHERE prescription_id=$1",[UUIDS.prescription]);
    assert.deepEqual(check.rows[0],{total:2,current:1,current_job:UUIDS.job2});
    const cross=new PostgresPrescriptionReviewRepository(new RpcClient(pool,"authenticated",UUIDS.other) as unknown as UserSupabaseClient);
    assert.equal(await cross.getCurrentRevision(UUIDS.other,UUIDS.prescription),null);
    console.log(JSON.stringify({marker:"PHASE1D4_CONTINUOUS_E2E_OK",ocrMedicines:ocr.medicines.length,revision1:confirmed1.review.revisionId,
      fingerprint1:confirmed1.review.canonicalInputFingerprint?.value,revision2:confirmed2.review.revisionId,
      fingerprint2:confirmed2.review.canonicalInputFingerprint?.value,result1:UUIDS.job1,result2:UUIDS.job2,current:UUIDS.job2,history:2}));
  } finally {
    const cleanup=await pool.connect().catch(()=>null);
    if(cleanup) try {
      await cleanup.query("BEGIN");
      await cleanup.query("DELETE FROM public.prescription_intelligence_results WHERE prescription_id=$1",[UUIDS.prescription]);
      await cleanup.query("DELETE FROM public.prescription_recommendations WHERE prescription_id=$1",[UUIDS.prescription]);
      await cleanup.query("DELETE FROM public.prescription_warnings WHERE prescription_id=$1",[UUIDS.prescription]);
      await cleanup.query("DELETE FROM public.prescription_medicines WHERE prescription_id=$1",[UUIDS.prescription]);
      await cleanup.query("DELETE FROM public.meddecode_scoped_worker_scope WHERE prescription_id=$1",[UUIDS.prescription]);
      await cleanup.query("DELETE FROM public.prescription_review_events WHERE prescription_id=$1",[UUIDS.prescription]);
      await cleanup.query("DELETE FROM public.prescription_review_medicines WHERE prescription_id=$1",[UUIDS.prescription]);
      await cleanup.query("DELETE FROM public.prescription_review_revisions WHERE prescription_id=$1",[UUIDS.prescription]);
      await cleanup.query("DELETE FROM public.prescription_ocr_evidence_sets WHERE prescription_id=$1",[UUIDS.prescription]);
      await cleanup.query("DELETE FROM public.ai_jobs WHERE prescription_id=$1",[UUIDS.prescription]);
      await cleanup.query("DELETE FROM public.prescriptions WHERE id=$1",[UUIDS.prescription]);
      await cleanup.query("DELETE FROM public.users WHERE id=ANY($1::uuid[])",[[UUIDS.owner,UUIDS.other]]);
      await cleanup.query("COMMIT");
      console.log("PHASE1D4_FIXTURE_CLEANUP_OK");
    } catch(error) { await cleanup.query("ROLLBACK").catch(()=>undefined); console.error(`PHASE1D4_FIXTURE_CLEANUP_FAILED:${error instanceof Error?error.message:"unknown"}`); }
    finally {cleanup.release();}
    await workerPool.end();await pool.end();
  }
}

async function finalize(pool:Pool,workerPool:Pool,review:any,jobId:string,result:any){
 const admin=await pool.connect(); try {await admin.query("INSERT INTO public.ai_jobs(id,user_id,prescription_id,job_type,status,lease_owner,lease_expires_at,heartbeat_at,started_at,claim_generation,attempt_count) VALUES($1,$2,$3,'prescription_analysis','processing','phase1d4-worker',clock_timestamp()+interval '10 minutes',clock_timestamp(),clock_timestamp(),1,1)",[jobId,UUIDS.owner,UUIDS.prescription]);
 await admin.query("INSERT INTO public.meddecode_scoped_worker_scope(job_id,prescription_id,user_id,worker_login,worker_instance_id,enabled,expires_at) VALUES($1,$2,$3,'meddecode_scoped_login','phase1d4-worker',true,clock_timestamp()+interval '1 hour')",[jobId,UUIDS.prescription,UUIDS.owner]);
 await admin.query("UPDATE public.prescriptions SET status='processing' WHERE id=$1",[UUIDS.prescription]);} finally{admin.release();}
 const workerRepo=new PostgresPrescriptionReviewRepository(new RpcClient(workerPool,"meddecode_scoped_worker") as unknown as UserSupabaseClient);
 await workerRepo.bindProcessingJob(UUIDS.owner,`review:${review.revisionId}:${review.canonicalInputFingerprint.value}`,jobId);
 const worker=await workerPool.connect(); try{await workerCall(worker,"SELECT * FROM public.meddecode_finalize_review_result_v1($1,$2,$3,$4,$5,$6,$7)",[jobId,UUIDS.prescription,review.revisionId,review.canonicalInputFingerprint.value,"phase1d4-worker",1,result]);}finally{worker.release();}
}
void main().catch(error=>{console.error(`PHASE1D4_FAILED:${error instanceof Error?(error.stack??error.message):"unknown"}`);process.exitCode=1;});
