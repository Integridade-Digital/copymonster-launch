/**
 * Generated-style Supabase table types for the CopyMonster schema.
 *
 * `Relationships` is required on every table entry by the supabase-js
 * `GenericTable` constraint; omitting it collapses every row type to `never`.
 * Regenerate with `supabase gen types typescript` after a schema change.
 * @module @deepseek-ai/dsh-supabase-client/types
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      tenants: {
        Row: {
          id: string
          name: string
          slug: string
          created_at: string
          updated_at: string
          status: 'active' | 'suspended' | 'deleted'
          metadata: Json
          subscription_status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          current_period_end: string | null
          plan_id: string | null
          usage_data: Json
          trial_ends_at?: string | null
          trial_used?: boolean
          trial_tokens_used?: number
          current_period_tokens_used?: number
          subscription_interval?: string | null
          cancel_at_period_end?: boolean | null
        }
        Insert: {
          id?: string
          name: string
          slug: string
          created_at?: string
          updated_at?: string
          status?: 'active' | 'suspended' | 'deleted'
          metadata?: Json
          subscription_status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          current_period_end?: string | null
          plan_id?: string | null
          usage_data?: Json
          trial_ends_at?: string | null
          trial_used?: boolean
          trial_tokens_used?: number
          current_period_tokens_used?: number
          subscription_interval?: string | null
          cancel_at_period_end?: boolean | null
        }
        Update: {
          id?: string
          name?: string
          slug?: string
          created_at?: string
          updated_at?: string
          status?: 'active' | 'suspended' | 'deleted'
          metadata?: Json
          subscription_status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          current_period_end?: string | null
          plan_id?: string | null
          usage_data?: Json
          trial_ends_at?: string | null
          trial_used?: boolean
          trial_tokens_used?: number
          current_period_tokens_used?: number
          subscription_interval?: string | null
          cancel_at_period_end?: boolean | null
        }
        Relationships: []
      }
      users: {
        Row: {
          id: string
          email: string
          full_name: string | null
          whatsapp: string | null
          avatar_url: string | null
          created_at: string
          updated_at: string
          last_login_at: string | null
          metadata: Json
        }
        Insert: {
          id: string
          email: string
          full_name?: string | null
          whatsapp?: string | null
          avatar_url?: string | null
          created_at?: string
          updated_at?: string
          last_login_at?: string | null
          metadata?: Json
        }
        Update: {
          id?: string
          email?: string
          full_name?: string | null
          whatsapp?: string | null
          avatar_url?: string | null
          created_at?: string
          updated_at?: string
          last_login_at?: string | null
          metadata?: Json
        }
        Relationships: []
      }
      positioning_mappings: {
        Row: {
          id: string
          user_id: string
          is_default: boolean
          status: string
        }
        Insert: {
          id?: string
          user_id: string
          is_default?: boolean
          status?: string
        }
        Update: {
          id?: string
          user_id?: string
          is_default?: boolean
          status?: string
        }
        Relationships: []
      }
      user_tenant_roles: {
        Row: {
          id: string
          user_id: string
          tenant_id: string
          role: 'owner' | 'admin' | 'member' | 'anonymous'
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          tenant_id: string
          role: 'owner' | 'admin' | 'member' | 'anonymous'
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          tenant_id?: string
          role: 'owner' | 'admin' | 'member' | 'anonymous'
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      app_sessions: {
        Row: {
          id: string
          user_id: string
          tenant_id: string
          token_hash: string
          expires_at: string
          created_at: string
          last_activity_at: string
        }
        Insert: {
          id?: string
          user_id: string
          tenant_id: string
          token_hash: string
          expires_at: string
          created_at?: string
          last_activity_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          tenant_id?: string
          token_hash?: string
          expires_at?: string
          created_at?: string
          last_activity_at?: string
        }
        Relationships: []
      }
      plans: {
        Row: {
          id: string
          name: string
          slug: string
          price_cents: number
          currency: string
          stripe_price_id: string | null
          stripe_price_id_monthly?: string | null
          stripe_price_id_annual?: string | null
          monthly_price_cents?: number | null
          annual_price_cents?: number | null
          token_limit_input?: number | null
          token_limit_output?: number | null
          max_workspaces?: number | null
          max_sessions?: number | null
          storage_gb?: number | null
          ai_tier?: string | null
          limits: Json
          features: string[]
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
          price_cents?: number
          currency?: string
          stripe_price_id?: string | null
          stripe_price_id_monthly?: string | null
          stripe_price_id_annual?: string | null
          monthly_price_cents?: number | null
          annual_price_cents?: number | null
          token_limit_input?: number | null
          token_limit_output?: number | null
          max_workspaces?: number | null
          max_sessions?: number | null
          storage_gb?: number | null
          ai_tier?: string | null
          limits?: Json
          features?: string[]
          is_active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          slug?: string
          price_cents?: number
          currency?: string
          stripe_price_id?: string | null
          stripe_price_id_monthly?: string | null
          stripe_price_id_annual?: string | null
          monthly_price_cents?: number | null
          annual_price_cents?: number | null
          token_limit_input?: number | null
          token_limit_output?: number | null
          max_workspaces?: number | null
          max_sessions?: number | null
          storage_gb?: number | null
          ai_tier?: string | null
          limits?: Json
          features?: string[]
          is_active?: boolean
          created_at?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          id: string
          tenant_id: string | null
          user_id: string | null
          action: string
          resource_type: string | null
          resource_id: string | null
          old_value: Json | null
          new_value: Json | null
          ip_address: string | null
          user_agent: string | null
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id?: string | null
          user_id?: string | null
          action: string
          resource_type?: string | null
          resource_id?: string | null
          old_value?: Json | null
          new_value?: Json | null
          ip_address?: string | null
          user_agent?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          tenant_id?: string | null
          user_id?: string | null
          action?: string
          resource_type?: string | null
          resource_id?: string | null
          old_value?: Json | null
          new_value?: Json | null
          ip_address?: string | null
          user_agent?: string | null
          created_at?: string
        }
        Relationships: []
      }
      trial_rate_limits: {
        Row: {
          id: string
          ip: string
          tenant_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          ip: string
          tenant_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          ip?: string
          tenant_id?: string | null
          created_at?: string
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      get_current_user_id: {
        Args: Record<string, never>
        Returns: string
      }
      get_current_tenant_id: {
        Args: Record<string, never>
        Returns: string
      }
      is_admin_or_owner: {
        Args: Record<string, never>
        Returns: boolean
      }
      increment_tenant_token_usage: {
        Args: {
          p_tenant_id: string
          p_tokens: number
        }
        Returns: void
      }
      get_positioning_mapping: {
        Args: {
          p_mapping_id: string
          p_user_id: string
        }
        Returns: PositioningMappingRow[]
      }
      get_my_profile: {
        Args: Record<string, never>
        Returns: MyProfileResult | null
      }
      check_my_tenant_quota: {
        Args: Record<string, never>
        Returns: TenantQuotaRow[]
      }
      increment_my_tenant_token_usage: {
        Args: { p_tokens: number; p_tenant_id?: string | null }
        Returns: void
      }
      get_my_tenant_metrics: {
        Args: { p_tenant_id?: string | null }
        Returns: MyTenantMetrics | null
      }
      admin_list_tenants: {
        Args: Record<string, never>
        Returns: AdminTenantRow[]
      }
      runtime_upsert_my_session_index: {
        Args: {
          p_session_id: string
          p_title?: string | null
          p_model?: string | null
          p_status?: string | null
        }
        Returns: void
      }
      runtime_increment_my_session_tokens: {
        Args: { p_session_id: string; p_tokens: number }
        Returns: void
      }
      runtime_mark_my_session_status: {
        Args: { p_session_id: string; p_status: string }
        Returns: void
      }
      get_my_positioning_mapping: {
        Args: { p_mapping_id: string }
        Returns: PositioningMappingRow[]
      }
      record_my_audit_log: {
        Args: {
          p_action: string
          p_resource_type?: string | null
          p_resource_id?: string | null
          p_old_value?: Json | null
          p_new_value?: Json | null
        }
        Returns: string
      }
      admin_list_audit_logs: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_tenant_id?: string | null
          p_action?: string | null
        }
        Returns: AuditLogRow[]
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

/** One row of `check_my_tenant_quota()`, per `supabase/migrations/043`. */
export interface TenantQuotaRow {
  allowed: boolean
  reason: string
  remaining_tokens: number
}

/** Result of `get_my_profile()`, per `supabase/migrations/040`. */
export interface MyProfileResult {
  user: {
    id: string
    email: string
    full_name: string | null
    avatar_url: string | null
    whatsapp: string | null
  }
  tenant: {
    id: string
    name: string
    slug: string
    status: string
  } | null
  role: 'owner' | 'admin' | 'member' | 'anonymous' | null
  is_admin: boolean
}

/** Tenant fields `get_my_tenant_metrics()` returns, per `supabase/migrations/043`. */
export interface MyTenantMetrics {
  tenant: {
    id: string
    name: string
    slug: string
    status: string
    subscription_status: string | null
    plan_id: string | null
    trial_ends_at: string | null
    trial_used: boolean | null
    trial_tokens_used: number | null
    current_period_tokens_used: number | null
    stripe_customer_id: string | null
    created_at: string
  }
  plan: {
    id: string
    name: string
    slug: string
    monthly_price_cents: number | null
    annual_price_cents: number | null
    token_limit_input: number | null
    token_limit_output: number | null
    max_workspaces: number | null
    max_sessions: number | null
    storage_gb: number | null
    ai_tier: string | null
  } | null
}

/** One row of `admin_list_tenants()`, per `supabase/migrations/043`. */
export interface AdminTenantRow {
  id: string
  name: string
  slug: string
  status: 'active' | 'suspended' | 'deleted'
  subscription_status: string | null
  plan_id: string | null
  trial_ends_at: string | null
  trial_used: boolean | null
  trial_tokens_used: number | null
  current_period_tokens_used: number | null
  created_at: string
}

/** JSON value as PostgREST returns it: no `undefined` members inside objects. */
export type StrictJson =
  | string
  | number
  | boolean
  | null
  | StrictJson[]
  | { [key: string]: StrictJson }

/** One row of `admin_list_audit_logs()`, per `supabase/migrations/043`. */
export interface AuditLogRow {
  id: string
  tenant_id: string | null
  user_id: string | null
  action: string
  resource_type: string | null
  resource_id: string | null
  old_value: StrictJson | null
  new_value: StrictJson | null
  ip_address: string | null
  user_agent: string | null
  created_at: string
}

/** Row of `public.positioning_mappings` returned by `get_positioning_mapping`, per `supabase/migrations/039`. */
export interface PositioningMappingRow {
  id: string
  tenant_id: string
  user_id: string
  name: string
  product_name: string
  block_1_public: string | null
  block_2_pains: string | null
  block_3_solution: string | null
  block_4_differentiators: string | null
  block_5_awareness_stage: string | null
  block_6_urgency: string | null
  block_7_social_proof: string | null
  block_8_objections: string | null
  block_9_emotional: string | null
  block_10_transformation: string | null
  block_11_voice: string | null
  block_12_promises: string | null
  status: 'in_progress' | 'completed' | 'archived'
  current_block: number
  is_default: boolean
  created_at: string
  updated_at: string
  completed_at: string | null
}

/** Convenience alias for the resolved caller identity used across the backend. */
export interface UserIdentity {
  userId: string
  tenantId: string
  role: 'owner' | 'admin' | 'member' | 'anonymous'
  email: string
  fullName?: string
  whatsapp?: string
}

export type SupabaseClientType = import('@supabase/supabase-js').SupabaseClient<Database>
