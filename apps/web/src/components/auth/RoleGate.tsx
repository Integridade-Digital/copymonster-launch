import React from 'react';
import { useAuth } from '../../lib/auth';

type Role = 'owner' | 'admin' | 'member' | 'anonymous';

interface RoleGateProps {
  children: React.ReactNode;
  allowedRoles: Role[];
  fallback?: React.ReactNode;
}

/**
 * Componente para condicionar renderização por role do usuário
 * 
 * Uso:
 * <RoleGate allowedRoles={['owner', 'admin']} fallback={<AccessDenied />}>
 *   <AdminPanel />
 * </RoleGate>
 */
export function RoleGate({ children, allowedRoles, fallback = null }: RoleGateProps) {
  const { user, role, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-4">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!user || !role) {
    return fallback;
  }

  if (!allowedRoles.includes(role)) {
    return fallback;
  }

  return <>{children}</>;
}

/**
 * Hook para verificar permissão de role programaticamente
 */
export function useRoleCheck(allowedRoles: Role[]) {
  const { user, role, isLoading } = useAuth();

  const hasPermission = React.useMemo(() => {
    if (!user || !role) return false;
    return allowedRoles.includes(role);
  }, [user, role, allowedRoles]);

  return { hasPermission, isLoading, user, role };
}
