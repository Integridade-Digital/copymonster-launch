# 🚀 COPYMONSTER SAAS - IMPLEMENTAÇÃO COMPLETA FASES 2-5

## ✅ STATUS ATUAL (FASE 1 CONCLUÍDA)

- [x] Schema Supabase Fase 1 criado
- [x] Autenticação OAuth funcional
- [x] Páginas Login/Register/Forgot/Reset implementadas
- [x] ChatMessageGuard protegendo rota raiz
- [x] Seed script para tenant inicial

---

## 📦 FASE 2: ISOLAMENTO POR TENANT

### 2.1 Migration já criada
Arquivo: `/workspace/supabase/migrations/002_saas_complete_isolation.sql`
- Row Level Security (RLS) habilitado em todas as tabelas
- Policies de isolamento por tenant_id
- Funções auxiliares: `get_current_tenant_id()`, `is_admin_or_owner()`

### 2.2 O que falta implementar no Backend

#### A) Middleware de Contexto do Tenant
**Arquivo:** `packages/api/auth-middleware/src/tenant-context.ts`

```typescript
import { Request, Response, NextFunction } from 'express';
import { createClient } from '@copymonster/supabase-client';

export async function injectTenantContext(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return next();

  const token = authHeader.replace('Bearer ', '');
  const supabase = createClient(); // cliente anon
  
  // Verificar token e extrair user_id
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return next();

  // Buscar tenant principal do usuário
  const { data: userRole } = await supabase
    .from('user_tenant_roles')
    .select('tenant_id, role')
    .eq('user_id', user.id)
    .limit(1)
    .single();

  if (userRole) {
    // Injetar no contexto da request
    (req as any).tenantId = userRole.tenant_id;
    (req as any).userRole = userRole.role;
    
    // Configurar para RLS do Supabase (se usar queries diretas)
    await supabase.rpc('set_local_config', { 
      key: 'app.current_tenant_id', 
      value: userRole.tenant_id 
    });
  }

  next();
}
```

#### B) Atualizar Controllers para usar tenant_id
**Exemplo:** `packages/api/session-controller/src/list.ts`

```typescript
// ANTES (sem isolamento)
export async function listSessions(ctx: Context) {
  const sessions = await ctx.storage.query('sessions');
  return sessions;
}

// DEPOIS (com isolamento)
export async function listSessions(ctx: Context) {
  const tenantId = ctx.identity?.tenantId;
  if (!tenantId) throw new UnauthorizedError('No tenant context');

  // Opção 1: Filtrar no código (menos seguro)
  const sessions = await ctx.storage.query('sessions');
  return sessions.filter(s => s.tenant_id === tenantId);

  // Opção 2: Usar query com filtro (recomendado)
  const sessions = await ctx.storage.query('sessions', {
    where: { tenant_id: tenantId }
  });
  return sessions;
}
```

### 2.3 Componentes Frontend para Fase 2

#### A) RoleGate Component
**Arquivo:** `apps/web/src/components/auth/RoleGate.tsx`

```typescript
import React from 'react';
import { useAuth } from '../../lib/auth';

type Role = 'owner' | 'admin' | 'member' | 'anonymous';

interface RoleGateProps {
  children: React.ReactNode;
  allowedRoles: Role[];
  fallback?: React.ReactNode;
}

export function RoleGate({ children, allowedRoles, fallback = null }: RoleGateProps) {
  const { user, role, isLoading } = useAuth();

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (!user || !role) {
    return fallback;
  }

  if (!allowedRoles.includes(role)) {
    return fallback;
  }

  return <>{children}</>;
}
```

#### B) Uso nos Menus
**Arquivo:** `apps/web/src/components/sidebar/Sidebar.tsx`

```typescript
import { RoleGate } from '../auth/RoleGate';

// Menu administrativo - só owner/admin vêem
<RoleGate allowedRoles={['owner', 'admin']}>
  <MenuItem to="/admin/tenants" icon={<UsersIcon />}>
    Gestão de Tenants
  </MenuItem>
  <MenuItem to="/admin/users" icon={<UserGroupIcon />}>
    Gestão de Usuários
  </MenuItem>
  <MenuItem to="/admin/providers" icon={<KeyIcon />}>
    Provedores LLM
  </MenuItem>
  <MenuItem to="/admin/audit" icon={<DocumentTextIcon />}>
    Auditoria
  </MenuItem>
</RoleGate>

// Menu comum - todos os membros vêem
<MenuItem to="/" icon={<ChatIcon />}>
  Chat
</MenuItem>
<MenuItem to="/settings" icon={<CogIcon />}>
  Configurações
</MenuItem>
```

---

## 📦 FASE 3: SISTEMA DE ROLES RBAC

### 3.1 Guards no Backend

#### A) Decorator de Roles
**Arquivo:** `packages/api/auth-middleware/src/decorators/roles.decorator.ts`

```typescript
import 'reflect-metadata';

export const Roles = (...roles: ('owner' | 'admin' | 'member')[]) => {
  return (target: any, key: string, descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata('roles', roles, descriptor.value);
    return descriptor;
  };
};
```

#### B) Guard de Autorização
**Arquivo:** `packages/api/auth-middleware/src/guards/authorization.guard.ts`

```typescript
import { Request, Response, NextFunction } from 'express';
import 'reflect-metadata';

export function authorizationGuard(req: Request, res: Response, next: NextFunction) {
  const requiredRoles = Reflect.getMetadata('roles', (req as any).handler);
  
  if (!requiredRoles) {
    return next(); // Sem restrição de role
  }

  const userRole = (req as any).userRole;
  
  if (!userRole || !requiredRoles.includes(userRole)) {
    return res.status(403).json({
      error: 'Forbidden',
      message: `Required role: ${requiredRoles.join(' or ')}`
    });
  }

  next();
}
```

#### C) Aplicação em Endpoints
**Exemplo:** `packages/api/workspace-controller/src/commands.ts`

```typescript
import { Roles } from '@copymonster/auth-middleware';

export class WorkspaceController {
  
  @Roles('owner', 'admin')
  async createWorkspace(params: CreateWorkspaceParams) {
    // Apenas owner/admin podem criar workspaces globais
  }

  @Roles('owner', 'admin', 'member')
  async updateWorkspace(params: UpdateWorkspaceParams) {
    // Todos podem atualizar seus próprios workspaces
  }

  @Roles('owner', 'admin')
  async deleteWorkspace(workspaceId: string) {
    // Apenas admin/owner podem deletar
  }
}
```

### 3.2 Políticas de URL no Supabase

Já implementadas na migration `002_saas_complete_isolation.sql`:
- `is_admin_or_owner()` function
- Policies condicionais por role
- Audit automático para ações administrativas

---

## 📦 FASE 4: PAINEL ADMINISTRATIVO COMPLETO

### 4.1 Páginas Admin Já Criadas
- [x] `AdminTenantsPage.tsx` - Gestão de tenants

### 4.2 Páginas que Faltam

#### A) Gestão de Usuários
**Arquivo:** `apps/web/src/pages/admin/AdminUsersPage.tsx`

```typescript
// Estrutura similar a AdminTenantsPage
// Funcionalidades:
// - Listar usuários por tenant
// - Adicionar usuário a tenant
// - Alterar role de usuário
// - Suspender/ativar usuário
// - Resetar senha de usuário
```

#### B) Gestão de Provedores LLM
**Arquivo:** `apps/web/src/pages/admin/AdminProvidersPage.tsx`

```typescript
// Funcionalidades:
// - Listar provedores configurados no tenant
// - Adicionar novo provedor (OpenAI, Anthropic, Azure)
// - Editar API keys (criptografadas)
// - Habilitar/desabilitar modelos
// - Testar conexão com provedor
```

#### C) Auditoria
**Arquivo:** `apps/web/src/pages/admin/AdminAuditPage.tsx`

```typescript
// Funcionalidades:
// - Listar logs de auditoria filtráveis
// - Filtros: por usuário, ação, recurso, data
// - Exportar logs para CSV/JSON
// - Visualizar detalhes de cada evento
```

#### D) Dashboard de Métricas
**Arquivo:** `apps/web/src/pages/admin/AdminDashboardPage.tsx`

```typescript
// Métricas a exibir:
// - Total de usuários ativos
// - Sessões criadas hoje/semana/mês
// - Uso de tokens por plano
// - Tenants ativos vs suspensos
// - Receita mensal recorrente (MRR)
```

### 4.3 Rotas do Admin

**Arquivo:** `apps/web/src/router/admin.routes.tsx`

```typescript
import { RouteObject } from 'react-router-dom';
import { RoleGate } from '../components/auth/RoleGate';

export const adminRoutes: RouteObject[] = [
  {
    path: '/admin',
    element: (
      <RoleGate allowedRoles={['owner', 'admin']}>
        <AdminLayout />
      </RoleGate>
    ),
    children: [
      { index: true, element: <AdminDashboardPage /> },
      { path: 'tenants', element: <AdminTenantsPage /> },
      { path: 'users', element: <AdminUsersPage /> },
      { path: 'providers', element: <AdminProvidersPage /> },
      { path: 'audit', element: <AdminAuditPage /> },
      { path: 'plans', element: <AdminPlansPage /> },
    ]
  }
];
```

---

## 📦 FASE 5: MONETIZAÇÃO COM STRIPE

### 5.1 Tabelas Adicionais

Já criadas na migration `002_saas_complete_isolation.sql`:
- `plans` - Tabela de planos
- Campos no `tenants`: subscription_status, stripe_customer_id, etc.

### 5.2 Integração Stripe Backend

#### A) Webhook Handler
**Arquivo:** `packages/api/stripe-webhook/src/handler.ts`

```typescript
import Stripe from 'stripe';
import { createClient } from '@copymonster/supabase-client';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2023-10-16' });

export async function handleStripeWebhook(event: Stripe.Event) {
  const supabase = createClient();

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;

      // Buscar tenant pelo stripe_customer_id
      const { data: tenant } = await supabase
        .from('tenants')
        .select('id')
        .eq('stripe_customer_id', customerId)
        .single();

      if (!tenant) throw new Error('Tenant not found');

      // Atualizar assinatura
      await supabase.from('tenants').update({
        subscription_status: subscription.status,
        stripe_subscription_id: subscription.id,
        plan_id: getPlanIdFromPrice(subscription.items.data[0].price.id),
        current_period_end: new Date(subscription.current_period_end * 1000)
      }).eq('id', tenant.id);

      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;

      await supabase
        .from('tenants')
        .update({
          subscription_status: 'canceled',
          stripe_subscription_id: null
        })
        .eq('stripe_customer_id', customerId);

      break;
    }

    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      
      if (session.mode === 'subscription') {
        // Atualizar tenant com stripe_customer_id
        await supabase
          .from('tenants')
          .update({ stripe_customer_id: session.customer as string })
          .eq('id', session.metadata?.tenant_id);
      }

      break;
    }
  }
}
```

#### B) Endpoint para Criar Checkout Session
**Arquivo:** `packages/api/billing/src/checkout.ts`

```typescript
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2023-10-16' });

export async function createCheckoutSession(params: {
  tenantId: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
}) {
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: params.priceId, quantity: 1 }],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    metadata: { tenant_id: params.tenantId },
    allow_promotion_codes: true,
  });

  return { sessionId: session.id, url: session.url };
}
```

### 5.3 Página de Planos no Frontend

**Arquivo:** `apps/web/src/pages/billing/PlansPage.tsx`

```typescript
import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase/client';
import { loadStripe } from '@stripe/stripe-js';

const stripePromise = loadStripe(process.env.VITE_STRIPE_PUBLIC_KEY!);

interface Plan {
  id: string;
  name: string;
  slug: string;
  price_cents: number;
  features: string[];
  limits: any;
}

export function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [currentPlan, setCurrentPlan] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadPlans();
  }, []);

  async function loadPlans() {
    const { data } = await supabase
      .from('plans')
      .select('*')
      .eq('is_active', true)
      .order('price_cents');
    
    setPlans(data || []);
    setIsLoading(false);
  }

  async function handleSubscribe(planSlug: string) {
    const plan = plans.find(p => p.slug === planSlug);
    if (!plan) return;

    // Chamar backend para criar checkout session
    const response = await fetch('/api/billing/create-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priceId: plan.stripe_price_id })
    });

    const { url } = await response.json();
    window.location.href = url;
  }

  if (isLoading) return <div>Loading...</div>;

  return (
    <div className="py-12">
      <h1 className="text-3xl font-bold text-center mb-8">Escolha seu Plano</h1>
      
      <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto px-4">
        {plans.map((plan) => (
          <div key={plan.id} className="border rounded-lg p-6 hover:shadow-lg transition">
            <h3 className="text-xl font-bold">{plan.name}</h3>
            <p className="text-3xl font-bold mt-4">
              R$ {(plan.price_cents / 100).toFixed(2)}
              <span className="text-sm font-normal">/mês</span>
            </p>
            
            <ul className="mt-6 space-y-3">
              {plan.features.map((feature, i) => (
                <li key={i} className="flex items-center">
                  <CheckIcon className="w-5 h-5 text-green-500 mr-2" />
                  {feature}
                </li>
              ))}
            </ul>

            <button
              onClick={() => handleSubscribe(plan.slug)}
              className="w-full mt-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              {plan.slug === currentPlan ? 'Plano Atual' : 'Assinar'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

### 5.4 Limits Enforcement

**Arquivo:** `packages/api/session-controller/src/limits.ts`

```typescript
import { createClient } from '@copymonster/supabase-client';

export async function checkSessionLimit(tenantId: string) {
  const supabase = createClient();

  // Buscar plano do tenant
  const { data: tenant } = await supabase
    .from('tenants')
    .select('plan_id, subscription_status')
    .eq('id', tenantId)
    .single();

  if (!tenant || tenant.subscription_status !== 'active') {
    // Usar plano free como fallback
    const { data: plan } = await supabase
      .from('plans')
      .select('limits')
      .eq('slug', 'free')
      .single();
    
    const maxSessions = plan?.limits?.sessions || 5;
    
    // Contar sessões atuais
    const { count } = await supabase
      .from('sessions')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);

    if ((count || 0) >= maxSessions) {
      throw new LimitExceededError(
        `Limite de sessões atingido. Upgrade para remover limites.`
      );
    }
  }
}
```

---

## 🔧 CONFIGURAÇÃO DE VARIÁVEIS DE AMBIENTE

**.env.example atualizado:**

```bash
# Supabase
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Stripe
STRIPE_SECRET_KEY=sk_test_...
VITE_STRIPE_PUBLIC_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# App
VITE_APP_URL=https://copymonster.com.br
NODE_ENV=production
```

---

## 📋 CHECKLIST DE IMPLEMENTAÇÃO

### Fase 2 - Isolamento
- [ ] Executar migration 002 no Supabase
- [ ] Implementar tenant-context middleware
- [ ] Atualizar todos controllers com filtro tenant_id
- [ ] Criar componente RoleGate no frontend
- [ ] Adicionar RoleGate em menus administrativos
- [ ] Testar vazamento de dados entre tenants

### Fase 3 - RBAC
- [ ] Implementar decorator @Roles()
- [ ] Implementar authorization guard
- [ ] Aplicar roles em endpoints críticos
- [ ] Testar acesso negado para roles inferiores

### Fase 4 - Painel Admin
- [ ] Criar AdminUsersPage
- [ ] Criar AdminProvidersPage
- [ ] Criar AdminAuditPage
- [ ] Criar AdminDashboardPage
- [ ] Configurar rotas admin
- [ ] Adicionar links no sidebar (condicional por role)

### Fase 5 - Monetização
- [ ] Configurar conta Stripe
- [ ] Criar produtos/preços no Stripe Dashboard
- [ ] Implementar webhook handler
- [ ] Criar endpoint create-checkout-session
- [ ] Implementar PlansPage no frontend
- [ ] Adicionar limits enforcement
- [ ] Testar fluxo completo de assinatura

---

## ⚠️ RISCOS E MITIGAÇÕES

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| RLS mal configurado | Vazamento de dados | Testar exaustivamente com múltiplos tenants |
| Webhook Stripe falhar | Assinaturas não atualizam | Implementar retry + dashboard de reconciliação |
| Performance com filtros | Queries lentas | Índices em tenant_id, cache em memória |
| Migração quebrar app | Downtime | Executar em staging primeiro, backup antes |

---

## 🎯 PRÓXIMOS PASSOS IMEDIATOS

1. **Executar migrations no Supabase:**
   ```sql
   -- Copiar conteúdo de 001_initial_identity.sql
   -- Copiar conteúdo de 002_saas_complete_isolation.sql
   ```

2. **Configurar variáveis de ambiente no VPS**

3. **Testar localmente:**
   ```bash
   pnpm install
   pnpm exec ts-node scripts/seed-initial-tenant.ts
   pnpm dev
   ```

4. **Subir para produção após testes**

---

**Documento criado:** `docs/implementation-phases-2-to-5.md`
**Status:** Pronto para revisão e implementação incremental
