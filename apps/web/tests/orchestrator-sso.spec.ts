/** Troca de sessão com o orquestrador: endpoint e validação do destino devolvido. */

import { describe, expect, it } from 'vitest'
import {
  orchestratorSessionEndpoint,
  readOrchestratorRedirect,
} from '../src/lib/auth/orchestrator-sso'

describe('orchestratorSessionEndpoint', () => {
  it('targets the tenant subdomain session route', () => {
    expect(orchestratorSessionEndpoint('acme')).toBe(
      'https://acme.copymonster.co/api/auth/session-token',
    )
  })
})

describe('readOrchestratorRedirect', () => {
  it('accepts an https tenant subdomain returned by the orchestrator', () => {
    expect(readOrchestratorRedirect({ redirectUrl: 'https://acme.copymonster.co/' }))
      .toBe('https://acme.copymonster.co/')
  })

  it('rejects missing, malformed, non-https, and foreign destinations', () => {
    expect(readOrchestratorRedirect(null)).toBeNull()
    expect(readOrchestratorRedirect({})).toBeNull()
    expect(readOrchestratorRedirect({ redirectUrl: '/workspace' })).toBeNull()
    expect(readOrchestratorRedirect({ redirectUrl: 'http://acme.copymonster.co/' })).toBeNull()
    expect(readOrchestratorRedirect({ redirectUrl: 'https://acme.evil.example/' })).toBeNull()
  })
})
