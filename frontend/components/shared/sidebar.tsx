"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Phone,
  PhoneForwarded,
  Calendar,
  BarChart3,
  Settings,
  Building2,
  Users,
  FileText,
  LogOut,
  Shield,
  Star,
  ClipboardList,
} from "lucide-react";
import { useAuth } from "@/lib/auth";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const dashboardNav: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/calls", label: "Call Logs", icon: Phone },
  { href: "/dashboard/appointments", label: "Appointments", icon: Calendar },
  { href: "/dashboard/intake-forms", label: "Intake Forms", icon: ClipboardList },
  { href: "/dashboard/reviews", label: "Reviews", icon: Star },
  { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/dashboard/phone-setup", label: "Phone Setup", icon: PhoneForwarded },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

const adminNav: NavItem[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/clinics", label: "Clinics", icon: Building2 },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/audit", label: "Audit Logs", icon: FileText },
];

export function Sidebar({ type }: { type: "dashboard" | "admin" }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const items = type === "admin" ? adminNav : dashboardNav;

  return (
    <aside className="w-64 bg-slate-900 text-white flex flex-col min-h-screen">
      {/* Logo */}
      <div className="p-4 border-b border-slate-800">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-br from-teal-500 to-teal-400 rounded-lg flex items-center justify-center">
            <Phone className="w-4 h-4 text-white" />
          </div>
          <span className="text-lg font-bold">
            Dental<span className="text-teal-400">Swarm</span>
          </span>
        </Link>
        {type === "admin" && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-400">
            <Shield className="w-3 h-3" />
            Administrator
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1">
        {items.map((item) => {
          const isActive = pathname === item.href ||
            (item.href !== "/dashboard" && item.href !== "/admin" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                isActive
                  ? "bg-teal-600 text-white"
                  : "text-slate-400 hover:text-white hover:bg-slate-800"
              )}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* User section */}
      <div className="p-3 border-t border-slate-800">
        <div className="px-3 py-2 text-sm">
          <p className="font-medium text-white truncate" title={user?.name || user?.email || ""}>{user?.name || user?.email || "User"}</p>
          <p className="text-xs text-slate-500 truncate">{user?.clinicName || user?.role || ""}</p>
        </div>
        <button
          onClick={logout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-800 w-full transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Log Out
        </button>
      </div>
    </aside>
  );
}
