import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  subtitle?: string;
  className?: string;
}

export function StatCard({ title, value, icon: Icon, subtitle, className }: StatCardProps) {
  return (
    <Card className={cn("flex flex-col justify-between", className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-cb-text-secondary">
          {title}
        </CardTitle>
        <Icon className="h-5 w-5 text-cb-text-secondary" aria-hidden="true" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold text-cb-text-primary">{value}</div>
        {subtitle && (
          <p className="mt-1 text-xs text-cb-text-secondary line-clamp-1">
            {subtitle}
          </p>
        )}
      </CardContent>
    </Card>
  );
}