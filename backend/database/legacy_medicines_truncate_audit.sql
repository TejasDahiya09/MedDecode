\set ON_ERROR_STOP on

-- Read-only evidence package. This intentionally does not issue REVOKE.
BEGIN READ ONLY;

SELECT
  'public.medicines' AS relation_name,
  has_table_privilege('anon', 'public.medicines', 'TRUNCATE') AS anon_effective_truncate,
  has_table_privilege('authenticated', 'public.medicines', 'TRUNCATE') AS authenticated_effective_truncate;

SELECT
  grantee.rolname AS grant_role,
  acl.privilege_type,
  acl.is_grantable
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) AS acl
LEFT JOIN pg_roles AS grantee ON grantee.oid = acl.grantee
WHERE n.nspname = 'public'
  AND c.relname = 'medicines'
  AND acl.privilege_type = 'TRUNCATE'
ORDER BY grant_role NULLS FIRST;

WITH RECURSIVE role_members AS (
  SELECT
    member,
    roleid,
    ARRAY[member, roleid]::oid[] AS path
  FROM pg_auth_members
  UNION ALL
  SELECT
    rm.member,
    next_role.roleid,
    rm.path || next_role.roleid
  FROM role_members AS rm
  JOIN pg_auth_members AS next_role ON next_role.member = rm.roleid
  WHERE NOT next_role.roleid = ANY(rm.path)
)
SELECT
  member_role.rolname AS client_role,
  parent_role.rolname AS inherited_role,
  has_table_privilege(member_role.rolname, 'public.medicines', 'TRUNCATE')
    AS effective_truncate_via_membership
FROM role_members
JOIN pg_roles AS member_role ON member_role.oid = role_members.member
JOIN pg_roles AS parent_role ON parent_role.oid = role_members.roleid
WHERE member_role.rolname IN ('anon', 'authenticated')
ORDER BY client_role, inherited_role;

COMMIT;
