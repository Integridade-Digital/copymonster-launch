-- ============================================================
-- COPYMONSTER SAAS - FASE 2, 3, 4, 5 COMPLETA
-- Migration: Isolation, RBAC, Audit, Billing
-- ============================================================

-- 1. EXTENSÕES NECESSÁRIAS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. TABELA DE PLANOS (FASE 5)
CREATE TABLE IF NOT EXISTS plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL, -- 'free', 'pro', 'enterprise'
  price_cents INTEGER DEFAULT 0,
  currency TEXT DEFAULT 'BRL',
  stripe_price_id TEXT, -- ID do preço no Stripe
  limits JSONB DEFAULT '{}'::jsonb, -- {"sessions": 10, "tokens": 10000}
  features TEXT[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. ATUALIZAÇÃO NA TABELA TENANTS (FASE 5)
ALTER TABLE tenants 
ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'trial' CHECK (subscription_status IN ('trial', 'active', 'canceled', 'past_due', 'deleted')),
ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES plans(id),
ADD COLUMN IF NOT EXISTS usage_data JSONB DEFAULT '{}'::jsonb;

-- 4. TABELA DE AUDITORIA (FASE 4)
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  user_id UUID REFERENCES users(id),
  action TEXT NOT NULL, -- 'CREATE_USER', 'DELETE_SESSION', 'UPDATE_SETTINGS'
  resource_type TEXT, -- 'USER', 'SESSION', 'WORKSPACE'
  resource_id UUID,
  old_value JSONB,
  new_value JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_tenant ON audit_logs(tenant_id);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);

-- 5. ATUALIZAÇÃO NAS TABELAS EXISTENTES (FASE 2)
-- Adicionar tenant_id e user_id onde faltam para isolamento

-- Sessions (se existir tabela de sessões de chat)
-- Nota: Assumindo que usaremos a estrutura de storage do DSH adaptada
-- Se não existir tabela 'sessions', criaremos uma padrão para o SaaS
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT,
  workspace_id UUID,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessions_tenant ON sessions(tenant_id);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- Workspaces (Tabela relacional para SaaS, complementando o file-based)
CREATE TABLE IF NOT EXISTS workspaces_meta (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL, -- Caminho relativo seguro
  is_global BOOLEAN DEFAULT false, -- Se true, visível a todos do tenant
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_workspaces_meta_tenant ON workspaces_meta(tenant_id);

-- Configurações de Provedores LLM por Tenant (FASE 4)
CREATE TABLE IF NOT EXISTS tenant_llm_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider_name TEXT NOT NULL, -- 'openai', 'anthropic', 'azure'
  api_key_encrypted TEXT NOT NULL,
  base_url TEXT,
  models_enabled TEXT[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, provider_name)
);

CREATE INDEX idx_tenant_llm_providers_tenant ON tenant_llm_providers(tenant_id);

-- 6. ROW LEVEL SECURITY (RLS) - FASE 2 CRÍTICO
-- Habilitar RLS em todas as tabelas sensíveis

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_tenant_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_llm_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_sessions ENABLE ROW LEVEL SECURITY;

-- FUNÇÕES AUXILIARES PARA RLS
CREATE OR REPLACE FUNCTION get_current_tenant_id()
RETURNS UUID AS $$
BEGIN
  RETURN NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID;
END;
$$ LANGUAGE SQL SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_current_user_id()
RETURNS UUID AS $$
BEGIN
  RETURN NULLIF(current_setting('app.current_user_id', TRUE), '')::UUID;
END;
$$ LANGUAGE SQL SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_admin_or_owner()
RETURNS BOOLEAN AS $$
DECLARE
  _user_id UUID := get_current_user_id();
  _tenant_id UUID := get_current_tenant_id();
  _role TEXT;
BEGIN
  SELECT role INTO _role
  FROM user_tenant_roles
  WHERE user_id = _user_id AND tenant_id = _tenant_id;
  
  RETURN _role IN ('owner', 'admin');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- POLICIES (POLÍTICAS DE SEGURANÇA)

-- Tenants: Usuário só vê seu tenant
CREATE POLICY "Users can view own tenant" ON tenants
  FOR SELECT USING (id = get_current_tenant_id());

-- Users: Usuário vê a si mesmo e outros do mesmo tenant (se admin)
CREATE POLICY "Users can view own profile" ON users
  FOR SELECT USING (id = get_current_user_id());

CREATE POLICY "Admins can view all users in tenant" ON users
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_tenant_roles utr
      WHERE utr.user_id = get_current_user_id()
      AND utr.tenant_id = (SELECT tenant_id FROM users WHERE id = get_current_user_id())
      AND utr.role IN ('owner', 'admin')
    )
  );

-- User Tenant Roles: Ver apenas roles do próprio tenant
CREATE POLICY "Users can view roles in own tenant" ON user_tenant_roles
  FOR SELECT USING (tenant_id = get_current_tenant_id());

CREATE POLICY "Admins can manage roles" ON user_tenant_roles
  FOR ALL USING (is_admin_or_owner());

-- Sessions: Isolamento total por tenant
CREATE POLICY "Users can view own sessions" ON sessions
  FOR SELECT USING (tenant_id = get_current_tenant_id());

CREATE POLICY "Users can create own sessions" ON sessions
  FOR INSERT WITH CHECK (tenant_id = get_current_tenant_id() AND user_id = get_current_user_id());

CREATE POLICY "Users can update own sessions" ON sessions
  FOR UPDATE USING (tenant_id = get_current_tenant_id() AND user_id = get_current_user_id());

CREATE POLICY "Users can delete own sessions" ON sessions
  FOR DELETE USING (tenant_id = get_current_tenant_id() AND user_id = get_current_user_id());

-- Workspaces: Isolamento por tenant
CREATE POLICY "Users can view tenant workspaces" ON workspaces_meta
  FOR SELECT USING (tenant_id = get_current_tenant_id());

CREATE POLICY "Admins can manage workspaces" ON workspaces_meta
  FOR ALL USING (is_admin_or_owner());

-- LLM Providers: Apenas admins veem/chaveiam
CREATE POLICY "Admins can view providers" ON tenant_llm_providers
  FOR SELECT USING (is_admin_or_owner());

CREATE POLICY "Owners can manage providers" ON tenant_llm_providers
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_tenant_roles
      WHERE user_id = get_current_user_id()
      AND tenant_id = tenant_llm_providers.tenant_id
      AND role = 'owner'
    )
  );

-- Audit Logs: Apenas admins veem
CREATE POLICY "Admins can view audit logs" ON audit_logs
  FOR SELECT USING (is_admin_or_owner());

-- App Sessions: Proprio usuario
CREATE POLICY "Users can view own app sessions" ON app_sessions
  FOR SELECT USING (user_id = get_current_user_id());

-- 7. SEED INICIAL DE PLANOS (FASE 5)
INSERT INTO plans (name, slug, price_cents, limits, features) VALUES
  ('Gratuito', 'free', 0, '{"sessions": 5, "tokens_monthly": 10000}', '{"basic_models"}'),
  ('Profissional', 'pro', 9900, '{"sessions": 50, "tokens_monthly": 100000}', '{"advanced_models", "priority_support", "custom_prompts"}'),
  ('Empresarial', 'enterprise', 29900, '{"sessions": -1, "tokens_monthly": -1}', '{"unlimited_everything", "dedicated_support", "sla", "audit_logs"}')
ON CONFLICT (slug) DO NOTHING;

-- 8. TRIGGER PARA AUDITORIA AUTOMÁTICA (Exemplo genérico)
-- Pode ser expandido para tabelas específicas
CREATE OR REPLACE FUNCTION log_audit_event()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, new_value)
    VALUES (NEW.tenant_id, get_current_user_id(), TG_ARGV[0], TG_ARGV[1], NEW.id, to_jsonb(NEW));
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, old_value, new_value)
    VALUES (NEW.tenant_id, get_current_user_id(), TG_ARGV[0], TG_ARGV[1], NEW.id, to_jsonb(OLD), to_jsonb(NEW));
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, old_value)
    VALUES (OLD.tenant_id, get_current_user_id(), TG_ARGV[0], TG_ARGV[1], OLD.id, to_jsonb(OLD));
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Exemplo de aplicação de trigger em Sessions
DROP TRIGGER IF EXISTS audit_sessions ON sessions;
CREATE TRIGGER audit_sessions
AFTER INSERT OR UPDATE OR DELETE ON sessions
FOR EACH ROW EXECUTE FUNCTION log_audit_event('SESSION_CHANGE', 'SESSION');
