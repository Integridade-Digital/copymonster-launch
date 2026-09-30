import { ProfilePage } from './pages/ProfilePage'
import { AppFrame } from './components/layout/AppFrame'
/** Browser entry for the Web client. */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import type { applyIndexInjections } from '@deepseek-ai/dsh-client-web'
import { AppWrapper, supabaseClient, useAuth } from './lib/auth'
import { ProtectedRoute, PublicRoute } from './lib/auth/protected-route'
import { RoleGate } from './components/auth/RoleGate'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { AdminTenantsPage } from './pages/admin/AdminTenantsPage'
import { AdminAuditPage } from './pages/admin/AdminAuditPage'
import { PlansPage } from './pages/billing/PlansPage'
import { BillingSuccessPage } from './pages/billing/BillingSuccessPage'
import { BillingCancelPage } from './pages/billing/BillingCancelPage'
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
  role?: string
}

/** Page global carrying {@link ClientAuthSession}. */
interface ClientAuthGlobal {
  __DSH_AUTH__?: ClientAuthSession
}

const clientAuth = globalThis as ClientAuthGlobal

/**
 * Publish the signed-in Supabase access token and role where Typert client
 * adapters and UI role gates read it.
 */
function publishClientAuthSession(): void {
  supabaseClient.auth.onAuthStateChange((_event, current) => {
    let role: string | undefined
    if (current?.access_token) {
      try {
        const parts = current.access_token.split('.')
        if (parts[1]) {
          const payload = JSON.parse(atob(parts[1]))
          role = payload.user_role || payload.role
        }
      } catch {}
    }
    clientAuth.__DSH_AUTH__ = {
      accessToken: current?.access_token,
      role,
    }
  })
}

const desktop = (globalThis as DesktopBootGlobal).dshDesktopBoot

const reportFailure = (reason: unknown): void => {
  if (desktop === undefined) throw reason
  void desktop.failed(reason instanceof Error ? reason.message : String(reason)).catch(console.error)
}

/** Captura erros não tratados no shell DSH e exibe tela amigável de recuperação em vez de tela preta. */
interface ErrorBoundaryProps {
  children: React.ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

class WebAppErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('WebApp failure intercepted by ErrorBoundary:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="cm-auth-page">
          <div className="cm-auth-card" style={{ maxWidth: '480px', textAlign: 'center' }}>
            <h2 className="cm-auth-title" style={{ color: 'var(--cm-auth-error-text)' }}>
              Erro ao inicializar o CopyMonster
            </h2>
            <p className="cm-auth-subtitle" style={{ marginTop: '0.75rem' }}>
              Ocorreu uma falha inesperada durante a inicialização do ambiente de trabalho:
            </p>
            <div className="cm-auth-alert cm-auth-alert--error" style={{ marginTop: '1rem', textAlign: 'left', wordBreak: 'break-word' }}>
              {this.state.error?.message ?? 'Erro desconhecido'}
            </div>
            <button
              type="button"
              onClick={() => { window.location.reload() }}
              className="cm-auth-button"
              style={{ marginTop: '1.25rem' }}
            >
              Recarregar aplicação
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

/**
 * Carrega o shell pesado do DSH Web dinamicamente apenas quando a rota autenticada for renderizada.
 * Isso garante que páginas públicas de autenticação (/login, /register) não baixem o bundle completo do workspace.
 */
const LazyWebApp = React.lazy(async () => {
  const { AppWebEntry, applyIndexInjections: applyInjections } = await import('@deepseek-ai/dsh-client-web')

  return {
    default: function WebAppShell() {
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
            await applyInjections(injections, src => new Promise<void>((resolve, reject) => {
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

      return <div ref={containerRef} id="dsh-web-root" style={{ height: '100%', width: '100%', overflow: 'hidden' }} />
    },
  }
})

/**
 * Top-level application routes using HTML5 browser history (BrowserRouter).
 * Handles public auth flows, protected workspace shell, and SaaS management views.
 */

type ActiveModalType = 'plans' | 'profile' | 'admin' | 'admin_audit' | null

/**
 * Shell autenticado do workspace. Mantém o LazyWebApp permanentemente montado
 * e renderiza painéis de gerenciamento (Planos, Perfil, Admin) como modais sobrepostos,
 * evitando a desmontagem do shell e o consequente erro de reboot do ModuleLoader.
 */
function AuthenticatedWorkspace() {
  const [activeModal, setActiveModal] = React.useState<ActiveModalType>(null)

  React.useEffect(() => {
    const handleModalEvent = (event: Event) => {
      const customEvent = event as CustomEvent<ActiveModalType>
      setActiveModal(customEvent.detail ?? null)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveModal(null)
      }
    }

    window.addEventListener('copymonster:modal', handleModalEvent)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('copymonster:modal', handleModalEvent)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  const closeModal = () => setActiveModal(null)

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <WebAppErrorBoundary>
        <React.Suspense
          fallback={
            <div className="cm-auth-boot" role="status" aria-live="polite">
              <span className="cm-auth-spinner" aria-hidden="true" />
              <span>Carregando ambiente de trabalho…</span>
            </div>
          }
        >
          <LazyWebApp />
        </React.Suspense>
      </WebAppErrorBoundary>

      {activeModal !== null && (
        <div
          role="presentation"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            onClick={closeModal}
            aria-hidden="true"
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.7)',
              backdropFilter: 'blur(3px)',
            }}
          />
          <div
            role="dialog"
            aria-modal="true"
            style={{
              position: 'relative',
              width: '100%',
              height: '100%',
              zIndex: 1,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {activeModal === 'plans' && (
              <AppFrame title="Planos e Faturamento" onClose={closeModal}>
                <PlansPage />
              </AppFrame>
            )}

            {activeModal === 'profile' && (
              <AppFrame title="Meu Perfil" onClose={closeModal}>
                <ProfilePage />
              </AppFrame>
            )}

            {activeModal === 'admin' && (
              <RoleGate allowedRoles={['owner', 'admin']} fallback={<div style={{ padding: 24, color: '#fff' }}>Acesso restrito a administradores.</div>}>
                <AppFrame title="Painel Administrativo" onClose={closeModal}>
                  <AdminTenantsPage />
                </AppFrame>
              </RoleGate>
            )}

            {activeModal === 'admin_audit' && (
              <RoleGate allowedRoles={['owner', 'admin']} fallback={<div style={{ padding: 24, color: '#fff' }}>Acesso restrito a administradores.</div>}>
                <AppFrame title="Trilha de Auditoria" onClose={closeModal}>
                  <AdminAuditPage />
                </AppFrame>
              </RoleGate>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function AppRoutes() {
  const { isLoading, authError, retryAuth, user } = useAuth()

  if (isLoading) {
    return (
      <div className="cm-auth-boot" role="status" aria-live="polite">
        <span className="cm-auth-spinner" aria-hidden="true" />
        <span>Verificando sessão…</span>
      </div>
    )
  }

  // Se houver erro de rede/conexão com Supabase e o usuário não foi autenticado, exibe tela de contingência
  if (authError && user === null) {
    return (
      <div className="cm-auth-page">
        <div className="cm-auth-card" style={{ maxWidth: '440px', textAlign: 'center' }}>
          <h2 className="cm-auth-title" style={{ color: 'var(--cm-auth-error-text)' }}>
            Erro de conexão
          </h2>
          <p className="cm-auth-subtitle" style={{ marginTop: '0.5rem' }}>
            Não foi possível comunicar com o servidor de autenticação.
          </p>
          <div className="cm-auth-alert cm-auth-alert--error" style={{ marginTop: '1rem', wordBreak: 'break-word' }}>
            {authError.message}
          </div>
          {retryAuth && (
            <button
              type="button"
              onClick={() => { void retryAuth() }}
              className="cm-auth-button"
              style={{ marginTop: '1.25rem' }}
            >
              Tentar novamente
            </button>
          )}
        </div>
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

      {/* Stripe Checkout Redirects (standalone routes) */}
      <Route
        path="/billing/success"
        element={
          <ProtectedRoute>
            <div style={{ height: '100%', width: '100%', overflowY: 'auto' }}>
              <BillingSuccessPage />
            </div>
          </ProtectedRoute>
        }
      />
      <Route
        path="/billing/cancel"
        element={
          <ProtectedRoute>
            <div style={{ height: '100%', width: '100%', overflowY: 'auto' }}>
              <BillingCancelPage />
            </div>
          </ProtectedRoute>
        }
      />

      {/* Rota Principal - DSH Web Workspace Shell com LazyWebApp permanentemente montado e Modais */}
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <AuthenticatedWorkspace />
          </ProtectedRoute>
        }
      />
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
