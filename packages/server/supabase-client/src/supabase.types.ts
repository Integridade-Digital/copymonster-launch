/**
 * Tipos gerados pelo Supabase para o schema do CopyMonster
 * Estes tipos devem ser atualizados sempre que o schema mudar
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      tenants: {
        Row: {
          id: string;
          name: string;
          slug: string;
          created_at: string;
          updated_at: string;
          status: 'active' | 'suspended' | 'deleted';
          metadata: Json;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          created_at?: string;
          updated_at?: string;
          status?: 'active' | 'suspended' | 'deleted';
          metadata?: Json;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          created_at?: string;
          updated_at?: string;
          status?: 'active' | 'suspended' | 'deleted';
          metadata?: Json;
        };
      };
      users: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          whatsapp: string | null;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
          last_login_at: string | null;
          metadata: Json;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          whatsapp?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
          last_login_at?: string | null;
          metadata?: Json;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string | null;
          whatsapp?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
          last_login_at?: string | null;
          metadata?: Json;
        };
      };
      user_tenant_roles: {
        Row: {
          id: string;
          user_id: string;
          tenant_id: string;
          role: 'owner' | 'admin' | 'member' | 'anonymous';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          tenant_id: string;
          role: 'owner' | 'admin' | 'member' | 'anonymous';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          tenant_id?: string;
          role?: 'owner' | 'admin' | 'member' | 'anonymous';
          created_at?: string;
          updated_at?: string;
        };
      };
      app_sessions: {
        Row: {
          id: string;
          user_id: string;
          tenant_id: string;
          token_hash: string;
          expires_at: string;
          created_at: string;
          last_activity_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          tenant_id: string;
          token_hash: string;
          expires_at: string;
          created_at?: string;
          last_activity_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          tenant_id?: string;
          token_hash?: string;
          expires_at?: string;
          created_at?: string;
          last_activity_at?: string;
        };
      };
    };
    Views: {};
    Functions: {
      get_current_user_id: {
        Args: Record<string, never>;
        Returns: string;
      };
    };
    Enums: {};
  };
}

// Tipo utilitário para identidade do usuário no contexto da request
export interface UserIdentity {
  userId: string;
  tenantId: string;
  role: 'owner' | 'admin' | 'member' | 'anonymous';
  email: string;
  fullName?: string;
  whatsapp?: string;
}

// Tipo para o cliente Supabase tipado
export type SupabaseClientType = import('@supabase/supabase-js').SupabaseClient<Database>;
