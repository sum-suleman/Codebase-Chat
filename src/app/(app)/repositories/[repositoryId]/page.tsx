import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ExternalLink,
  FolderGit2,
  GitBranch,
  MessageSquare,
  Search,
} from "lucide-react";

import { RepositoryFileBrowser } from "@/components/repositories/repository-file-browser";
import { Badge } from "@/components/ui/badge";
import { listLatestRepositoryIndexJobs } from "@/lib/indexing/pipeline";
import {
  getUserActiveRepositoryById,
  listIndexedRepositoryFiles,
} from "@/lib/repositories/browser";
import { createClient } from "@/lib/supabase/server";

interface RepositoryDetailPageProps {
  params: Promise<{
    repositoryId: string;
  }>;
  searchParams?: Promise<{
    file?: string;
    line?: string;
  }>;
}

export default async function RepositoryDetailPage({
  params,
  searchParams,
}: RepositoryDetailPageProps) {
  const { repositoryId } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    notFound();
  }

  const repository = await getUserActiveRepositoryById(supabase, repositoryId);
  if (!repository) {
    notFound();
  }

  const [jobsByRepoId, files] = await Promise.all([
    listLatestRepositoryIndexJobs(supabase, [repository.id]),
    listIndexedRepositoryFiles(supabase, repository.id),
  ]);

  const latestJob = jobsByRepoId.get(repository.id);
  const isIndexed = latestJob?.status === "indexed" || files.length > 0;
  const parsedLine = resolvedSearchParams?.line
    ? Number.parseInt(resolvedSearchParams.line, 10)
    : undefined;
  const initialHighlightLine =
    parsedLine && Number.isFinite(parsedLine) && parsedLine > 0
      ? parsedLine
      : undefined;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col justify-between gap-4 border-b border-cb-border pb-5 md:flex-row md:items-center">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-cb-text-secondary">
            <Link
              href="/repositories"
              className="inline-flex items-center gap-1 transition-colors hover:text-cb-text-primary"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Repositories
            </Link>
            <span>/</span>
            <span className="font-mono text-cb-text-primary">
              {repository.fullName}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="flex items-center gap-2 font-mono text-xl font-bold tracking-tight text-cb-text-primary">
              <FolderGit2 className="h-5 w-5 text-cb-primary" />
              {repository.fullName}
            </h1>
            <Badge variant={isIndexed ? "success" : "default"} className="capitalize">
              {latestJob?.status ?? "pending"}
            </Badge>
            <Badge variant="default" className="capitalize">
              {repository.visibility}
            </Badge>
            {repository.defaultBranch && (
              <span className="inline-flex items-center gap-1 rounded-md border border-cb-border bg-cb-elevated/50 px-2 py-0.5 font-mono text-xs text-cb-text-secondary">
                <GitBranch className="h-3 w-3" />
                {repository.defaultBranch}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <a
            href={repository.canonicalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center justify-center rounded-md border border-cb-border bg-transparent px-3.5 text-xs font-medium text-cb-text-primary transition-colors hover:bg-cb-elevated"
          >
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
            View on {repository.provider === "gitlab" ? "GitLab" : "GitHub"}
          </a>

          {isIndexed && (
            <>
              <Link
                href={`/search?repo=${encodeURIComponent(repository.id)}`}
                className="inline-flex h-9 items-center justify-center rounded-md border border-cb-border bg-cb-bg px-3.5 text-xs font-medium text-cb-text-primary transition-colors hover:bg-cb-elevated"
              >
                <Search className="mr-1.5 h-3.5 w-3.5" />
                Search in Repo
              </Link>
              <Link
                href={`/chat?repo=${encodeURIComponent(repository.id)}`}
                className="inline-flex h-9 items-center justify-center rounded-md bg-cb-primary px-4 text-xs font-medium text-white transition-colors hover:bg-cb-primary-hover"
              >
                <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
                Chat with Codebase
              </Link>
            </>
          )}
        </div>
      </div>

      <RepositoryFileBrowser
        repositoryId={repository.id}
        repositoryFullName={repository.fullName}
        files={files}
        initialFilePath={resolvedSearchParams?.file}
        initialHighlightLine={initialHighlightLine}
      />
    </div>
  );
}
