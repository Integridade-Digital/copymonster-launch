/** WhatsApp MCP settings card locale completeness across the eight shipped dictionaries. */

import { describe, expect, it } from 'vitest'
import { de, en, es, fr, ja, pt, ru, zh, type WhatsAppMcpLocaleKey } from '../src/client/locales/index.ts'

describe('locale dictionaries', () => {
  const dictionaries: Record<string, Record<WhatsAppMcpLocaleKey, string>> = { en, pt, zh, es, fr, de, ru, ja }
  const englishKeys = Object.keys(en).sort()

  for (const [locale, dictionary] of Object.entries(dictionaries)) {
    it(`${locale} covers every English key with non-empty copy`, () => {
      expect(Object.keys(dictionary).sort()).toEqual(englishKeys)
      for (const key of englishKeys) {
        expect(dictionary[key as WhatsAppMcpLocaleKey].trim()).not.toBe('')
      }
    })
  }

  it('keeps the required card copy in the fallback dictionary', () => {
    expect(en.title).toBe('WhatsApp Business MCP')
    expect(en.description).toBe('Connect your WhatsApp Business account to manage messages and templates.')
    expect(en.authorize).toBe('Authorize')
    expect(en.refreshToken).toBe('Refresh token')
    expect(en.testConnection).toBe('Test connection')
    expect(en.clearCredentials).toBe('Clear credentials')
    expect(en.connectionSuccessful).toBe('Connection successful.')
    expect(en.authorizationFailed).toBe('Authorization failed.')
    expect(en.tokenExpired).toBe('Token expired.')
    expect(en.connecting).toBe('Connecting…')
  })
})
