\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

-- Composite key permits every child row to prove that its owner is the
-- prescription owner without trusting a client-supplied user identifier.
ALTER TABLE public.prescriptions
  ADD CONSTRAINT prescriptions_id_user_review_unique UNIQUE (id, user_id);

CREATE TABLE public.prescription_ocr_evidence_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id uuid NOT NULL,
  user_id uuid NOT NULL,
  schema_version text NOT NULL CHECK (length(btrim(schema_version)) BETWEEN 1 AND 40),
  document_sha256 text CHECK (document_sha256 IS NULL OR document_sha256 ~ '^[0-9a-f]{64}$'),
  page_count integer CHECK (page_count IS NULL OR page_count BETWEEN 1 AND 10),
  provider_count integer NOT NULL CHECK (provider_count BETWEEN 0 AND 4),
  evidence_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence_payload)='object' AND pg_column_size(evidence_payload) <= 1048576),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (prescription_id, id),
  FOREIGN KEY (prescription_id, user_id) REFERENCES public.prescriptions(id, user_id) ON DELETE CASCADE
);

CREATE TABLE public.prescription_review_revisions (
  id uuid PRIMARY KEY,
  prescription_id uuid NOT NULL,
  user_id uuid NOT NULL,
  evidence_set_id uuid NOT NULL,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  base_revision_id uuid REFERENCES public.prescription_review_revisions(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('draft','confirmed','superseded')),
  lock_version bigint NOT NULL DEFAULT 0 CHECK (lock_version >= 0),
  review_schema_version text NOT NULL CHECK (review_schema_version='1.0'),
  review_json jsonb NOT NULL CHECK (jsonb_typeof(review_json)='object' AND pg_column_size(review_json) <= 1048576),
  input_fingerprint text CHECK (input_fingerprint IS NULL OR input_fingerprint ~ '^[0-9a-f]{64}$'),
  confirmation_idempotency_key text CHECK (confirmation_idempotency_key IS NULL OR length(confirmation_idempotency_key) BETWEEN 1 AND 128),
  confirmed_at timestamptz,
  is_current boolean NOT NULL DEFAULT true,
  intelligence_state text NOT NULL DEFAULT 'not_requested' CHECK (intelligence_state IN ('not_requested','pending','bound','completed','stale')),
  intelligence_request_key text UNIQUE,
  processing_job_id uuid REFERENCES public.ai_jobs(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (prescription_id, revision_number),
  UNIQUE (prescription_id, confirmation_idempotency_key),
  UNIQUE (prescription_id, id),
  FOREIGN KEY (prescription_id, user_id) REFERENCES public.prescriptions(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (prescription_id, evidence_set_id) REFERENCES public.prescription_ocr_evidence_sets(prescription_id, id) ON DELETE RESTRICT,
  CHECK ((status IN ('confirmed','superseded')) = (input_fingerprint IS NOT NULL AND confirmation_idempotency_key IS NOT NULL AND confirmed_at IS NOT NULL)),
  CHECK (status <> 'draft' OR (input_fingerprint IS NULL AND confirmation_idempotency_key IS NULL AND confirmed_at IS NULL)),
  CHECK ((intelligence_state='not_requested') OR status IN ('confirmed','superseded'))
);

CREATE UNIQUE INDEX prescription_review_one_current_idx
  ON public.prescription_review_revisions(prescription_id) WHERE is_current;
CREATE UNIQUE INDEX prescription_review_one_draft_idx
  ON public.prescription_review_revisions(prescription_id) WHERE status='draft' AND is_current;
CREATE INDEX prescription_review_owner_history_idx
  ON public.prescription_review_revisions(user_id, prescription_id, revision_number DESC);

CREATE TABLE public.prescription_review_medicines (
  revision_id uuid NOT NULL REFERENCES public.prescription_review_revisions(id) ON DELETE CASCADE,
  prescription_id uuid NOT NULL,
  medicine_id uuid NOT NULL,
  origin text NOT NULL CHECK (origin IN ('extracted','user_added')),
  status text NOT NULL CHECK (status IN ('active','removed')),
  position integer NOT NULL CHECK (position > 0),
  original_fields jsonb,
  current_fields jsonb NOT NULL CHECK (jsonb_typeof(current_fields)='object' AND pg_column_size(current_fields) <= 16384),
  provenance jsonb NOT NULL CHECK (jsonb_typeof(provenance)='object' AND pg_column_size(provenance) <= 16384),
  added_by_command_id text CHECK (added_by_command_id IS NULL OR length(added_by_command_id) BETWEEN 1 AND 128),
  removed_at timestamptz,
  PRIMARY KEY (revision_id, medicine_id),
  FOREIGN KEY (prescription_id, revision_id) REFERENCES public.prescription_review_revisions(prescription_id, id) ON DELETE CASCADE,
  CHECK ((origin='extracted') = (original_fields IS NOT NULL)),
  CHECK (original_fields IS NULL OR jsonb_typeof(original_fields)='object'),
  CHECK ((status='removed') = (removed_at IS NOT NULL))
);
CREATE UNIQUE INDEX prescription_review_active_position_idx
  ON public.prescription_review_medicines(revision_id, position) WHERE status='active';
CREATE UNIQUE INDEX prescription_review_add_command_idx
  ON public.prescription_review_medicines(revision_id, added_by_command_id) WHERE added_by_command_id IS NOT NULL;

CREATE TABLE public.prescription_review_events (
  id uuid PRIMARY KEY,
  prescription_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  user_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('draft_created','medicine_edited','medicine_added','medicine_removed','medicine_restored','original_restored','medicines_reordered','draft_saved','revision_confirmed','revision_reopened')),
  medicine_id uuid,
  changed_fields text[] NOT NULL DEFAULT '{}',
  idempotency_key text CHECK (idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 128),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (prescription_id, revision_id) REFERENCES public.prescription_review_revisions(prescription_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (prescription_id, user_id) REFERENCES public.prescriptions(id, user_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX prescription_review_event_idempotency_idx
  ON public.prescription_review_events(prescription_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX prescription_review_events_history_idx
  ON public.prescription_review_events(prescription_id, occurred_at, id);

-- Legacy result rows remain valid with null review columns. A future reviewed
-- finalization RPC must require all three review fields together for V3 jobs.
ALTER TABLE public.prescription_intelligence_results
  ADD COLUMN review_revision_id uuid REFERENCES public.prescription_review_revisions(id) ON DELETE RESTRICT,
  ADD COLUMN review_input_fingerprint text CHECK (review_input_fingerprint IS NULL OR review_input_fingerprint ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT prescription_result_review_binding_complete CHECK (
    (review_revision_id IS NULL AND review_input_fingerprint IS NULL)
    OR (review_revision_id IS NOT NULL AND review_input_fingerprint IS NOT NULL)
  );

ALTER TABLE public.prescription_ocr_evidence_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prescription_review_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prescription_review_medicines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prescription_review_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY prescription_evidence_select_own ON public.prescription_ocr_evidence_sets
  FOR SELECT TO authenticated USING (user_id=auth.uid());
CREATE POLICY prescription_review_revisions_select_own ON public.prescription_review_revisions
  FOR SELECT TO authenticated USING (user_id=auth.uid());
CREATE POLICY prescription_review_medicines_select_own ON public.prescription_review_medicines
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.prescription_review_revisions r WHERE r.id=revision_id AND r.user_id=auth.uid()));
CREATE POLICY prescription_review_events_select_own ON public.prescription_review_events
  FOR SELECT TO authenticated USING (user_id=auth.uid());

REVOKE ALL ON public.prescription_ocr_evidence_sets, public.prescription_review_revisions,
  public.prescription_review_medicines, public.prescription_review_events FROM PUBLIC, anon, authenticated;
GRANT SELECT (id,prescription_id,user_id,schema_version,document_sha256,page_count,provider_count,created_at)
  ON public.prescription_ocr_evidence_sets TO authenticated;
GRANT SELECT ON public.prescription_review_revisions, public.prescription_review_medicines,
  public.prescription_review_events TO authenticated;

-- Internal helpers are deliberately not granted to any application role.
CREATE FUNCTION public.meddecode_review_write_medicines_v1(p_revision_id uuid, p_prescription_id uuid, p_medicines jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE m jsonb;
BEGIN
  IF jsonb_typeof(p_medicines) <> 'array' OR jsonb_array_length(p_medicines) > 100 OR pg_column_size(p_medicines) > 1048576 THEN
    RAISE EXCEPTION 'review_invalid';
  END IF;
  DELETE FROM public.prescription_review_medicines WHERE revision_id=p_revision_id;
  FOR m IN SELECT value FROM jsonb_array_elements(p_medicines) LOOP
    IF jsonb_typeof(m) <> 'object' THEN RAISE EXCEPTION 'review_invalid'; END IF;
    INSERT INTO public.prescription_review_medicines(
      revision_id,prescription_id,medicine_id,origin,status,position,original_fields,current_fields,
      provenance,added_by_command_id,removed_at
    ) VALUES (
      p_revision_id,p_prescription_id,(m->>'medicineId')::uuid,m->>'origin',m->>'status',(m->>'position')::integer,
      m->'original',m->'current',m->'provenance',nullif(m->>'addedByCommandId',''),
      CASE WHEN m->>'removedAt' IS NULL THEN NULL ELSE (m->>'removedAt')::timestamptz END
    );
  END LOOP;
END $fn$;

CREATE FUNCTION public.meddecode_review_append_event_v1(
  p_user_id uuid,p_prescription_id uuid,p_revision_id uuid,p_event jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
  IF jsonb_typeof(p_event) <> 'object' OR pg_column_size(p_event) > 16384 THEN RAISE EXCEPTION 'review_invalid'; END IF;
  INSERT INTO public.prescription_review_events(
    id,prescription_id,revision_id,user_id,event_type,medicine_id,changed_fields,idempotency_key,occurred_at
  ) VALUES (
    (p_event->>'eventId')::uuid,p_prescription_id,p_revision_id,p_user_id,p_event->>'type',
    CASE WHEN p_event->>'medicineId' IS NULL THEN NULL ELSE (p_event->>'medicineId')::uuid END,
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_event->'changedFields','[]'::jsonb))),
    nullif(p_event->>'idempotencyKey',''),COALESCE((p_event->>'occurredAt')::timestamptz,clock_timestamp())
  );
END $fn$;

REVOKE ALL ON FUNCTION public.meddecode_review_write_medicines_v1(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.meddecode_review_append_event_v1(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.meddecode_has_owned_prescription_review_v1(p_prescription_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
  SELECT EXISTS(SELECT 1 FROM public.prescriptions p WHERE p.id=p_prescription_id AND p.user_id=auth.uid())
$fn$;

CREATE FUNCTION public.meddecode_get_prescription_review_v1(p_prescription_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
  SELECT r.review_json FROM public.prescription_review_revisions r
  WHERE r.prescription_id=p_prescription_id AND r.user_id=auth.uid() AND r.is_current
$fn$;

CREATE FUNCTION public.meddecode_list_prescription_review_revisions_v1(p_prescription_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
  SELECT COALESCE(jsonb_agg(r.review_json ORDER BY r.revision_number DESC),'[]'::jsonb)
  FROM public.prescription_review_revisions r WHERE r.prescription_id=p_prescription_id AND r.user_id=auth.uid()
$fn$;

CREATE FUNCTION public.meddecode_get_prescription_review_evidence_v1(p_prescription_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
  SELECT jsonb_build_object(
    'evidenceSetId',e.id,'prescriptionId',e.prescription_id,'schemaVersion',e.schema_version,
    'documentSha256',e.document_sha256,'pageCount',e.page_count,'providerCount',e.provider_count,'createdAt',e.created_at
  ) FROM public.prescription_ocr_evidence_sets e
  WHERE e.prescription_id=p_prescription_id AND e.user_id=auth.uid()
$fn$;

CREATE FUNCTION public.meddecode_get_review_intelligence_request_v1(p_prescription_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
  SELECT CASE WHEN r.intelligence_request_key IS NULL THEN NULL ELSE jsonb_build_object(
    'requestKey',r.intelligence_request_key,'ownerId',r.user_id,'prescriptionId',r.prescription_id,
    'confirmedRevisionId',r.id,'inputFingerprint',r.input_fingerprint,'processingJobId',r.processing_job_id,
    'state',r.intelligence_state,'createdAt',r.confirmed_at
  ) END FROM public.prescription_review_revisions r
  WHERE r.prescription_id=p_prescription_id AND r.user_id=auth.uid() AND r.is_current
$fn$;

CREATE FUNCTION public.meddecode_apply_prescription_review_draft_v1(
  p_prescription_id uuid,p_revision_id uuid,p_expected_revision_number integer,p_expected_lock_version bigint,
  p_review jsonb,p_medicines jsonb,p_event jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE v_user uuid:=auth.uid(); v_revision public.prescription_review_revisions%ROWTYPE; v_event_key text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'review_not_found'; END IF;
  SELECT * INTO v_revision FROM public.prescription_review_revisions
    WHERE id=p_revision_id AND prescription_id=p_prescription_id AND user_id=v_user AND is_current FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'review_not_found'; END IF;
  v_event_key:=nullif(p_event->>'idempotencyKey','');
  IF v_event_key IS NOT NULL AND EXISTS(SELECT 1 FROM public.prescription_review_events WHERE prescription_id=p_prescription_id AND idempotency_key=v_event_key AND revision_id=p_revision_id AND event_type=p_event->>'type') THEN
    RETURN v_revision.review_json;
  END IF;
  IF v_revision.status<>'draft' THEN RAISE EXCEPTION 'review_immutable'; END IF;
  IF v_revision.revision_number<>p_expected_revision_number OR v_revision.lock_version<>p_expected_lock_version THEN RAISE EXCEPTION 'review_stale'; END IF;
  IF jsonb_typeof(p_review)<>'object' OR pg_column_size(p_review)>1048576
     OR p_review->>'revisionId'<>p_revision_id::text OR (p_review->>'prescriptionId')::uuid<>p_prescription_id
     OR (p_review->>'revisionNumber')::integer<>p_expected_revision_number
     OR (p_review->>'lockVersion')::bigint<>p_expected_lock_version+1 OR p_review->>'status'<>'draft' THEN
    RAISE EXCEPTION 'review_conflict';
  END IF;
  UPDATE public.prescription_review_revisions SET review_json=p_review,lock_version=p_expected_lock_version+1,updated_at=clock_timestamp()
    WHERE id=p_revision_id;
  PERFORM public.meddecode_review_write_medicines_v1(p_revision_id,p_prescription_id,p_medicines);
  PERFORM public.meddecode_review_append_event_v1(v_user,p_prescription_id,p_revision_id,p_event);
  RETURN p_review;
END $fn$;

CREATE FUNCTION public.meddecode_confirm_prescription_review_v1(
  p_prescription_id uuid,p_revision_id uuid,p_expected_revision_number integer,p_expected_lock_version bigint,
  p_review jsonb,p_medicines jsonb,p_event jsonb,p_request jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE v_user uuid:=auth.uid(); v_revision public.prescription_review_revisions%ROWTYPE; v_key text:=nullif(p_event->>'idempotencyKey',''); v_fingerprint text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'review_not_found'; END IF;
  SELECT * INTO v_revision FROM public.prescription_review_revisions
    WHERE id=p_revision_id AND prescription_id=p_prescription_id AND user_id=v_user AND is_current FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'review_not_found'; END IF;
  IF v_revision.status='confirmed' AND v_revision.confirmation_idempotency_key=v_key THEN
    RETURN jsonb_build_object('review',v_revision.review_json,'intelligenceRequest',jsonb_build_object(
      'requestKey',v_revision.intelligence_request_key,'ownerId',v_user,'prescriptionId',p_prescription_id,
      'confirmedRevisionId',v_revision.id,'inputFingerprint',v_revision.input_fingerprint,
      'processingJobId',v_revision.processing_job_id,'state',v_revision.intelligence_state,'createdAt',v_revision.confirmed_at));
  END IF;
  IF v_revision.status<>'draft' THEN RAISE EXCEPTION 'review_immutable'; END IF;
  IF v_revision.revision_number<>p_expected_revision_number OR v_revision.lock_version<>p_expected_lock_version THEN RAISE EXCEPTION 'review_stale'; END IF;
  v_fingerprint:=p_review#>>'{canonicalInputFingerprint,value}';
  IF v_key IS NULL OR v_fingerprint !~ '^[0-9a-f]{64}$' OR jsonb_typeof(p_request)<>'object'
     OR p_review->>'status'<>'confirmed' OR (p_review->>'lockVersion')::bigint<>p_expected_lock_version+1
     OR p_request->>'confirmedRevisionId'<>p_revision_id::text OR p_request->>'inputFingerprint'<>v_fingerprint
     OR p_request->>'requestKey' IS NULL THEN RAISE EXCEPTION 'review_conflict'; END IF;
  UPDATE public.prescription_review_revisions SET
    status='confirmed',review_json=p_review,lock_version=p_expected_lock_version+1,input_fingerprint=v_fingerprint,
    confirmation_idempotency_key=v_key,confirmed_at=(p_review#>>'{confirmation,confirmedAt}')::timestamptz,
    intelligence_state='pending',intelligence_request_key=p_request->>'requestKey',updated_at=clock_timestamp()
    WHERE id=p_revision_id;
  PERFORM public.meddecode_review_write_medicines_v1(p_revision_id,p_prescription_id,p_medicines);
  PERFORM public.meddecode_review_append_event_v1(v_user,p_prescription_id,p_revision_id,p_event);
  RETURN jsonb_build_object('review',p_review,'intelligenceRequest',p_request);
END $fn$;

CREATE FUNCTION public.meddecode_reopen_prescription_review_v1(
  p_prescription_id uuid,p_revision_id uuid,p_expected_revision_number integer,p_expected_lock_version bigint,
  p_new_review jsonb,p_medicines jsonb,p_event jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE v_user uuid:=auth.uid(); v_current public.prescription_review_revisions%ROWTYPE; v_new_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'review_not_found'; END IF;
  SELECT * INTO v_current FROM public.prescription_review_revisions
    WHERE id=p_revision_id AND prescription_id=p_prescription_id AND user_id=v_user AND is_current FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'review_not_found'; END IF;
  IF v_current.status<>'confirmed' THEN RAISE EXCEPTION 'review_invalid_transition'; END IF;
  IF v_current.revision_number<>p_expected_revision_number OR v_current.lock_version<>p_expected_lock_version THEN RAISE EXCEPTION 'review_stale'; END IF;
  v_new_id:=(p_new_review->>'revisionId')::uuid;
  IF p_new_review->>'status'<>'draft' OR (p_new_review->>'baseRevisionId')::uuid<>p_revision_id
     OR (p_new_review->>'revisionNumber')::integer<>p_expected_revision_number+1 OR (p_new_review->>'lockVersion')::bigint<>0 THEN
    RAISE EXCEPTION 'review_conflict'; END IF;
  UPDATE public.prescription_review_revisions SET is_current=false,
    intelligence_state=CASE WHEN intelligence_state IN ('pending','bound') THEN 'stale' ELSE intelligence_state END,
    updated_at=clock_timestamp() WHERE id=p_revision_id;
  INSERT INTO public.prescription_review_revisions(
    id,prescription_id,user_id,evidence_set_id,revision_number,base_revision_id,status,lock_version,
    review_schema_version,review_json,is_current,created_at,updated_at
  ) VALUES (v_new_id,p_prescription_id,v_user,v_current.evidence_set_id,p_expected_revision_number+1,p_revision_id,'draft',0,'1.0',p_new_review,true,clock_timestamp(),clock_timestamp());
  PERFORM public.meddecode_review_write_medicines_v1(v_new_id,p_prescription_id,p_medicines);
  PERFORM public.meddecode_review_append_event_v1(v_user,p_prescription_id,v_new_id,p_event);
  RETURN p_new_review;
END $fn$;

-- OCR-to-review initialization is worker-only and derives owner from the
-- already-owned processing job. It is idempotent for the same prescription.
CREATE FUNCTION public.meddecode_initialize_prescription_review_v1(
  p_job_id uuid,p_prescription_id uuid,p_evidence jsonb,p_review jsonb,p_medicines jsonb,p_event jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE v_role text:=current_setting('role',true); v_user uuid; v_evidence_id uuid; v_revision_id uuid; v_existing jsonb;
BEGIN
  IF v_role IS DISTINCT FROM 'meddecode_scoped_worker' THEN RAISE EXCEPTION 'review_forbidden'; END IF;
  SELECT j.user_id INTO v_user FROM public.ai_jobs j JOIN public.prescriptions p ON p.id=j.prescription_id AND p.user_id=j.user_id
    WHERE j.id=p_job_id AND j.prescription_id=p_prescription_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'review_not_found'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.meddecode_scoped_worker_scope s
    WHERE s.job_id=p_job_id AND s.prescription_id=p_prescription_id AND s.user_id=v_user
      AND s.worker_login=session_user AND s.enabled AND s.expires_at>clock_timestamp()
  ) THEN RAISE EXCEPTION 'review_forbidden'; END IF;
  SELECT review_json INTO v_existing FROM public.prescription_review_revisions WHERE prescription_id=p_prescription_id AND is_current;
  IF FOUND THEN RETURN v_existing; END IF;
  v_evidence_id:=(p_evidence->>'evidenceSetId')::uuid; v_revision_id:=(p_review->>'revisionId')::uuid;
  IF p_review->>'status'<>'draft' OR (p_review->>'revisionNumber')::integer<>1 OR (p_review->>'lockVersion')::bigint<>0
     OR (p_review->>'prescriptionId')::uuid<>p_prescription_id OR pg_column_size(p_evidence)>1048576 THEN RAISE EXCEPTION 'review_conflict'; END IF;
  INSERT INTO public.prescription_ocr_evidence_sets(id,prescription_id,user_id,schema_version,document_sha256,page_count,provider_count,evidence_payload)
  VALUES(v_evidence_id,p_prescription_id,v_user,p_evidence->>'schemaVersion',nullif(p_evidence->>'documentSha256',''),
    NULLIF(p_evidence->>'pageCount','')::integer,COALESCE((p_evidence->>'providerCount')::integer,0),COALESCE(p_evidence->'payload','{}'::jsonb));
  INSERT INTO public.prescription_review_revisions(id,prescription_id,user_id,evidence_set_id,revision_number,status,lock_version,review_schema_version,review_json)
  VALUES(v_revision_id,p_prescription_id,v_user,v_evidence_id,1,'draft',0,'1.0',p_review);
  PERFORM public.meddecode_review_write_medicines_v1(v_revision_id,p_prescription_id,p_medicines);
  PERFORM public.meddecode_review_append_event_v1(v_user,p_prescription_id,v_revision_id,p_event);
  RETURN p_review;
END $fn$;

CREATE FUNCTION public.meddecode_bind_review_intelligence_job_v1(p_request_key text,p_processing_job_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE v_role text:=current_setting('role',true); r public.prescription_review_revisions%ROWTYPE;
BEGIN
  IF v_role IS DISTINCT FROM 'meddecode_scoped_worker' THEN RAISE EXCEPTION 'review_forbidden'; END IF;
  SELECT * INTO r FROM public.prescription_review_revisions WHERE intelligence_request_key=p_request_key AND is_current FOR UPDATE;
  IF NOT FOUND OR r.status<>'confirmed' OR r.intelligence_state NOT IN ('pending','bound') THEN RAISE EXCEPTION 'review_stale'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.ai_jobs j WHERE j.id=p_processing_job_id AND j.prescription_id=r.prescription_id AND j.user_id=r.user_id) THEN RAISE EXCEPTION 'review_conflict'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.meddecode_scoped_worker_scope s WHERE s.job_id=p_processing_job_id
      AND s.prescription_id=r.prescription_id AND s.user_id=r.user_id AND s.worker_login=session_user
      AND s.enabled AND s.expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'review_forbidden'; END IF;
  IF r.processing_job_id IS NOT NULL AND r.processing_job_id<>p_processing_job_id THEN RAISE EXCEPTION 'review_conflict'; END IF;
  UPDATE public.prescription_review_revisions SET processing_job_id=p_processing_job_id,intelligence_state='bound',updated_at=clock_timestamp() WHERE id=r.id;
  RETURN jsonb_build_object('requestKey',r.intelligence_request_key,'ownerId',r.user_id,'prescriptionId',r.prescription_id,
    'confirmedRevisionId',r.id,'inputFingerprint',r.input_fingerprint,'processingJobId',p_processing_job_id,'state','bound','createdAt',r.confirmed_at);
END $fn$;

CREATE FUNCTION public.meddecode_assert_current_review_result_v1(
  p_prescription_id uuid,p_revision_id uuid,p_input_fingerprint text,p_processing_job_id uuid
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE v_role text:=current_setting('role',true);
BEGIN
  IF v_role IS DISTINCT FROM 'meddecode_scoped_worker' THEN RAISE EXCEPTION 'review_forbidden'; END IF;
  PERFORM 1 FROM public.prescription_review_revisions r WHERE r.id=p_revision_id AND r.prescription_id=p_prescription_id
      AND r.is_current AND r.status='confirmed' AND r.input_fingerprint=p_input_fingerprint
      AND r.processing_job_id=p_processing_job_id AND r.intelligence_state='bound' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'review_stale'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.meddecode_scoped_worker_scope s WHERE s.job_id=p_processing_job_id
      AND s.prescription_id=p_prescription_id AND s.worker_login=session_user AND s.enabled
      AND s.expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'review_forbidden'; END IF;
  RETURN true;
END $fn$;

-- A V3 result write is rejected inside the same transaction if the revision,
-- fingerprint or job is no longer current. Legacy rows with both fields null
-- retain their previous behavior.
CREATE FUNCTION public.meddecode_fence_review_result_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE v_bound public.prescription_review_revisions%ROWTYPE;
BEGIN
  IF NEW.review_revision_id IS NULL AND NEW.review_input_fingerprint IS NULL THEN
    SELECT r.* INTO v_bound FROM public.prescription_review_revisions r
      WHERE r.processing_job_id=NEW.job_id FOR UPDATE;
    IF NOT FOUND THEN RETURN NEW; END IF;
    NEW.review_revision_id:=v_bound.id;
    NEW.review_input_fingerprint:=v_bound.input_fingerprint;
  END IF;
  PERFORM 1 FROM public.prescription_review_revisions r WHERE r.id=NEW.review_revision_id
      AND r.prescription_id=NEW.prescription_id AND r.is_current AND r.status='confirmed'
      AND r.input_fingerprint=NEW.review_input_fingerprint AND r.processing_job_id=NEW.job_id
      AND r.intelligence_state='bound' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'review_stale'; END IF;
  UPDATE public.prescription_review_revisions SET intelligence_state='completed',updated_at=clock_timestamp() WHERE id=NEW.review_revision_id;
  RETURN NEW;
END $fn$;
CREATE TRIGGER prescription_result_review_fence
BEFORE INSERT OR UPDATE OF review_revision_id,review_input_fingerprint,job_id ON public.prescription_intelligence_results
FOR EACH ROW EXECUTE FUNCTION public.meddecode_fence_review_result_v1();

REVOKE ALL ON FUNCTION public.meddecode_has_owned_prescription_review_v1(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.meddecode_get_prescription_review_v1(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.meddecode_list_prescription_review_revisions_v1(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.meddecode_get_prescription_review_evidence_v1(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.meddecode_get_review_intelligence_request_v1(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.meddecode_apply_prescription_review_draft_v1(uuid,uuid,integer,bigint,jsonb,jsonb,jsonb) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.meddecode_confirm_prescription_review_v1(uuid,uuid,integer,bigint,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.meddecode_reopen_prescription_review_v1(uuid,uuid,integer,bigint,jsonb,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.meddecode_has_owned_prescription_review_v1(uuid),
  public.meddecode_get_prescription_review_v1(uuid),public.meddecode_list_prescription_review_revisions_v1(uuid),
  public.meddecode_get_prescription_review_evidence_v1(uuid),public.meddecode_get_review_intelligence_request_v1(uuid),
  public.meddecode_apply_prescription_review_draft_v1(uuid,uuid,integer,bigint,jsonb,jsonb,jsonb),
  public.meddecode_confirm_prescription_review_v1(uuid,uuid,integer,bigint,jsonb,jsonb,jsonb,jsonb),
  public.meddecode_reopen_prescription_review_v1(uuid,uuid,integer,bigint,jsonb,jsonb,jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.meddecode_initialize_prescription_review_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb),
  public.meddecode_bind_review_intelligence_job_v1(text,uuid),
  public.meddecode_assert_current_review_result_v1(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.meddecode_fence_review_result_v1() FROM PUBLIC,anon,authenticated;
DO $grants$
BEGIN
  IF to_regrole('meddecode_scoped_worker') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.meddecode_initialize_prescription_review_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb),
      public.meddecode_bind_review_intelligence_job_v1(text,uuid),
      public.meddecode_assert_current_review_result_v1(uuid,uuid,text,uuid) TO meddecode_scoped_worker';
  END IF;
END $grants$;

COMMIT;
