import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { t } from '../../locales'
import { listMyPositioningMappings } from '../../components/dna/useDnaOnboardingState'

/**
 * Paths that never require a completed DNA mapping: the onboarding flow
 * itself and the Stripe checkout return URLs. In-workspace surfaces
 * (settings, profile, billing modals) stay reachable from the onboarding
 * route because it mounts the same workspace shell.
 */
function isDnaGuardExempt(pathname: string): boolean {
  return pathname.startsWith('/onboarding/') || pathname.startsWith('/billing/')
}

type DnaGatePhase = 'checking' | 'missing' | 'ready'

interface RequireDnaRouteProps {
  children: React.ReactNode
}

/**
 * Fail-closed gate over the authenticated workspace: a creator with no
 * completed positioning mapping is redirected to /onboarding/dna. An
 * unreadable roster also redirects — the onboarding route surfaces its own
 * recovery copy.
 * @param props - the workspace tree to render once the gate passes.
 */
export function RequireDnaRoute({ children }: RequireDnaRouteProps) {
  const location = useLocation()
  const [phase, setPhase] = React.useState<DnaGatePhase>('checking')

  React.useEffect(() => {
    if (isDnaGuardExempt(location.pathname)) {
      setPhase('ready')
      return
    }
    let cancelled = false
    setPhase('checking')
    listMyPositioningMappings()
      .then(rows => {
        if (cancelled) return
        setPhase(rows.some(row => row.status === 'completed') ? 'ready' : 'missing')
      })
      .catch(() => {
        // Fail-closed: an unreadable roster reads as no completed DNA.
        if (!cancelled) setPhase('missing')
      })
    return () => { cancelled = true }
  }, [location.pathname])

  if (phase === 'missing') return <Navigate to="/onboarding/dna" replace />
  if (phase === 'checking') {
    return (
      <div className="cm-auth-boot" role="status" aria-live="polite">
        <span className="cm-auth-spinner" aria-hidden="true" />
        <span>{t('auth.error.loadingWorkspace')}</span>
      </div>
    )
  }
  return <>{children}</>
}
