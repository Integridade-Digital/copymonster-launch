-- ============================================================
-- FASE 1: FUNDAÇÃO DE IDENTIDADE
-- CopyMonster - Integridade Digital
-- Migration: 001_initial_identity.sql
-- ============================================================

-- Habilitar extensão UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TABELA DE TENANTS (empresas/clientes do SaaS)
-- ============================================================
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL, -- para URL amigável
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  metadata JSONB DEFAULT '{}'::jsonb
);

-- ============================================================
-- TABELA DE USUÁRIOS (vinculada ao auth.users do Supabase)
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  whatsapp TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- ============================================================
-- TABELA DE ASSOCIAÇÃO USUÁRIO-TENANT COM ROLES
-- ============================================================
CREATE TABLE IF NOT EXISTS user_tenant_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'anonymous')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, tenant_id)
);

-- ============================================================
-- TABELA DE SESSÕES DE APLICAÇÃO (para rastrear sessões ativas)
-- ============================================================
CREATE TABLE IF NOT EXISTS app_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ÍNDICES PARA PERFORMANCE
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_user_tenant_roles_user ON user_tenant_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_tenant_roles_tenant ON user_tenant_roles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_tenant_roles_role ON user_tenant_roles(role);
CREATE INDEX IF NOT EXISTS idx_app_sessions_token ON app_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_app_sessions_user ON app_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_app_sessions_tenant ON app_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);

-- ============================================================
-- TRIGGER PARA UPDATED_AT
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_tenant_roles_updated_at BEFORE UPDATE ON user_tenant_roles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- TRIGGER PARA CRIAR USUÁRIO AUTOMATICAMENTE QUANDO AUTH.USERS FOR CRIADO
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, avatar_url, created_at)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url',
    NEW.created_at
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger que dispara quando um novo usuário é criado no auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- FUNÇÃO PARA OBTER DADOS DO USUÁRIO LOGADO
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_current_user_id()
RETURNS UUID AS $$
BEGIN
  RETURN auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- SEED INICIAL: TENANT "INTEGRIDADE DIGITAL"
-- ============================================================
-- Nota: O primeiro usuário que se registrar será automaticamente
-- vinculado a este tenant como 'owner' via script de seed
INSERT INTO tenants (id, name, slug, status, metadata)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Integridade Digital',
  'integridade-digital',
  'active',
  '{"is_default": true, "created_by": "system"}'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- COMENTÁRIOS NAS TABELAS
-- ============================================================
COMMENT ON TABLE tenants IS 'Tenants (clientes/empresas) do SaaS CopyMonster';
COMMENT ON TABLE users IS 'Usuários do sistema, vinculados ao auth.users do Supabase';
COMMENT ON TABLE user_tenant_roles IS 'Associação de usuários a tenants com roles (owner, admin, member, anonymous)';
COMMENT ON TABLE app_sessions IS 'Sessões ativas da aplicação para rastreamento e invalidação';

COMMENT ON COLUMN tenants.slug IS 'Identificador único para URLs amigáveis (ex: /tenant/:slug)';
COMMENT ON COLUMN tenants.status IS 'Status do tenant: active, suspended, deleted';
COMMENT ON COLUMN users.whatsapp IS 'WhatsApp do usuário em formato internacional (ex: +5511999999999)';
COMMENT ON COLUMN user_tenant_roles.role IS 'Role do usuário no tenant: owner, admin, member, anonymous';

-- ============================================================
-- FIM DA MIGRATION 001
-- ============================================================
