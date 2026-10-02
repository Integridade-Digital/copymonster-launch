import { FooterActionsRoot } from './components/layout/FooterActionsRoot'
/** Browser entry for the Web client. */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import type { applyIndexInjections } from '@deepseek-ai/dsh-client-web'
import { AppWrapper, supabaseClient, useAuth } from './lib/auth'
import { ensureDshBrowserSession, resolveHostBoot } from './lib/auth/host-boot'
import { ProtectedRoute, PublicRoute } from './lib/auth/protected-route'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
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

/** Page global installed by the host index injection of the boot module facade. */
interface HostBootGlobal {
  __ModuleLoader__?: unknown
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
        const entry = new AppWebEntry(containerRef.current, {
          onBoot: (ctx) => {
            ctx.slots.inject('sidebar.footer.action', function* () {
              yield ctx.slots.register(
                { name: 'sidebar.footer.action', id: 'copymonster-footer-actions' },
                FooterActionsRoot,
              )
            })
          },
        })

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

/** Indicador de progresso do carregamento do ambiente de trabalho. */
function WorkspaceBootProgress() {
  return (
    <div className="cm-auth-boot" role="status" aria-live="polite">
      <span className="cm-auth-spinner" aria-hidden="true" />
      <span>Carregando ambiente de trabalho…</span>
    </div>
  )
}

/**
 * Tela exibida quando a troca do token de lançamento não rendeu o documento
 * injetado, o que significa que o processo não registra a rota de entrada do host.
 */
function HostBootUnavailable() {
  return (
    <div className="cm-auth-page">
      <div className="cm-auth-card" style={{ maxWidth: '480px', textAlign: 'center' }}>
        <h2 className="cm-auth-title" style={{ color: 'var(--cm-auth-error-text)' }}>
          Sessão do host indisponível
        </h2>
        <p className="cm-auth-subtitle" style={{ marginTop: '0.75rem' }}>
          O servidor não atende a rota de entrada que estabelece a sessão do host. Inicie o
          CopyMonster com o patch do bundle de autenticação e tente novamente.
        </p>
      </div>
    </div>
  )
}

/**
 * Top-level application routes using HTML5 browser history (BrowserRouter).
 * Handles public auth flows, protected workspace shell, and SaaS management views.
 */

/**
 * Shell autenticado do workspace. Mantém o LazyWebApp permanentemente montado.
 * Os painéis Plans, Profile e Admin são agora abertos diretamente a partir do slot
 * sidebar.footer.action (FooterActionsRoot), seguindo o padrão Settings (estado local + overlay).
 */
function AuthenticatedWorkspace() {
  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const path = window.location.pathname
    if (path === '/admin' || path === '/admin/audit') {
      window.history.replaceState({}, '', '/')
      // Small delay ensures FooterActionsRoot listener is attached
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('copymonster:modal', { detail: 'admin' }))
      }, 50)
    } else if (path === '/plans') {
      window.history.replaceState({}, '', '/')
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('copymonster:modal', { detail: 'plans' }))
      }, 50)
    } else if (path === '/profile') {
      window.history.replaceState({}, '', '/')
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('copymonster:modal', { detail: 'profile' }))
      }, 50)
    }
  }, [])

  const hostBoot = resolveHostBoot({
    facadePresent: (globalThis as HostBootGlobal).__ModuleLoader__ !== undefined,
    desktopBoot: desktop !== undefined,
    pathname: window.location.pathname,
  })

  React.useEffect(() => {
    if (hostBoot !== 'exchange') return
    ensureDshBrowserSession()
  }, [hostBoot])

  if (hostBoot === 'unavailable') return <HostBootUnavailable />
  if (hostBoot === 'exchange') return <WorkspaceBootProgress />

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <WebAppErrorBoundary>
        <React.Suspense fallback={<WorkspaceBootProgress />}>
          <LazyWebApp />
        </React.Suspense>
      </WebAppErrorBoundary>
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
