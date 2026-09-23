import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  supabaseClient,
  getUserFullProfile,
  type AuthUser,
  type AuthContextType,
} from './supabase.client';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** Narrow an unknown Supabase failure to an `Error` for the context surface. */
function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Installs the Supabase session listener and exposes the auth context.
 * @param props - the subtree that consumes the auth context.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function loadSession() {
      try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session?.user) {
          const fullProfile = await getUserFullProfile(session.user.id);
          if (mounted) setUser(fullProfile);
        }
      } catch (error: unknown) {
        console.error('Error loading session:', error);
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    void loadSession();

    const { data: { subscription } } = supabaseClient.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        const fullProfile = await getUserFullProfile(session.user.id);
        if (mounted) setUser(fullProfile);
      } else if (mounted) {
        setUser(null);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<{ error: Error | null }> => {
    try {
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return { error: null };
    } catch (error: unknown) {
      return { error: asError(error) };
    }
  }, []);

  const signUp = useCallback(async (
    email: string,
    password: string,
    fullName: string,
    whatsapp: string,
  ): Promise<{ error: Error | null }> => {
    try {
      const { error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName, whatsapp } },
      });
      if (error) throw error;
      return { error: null };
    } catch (error: unknown) {
      return { error: asError(error) };
    }
  }, []);

  const signOut = useCallback(async () => {
    await supabaseClient.auth.signOut();
    setUser(null);
  }, []);

  const resetPassword = useCallback(async (email: string): Promise<{ error: Error | null }> => {
    try {
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      return { error: null };
    } catch (error: unknown) {
      return { error: asError(error) };
    }
  }, []);

  const updateUser = useCallback(async (data: Partial<AuthUser>): Promise<{ error: Error | null }> => {
    try {
      const { error } = await supabaseClient.auth.updateUser({
        ...data.email === undefined ? {} : { email: data.email },
        data: {
          ...data.fullName === undefined ? {} : { full_name: data.fullName },
          ...data.avatarUrl === undefined ? {} : { avatar_url: data.avatarUrl },
          ...data.whatsapp === undefined ? {} : { whatsapp: data.whatsapp },
        },
      });
      if (error) throw error;

      if (user !== null) setUser(await getUserFullProfile(user.id));
      return { error: null };
    } catch (error: unknown) {
      return { error: asError(error) };
    }
  }, [user]);

  const value: AuthContextType = {
    user,
    isLoading,
    isAuthenticated: user !== null,
    signIn,
    signUp,
    signOut,
    resetPassword,
    updateUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Read the CopyMonster auth context.
 * @returns the context value.
 * @throws when called outside {@link AuthProvider}.
 */
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export { AuthContext };
