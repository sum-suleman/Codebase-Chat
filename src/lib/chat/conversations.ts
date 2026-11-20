import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { CodeCitation } from "@/lib/chat/retrieval";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ConversationSummaryRecord {
  id: string;
  repositoryId: string;
  repositoryFullName: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessageRecord {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  citations: CodeCitation[];
  createdAt: string;
}

export interface ConversationDetailRecord extends ConversationSummaryRecord {
  messages: ChatMessageRecord[];
}

export function deriveConversationTitle(firstQuestion: string): string {
  const normalized = firstQuestion.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "New conversation";
  }
  if (normalized.length <= 72) {
    return normalized;
  }
  return `${normalized.slice(0, 69).trimEnd()}...`;
}

function normalizeCitations(raw: unknown): CodeCitation[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const citations: CodeCitation[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const rec = item as Record<string, unknown>;
    if (
      typeof rec.chunkId !== "string" ||
      typeof rec.filePath !== "string" ||
      typeof rec.startLine !== "number" ||
      typeof rec.endLine !== "number"
    ) {
      continue;
    }

    citations.push({
      index: typeof rec.index === "number" ? rec.index : citations.length + 1,
      chunkId: rec.chunkId,
      filePath: rec.filePath,
      language: typeof rec.language === "string" ? rec.language : "text",
      startLine: rec.startLine,
      endLine: rec.endLine,
      similarity: typeof rec.similarity === "number" ? rec.similarity : 0,
      snippet: typeof rec.snippet === "string" ? rec.snippet : "",
      githubUrl: typeof rec.githubUrl === "string" ? rec.githubUrl : null,
    });
  }
  return citations;
}

export async function listUserConversations(
  userClient: SupabaseClient,
  limit = 30
): Promise<ConversationSummaryRecord[]> {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));

  const { data, error } = await userClient
    .from("conversations")
    .select(
      "id, repository_id, title, created_at, updated_at, repositories(full_name)"
    )
    .order("updated_at", { ascending: false })
    .limit(safeLimit);

  if (error) {
    throw new Error("Unable to load conversation history.");
  }

  const items: ConversationSummaryRecord[] = [];
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    if (
      typeof row.id !== "string" ||
      typeof row.repository_id !== "string" ||
      typeof row.title !== "string" ||
      typeof row.created_at !== "string" ||
      typeof row.updated_at !== "string"
    ) {
      continue;
    }

    const repoJoin = row.repositories as
      | { full_name?: unknown }
      | Array<{ full_name?: unknown }>
      | null
      | undefined;

    let repositoryFullName = "Repository";
    if (Array.isArray(repoJoin) && typeof repoJoin[0]?.full_name === "string") {
      repositoryFullName = repoJoin[0].full_name;
    } else if (
      repoJoin &&
      !Array.isArray(repoJoin) &&
      typeof repoJoin.full_name === "string"
    ) {
      repositoryFullName = repoJoin.full_name;
    }

    items.push({
      id: row.id,
      repositoryId: row.repository_id,
      repositoryFullName,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  return items;
}

export async function getConversationWithMessages(
  userClient: SupabaseClient,
  conversationId: string
): Promise<ConversationDetailRecord | null> {
  if (!UUID_PATTERN.test(conversationId)) {
    return null;
  }

  const { data: convRow, error: convError } = await userClient
    .from("conversations")
    .select(
      "id, repository_id, title, created_at, updated_at, repositories(full_name)"
    )
    .eq("id", conversationId)
    .single();

  if (convError || !convRow || typeof convRow.id !== "string") {
    return null;
  }

  const { data: msgRows, error: msgError } = await userClient
    .from("messages")
    .select("id, conversation_id, role, content, citations, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (msgError) {
    throw new Error("Unable to load conversation messages.");
  }

  const repoJoin = convRow.repositories as
    | { full_name?: unknown }
    | Array<{ full_name?: unknown }>
    | null
    | undefined;

  let repositoryFullName = "Repository";
  if (Array.isArray(repoJoin) && typeof repoJoin[0]?.full_name === "string") {
    repositoryFullName = repoJoin[0].full_name;
  } else if (
    repoJoin &&
    !Array.isArray(repoJoin) &&
    typeof repoJoin.full_name === "string"
  ) {
    repositoryFullName = repoJoin.full_name;
  }

  const messages: ChatMessageRecord[] = [];
  for (const row of (msgRows ?? []) as Array<Record<string, unknown>>) {
    if (
      typeof row.id !== "string" ||
      typeof row.conversation_id !== "string" ||
      (row.role !== "user" && row.role !== "assistant") ||
      typeof row.content !== "string" ||
      typeof row.created_at !== "string"
    ) {
      continue;
    }

    messages.push({
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role,
      content: row.content,
      citations: normalizeCitations(row.citations),
      createdAt: row.created_at,
    });
  }

  return {
    id: convRow.id,
    repositoryId: String(convRow.repository_id),
    repositoryFullName,
    title: String(convRow.title),
    createdAt: String(convRow.created_at),
    updatedAt: String(convRow.updated_at),
    messages,
  };
}

export async function createConversation(
  userClient: SupabaseClient,
  params: {
    ownerId: string;
    repositoryId: string;
    title: string;
  }
): Promise<{ id: string; title: string; repositoryId: string }> {
  if (!UUID_PATTERN.test(params.ownerId) || !UUID_PATTERN.test(params.repositoryId)) {
    throw new Error("Invalid owner or repository identifier.");
  }

  const { data, error } = await userClient
    .from("conversations")
    .insert({
      owner_id: params.ownerId,
      repository_id: params.repositoryId,
      title: params.title.slice(0, 200),
    })
    .select("id, title, repository_id")
    .single();

  if (error || !data || typeof data.id !== "string") {
    throw new Error("Failed to create conversation.");
  }

  return {
    id: data.id,
    title: String(data.title),
    repositoryId: String(data.repository_id),
  };
}

export async function appendConversationMessage(
  userClient: SupabaseClient,
  params: {
    ownerId: string;
    conversationId: string;
    role: "user" | "assistant";
    content: string;
    citations?: CodeCitation[];
  }
): Promise<ChatMessageRecord> {
  if (
    !UUID_PATTERN.test(params.ownerId) ||
    !UUID_PATTERN.test(params.conversationId)
  ) {
    throw new Error("Invalid conversation or owner identifier.");
  }

  const { data, error } = await userClient
    .from("messages")
    .insert({
      owner_id: params.ownerId,
      conversation_id: params.conversationId,
      role: params.role,
      content: params.content,
      citations: params.citations ?? [],
    })
    .select("id, conversation_id, role, content, citations, created_at")
    .single();

  if (error || !data || typeof data.id !== "string") {
    throw new Error("Failed to save chat message.");
  }

  return {
    id: data.id,
    conversationId: String(data.conversation_id),
    role: data.role === "assistant" ? "assistant" : "user",
    content: String(data.content),
    citations: normalizeCitations(data.citations),
    createdAt: String(data.created_at),
  };
}

export async function deleteConversation(
  userClient: SupabaseClient,
  conversationId: string
): Promise<void> {
  if (!UUID_PATTERN.test(conversationId)) {
    throw new Error("Invalid conversation identifier.");
  }

  const { error } = await userClient
    .from("conversations")
    .delete()
    .eq("id", conversationId);

  if (error) {
    throw new Error("Failed to delete conversation.");
  }
}

export async function renameConversation(
  userClient: SupabaseClient,
  conversationId: string,
  title: string
): Promise<{ id: string; title: string; updatedAt: string }> {
  if (!UUID_PATTERN.test(conversationId)) {
    throw new Error("Invalid conversation identifier.");
  }

  const normalized = title.replace(/\s+/g, " ").trim();
  if (!normalized) {
    throw new Error("Conversation title cannot be empty.");
  }

  const boundedTitle = normalized.slice(0, 200);

  const { data, error } = await userClient
    .from("conversations")
    .update({ title: boundedTitle })
    .eq("id", conversationId)
    .select("id, title, updated_at")
    .single();

  if (error || !data || typeof data.id !== "string") {
    throw new Error("Failed to rename conversation.");
  }

  return {
    id: data.id,
    title: String(data.title),
    updatedAt: String(data.updated_at),
  };
}
