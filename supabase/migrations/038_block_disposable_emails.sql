BEGIN;

-- ============================================================================
-- MIGRATION 038: bloqueio de e-mails descartaveis no cadastro (anti-abuso)
--
-- Plano: docs/roadmap/plano-producao-llm-providers-billing-trial.md (Etapa 9)
-- Registro operacional: docs/roadmap/etapa9-anti-abuso.md
--
-- O cadastro do CopyMonster e 100% client -> Supabase Auth (supabase.auth.signUp)
-- e nao passa pelo host. O ponto correto de interceptacao e, portanto, o banco:
-- um trigger BEFORE INSERT em auth.users que rejeita dominios descartaveis antes
-- de qualquer tenant/trial ser criado (handle_new_user e AFTER INSERT).
--
-- Como adicionar/remover dominios no futuro, sem nova migration:
--   INSERT INTO public.disposable_email_domains(domain) VALUES ('exemplo.com');
--   DELETE FROM public.disposable_email_domains WHERE domain = 'exemplo.com';
-- O dominio e o sufixo exato apos o '@', em minusculas.
--
-- O trigger so rejeita o que estiver cadastrado; lista vazia nao bloqueia
-- ninguem. A mensagem e generica de proposito (nao revela a regra anti-abuso).
-- ============================================================================

-- 1. Lista de dominios descartaveis
CREATE TABLE IF NOT EXISTS public.disposable_email_domains (
  domain TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

COMMENT ON TABLE public.disposable_email_domains IS
  'Dominios de e-mail descartaveis bloqueados no cadastro (Etapa 9 anti-abuso)';

-- 2. Seed inicial (14 dominios)
INSERT INTO public.disposable_email_domains (domain) VALUES
  ('mailinator.com'),
  ('tempmail.com'),
  ('temp-mail.org'),
  ('10minutemail.com'),
  ('guerrillamail.com'),
  ('sharklasers.com'),
  ('yopmail.com'),
  ('getnada.com'),
  ('dispostable.com'),
  ('maildrop.cc'),
  ('throwawaymail.com'),
  ('trashmail.com'),
  ('mailnesia.com'),
  ('fakeinbox.com')
ON CONFLICT (domain) DO NOTHING;

-- 3. Funcao de bloqueio (executada por um trigger BEFORE INSERT em auth.users)
CREATE OR REPLACE FUNCTION public.block_disposable_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _domain TEXT;
BEGIN
  _domain := lower(split_part(coalesce(NEW.email, ''), '@', 2));
  IF _domain <> '' AND EXISTS (
    SELECT 1 FROM public.disposable_email_domains d WHERE d.domain = _domain
  ) THEN
    RAISE EXCEPTION 'disposable_email_domain';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.block_disposable_signup() IS
  'Rejeita cadastro cujo dominio de e-mail conste em disposable_email_domains';

-- 4. Trigger BEFORE INSERT (nao afeta usuarios existentes)
DROP TRIGGER IF EXISTS on_auth_user_before_insert_block_disposable ON auth.users;
CREATE TRIGGER on_auth_user_before_insert_block_disposable
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.block_disposable_signup();

-- 5. RLS deny default: somente a funcao SECURITY DEFINER le a lista
ALTER TABLE public.disposable_email_domains ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_all_disposable_email_domains" ON public.disposable_email_domains;
CREATE POLICY "deny_all_disposable_email_domains"
  ON public.disposable_email_domains
  FOR ALL
  TO public
  USING (false)
  WITH CHECK (false);

NOTIFY pgrst, 'reload schema';

COMMIT;
