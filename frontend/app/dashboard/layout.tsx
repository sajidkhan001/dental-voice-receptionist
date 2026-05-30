"use client";

import { ProtectedRoute } from "@/lib/auth";
import { Sidebar } from "@/components/shared/sidebar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <div className="flex min-h-screen bg-slate-50">
        <Sidebar type="dashboard" />
        <main className="flex-1 min-w-0 p-6 lg:p-8">{children}</main>
      </div>
    </ProtectedRoute>
  );
}
