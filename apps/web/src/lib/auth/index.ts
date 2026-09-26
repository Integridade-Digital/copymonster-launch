export {
  supabaseClient,
  getUserFullProfile,
  type AuthUser,
  type AuthContextType,
} from './supabase.client';
export { AuthProvider, useAuth, AuthContext } from './auth.provider';
export { AppWrapper } from './app-wrapper';
export { formatAuthError } from './auth-error-utils';
