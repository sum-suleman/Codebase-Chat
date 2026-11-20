import { CheckCircle2, XCircle, RefreshCw, Link as LinkIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type ActivityType = 
  | "connected" 
  | "indexing_started" 
  | "indexing_completed" 
  | "indexing_failed";

export interface ActivityItemProps {
  type: ActivityType;
  message: string;
  repoName: string;
  timestamp: string;
  className?: string;
}

export function ActivityItem({
  type,
  message,
  repoName,
  timestamp,
  className,
}: ActivityItemProps) {
  const getIconConfig = () => {
    switch (type) {
      case "indexing_completed":
        return { Icon: CheckCircle2, color: "text-cb-success" };
      case "indexing_failed":
        return { Icon: XCircle, color: "text-cb-error" };
      case "indexing_started":
        return { Icon: RefreshCw, color: "text-cb-primary" };
      case "connected":
        return { Icon: LinkIcon, color: "text-cb-text-secondary" };
      default:
        return { Icon: RefreshCw, color: "text-cb-text-secondary" };
    }
  };

  const { Icon, color } = getIconConfig();

  return (
    <div className={cn("flex items-start gap-3 border-b border-cb-border p-4 last:border-0", className)}>
      <div className="mt-0.5 shrink-0 rounded-full bg-cb-bg p-1">
        <Icon className={cn("h-3.5 w-3.5", color)} aria-hidden="true" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="break-words text-sm font-medium text-cb-text-primary">
          {message}
        </span>
        <div className="flex items-center gap-1.5 text-xs text-cb-text-secondary">
          <span className="truncate font-mono">{repoName}</span>
          <span className="h-0.5 w-0.5 shrink-0 rounded-full bg-cb-border" aria-hidden="true" />
          <span className="shrink-0">{timestamp}</span>
        </div>
      </div>
    </div>
  );
}