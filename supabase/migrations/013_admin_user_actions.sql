BEGIN;

-- ============================================================================
-- MIGRATION 013: Ações Administrativas de Usuário (Bloco 7.2 — Parte B)
-- RPCs: admin_update_user_role, admin_toggle_user_status
-- ============================================================================

-- 1. Garantir coluna status em public.users
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended'));

-- 2. RPC admin_update_user_role
CREATE OR REPLACE FUNCTION public.admin_update_user_role(
  p_membership_id UUID,
  p_new_role TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_user_id UUID;
  v_tenant_id UUID;
  v_old_role TEXT;
  v_owner_count INTEGER;
BEGIN
  IF NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Acesso negado: privilégios insuficientes.';
  END IF;

  IF p_new_role NOT IN ('owner', 'admin', 'member') THEN
    RAISE EXCEPTION 'Role inválida: deve ser owner, admin ou member.';
  END IF;

  SELECT user_id, tenant_id, role
  INTO v_target_user_id, v_tenant_id, v_old_role
  FROM public.user_tenant_roles
  WHERE id = p_membership_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vínculo de usuário não encontrado.';
  END IF;

  -- Regra 1: Bloquear QUALQUER alteração da própria role
  IF v_target_user_id = auth.uid() AND p_new_role <> v_old_role THEN
    RAISE EXCEPTION 'Você não pode alterar sua própria função.';
  END IF;

  -- Regra 2: Não pode rebaixar o único owner do tenant
  IF v_old_role = 'owner' AND p_new_role <> 'owner' THEN
    SELECT COUNT(*) INTO v_owner_count
    FROM public.user_tenant_roles
    WHERE tenant_id = v_tenant_id AND role = 'owner';

    IF v_owner_count <= 1 THEN
      RAISE EXCEPTION 'Não é permitido rebaixar o único proprietário deste tenant.';
    END IF;
  END IF;

  UPDATE public.user_tenant_roles
  SET role = p_new_role, updated_at = NOW()
  WHERE id = p_membership_id;

  -- Auditoria explícita
  INSERT INTO public.audit_logs (
    tenant_id, user_id, action, resource_type, resource_id, old_value, new_value, created_at
  ) VALUES (
    v_tenant_id, auth.uid(), 'UPDATE_USER_ROLE', 'USER_ROLE', p_membership_id,
    jsonb_build_object('role', v_old_role), jsonb_build_object('role', p_new_role), NOW()
  );

  RETURN true;
END;
$$;

-- 3. RPC admin_toggle_user_status
CREATE OR REPLACE FUNCTION public.admin_toggle_user_status(
  p_user_id UUID,
  p_new_status TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_status TEXT;
BEGIN
  IF NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Acesso negado: privilégios insuficientes.';
  END IF;

  IF p_new_status NOT IN ('active', 'suspended') THEN
    RAISE EXCEPTION 'Status inválido: deve ser active ou suspended.';
  END IF;

  -- Regra 3: Não pode suspender a si mesmo
  IF p_user_id = auth.uid() AND p_new_status = 'suspended' THEN
    RAISE EXCEPTION 'Você não pode suspender sua própria conta.';
  END IF;

  SELECT COALESCE(status, 'active') INTO v_old_status
  FROM public.users
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuário não encontrado.';
  END IF;

  UPDATE public.users
  SET status = p_new_status, updated_at = NOW()
  WHERE id = p_user_id;

  -- Auditoria explícita
  INSERT INTO public.audit_logs (
    tenant_id, user_id, action, resource_type, resource_id, old_value, new_value, created_at
  ) VALUES (
    NULL, auth.uid(), 'TOGGLE_USER_STATUS', 'USER', p_user_id,
    jsonb_build_object('status', v_old_status), jsonb_build_object('status', p_new_status), NOW()
  );

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_update_user_role(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_user_role(UUID, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_toggle_user_status(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_toggle_user_status(UUID, TEXT) TO authenticated;

COMMIT;
