-- ============================================================
-- Migration: 024_fix_existing_user_roles.sql
-- CopyMonster - Integridade Digital
--
-- Correcao dos dados historicos criados pelo trigger antigo, que
-- dava a cada usuario novo um tenant proprio e role 'owner'.
-- Estado final: um tenant oficial, o operador como 'owner', todos
-- os demais como 'member' desse tenant.
--
-- _owner_id e o operador real (integridade.digital@gmail.com).
-- Troque o UUID se o operador da conta for outro.
-- ============================================================

BEGIN;

-- 0. O tenant padrao precisa existir (023 e idempotente, mas 024
-- tambem e para poder ser aplicado isoladamente).
INSERT INTO public.tenants (id, name, slug, status, metadata)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Integridade Digital',
  'integridade-digital',
  'active',
  jsonb_build_object('created_by_trigger', false)
)
ON CONFLICT (id) DO NOTHING;

-- 1. Operador real como 'owner' do tenant padrao.
INSERT INTO public.user_tenant_roles (user_id, tenant_id, role)
SELECT u.id, '00000000-0000-0000-0000-000000000001'::uuid, 'owner'
FROM public.users u
WHERE u.id = '5302ad3a-f6a9-4fc3-890e-3e8af8b767c7'::uuid
ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = EXCLUDED.role;

-- 2. Rebaixa para 'member' no tenant padrao todo vinculo de usuario
--    (exceto o operador) apontado para tenant criado pelo trigger.
INSERT INTO public.user_tenant_roles (user_id, tenant_id, role)
SELECT utr.user_id, '00000000-0000-0000-0000-000000000001'::uuid, 'member'
FROM public.user_tenant_roles utr
JOIN public.tenants t ON t.id = utr.tenant_id
WHERE t.metadata->>'created_by_trigger' = 'true'
  AND utr.user_id <> '5302ad3a-f6a9-4fc3-890e-3e8af8b767c7'::uuid
ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = EXCLUDED.role;

-- 3. Remove os vinculos com os tenants criados pelo trigger. Cada
--    usuario ja recebeu o vinculo equivalente no passo 2, entao
--    ninguem fica sem tenant.
DELETE FROM public.user_tenant_roles utr
USING public.tenants t
WHERE utr.tenant_id = t.id
  AND t.metadata->>'created_by_trigger' = 'true';

-- 4. Desativa (soft delete) os tenants criados pelo trigger que
--    ficaram sem vinculo. 'deleted' e o status reservado para isso
--    em tenants.status; mantem a linha para preservar qualquer
--    tabela filha com ON DELETE CASCADE.
UPDATE public.tenants t
SET status = 'deleted'
WHERE t.metadata->>'created_by_trigger' = 'true'
  AND t.id <> '00000000-0000-0000-0000-000000000001'::uuid
  AND NOT EXISTS (
    SELECT 1 FROM public.user_tenant_roles utr WHERE utr.tenant_id = t.id
  );

-- 5. Guarda de seguranca: aborta se o resultado nao for exatamente
--    um owner no tenant padrao e nenhum owner em tenant deletado.
DO $guard$
DECLARE
  _owners UUID[];
BEGIN
  SELECT array_agg(utr.user_id) INTO _owners
  FROM public.user_tenant_roles utr
  JOIN public.tenants t ON t.id = utr.tenant_id
  WHERE utr.role = 'owner';

  IF _owners IS DISTINCT FROM ARRAY['5302ad3a-f6a9-4fc3-890e-3e8af8b767c7'::uuid] THEN
    RAISE EXCEPTION '024 abortado: owner esperado nao e o unico owner. Owners: %', _owners;
  END IF;
END
$guard$;

COMMIT;
