import 'reflect-metadata';

export type UserRole = 'owner' | 'admin' | 'member';

/**
 * Decorator para especificar roles requeridas em um endpoint
 * 
 * Uso:
 * @Roles('owner', 'admin')
 * async deleteWorkspace(id: string) { ... }
 */
export const Roles = (...roles: UserRole[]) => {
  return (target: any, key: string, descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata('roles', roles, descriptor.value);
    return descriptor;
  };
};

/**
 * Helper para obter roles requeridas de um método
 */
export function getRequiredRoles(handler: Function): UserRole[] | undefined {
  return Reflect.getMetadata('roles', handler);
}
