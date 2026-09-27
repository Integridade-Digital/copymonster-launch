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
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
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
