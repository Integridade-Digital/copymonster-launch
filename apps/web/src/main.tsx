/** Browser entry for the Web client. */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppWebEntry, applyIndexInjections } from '@deepseek-ai/dsh-client-web'
import { AppWrapper, supabaseClient, useAuth } from './lib/auth'
import { ProtectedRoute, PublicRoute } from './lib/auth/protected-route'
import { RoleGate } from './components/auth/RoleGate'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { AdminTenantsPage } from './pages/admin/AdminTenantsPage'
import { PlansPage } from './pages/billing/PlansPage'
import './auth.css'

interface DesktopBootGlobal {
  dshDesktopBoot?: {
    failed(message: string): Promise<void>
    ready(): Promise<{ injections: Parameters<typeof applyIndexInjections>[0]; streamBaseUrl: string }>
  }
}

/** Session facts the Typert `auth` Client Context adapter reads from the page. */
interface ClientAuthSession {
  accessToken?: string
}

/** Page global carrying {@link ClientAuthSession}. */
interface ClientAuthGlobal {
  __DSH_AUTH__?: ClientAuthSession
}

const clientAuth = globalThis as ClientAuthGlobal

/**
 * Publish the signed-in Supabase access token where the Typert `auth` Client
 * Context adapter reads it. The adapter holds no session of its own and
 * re-reads this global on every Remote call, so a sign-out or a token refresh
 * takes effect without a reload.
 */
function publishClientAuthSession(): void {
  supabaseClient.auth.onAuthStateChange((_event, current) => {
    clientAuth.__DSH_AUTH__ = { accessToken: current?.access_token }
  })
}

const desktop = (globalThis as DesktopBootGlobal).dshDesktopBoot

const reportFailure = (reason: unknown): void => {
  if (desktop === undefined) throw reason
  void desktop.failed(reason instanceof Error ? reason.message : String(reason)).catch(console.error)
}

/** Mounts the Harness web shell; rendered only for an authenticated session. */
function WebApp() {
  const containerRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!containerRef.current) return
    const entry = new AppWebEntry(containerRef.current)

    if (desktop !== undefined) {
      const gate = (globalThis as { __DSH_BOOT_READY__?: PromiseWithResolvers<void> }).__DSH_BOOT_READY__
      if (gate === undefined) throw new Error('desktop web: boot readiness is missing')
      void desktop.ready().then(async ({ injections, streamBaseUrl }) => {
        const transport = globalThis as { __DSH_TRANSPORT__?: { ownsHost: boolean; streamBaseUrl: string } }
        transport.__DSH_TRANSPORT__ = { ownsHost: true, streamBaseUrl }
        await applyIndexInjections(injections, src => new Promise<void>((resolve, reject) => {
          const script = document.createElement('script')
          script.src = src
          script.onload = () => { resolve() }
          script.onerror = () => { reject(new Error(`desktop web: failed to load ${src}`)) }
          document.head.append(script)
        }))
        gate.resolve()
      }).catch((error: unknown) => { gate.reject(error) })
    }

    void entry.run(desktop === undefined ? undefined : reportFailure)
    return () => { void entry.dispose() }
  }, [])

  return <div ref={containerRef} id="dsh-web-root" />
}

/**
 * Top-level application routes using HTML5 browser history (BrowserRouter).
 * Handles public auth flows, protected workspace shell, and SaaS management views.
 */
function AppRoutes() {
  const { isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="cm-auth-boot" role="status" aria-live="polite">
        <span className="cm-auth-spinner" aria-hidden="true" />
        <span>Verificando sessão…</span>
      </div>
    )
  }

  return (
    <Routes>
      {/* Rotas Públicas de Autenticação */}
      <Route
        path="/login"
        element={
          <PublicRoute>
            <LoginPage />
          </PublicRoute>
        }
      />
      <Route
        path="/register"
        element={
          <PublicRoute>
            <RegisterPage />
          </PublicRoute>
        }
      />
      <Route
        path="/forgot-password"
        element={
          <PublicRoute>
            <ForgotPasswordPage />
          </PublicRoute>
        }
      />
      <Route
        path="/reset-password"
        element={
          <PublicRoute>
            <ResetPasswordPage />
          </PublicRoute>
        }
      />

      {/* Rotas Protegidas - SaaS Billing e Planos */}
      <Route
        path="/billing"
        element={
          <ProtectedRoute>
            <PlansPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/plans"
        element={
          <ProtectedRoute>
            <PlansPage />
          </ProtectedRoute>
        }
      />

      {/* Rota Protegida - Painel Administrativo de Tenants (owner/admin) */}
      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <RoleGate allowedRoles={['owner', 'admin']} fallback={<Navigate to="/" replace />}>
              <AdminTenantsPage />
            </RoleGate>
          </ProtectedRoute>
        }
      />

      {/* Rota Principal - DSH Web Workspace Shell */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <WebApp />
          </ProtectedRoute>
        }
      />

      {/* Rota Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function Root() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}

try {
  const el = document.getElementById('root')
  if (el === null) throw new Error('web app: missing #root')

  publishClientAuthSession()

  createRoot(el).render(
    <React.StrictMode>
      <AppWrapper>
        <Root />
      </AppWrapper>
    </React.StrictMode>,
  )
} catch (reason) {
  reportFailure(reason)
}
