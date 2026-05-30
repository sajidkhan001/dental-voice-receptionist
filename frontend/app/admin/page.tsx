"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Building2,
  CheckCircle,
  Phone,
  PhoneIncoming,
  CalendarCheck,
  Users,
  Loader2,
} from "lucide-react";
import { api, AdminOverview } from "@/lib/api";

const kpiConfig = [
  {
    key: "total_clinics" as const,
    label: "Total Clinics",
    icon: Building2,
    color: "text-blue-600",
    bg: "bg-blue-50",
  },
  {
    key: "active_clinics" as const,
    label: "Active Clinics",
    icon: CheckCircle,
    color: "text-green-600",
    bg: "bg-green-50",
  },
  {
    key: "total_calls" as const,
    label: "Total Calls",
    icon: Phone,
    color: "text-teal-600",
    bg: "bg-teal-50",
  },
  {
    key: "today_calls" as const,
    label: "Today's Calls",
    icon: PhoneIncoming,
    color: "text-orange-600",
    bg: "bg-orange-50",
  },
  {
    key: "total_bookings" as const,
    label: "Total Bookings",
    icon: CalendarCheck,
    color: "text-purple-600",
    bg: "bg-purple-50",
  },
  {
    key: "total_users" as const,
    label: "Total Users",
    icon: Users,
    color: "text-indigo-600",
    bg: "bg-indigo-50",
  },
];

export default function AdminOverviewPage() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const overview = await api.admin.overview();
        setData(overview);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-teal-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 text-red-700 rounded-lg p-4 text-sm">
        {error}
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 mb-6">
        System Overview
      </h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {kpiConfig.map((kpi) => {
          const Icon = kpi.icon;
          const value = data?.[kpi.key] ?? 0;

          return (
            <Card key={kpi.key}>
              <CardContent className="flex items-center gap-4">
                <div
                  className={`w-12 h-12 rounded-lg ${kpi.bg} flex items-center justify-center shrink-0`}
                >
                  <Icon className={`w-6 h-6 ${kpi.color}`} />
                </div>
                <div>
                  <p className="text-2xl font-bold text-slate-900">
                    {value.toLocaleString()}
                  </p>
                  <p className="text-sm text-slate-500">{kpi.label}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
