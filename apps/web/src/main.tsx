/** Browser entry for the Web client. */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AppWebEntry, applyIndexInjections } from '@deepseek-ai/dsh-client-web'
import { AppWrapper, useAuth } from './lib/auth'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import './auth.css'

interface DesktopBootGlobal {
  dshDesktopBoot?: {
    failed(message: string): Promise<void>
    ready(): Promise<{ injections: Parameters<typeof applyIndexInjections>[0]; streamBaseUrl: string }>
  }
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

/** CopyMonster auth screens, addressed by the current pathname. */
function AuthRoutes() {
  const initial = `${window.location.pathname}${window.location.search}`
  return (
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        {/* Unauthenticated visitors land on registration, per the SaaS flow. */}
        <Route path="/register" element={<RegisterPage />} />
        <Route path="*" element={<RegisterPage />} />
      </Routes>
    </MemoryRouter>
  )
}

/**
 * Authentication gate: the Harness shell mounts only for a signed-in session.
 * Keeping the shell unmounted while signed out is the security boundary this
 * phase provides — there is no composer or RPC surface to reach unauthenticated.
 */
function Root() {
  const { user, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="cm-auth-boot" role="status" aria-live="polite">
        <span className="cm-auth-spinner" aria-hidden="true" />
        <span>Verificando sessão…</span>
      </div>
    )
  }

  if (user === null) return <AuthRoutes />
  return <WebApp />
}

try {
  const el = document.getElementById('root')
  if (el === null) throw new Error('web app: missing #root')

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
