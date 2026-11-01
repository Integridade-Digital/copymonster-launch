/**
 * Troca do JWT do Supabase pela sessão assinada do orquestrador de subdomínios.
 * O orquestrador emite o cookie `sid` no domínio pai e devolve a URL do
 * subdomínio do tenant, que o navegador abre em seguida.
 * @module apps/web/lib/auth/orchestrator-sso
 */

import { TENANT_BASE_DOMAIN } from './subdomain-guard';

/** Caminho da troca de sessão no orquestrador. */
export const ORCHESTRATOR_SESSION_PATH = '/api/auth/session-token';

/** Falha de preparação da sessão isolada, com mensagem própria para o formulário. */
export class WorkspaceSessionError extends Error {}

/**
 * Monta o endpoint de troca de sessão do subdomínio do tenant.
 * @param tenantSlug - Slug do tenant da conta autenticada.
 * @param baseDomain - Domínio base dos subdomínios.
 * @returns URL absoluta do endpoint do orquestrador.
 */
export function orchestratorSessionEndpoint(
  tenantSlug: string,
  baseDomain: string = TENANT_BASE_DOMAIN,
): string {
  return `https://${tenantSlug}.${baseDomain}${ORCHESTRATOR_SESSION_PATH}`;
}

/**
 * Lê e valida a URL de destino devolvida pelo orquestrador.
 * @param body - Corpo JSON decodificado da resposta.
 * @param baseDomain - Domínio base aceito para o destino.
 * @returns URL de destino https dentro do domínio base, ou null quando inválida.
 */
export function readOrchestratorRedirect(
  body: unknown,
  baseDomain: string = TENANT_BASE_DOMAIN,
): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const redirectUrl = (body as { redirectUrl?: unknown }).redirectUrl;
  if (typeof redirectUrl !== 'string' || redirectUrl === '') return null;
  let url: URL;
  try {
    url = new URL(redirectUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  if (host !== baseDomain && !host.endsWith(`.${baseDomain}`)) return null;
  return url.toString();
}
