-- 2.a Downgrade owner roles to member for tenants created by trigger
UPDATE public.user_tenant_roles utr
SET role = 'member'
FROM public.tenants t
WHERE utr.tenant_id = t.id
  AND t.metadata->>'created_by_trigger' = 'true'
  AND utr.role = 'owner'
  AND utr.user_id <> 'meu-user-id-do-owner-real';

-- 2.b Remove user-tenant links created by trigger (owner/member links to trigger-created tenants)
DELETE FROM public.user_tenant_roles
WHERE tenant_id IN (
  SELECT t.id FROM public.tenants t
  WHERE t.metadata->>'created_by_trigger' = 'true'
);

-- 2.c Remove tenants created by trigger that have no remaining user links
DELETE FROM public.tenants
WHERE metadata->>'created_by_trigger' = 'true'
  AND id NOT IN (
    SELECT DISTINCT tenant_id FROM public.user_tenant_roles
  );