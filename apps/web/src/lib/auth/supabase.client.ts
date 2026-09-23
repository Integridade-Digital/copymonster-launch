import { createClient, SupabaseClient } from '@supabase/supabase-js';

/** Default tenant slug, mirrored from the host-side `dsh-constants` package. */
const DEFAULT_TENANT_SLUG = 'integridade-digital';

/**
 * Browser-visible schema projection.
 *
 * `Relationships` is required by the supabase-js `GenericTable` constraint;
 * without it every row type collapses to `never`.
 */
export interface Database {
  public: {
    Tables: {
      tenants: {
        Row: {
          id: string;
          name: string;
          slug: string;
          status: 'active' | 'suspended' | 'deleted';
          created_at: string;
          subscription_status: string;
          current_period_end: string | null;
          plan_id: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          status?: 'active' | 'suspended' | 'deleted';
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          status?: 'active' | 'suspended' | 'deleted';
        };
        Relationships: [];
      };
      users: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          whatsapp: string | null;
          avatar_url: string | null;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          whatsapp?: string | null;
          avatar_url?: string | null;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string | null;
          whatsapp?: string | null;
          avatar_url?: string | null;
        };
        Relationships: [];
      };
      user_tenant_roles: {
        Row: {
          id: string;
          user_id: string;
          tenant_id: string;
          role: 'owner' | 'admin' | 'member' | 'anonymous';
        };
        Insert: {
          id?: string;
          user_id: string;
          tenant_id: string;
          role: 'owner' | 'admin' | 'member' | 'anonymous';
        };
        Update: {
          id?: string;
          user_id?: string;
          tenant_id?: string;
          role?: 'owner' | 'admin' | 'member' | 'anonymous';
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

/** Authenticated user as the browser consumes it. */
export interface AuthUser {
  id: string;
  email: string;
  fullName?: string;
  whatsapp?: string;
  avatarUrl?: string;
  tenantId?: string;
  role?: 'owner' | 'admin' | 'member' | 'anonymous';
}

/** Auth context surface shared by `AuthProvider` and every consumer. */
export interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName: string, whatsapp: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: Error | null }>;
  updateUser: (data: Partial<AuthUser>) => Promise<{ error: Error | null }>;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (SUPABASE_URL === undefined || SUPABASE_ANON_KEY === undefined) {
  console.warn('Supabase credentials not configured. Auth will not work.');
}

export const supabaseClient: SupabaseClient<Database> = createClient<Database>(
  SUPABASE_URL ?? '',
  SUPABASE_ANON_KEY ?? '',
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  },
);

/**
 * Read the signed-in user's profile, tenant, and role under row-level security.
 * @param userId - Supabase `auth.users` identity.
 * @returns the composed profile, or `null` when the profile row is unreachable.
 */
export async function getUserFullProfile(userId: string): Promise<AuthUser | null> {
  try {
    const { data: userData, error: userError } = await supabaseClient
      .from('users')
      .select('id, email, full_name, whatsapp, avatar_url')
      .eq('id', userId)
      .single();

    if (userError !== null || userData === null) return null;

    const { data: tenantData } = await supabaseClient
      .from('tenants')
      .select('id')
      .eq('slug', DEFAULT_TENANT_SLUG)
      .eq('status', 'active')
      .single();

    if (tenantData === null) {
      return {
        id: userData.id,
        email: userData.email,
        ...userData.full_name === null ? {} : { fullName: userData.full_name },
        ...userData.whatsapp === null ? {} : { whatsapp: userData.whatsapp },
        ...userData.avatar_url === null ? {} : { avatarUrl: userData.avatar_url },
      };
    }

    const { data: roleData } = await supabaseClient
      .from('user_tenant_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('tenant_id', tenantData.id)
      .single();

    return {
      id: userData.id,
      email: userData.email,
      ...userData.full_name === null ? {} : { fullName: userData.full_name },
      ...userData.whatsapp === null ? {} : { whatsapp: userData.whatsapp },
      ...userData.avatar_url === null ? {} : { avatarUrl: userData.avatar_url },
      tenantId: tenantData.id,
      role: roleData?.role ?? 'anonymous',
    };
  } catch (error: unknown) {
    console.error('Error fetching user profile:', error);
    return null;
  }
}
