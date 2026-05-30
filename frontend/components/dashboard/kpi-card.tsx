"use client";

import { type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface KPICardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: string;
  color?: "teal" | "blue" | "red" | "amber" | "purple";
}

const colorMap = {
  teal: {
    bg: "bg-teal-50",
    iconBg: "bg-teal-100",
    iconColor: "text-teal-600",
    trendColor: "text-teal-600",
  },
  blue: {
    bg: "bg-blue-50",
    iconBg: "bg-blue-100",
    iconColor: "text-blue-600",
    trendColor: "text-blue-600",
  },
  red: {
    bg: "bg-red-50",
    iconBg: "bg-red-100",
    iconColor: "text-red-600",
    trendColor: "text-red-600",
  },
  amber: {
    bg: "bg-amber-50",
    iconBg: "bg-amber-100",
    iconColor: "text-amber-600",
    trendColor: "text-amber-600",
  },
  purple: {
    bg: "bg-purple-50",
    iconBg: "bg-purple-100",
    iconColor: "text-purple-600",
    trendColor: "text-purple-600",
  },
};

export function KPICard({ title, value, icon: Icon, trend, color = "teal" }: KPICardProps) {
  const colors = colorMap[color];

  return (
    <Card className={cn("border-0 shadow-sm", colors.bg)}>
      <CardContent className="flex items-center gap-4">
        <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-xl", colors.iconBg)}>
          <Icon className={cn("h-6 w-6", colors.iconColor)} />
        </div>
        <div className="min-w-0">
          <p className="text-3xl font-bold text-slate-900 tabular-nums">{value}</p>
          <p className="text-sm text-slate-600">{title}</p>
          {trend && (
            <p className={cn("text-xs font-medium mt-0.5", colors.trendColor)}>{trend}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
