/**
 * Aquisição da sessão de boot do host exigida pelo workspace autenticado.
 *
 * O host só injeta `__ModuleLoader__`, `__DSH_BOOT__` e `__DSH_BOOT_READY__` em
 * requisições que apresentam o cookie `dsh-auth-<sha256(host)>`, e o shell público
 * servido a quem não o apresenta não carrega nenhuma dessas globals. Um usuário
 * autenticado no Supabase que nunca trocou o token de lançamento recebe esse
 * shell, e o `AppWebEntry` não pode ser inicializado sobre ele.
 *
 * A troca é feita por `GET /enter`, rota registrada por
 * `@deepseek-ai/dsh-api-auth-http`: ela redireciona para `/?token=<lançamento>`,
 * o host responde 303 com o `Set-Cookie` e um segundo 303 para `/`, que então
 * serve o documento injetado.
 */

/** Rota de entrada do host; registrada por `@deepseek-ai/dsh-api-auth-http`. */
export const DSH_ENTER_PATH = '/enter';

/** O que o workspace autenticado faz com a facade de bootstrap do host. */
export type HostBootAction =
  /** A facade está disponível: o `AppWebEntry` pode ser inicializado. */
  | 'boot'
  /** O documento é o shell público: trocar o token de lançamento pelo cookie do host. */
  | 'exchange'
  /** A troca não devolveu o documento injetado: o host não atende a rota de entrada. */
  | 'unavailable'

/** Fatos da página que decidem a ação, todos estáveis durante a vida do documento. */
export interface HostBootFacts {
  /** O host injetou `window.__ModuleLoader__` neste documento. */
  facadePresent: boolean;
  /** O carrier desktop inicializou, e instala a facade pela troca assíncrona dele. */
  desktopBoot: boolean;
  /** O pathname que o navegador está exibindo. */
  pathname: string;
}

/**
 * Decide o que o workspace autenticado faz quando a facade de bootstrap do host
 * não está presente.
 * @param facts - Fatos da página atuais.
 * @returns A ação que o workspace deve executar.
 */
export function resolveHostBoot(facts: HostBootFacts): HostBootAction {
  // O carrier desktop não injeta a facade no documento: `dshDesktopBoot.ready`
  // a instala depois do seu deferred de prontidão, que o `AppWebEntry` aguarda
  // antes de lê-la. A ausência inicial não significa shell público ali.
  if (facts.facadePresent || facts.desktopBoot) return 'boot';
  // Estar em `/enter` significa que a troca não rendeu o documento injetado, o
  // que acontece quando o processo não registra a rota — uma execução sem o
  // patch do bundle copymonster deixa `/enter` cair no shell público. Repetir a
  // navegação recarregaria a mesma página indefinidamente.
  if (facts.pathname === DSH_ENTER_PATH) return 'unavailable';
  return 'exchange';
}

/**
 * Navega o documento para a rota de entrada do host, que responde com o cookie
 * de sessão e redireciona para `/`.
 */
export function ensureDshBrowserSession(): void {
  window.location.replace(DSH_ENTER_PATH);
}
