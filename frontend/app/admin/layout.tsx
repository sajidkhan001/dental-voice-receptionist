"use client";

import { ProtectedRoute } from "@/lib/auth";
import { Sidebar } from "@/components/shared/sidebar";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ProtectedRoute roles={["superadmin"]}>
      <div className="flex min-h-screen">
        <Sidebar type="admin" />
        <main className="flex-1 bg-slate-50 p-6 overflow-auto">
          {children}
        </main>
      </div>
    </ProtectedRoute>
  );
}
