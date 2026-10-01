BEGIN;

-- ============================================================================
-- MIGRATION 019: Ajuste do Trigger sync_session_to_index (Bloco 7.6)
-- Garante que sessões previamente purgadas (soft delete) sejam ressuscitadas
-- (deleted_at = NULL) caso recebam nova atividade ou inserção do DSH.
-- ============================================================================

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
      updated_at = EXCLUDED.updated_at,
      deleted_at = NULL; -- Ressuscita a sessão caso estivesse purgada
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'sync_session_to_index INSERT/UPDATE failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

COMMIT;
