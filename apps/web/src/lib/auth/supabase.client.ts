import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Tipos para o schema do CopyMonster
export interface Database {
  public: {
    Tables: {
      tenants: {
        Row: {
          id: string;
          name: string;
          slug: string;
          status: 'active' | 'suspended' | 'deleted';
        };
      };
      users: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          whatsapp: string | null;
          avatar_url: string | null;
        };
      };
      user_tenant_roles: {
        Row: {
          id: string;
          user_id: string;
          tenant_id: string;
          role: 'owner' | 'admin' | 'member' | 'anonymous';
        };
      };
    };
  };
}

// Interface de usuário autenticado
export interface AuthUser {
  id: string;
  email: string;
  fullName?: string;
  whatsapp?: string;
  avatarUrl?: string;
  tenantId?: string;
  role?: 'owner' | 'admin' | 'member' | 'anonymous';
}

// Contexto de autenticação
export interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signUp: (email: string, password: string, fullName: string, whatsapp: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: any }>;
  updateUser: (data: Partial<AuthUser>) => Promise<{ error: any }>;
}

// Criar cliente Supabase
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn('Supabase credentials not configured. Auth will not work.');
}

export const supabaseClient: SupabaseClient<Database> = createClient<Database>(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  }
);

/**
 * Obter dados completos do usuário incluindo tenant e role
 */
export async function getUserFullProfile(userId: string): Promise<AuthUser | null> {
  try {
    // Buscar dados do usuário
    const { data: userData, error: userError } = await supabaseClient
      .from('users')
      .select('id, email, full_name, whatsapp, avatar_url')
      .eq('id', userId)
      .single();

    if (userError || !userData) {
      return null;
    }

    // Buscar tenant padrão (Integridade Digital)
    const { data: tenantData } = await supabaseClient
      .from('tenants')
      .select('id')
      .eq('slug', 'integridade-digital')
      .eq('status', 'active')
      .single();

    if (!tenantData) {
      return {
        id: userData.id,
        email: userData.email,
        fullName: userData.full_name || undefined,
        whatsapp: userData.whatsapp || undefined,
        avatarUrl: userData.avatar_url || undefined,
      };
    }

    // Buscar role do usuário no tenant
    const { data: roleData } = await supabaseClient
      .from('user_tenant_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('tenant_id', tenantData.id)
      .single();

    return {
      id: userData.id,
      email: userData.email,
      fullName: userData.full_name || undefined,
      whatsapp: userData.whatsapp || undefined,
      avatarUrl: userData.avatar_url || undefined,
      tenantId: tenantData.id,
      role: roleData?.role || 'anonymous',
    };
  } catch (error) {
    console.error('Error fetching user profile:', error);
    return null;
  }
}
