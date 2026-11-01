/**
 * Decisão de permanência no host da plataforma: uma conta de tenant que abre o
 * host principal é encaminhada ao subdomínio do próprio tenant, enquanto rotas
 * públicas, de administração da plataforma e de cobrança continuam no host
 * principal.
 * @module apps/web/lib/auth/subdomain-guard
 */

/** Host público da plataforma. */
export const PLATFORM_HOST = 'app.copymonster.co';

/** Domínio base dos subdomínios de tenant. */
export const TENANT_BASE_DOMAIN = 'copymonster.co';

/** Prefixos de rota que nunca são encaminhados ao subdomínio do tenant. */
const PLATFORM_ONLY_PREFIXES = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/auth',
  '/admin',
  '/plans',
  '/profile',
  '/billing',
] as const;

/** Fatos da página que decidem o encaminhamento. */
export interface TenantRedirectFacts {
  /** Host da página, com porta opcional. */
  host: string;
  /** Pathname exibido pelo navegador. */
  pathname: string;
  /** Slug do tenant da conta autenticada, quando houver. */
  tenantSlug?: string;
}

/**
 * Verifica se uma rota pertence ao host da plataforma e não ao tenant.
 * @param pathname - Pathname exibido pelo navegador.
 * @returns true para rotas públicas, de administração ou de cobrança.
 */
export function isPlatformOnlyPath(pathname: string): boolean {
  return PLATFORM_ONLY_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Decide o destino no subdomínio do tenant para uma visita ao host principal.
 * @param facts - Fatos atuais da página e da conta.
 * @returns URL absoluta do subdomínio, ou null quando a página deve permanecer.
 */
export function resolveTenantRedirect(facts: TenantRedirectFacts): string | null {
  const host = facts.host.split(':')[0]?.toLowerCase();
  if (host !== PLATFORM_HOST) return null;
  if (isPlatformOnlyPath(facts.pathname)) return null;
  const slug = facts.tenantSlug?.trim().toLowerCase();
  if (slug === undefined || slug === '') return null;
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) return null;
  return `https://${slug}.${TENANT_BASE_DOMAIN}/`;
}
