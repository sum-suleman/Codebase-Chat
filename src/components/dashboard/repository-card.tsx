import Link from "next/link";
import { FolderGit2, FileCode2, Clock, AlertCircle } from "lucide-react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export interface RepositoryCardProps {
  repositoryId?: string;
  name: string;
  provider: "GitHub" | "GitLab";
  language: string;
  fileCount: number;
  status: "indexed" | "indexing" | "failed" | "queued" | "pending";
  lastUpdated: string;
  statusMessage?: string;
  repositoryHref?: string;
  chatHref?: string;
  className?: string;
}

export function RepositoryCard({
  repositoryId,
  name,
  provider,
  language,
  fileCount,
  status,
  lastUpdated,
  statusMessage,
  repositoryHref,
  chatHref,
  className,
}: RepositoryCardProps) {
  const isIndexed = status === "indexed";
  const isFailed = status === "failed";

  const resolvedRepositoryHref = repositoryHref ?? "/repositories";
  const resolvedChatHref =
    chatHref ??
    (repositoryId ? `/chat?repo=${encodeURIComponent(repositoryId)}` : "/chat");

  const getBadgeVariant = () => {
    switch (status) {
      case "indexed":
        return "success";
      case "failed":
        return "danger";
      case "indexing":
        return "warning";
      case "queued":
        return "default";
      case "pending":
        return "default";
      default:
        return "default";
    }
  };

  const getStatusLabel = () => {
    switch (status) {
      case "indexed":
        return "Indexed";
      case "failed":
        return "Failed";
      case "indexing":
        return "Indexing";
      case "queued":
        return "Queued";
      case "pending":
        return "Pending";
      default:
        return "Pending";
    }
  };

  return (
    <Card
      className={cn(
        "group flex flex-col transition-all duration-200 hover:border-cb-primary hover:shadow-[0_0_15px_rgba(59,130,246,0.1)]",
        className
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1.5 text-left min-w-0 flex-1">
            <CardTitle className="flex items-center gap-2 text-base font-mono">
              <FolderGit2 className="h-4 w-4 shrink-0 text-cb-text-secondary" aria-hidden="true" />
              <span className="truncate">{name}</span>
            </CardTitle>
            <div className="flex items-center gap-2 text-xs text-cb-text-secondary">
              <span className="font-medium shrink-0">{provider}</span>
              <span className="h-1 w-1 shrink-0 rounded-full bg-cb-border" aria-hidden="true" />
              <span className="truncate">{language}</span>
            </div>
          </div>
          <Badge variant={getBadgeVariant()} className="capitalize shrink-0">
            {getStatusLabel()}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex-1 pb-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center text-sm text-cb-text-primary">
            {isFailed ? (
              <div className="flex items-center text-cb-error min-w-0">
                <AlertCircle className="mr-2 h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{statusMessage || "Parsing failed"}</span>
              </div>
            ) : (
              <div className="flex items-center min-w-0">
                <FileCode2 className="mr-2 h-4 w-4 shrink-0 text-cb-text-secondary" aria-hidden="true" />
                <span className="truncate">
                  {fileCount > 0 ? `${fileCount.toLocaleString()} files indexed` : "0 files indexed"}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center text-xs text-cb-text-secondary min-w-0">
            <Clock className="mr-2 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {status === "indexing" && statusMessage
                ? statusMessage
                : `Last updated ${lastUpdated}`}
            </span>
          </div>
        </div>
      </CardContent>

      <Separator />

      <CardFooter className="flex items-center justify-between gap-3 pt-4">
        <Link
          href={resolvedRepositoryHref}
          className="inline-flex h-8 w-full items-center justify-center rounded-md border border-cb-border bg-transparent px-3 text-xs font-medium text-cb-text-primary transition-colors hover:bg-cb-elevated"
        >
          Open Repository
        </Link>
        {isIndexed ? (
          <Link
            href={resolvedChatHref}
            className="inline-flex h-8 w-full items-center justify-center rounded-md bg-cb-primary px-3 text-xs font-medium text-white transition-colors hover:bg-cb-primary-hover"
          >
            Ask AI
          </Link>
        ) : (
          <Button
            variant="primary"
            size="sm"
            className="w-full"
            disabled
          >
            Ask AI
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
