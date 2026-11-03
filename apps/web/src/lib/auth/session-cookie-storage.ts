/**
 * Supabase session storage shared by every `*.copymonster.co` origin.
 *
 * Supabase's default storage is `localStorage`, which is scoped to one origin.
 * The main app authenticates on `app.copymonster.co` and redirects to
 * `<tenant>.copymonster.co`; without a shared store the tenant subdomain cannot
 * see the session and shows the sign-in form again. Cookies are scoped to the
 * registrable domain, so they carry the session across both origins.
 *
 * Values are base64url-encoded and split into chunks so a session larger than a
 * single cookie's 4 KB budget still round-trips. Cookie names keep the Supabase
 * storage key (`sb-<ref>-auth-token`) plus a numeric suffix per chunk.
 * @module apps/web/lib/auth/session-cookie-storage
 */

import type { SupportedStorage } from '@supabase/supabase-js';
import { TENANT_BASE_DOMAIN } from './subdomain-guard';

/** Base domain shared by the main app and every tenant workspace. */
const SHARED_COOKIE_DOMAIN = `.${TENANT_BASE_DOMAIN}`;

/** Lifetime of the stored session; Supabase rotates the value on refresh. */
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** Maximum encoded characters per cookie, staying under the 4 KB per-cookie budget. */
const MAX_CHUNK_LENGTH = 3000;

/** Minimal document surface the session store needs. */
export interface CookieDocument {
  cookie: string;
}

/** Browser facts that decide the cookie scope. */
export interface SessionCookieEnvironment {
  /** The document whose cookies hold the session. */
  document: CookieDocument;
  /** Current hostname, used to decide whether the cookie is shared. */
  hostname: string;
  /** Whether the page runs over HTTPS, which requires the `Secure` attribute. */
  secure: boolean;
}

/**
 * Decide the cookie domain for the current hostname.
 *
 * `localhost` and preview hosts stay host-only so local development keeps
 * working; the production registrable domain sets `Domain=.copymonster.co` so
 * the main app and tenant subdomains read the same cookie.
 * @param hostname - Hostname of the current document.
 * @returns The cookie domain attribute, or `undefined` for a host-only cookie.
 */
export function sharedCookieDomain(hostname: string): string | undefined {
  const host = hostname.toLowerCase();
  if (host === TENANT_BASE_DOMAIN || host.endsWith(SHARED_COOKIE_DOMAIN)) return SHARED_COOKIE_DOMAIN;
  return undefined;
}

/** Encode a UTF-8 string as unpadded base64url. */
function encodeCookieValue(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  const batch = 0x8000;
  for (let index = 0; index < bytes.length; index += batch) {
    binary += String.fromCharCode(...bytes.subarray(index, index + batch));
  }
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

/** Decode an unpadded base64url string, or return `null` for malformed input. */
function decodeCookieValue(value: string): string | null {
  try {
    const base64 = value.replace(/-/gu, '+').replace(/_/gu, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/** Parse the document cookie string into a name → value map. */
function readCookieMap(document: CookieDocument): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed === '') continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    cookies.set(trimmed.slice(0, separator), trimmed.slice(separator + 1));
  }
  return cookies;
}

/** Write one cookie with the shared scope and lifetime. */
function writeCookie(
  document: CookieDocument,
  name: string,
  value: string,
  environment: SessionCookieEnvironment,
  maxAgeSeconds: number,
): void {
  const attributes = [`${name}=${value}`, 'Path=/', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`];
  const domain = sharedCookieDomain(environment.hostname);
  if (domain !== undefined) attributes.push(`Domain=${domain}`);
  if (environment.secure) attributes.push('Secure');
  document.cookie = attributes.join('; ');
}

/** Delete the plain key and every chunk previously written for it. */
function clearCookie(
  document: CookieDocument,
  key: string,
  environment: SessionCookieEnvironment,
): void {
  const cookies = readCookieMap(document);
  const chunkPrefix = `${key}.`;
  for (const name of cookies.keys()) {
    if (name === key || name.startsWith(chunkPrefix)) {
      writeCookie(document, name, '', environment, 0);
    }
  }
}

/** Read and join the chunk cookies for a key, falling back to an unchunked value. */
function readCookie(document: CookieDocument, key: string): string | null {
  const cookies = readCookieMap(document);
  const chunks: string[] = [];
  for (let index = 0; ; index += 1) {
    const chunk = cookies.get(`${key}.${index}`);
    if (chunk === undefined) break;
    chunks.push(chunk);
  }
  if (chunks.length > 0) return chunks.join('');
  return cookies.get(key) ?? null;
}

/**
 * Create Supabase session storage backed by shared cookies.
 * @param environment - Current document and host facts.
 * @returns Storage that Supabase Auth can use instead of `localStorage`.
 */
export function createSessionCookieStorage(environment: SessionCookieEnvironment): SupportedStorage {
  return {
    getItem(key: string): string | null {
      const encoded = readCookie(environment.document, key);
      return encoded === null ? null : decodeCookieValue(encoded);
    },
    setItem(key: string, value: string): void {
      clearCookie(environment.document, key, environment);
      const encoded = encodeCookieValue(value);
      if (encoded.length <= MAX_CHUNK_LENGTH) {
        writeCookie(environment.document, key, encoded, environment, COOKIE_MAX_AGE_SECONDS);
        return;
      }
      for (let offset = 0, index = 0; offset < encoded.length; offset += MAX_CHUNK_LENGTH, index += 1) {
        writeCookie(
          environment.document,
          `${key}.${index}`,
          encoded.slice(offset, offset + MAX_CHUNK_LENGTH),
          environment,
          COOKIE_MAX_AGE_SECONDS,
        );
      }
    },
    removeItem(key: string): void {
      clearCookie(environment.document, key, environment);
    },
  };
}
