import { createClient, SupabaseClient } from '@supabase/supabase-js';

/** JSON document the `get_my_profile()` RPC returns, per `supabase/migrations/003`. */
export interface MyProfileResult {
  user: {
    id: string;
    email: string;
    full_name: string | null;
    avatar_url: string | null;
    whatsapp: string | null;
  };
  tenant: {
    id: string;
    name: string;
    slug: string;
    status: string;
  } | null;
  role: 'owner' | 'admin' | 'member' | 'anonymous' | null;
}

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
    Functions: {
      get_my_profile: {
        Args: Record<string, never>;
        Returns: MyProfileResult;
      };
    };
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
  authError?: Error | null;
  retryAuth?: () => Promise<void>;
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
 *
 * The single `get_my_profile()` RPC reads `auth.uid()` on the server, so the
 * browser sends no user id and cannot widen its own scope; the returned
 * `user.id` is still checked against `userId` so a stale session cannot resolve
 * another account's profile.
 * @param userId - Supabase `auth.users` identity the caller expects.
 * @returns the composed profile, or `null` when the call fails, no session is
 *   established, or the returned profile belongs to another account.
 */
export async function getUserFullProfile(userId: string): Promise<AuthUser | null> {
  try {
    const { data, error } = await supabaseClient.rpc('get_my_profile');

    if (error !== null || data === null) return null;
    if (data.user.id !== userId) return null;

    const { id, email, full_name, whatsapp, avatar_url } = data.user;

    return {
      id,
      email,
      ...full_name === null || full_name === '' ? {} : { fullName: full_name },
      ...whatsapp === null || whatsapp === '' ? {} : { whatsapp },
      ...avatar_url === null || avatar_url === '' ? {} : { avatarUrl: avatar_url },
      ...data.tenant === null ? {} : { tenantId: data.tenant.id },
      ...data.role === null ? {} : { role: data.role },
    };
  } catch (error: unknown) {
    console.error('Error fetching user profile:', error);
    return null;
  }
}
