import { redirect } from "next/navigation";

import {
  ChatWorkspace,
  type ChatRepositoryOption,
} from "@/components/chat/chat-workspace";
import {
  getConversationWithMessages,
  listUserConversations,
} from "@/lib/chat/conversations";
import { listLatestRepositoryIndexJobs } from "@/lib/indexing/pipeline";
import { listUserActiveRepositories } from "@/lib/repositories/manage";
import { createClient } from "@/lib/supabase/server";

interface ChatPageProps {
  searchParams: Promise<{
    conversation?: string;
    repo?: string;
    prompt?: string;
  }>;
}

export default async function ChatPage({ searchParams }: ChatPageProps) {
  const resolvedParams = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [repositories, conversations] = await Promise.all([
    listUserActiveRepositories(supabase).catch(() => []),
    listUserConversations(supabase, 30).catch(() => []),
  ]);

  const jobsByRepoId =
    repositories.length > 0
      ? await listLatestRepositoryIndexJobs(
          supabase,
          repositories.map((r) => r.id)
        ).catch(() => new Map())
      : new Map();

  const repositoryOptions: ChatRepositoryOption[] = repositories.map((repo) => {
    const job = jobsByRepoId.get(repo.id);
    const isIndexed = job?.status === "indexed" && (job?.chunksTotal ?? 0) > 0;
    return {
      id: repo.id,
      fullName: repo.fullName,
      defaultBranch: repo.defaultBranch,
      isIndexed,
      filesIndexed: job?.filesIndexed ?? 0,
      chunksTotal: job?.chunksTotal ?? 0,
    };
  });

  const requestedConversationId =
    typeof resolvedParams.conversation === "string"
      ? resolvedParams.conversation.trim()
      : "";

  const activeConversation = requestedConversationId
    ? await getConversationWithMessages(supabase, requestedConversationId).catch(
        () => null
      )
    : null;

  const initialRepositoryId =
    activeConversation?.repositoryId ??
    (typeof resolvedParams.repo === "string" ? resolvedParams.repo.trim() : null);

  const initialPrompt =
    !activeConversation && typeof resolvedParams.prompt === "string"
      ? resolvedParams.prompt.trim().slice(0, 2000)
      : "";

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-cb-text-primary">
          AI Codebase Chat
        </h1>
        <p className="mt-1 text-sm text-cb-text-secondary">
          Ask natural language questions grounded in your indexed repositories
          with exact file and line citations.
        </p>
      </div>

      <ChatWorkspace
        repositories={repositoryOptions}
        initialConversations={conversations}
        initialConversationId={activeConversation?.id ?? null}
        initialMessages={activeConversation?.messages ?? []}
        initialRepositoryId={initialRepositoryId}
        initialPrompt={initialPrompt}
      />
    </div>
  );
}
