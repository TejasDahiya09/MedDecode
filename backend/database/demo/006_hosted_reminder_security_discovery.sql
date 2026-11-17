-- READ-ONLY hosted Reminder security discovery.
-- Reports live schema effects only; it does not infer migration deployment
-- from repository files or read reminder, dose-log, Cabinet, or user rows.

BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';

SELECT
  'public.medication_reminders'::text AS table_name,
  to_regclass('public.medication_reminders') IS NOT NULL AS table_exists
UNION ALL
SELECT
  'public.medication_dose_logs',
  to_regclass('public.medication_dose_logs') IS NOT NULL;

SELECT
  expected.table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS force_rls
FROM (
  VALUES
    ('public.medication_reminders'::text),
    ('public.medication_dose_logs'::text)
) AS expected(table_name)
LEFT JOIN pg_class AS c
  ON c.oid = to_regclass(expected.table_name);

-- Exact deployed policy expressions and policy names for both tables.
SELECT
  p.polrelid::regclass::text AS table_name,
  p.polname AS policy_name,
  CASE p.polcmd
    WHEN 'r' THEN 'SELECT'
    WHEN 'a' THEN 'INSERT'
    WHEN 'w' THEN 'UPDATE'
    WHEN 'd' THEN 'DELETE'
    WHEN '*' THEN 'ALL'
    ELSE p.polcmd::text
  END AS command,
  p.polpermissive AS permissive,
  ARRAY(
    SELECT role_oid::regrole::text
    FROM unnest(p.polroles) AS roles(role_oid)
    ORDER BY role_oid
  ) AS roles,
  pg_get_expr(p.polqual, p.polrelid) AS using_expression,
  pg_get_expr(p.polwithcheck, p.polrelid) AS with_check_expression
FROM pg_policy AS p
WHERE p.polrelid IN (
  to_regclass('public.medication_reminders'),
  to_regclass('public.medication_dose_logs')
)
ORDER BY table_name, policy_name;

-- These booleans test the observable corrected INSERT/UPDATE predicate
-- shape used by Migration 009. They do not prove a migration-ledger entry.
SELECT
  EXISTS (
    SELECT 1
    FROM pg_policy AS p
    WHERE p.polrelid = to_regclass('public.medication_reminders')
      AND p.polname = 'medication_reminders_owner_insert'
      AND p.polcmd = 'a'
      AND COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '')
        ILIKE '%medication_reminders.medicine_id%'
      AND COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '')
        ILIKE '%mc.user_id = auth.uid()%'
  ) AS corrected_insert_effect_observed,
  EXISTS (
    SELECT 1
    FROM pg_policy AS p
    WHERE p.polrelid = to_regclass('public.medication_reminders')
      AND p.polname = 'medication_reminders_owner_update'
      AND p.polcmd = 'w'
      AND COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '')
        ILIKE '%medication_reminders.medicine_id%'
      AND COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '')
        ILIKE '%mc.user_id = auth.uid()%'
      AND COALESCE(pg_get_expr(p.polqual, p.polrelid), '')
        ILIKE '%auth.uid() = user_id%'
  ) AS corrected_update_effect_observed;

-- Direct PUBLIC table ACL entries. No rows means no direct PUBLIC grants.
SELECT
  c.relname AS table_name,
  acl.privilege_type,
  acl.is_grantable
FROM pg_class AS c
CROSS JOIN LATERAL aclexplode(
  COALESCE(c.relacl, acldefault('r', c.relowner))
) AS acl
WHERE c.oid IN (
  to_regclass('public.medication_reminders'),
  to_regclass('public.medication_dose_logs')
)
  AND acl.grantee = 0
ORDER BY c.relname, acl.privilege_type;

-- Effective table privileges: anon includes any PUBLIC-granted access.
SELECT
  expected.table_name,
  has_table_privilege(to_regrole('anon'), c.oid, 'SELECT') AS anon_select,
  has_table_privilege(to_regrole('anon'), c.oid, 'INSERT') AS anon_insert,
  has_table_privilege(to_regrole('anon'), c.oid, 'UPDATE') AS anon_update,
  has_table_privilege(to_regrole('anon'), c.oid, 'DELETE') AS anon_delete,
  has_table_privilege(to_regrole('anon'), c.oid, 'TRUNCATE') AS anon_truncate,
  has_table_privilege(to_regrole('anon'), c.oid, 'REFERENCES') AS anon_references,
  has_table_privilege(to_regrole('anon'), c.oid, 'TRIGGER') AS anon_trigger,
  has_table_privilege(to_regrole('authenticated'), c.oid, 'SELECT') AS authenticated_select,
  has_table_privilege(to_regrole('authenticated'), c.oid, 'INSERT') AS authenticated_insert,
  has_table_privilege(to_regrole('authenticated'), c.oid, 'UPDATE') AS authenticated_update,
  has_table_privilege(to_regrole('authenticated'), c.oid, 'DELETE') AS authenticated_delete
FROM (
  VALUES
    ('public.medication_reminders'::text),
    ('public.medication_dose_logs'::text)
) AS expected(table_name)
LEFT JOIN pg_class AS c
  ON c.oid = to_regclass(expected.table_name)
ORDER BY expected.table_name;

-- Explicit column-level grants on these tables, if any.
SELECT
  a.attrelid::regclass::text AS table_name,
  a.attname AS column_name,
  CASE
    WHEN acl.grantee = 0 THEN 'PUBLIC'
    ELSE role_info.rolname
  END AS grantee,
  acl.privilege_type,
  acl.is_grantable
FROM pg_attribute AS a
CROSS JOIN LATERAL aclexplode(a.attacl) AS acl
LEFT JOIN pg_roles AS role_info
  ON role_info.oid = acl.grantee
WHERE a.attrelid IN (
    to_regclass('public.medication_reminders'),
    to_regclass('public.medication_dose_logs')
  )
  AND a.attnum > 0
  AND NOT a.attisdropped
  AND acl.grantee IN (
    0,
    to_regrole('anon'),
    to_regrole('authenticated')
  )
ORDER BY table_name, column_name, grantee, acl.privilege_type;

-- Exact dose-log relationship and uniqueness constraint definitions.
SELECT
  c.conname AS constraint_name,
  c.contype AS constraint_type,
  c.convalidated AS is_validated,
  pg_get_constraintdef(c.oid, true) AS definition
FROM pg_constraint AS c
WHERE c.conrelid = to_regclass('public.medication_dose_logs')
  AND (
    c.contype IN ('f', 'u')
    OR c.conname IN (
      'medication_dose_logs_reminder_user_fkey'
    )
  )
ORDER BY c.conname;

SELECT
  EXISTS (
    SELECT 1
    FROM pg_constraint AS c
    WHERE c.conrelid = to_regclass('public.medication_dose_logs')
      AND c.contype = 'f'
      AND c.conname = 'medication_dose_logs_reminder_user_fkey'
      AND c.confrelid = to_regclass('public.medication_reminders')
      AND pg_get_constraintdef(c.oid, true)
        ILIKE '%FOREIGN KEY (reminder_id, user_id)%REFERENCES medication_reminders(id, user_id)%'
  ) AS composite_reminder_user_fk_present,
  EXISTS (
    SELECT 1
    FROM pg_constraint AS c
    WHERE c.conrelid = to_regclass('public.medication_dose_logs')
      AND c.contype = 'u'
      AND pg_get_constraintdef(c.oid, true)
        ILIKE '%UNIQUE (reminder_id, dose_time)%'
  ) AS dose_log_reminder_time_unique_present;

ROLLBACK;
