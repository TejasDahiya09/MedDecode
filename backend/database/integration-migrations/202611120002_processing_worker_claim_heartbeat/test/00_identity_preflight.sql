\set ON_ERROR_STOP on

DO $identity$
BEGIN
  IF current_database() IS DISTINCT FROM 'meddecode_job_test'
     OR inet_server_addr() IS DISTINCT FROM inet '127.0.0.1'
     OR inet_server_port() IS DISTINCT FROM 5433
     OR current_setting('server_version_num')::integer / 10000 <> 17 THEN
    RAISE EXCEPTION 'approved disposable PostgreSQL identity could not be verified';
  END IF;
END
$identity$;

SELECT 'IDENTITY_OK';
