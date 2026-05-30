"use client";

import { AuthProvider } from "./auth";

export function ClientProviders({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}
