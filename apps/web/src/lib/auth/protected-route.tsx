import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAuth?: boolean;
}

/**
 * Componente para proteger rotas que exigem autenticação
 * 
 * Uso:
 * <ProtectedRoute requireAuth={true}>
 *   <Dashboard />
 * </ProtectedRoute>
 */
export function ProtectedRoute({ children, requireAuth = true }: ProtectedRouteProps) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    // Mostrar loading enquanto verifica autenticação
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (requireAuth && !user) {
    // Redirecionar para login se não estiver autenticado
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

/**
 * Componente para rotas públicas (redireciona para dashboard se já estiver logado)
 */
export function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (user) {
    // Redirecionar para home se já estiver autenticado
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
