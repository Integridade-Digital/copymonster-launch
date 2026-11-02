/** Troca de sessão com o orquestrador: endpoint e validação do destino devolvido. */

import { describe, expect, it, vi } from 'vitest'
import {
  exchangeOrchestratorSession,
  orchestratorSessionEndpoint,
  readOrchestratorRedirect,
  WorkspaceSessionError,
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

describe('exchangeOrchestratorSession', () => {
  it('performs POST request with credentials and returns valid redirectUrl', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ redirectUrl: 'https://acme.copymonster.co/' }),
    })

    const result = await exchangeOrchestratorSession(
      'acme',
      'supabase-mock-jwt',
      mockFetch as unknown as typeof fetch,
    )

    expect(result).toBe('https://acme.copymonster.co/')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://acme.copymonster.co/api/auth/session-token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supabaseJwt: 'supabase-mock-jwt', username: 'acme' }),
        credentials: 'include',
      },
    )
  })

  it('throws WorkspaceSessionError when HTTP response is not ok', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'unauthorized' }),
    })

    await expect(
      exchangeOrchestratorSession('acme', 'token', mockFetch as unknown as typeof fetch),
    ).rejects.toThrow(WorkspaceSessionError)
  })

  it('throws WorkspaceSessionError when orchestrator returns invalid redirect', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ redirectUrl: 'https://malicious.com/' }),
    })

    await expect(
      exchangeOrchestratorSession('acme', 'token', mockFetch as unknown as typeof fetch),
    ).rejects.toThrow(WorkspaceSessionError)
  })
})
