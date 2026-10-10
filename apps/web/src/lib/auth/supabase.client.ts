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
          trial_ends_at?: string | null;
          trial_used?: boolean;
          trial_tokens_used?: number;
          current_period_tokens_used?: number;
          subscription_interval?: string | null;
          cancel_at_period_end?: boolean;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          status?: 'active' | 'suspended' | 'deleted';
          subscription_status?: string;
          plan_id?: string | null;
          trial_ends_at?: string | null;
          trial_used?: boolean;
          trial_tokens_used?: number;
          current_period_tokens_used?: number;
          subscription_interval?: string | null;
          cancel_at_period_end?: boolean;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          status?: 'active' | 'suspended' | 'deleted';
          subscription_status?: string;
          plan_id?: string | null;
          trial_ends_at?: string | null;
          trial_used?: boolean;
          trial_tokens_used?: number;
          current_period_tokens_used?: number;
          subscription_interval?: string | null;
          cancel_at_period_end?: boolean;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
        };
        Relationships: [];
      };
      audit_logs: {
        Row: {
          id: string;
          tenant_id: string | null;
          user_id: string | null;
          action: string;
          resource_type: string | null;
          resource_id: string | null;
          old_value: any | null;
          new_value: any | null;
          ip_address: string | null;
          user_agent: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id?: string | null;
          user_id?: string | null;
          action: string;
          resource_type?: string | null;
          resource_id?: string | null;
          old_value?: any | null;
          new_value?: any | null;
          ip_address?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string | null;
          user_id?: string | null;
          action?: string;
          resource_type?: string | null;
          resource_id?: string | null;
          old_value?: any | null;
          new_value?: any | null;
          ip_address?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      plans: {
        Row: {
          id: string;
          name: string;
          slug: string;
          price_cents: number;
          monthly_price_cents?: number | null;
          annual_price_cents?: number | null;
          currency: string;
          stripe_price_id?: string | null;
          stripe_price_id_monthly?: string | null;
          stripe_price_id_annual?: string | null;
          token_limit_input?: number | null;
          token_limit_output?: number | null;
          max_workspaces?: number | null;
          max_sessions?: number | null;
          storage_gb?: number | null;
          ai_tier?: string | null;
          limits?: Record<string, any> | null;
          features?: string[] | null;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          price_cents?: number;
          monthly_price_cents?: number | null;
          annual_price_cents?: number | null;
          currency?: string;
          stripe_price_id?: string | null;
          stripe_price_id_monthly?: string | null;
          stripe_price_id_annual?: string | null;
          token_limit_input?: number | null;
          token_limit_output?: number | null;
          max_workspaces?: number | null;
          max_sessions?: number | null;
          storage_gb?: number | null;
          ai_tier?: string | null;
          limits?: Record<string, any> | null;
          features?: string[] | null;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          price_cents?: number;
          monthly_price_cents?: number | null;
          annual_price_cents?: number | null;
          currency?: string;
          stripe_price_id?: string | null;
          stripe_price_id_monthly?: string | null;
          stripe_price_id_annual?: string | null;
          token_limit_input?: number | null;
          token_limit_output?: number | null;
          max_workspaces?: number | null;
          max_sessions?: number | null;
          storage_gb?: number | null;
          ai_tier?: string | null;
          limits?: Record<string, any> | null;
          features?: string[] | null;
          is_active?: boolean;
          created_at?: string;
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
      list_my_positioning_mappings: {
        Args: Record<string, never>;
        Returns: PositioningMappingRow[];
      };
      create_positioning_mapping: {
        Args: { p_name: string; p_product_name: string };
        Returns: PositioningMappingRow;
      };
      update_positioning_block: {
        Args: { p_mapping_id: string; p_block_number: number; p_content: string };
        Returns: PositioningMappingRow;
      };
      count_my_positioning_mappings: {
        Args: Record<string, never>;
        Returns: PositioningQuota;
      };
      set_default_positioning_mapping: {
        Args: { p_mapping_id: string };
        Returns: boolean;
      };
      delete_positioning_mapping: {
        Args: { p_mapping_id: string };
        Returns: boolean;
      };
      duplicate_positioning_mapping: {
        Args: { p_mapping_id: string; p_new_name: string };
        Returns: PositioningMappingRow;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

/** JSONB returned by count_my_positioning_mappings(), per `supabase/migrations/039`. */
export interface PositioningQuota {
  count: number;
  max: number;
  can_create: boolean;
  plan_slug: string;
  is_unlimited: boolean;
}

/** Row of `public.positioning_mappings` returned by the DNA RPCs, per `supabase/migrations/039`. */
export interface PositioningMappingRow {
  id: string;
  name: string;
  product_name: string;
  block_1_public: string | null;
  block_2_pains: string | null;
  block_3_solution: string | null;
  block_4_differentiators: string | null;
  block_5_awareness_stage: string | null;
  block_6_urgency: string | null;
  block_7_social_proof: string | null;
  block_8_objections: string | null;
  block_9_emotional: string | null;
  block_10_transformation: string | null;
  block_11_voice: string | null;
  block_12_promises: string | null;
  status: 'in_progress' | 'completed' | 'archived';
  current_block: number;
  is_default: boolean;
  updated_at: string;
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
  updatePassword: (password: string) => Promise<{ error: Error | null }>;
  updateProfile: (data: { fullName?: string; whatsapp?: string }) => Promise<{ error: Error | null }>;
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

    const resolvedRole = data.role ?? 'member';
    return {
      id,
      email,
      ...full_name === null || full_name === '' ? {} : { fullName: full_name },
      ...whatsapp === null || whatsapp === '' ? {} : { whatsapp },
      ...avatar_url === null || avatar_url === '' ? {} : { avatarUrl: avatar_url },
      ...data.tenant === null ? {} : { tenantId: data.tenant.id },
      role: resolvedRole,
    };
  } catch (error: unknown) {
    console.error('Error fetching user profile:', error);
    return null;
  }
}
