import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react';
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
 * Includes resilience against transient profile lookup timeouts and exposes authError/retryAuth.
 * Deduplicates in-flight profile resolution and memoizes the context value.
 * @param props - the subtree that consumes the auth context.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<Error | null>(null);

  // Cache de promessa em andamento para deduplicar chamadas concorrentes para o mesmo userId
  const inFlightProfileRef = useRef<{ userId: string; promise: Promise<AuthUser | null> } | null>(null);

  const resolveUserProfile = useCallback(async (userId: string, email?: string): Promise<AuthUser | null> => {
    // Se já houver uma busca em andamento para este mesmo usuário, reutiliza a Promise
    if (inFlightProfileRef.current && inFlightProfileRef.current.userId === userId) {
      return inFlightProfileRef.current.promise;
    }

    const promise = (async (): Promise<AuthUser | null> => {
      try {
        const fullProfile = await getUserFullProfile(userId);
        setAuthError(null);
        return fullProfile;
      } catch (err: unknown) {
        console.error('Error fetching full profile, falling back to basic session:', err);
        setAuthError(asError(err));
        // Não desloga o usuário caso a busca do perfil RPC falhe por instabilidade de rede/timeout
        return {
          id: userId,
          email: email ?? '',
          role: 'member',
        };
      } finally {
        if (inFlightProfileRef.current?.userId === userId) {
          inFlightProfileRef.current = null;
        }
      }
    })();

    inFlightProfileRef.current = { userId, promise };
    return promise;
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const { data: { session }, error } = await supabaseClient.auth.getSession();
      if (error) throw error;
      if (session?.user) {
        const profile = await resolveUserProfile(session.user.id, session.user.email);
        setUser(profile);
      } else {
        setUser(null);
        setAuthError(null);
      }
    } catch (err: unknown) {
      console.error('Error refreshing session:', err);
      setAuthError(asError(err));
    }
  }, [resolveUserProfile]);

  useEffect(() => {
    let mounted = true;
    let initialHandled = false;

    // Trata eventos de autenticação de forma deduplicada
    const handleSessionChange = async (event: string, sessionUser: { id: string; email?: string } | null) => {
      if (!sessionUser) {
        if (mounted) {
          setUser(null);
          setAuthError(null);
        }
        return;
      }

      // Evita refetch redundante em TOKEN_REFRESHED se o usuário já estiver resolvido com o mesmo id
      if (event === 'TOKEN_REFRESHED' && user?.id === sessionUser.id) {
        return;
      }

      try {
        const profile = await resolveUserProfile(sessionUser.id, sessionUser.email);
        if (mounted) setUser(profile);
      } catch (error: unknown) {
        if (mounted) setAuthError(asError(error));
      }
    };

    // Subscrição única de auth do Supabase (onAuthStateChange emite INITIAL_SESSION logo ao registrar)
    const { data: { subscription } } = supabaseClient.auth.onAuthStateChange(async (event, session) => {
      initialHandled = true;
      try {
        await handleSessionChange(event, session?.user ?? null);
      } finally {
        if (mounted) setIsLoading(false);
      }
    });

    // Fallback de segurança: caso o evento INITIAL_SESSION não seja emitido prontamente
    const fallbackTimer = setTimeout(() => {
      if (!initialHandled && mounted) {
        void supabaseClient.auth.getSession().then(async ({ data: { session }, error }) => {
          if (!mounted) return;
          try {
            if (error) throw error;
            await handleSessionChange('FALLBACK_LOAD', session?.user ?? null);
          } catch (err: unknown) {
            setAuthError(asError(err));
          } finally {
            if (mounted) setIsLoading(false);
          }
        });
      }
    }, 150);

    return () => {
      mounted = false;
      clearTimeout(fallbackTimer);
      subscription.unsubscribe();
    };
  }, [resolveUserProfile, user?.id]);

  const retryAuth = useCallback(async () => {
    setIsLoading(true);
    try {
      await refreshSession();
    } finally {
      setIsLoading(false);
    }
  }, [refreshSession]);

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
    setAuthError(null);
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

  const value = useMemo<AuthContextType>(() => ({
    user,
    isLoading,
    isAuthenticated: user !== null,
    authError,
    retryAuth,
    signIn,
    signUp,
    signOut,
    resetPassword,
    updateUser,
  }), [user, isLoading, authError, retryAuth, signIn, signUp, signOut, resetPassword, updateUser]);

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
