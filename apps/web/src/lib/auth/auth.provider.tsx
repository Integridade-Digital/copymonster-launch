import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabaseClient, getUserFullProfile, type AuthUser, type AuthContextType } from './supabase.client';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Carregar sessão atual ao iniciar
  useEffect(() => {
    let mounted = true;

    async function loadSession() {
      try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        
        if (session?.user) {
          const fullProfile = await getUserFullProfile(session.user.id);
          if (mounted) {
            setUser(fullProfile);
          }
        }
      } catch (error) {
        console.error('Error loading session:', error);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    loadSession();

    // Ouvir mudanças na autenticação
    const { data: { subscription } } = supabaseClient.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        const fullProfile = await getUserFullProfile(session.user.id);
        if (mounted) {
          setUser(fullProfile);
        }
      } else {
        if (mounted) {
          setUser(null);
        }
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // Sign in com email/senha
  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const { error } = await supabaseClient.auth.signInWithPassword({
        email,
        password,
      });
      
      if (error) throw error;
      
      return { error: null };
    } catch (error: any) {
      return { error };
    }
  }, []);

  // Sign up com dados completos
  const signUp = useCallback(async (email: string, password: string, fullName: string, whatsapp: string) => {
    try {
      const { error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            whatsapp: whatsapp,
          },
        },
      });
      
      if (error) throw error;
      
      return { error: null };
    } catch (error: any) {
      return { error };
    }
  }, []);

  // Sign out
  const signOut = useCallback(async () => {
    await supabaseClient.auth.signOut();
    setUser(null);
  }, []);

  // Reset password
  const resetPassword = useCallback(async (email: string) => {
    try {
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      
      if (error) throw error;
      
      return { error: null };
    } catch (error: any) {
      return { error };
    }
  }, []);

  // Update user data
  const updateUser = useCallback(async (data: Partial<AuthUser>) => {
    try {
      const { error } = await supabaseClient.auth.updateUser({
        email: data.email,
        password: undefined, // senha é atualizada separadamente
        data: {
          full_name: data.fullName,
          avatar_url: data.avatarUrl,
          whatsapp: data.whatsapp,
        },
      });
      
      if (error) throw error;
      
      // Atualizar perfil completo
      if (user) {
        const fullProfile = await getUserFullProfile(user.id);
        setUser(fullProfile);
      }
      
      return { error: null };
    } catch (error: any) {
      return { error };
    }
  }, [user]);

  const value: AuthContextType = {
    user,
    isLoading,
    isAuthenticated: !!user,
    signIn,
    signUp,
    signOut,
    resetPassword,
    updateUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export { AuthContext };
