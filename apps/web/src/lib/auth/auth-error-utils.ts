/**
 * Utilitário de formatação e categorização de mensagens de erro de autenticação.
 * Converte erros técnicos ou em inglês do Supabase em mensagens claras em português,
 * distinguindo erros de credenciais (400) de falhas de rede/servidor (500/timeout).
 */
export function formatAuthError(error: unknown, fallbackMessage: string): string {
  if (error === null || error === undefined) return fallbackMessage;

  const rawMessage = error instanceof Error
    ? error.message
    : typeof error === 'object' && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error);

  const lower = rawMessage.toLowerCase();

  // Erros de credenciais e validação (400)
  if (lower.includes('invalid login credentials') || lower.includes('invalid_credentials')) {
    return 'E-mail ou senha incorretos. Verifique seus dados e tente novamente.';
  }
  if (lower.includes('email not confirmed')) {
    return 'E-mail ainda não confirmado. Verifique sua caixa de entrada e spam para ativar sua conta.';
  }
  if (lower.includes('user already registered') || lower.includes('already registered')) {
    return 'Este e-mail já está cadastrado. Faça login ou recupere sua senha.';
  }
  if (lower.includes('password should be at least')) {
    return 'A senha é muito curta. Utilize ao menos 8 caracteres.';
  }

  // Rate-limiting / excesso de tentativas (429)
  if (lower.includes('too many requests') || lower.includes('rate limit')) {
    return 'Muitas tentativas consecutivas. Por segurança, aguarde alguns instantes antes de tentar novamente.';
  }

  // Falhas de rede, timeout e indisponibilidade de servidor (500/offline)
  if (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network request failed') ||
    lower.includes('abort') ||
    lower.includes('timeout')
  ) {
    return 'Falha de conexão com o servidor. Verifique sua conexão com a internet e tente novamente.';
  }

  if (lower.includes('500') || lower.includes('internal server error') || lower.includes('bad gateway')) {
    return 'O serviço de autenticação está temporariamente instável. Tente novamente em instantes.';
  }

  return rawMessage;
}
