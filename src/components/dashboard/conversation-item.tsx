import { MessageSquare, GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ConversationItemProps {
  title: string;
  repoName: string;
  excerpt: string;
  timestamp: string;
  className?: string;
}

export function ConversationItem({
  title,
  repoName,
  excerpt,
  timestamp,
  className,
}: ConversationItemProps) {
  return (
    <div 
      className={cn(
        "group flex flex-col border-b border-cb-border p-4 transition-colors last:border-0 hover:bg-cb-elevated/50",
        className
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-cb-text-secondary group-hover:text-cb-primary transition-colors" aria-hidden="true" />
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <span className="truncate text-sm font-medium text-cb-text-primary">
              {title}
            </span>
            <span className="line-clamp-2 text-xs text-cb-text-secondary leading-relaxed">
              {excerpt}
            </span>
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 pl-7 text-[11px] text-cb-text-secondary">
        <div className="flex items-center gap-1 font-mono min-w-0">
          <GitBranch className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="truncate max-w-[120px]">{repoName}</span>
        </div>
        <span className="h-0.5 w-0.5 shrink-0 rounded-full bg-cb-border" aria-hidden="true" />
        <span className="shrink-0">{timestamp}</span>
      </div>
    </div>
  );
}