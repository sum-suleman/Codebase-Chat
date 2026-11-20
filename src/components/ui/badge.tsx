import * as React from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "primary" | "success" | "warning" | "danger" | "outline";
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  const baseStyles = "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors";
  
  const variants = {
    default: "bg-cb-elevated text-cb-text-primary",
    primary: "bg-cb-primary/10 text-cb-primary border border-cb-primary/20",
    success: "bg-cb-success/10 text-cb-success border border-cb-success/20",
    warning: "bg-cb-warning/10 text-cb-warning border border-cb-warning/20",
    danger: "bg-cb-error/10 text-cb-error border border-cb-error/20",
    outline: "border border-cb-border text-cb-text-secondary",
  };

  return (
    <span className={cn(baseStyles, variants[variant], className)} {...props} />
  );
}

export { Badge };