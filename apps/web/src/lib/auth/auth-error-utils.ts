import { t } from '../../locales';

/**
 * Utilitário de formatação e categorização de mensagens de erro de autenticação em EN/ZH.
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

  return rawMessage;
}

export const getFriendlyAuthErrorMessage = formatAuthError;
