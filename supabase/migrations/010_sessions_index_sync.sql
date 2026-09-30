BEGIN;

-- ============================================================================
-- MIGRATION 010: Sincronização Automática com sessions_index
-- 1. Trigger tolerante a falhas em public.sessions para alimentar sessions_index
-- 2. Backfill inicial para sessões pré-existentes
-- ============================================================================

-- 1. Função de sincronização com tratamento de exceções (Ajuste 3: não bloqueia a sessão)
CREATE OR REPLACE FUNCTION public.sync_session_to_index()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    BEGIN
      DELETE FROM public.sessions_index WHERE id = OLD.id::text;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'sync_session_to_index DELETE failed: %', SQLERRM;
    END;
    RETURN OLD;
  END IF;

  BEGIN
    INSERT INTO public.sessions_index (
      id,
      tenant_id,
      user_id,
      title,
      status,
      created_at,
      updated_at
    ) VALUES (
      NEW.id::text,
      NEW.tenant_id,
      NEW.user_id,
      COALESCE(NEW.title, 'Sem título'),
      'active',
      NEW.created_at,
      NEW.updated_at
    )
    ON CONFLICT (id) DO UPDATE SET
      title = COALESCE(EXCLUDED.title, public.sessions_index.title),
      updated_at = EXCLUDED.updated_at;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'sync_session_to_index INSERT/UPDATE failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- 2. Trigger em public.sessions
DROP TRIGGER IF EXISTS trg_sync_session_to_index ON public.sessions;
CREATE TRIGGER trg_sync_session_to_index
  AFTER INSERT OR UPDATE OR DELETE ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.sync_session_to_index();

-- 3. Backfill idempotente das sessões existentes
INSERT INTO public.sessions_index (
  id,
  tenant_id,
  user_id,
  title,
  status,
  created_at,
  updated_at
)
SELECT 
  s.id::text,
  s.tenant_id,
  s.user_id,
  COALESCE(s.title, 'Sem título'),
  'active',
  s.created_at,
  s.updated_at
FROM public.sessions s
ON CONFLICT (id) DO NOTHING;

COMMIT;
