import React, { useEffect, useState } from 'react';
import { AuthProvider } from './auth.provider';
import { ChatMessageGuard } from '../components/auth/ChatMessageGuard';

interface AppWrapperProps {
  children: React.ReactNode;
}

/**
 * Wrapper principal da aplicação que integra autenticação
 * Envolve toda a aplicação com AuthProvider e adiciona guards necessários
 */
export function AppWrapper({ children }: AppWrapperProps) {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // Aguardar aplicação estar pronta
    setIsReady(true);
  }, []);

  if (!isReady) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <AuthProvider>
      <ChatMessageGuard />
      {children}
    </AuthProvider>
  );
}
