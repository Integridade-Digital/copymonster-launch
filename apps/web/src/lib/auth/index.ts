/**
 * CopyMonster Auth Module
 * 
 * Módulo de autenticação com Supabase para o frontend
 */

export { AuthProvider, useAuth, AuthContext } from './auth.provider';
export { supabaseClient, getUserFullProfile } from './supabase.client';
export { AppWrapper } from './app-wrapper';
export { ProtectedRoute, PublicRoute } from './protected-route';
export type { AuthUser, AuthContextType, Database } from './supabase.client';
