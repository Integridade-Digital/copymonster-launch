import React from 'react';
import { AuthProvider } from './auth.provider';

interface AppWrapperProps {
  children: React.ReactNode;
}

/**
 * Wraps the application in the CopyMonster auth provider.
 *
 * Routing and the authenticated/unauthenticated gate live in `main.tsx`; this
 * component only installs the provider so `useAuth` is available to everything
 * below it, including the auth screens rendered outside the Harness shell.
 *
 * @param props - the subtree that consumes the auth context.
 */
export function AppWrapper({ children }: AppWrapperProps) {
  return <AuthProvider>{children}</AuthProvider>;
}
