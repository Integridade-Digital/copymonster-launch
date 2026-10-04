import { t } from '../../locales';

const SENSITIVE_PATTERNS = [
  /@deepseek-ai(?:\/[^\s'"`]+)?/i,
  /\/packages(?:\/[^\s'"`]*)?/i,
  /\/tmp(?:\/[^\s'"`]*)?/i,
  /\/var(?:\/[^\s'"`]*)?/i,
  /(?:^|[\s"'`(=])(?:\/[a-zA-Z0-9_.-]+){2,}/,
  /(?:[a-zA-Z]:\\[a-zA-Z0-9_.\-\\]+)/,
];

/**
 * Utilitário de formatação e categorização de mensagens de erro de autenticação em EN/ZH.
 * Redige mensagens cruas para evitar vazamento de paths internos ou detalhes sensíveis de infraestrutura.
 */
export function formatAuthError(error: unknown, fallbackMessage?: string): string {
  if (error === null || error === undefined) return fallbackMessage || t('auth.error.unknown');

  const rawMessage = error instanceof Error
    ? error.message
    : typeof error === 'object' && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error);

  const lower = rawMessage.toLowerCase();

  // Erros de credenciais e validação (400)
  if (lower.includes('invalid login credentials') || lower.includes('invalid_credentials')) {
    return t('auth.error.invalidCredentials');
  }
  if (lower.includes('email not confirmed')) {
    return t('auth.error.emailNotConfirmed');
  }
  if (lower.includes('user already registered') || lower.includes('already registered')) {
    return t('auth.error.alreadyRegistered');
  }
  if (lower.includes('password should be at least')) {
    return t('auth.error.passwordTooShort');
  }
  if (lower.includes('token has expired') || lower.includes('otp_expired') || lower.includes('invalid link') || lower.includes('link has expired')) {
    return t('auth.error.tokenExpired');
  }
  if (lower.includes('user not found')) {
    return t('auth.error.userNotFound');
  }
  if (lower.includes('invalid email') || lower.includes('valid email')) {
    return t('auth.error.invalidEmail');
  }
  if (lower.includes('jwt expired') || lower.includes('session expired') || lower.includes('session from session_id claim')) {
    return t('auth.error.sessionExpired');
  }
  if (lower.includes('new password should be different') || lower.includes('same password')) {
    return t('auth.error.samePassword');
  }
  if (lower.includes('provider is disabled') || lower.includes('signups not allowed') || lower.includes('signup is disabled')) {
    return t('auth.error.providerDisabled');
  }

  // Rate-limiting / excesso de tentativas (429)
  if (lower.includes('too many requests') || lower.includes('rate limit')) {
    return t('auth.error.tooManyRequests');
  }

  // Falhas de rede, timeout e indisponibilidade de servidor (500/offline)
  if (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network request failed') ||
    lower.includes('abort') ||
    lower.includes('timeout')
  ) {
    return t('auth.error.networkFailed');
  }

  if (lower.includes('500') || lower.includes('internal server error') || lower.includes('bad gateway')) {
    return t('auth.error.serviceUnavailable');
  }

  // Bloquear regex que revele caminhos do sistema ou pacotes internos
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(rawMessage)) {
      return fallbackMessage || t('auth.error.generic');
    }
  }

  // Fallback seguro: não exibir mensagem crua não mapeada
  return fallbackMessage || t('auth.error.generic');
}

export const getFriendlyAuthErrorMessage = formatAuthError;
