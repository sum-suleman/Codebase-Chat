import { NextResponse } from "next/server";

import {
  appendConversationMessage,
  createConversation,
  deriveConversationTitle,
  getConversationWithMessages,
} from "@/lib/chat/conversations";
import { createGroundedAnswerStream } from "@/lib/chat/llm";
import { retrieveCodebaseContext } from "@/lib/chat/retrieval";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChatRequestBody {
  repositoryId?: unknown;
  conversationId?: unknown;
  message?: unknown;
}

function encodeSseEvent(event: string, data: unknown): Uint8Array {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  return new TextEncoder().encode(payload);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON request body." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const question = typeof body.message === "string" ? body.message.trim() : "";
  if (!question) {
    return NextResponse.json(
      { error: "Please enter a question about your repository." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (question.length > 8000) {
    return NextResponse.json(
      { error: "Question exceeds the 8,000-character limit." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const requestedConversationId =
    typeof body.conversationId === "string" && body.conversationId.trim()
      ? body.conversationId.trim()
      : null;

  let repositoryId =
    typeof body.repositoryId === "string" ? body.repositoryId.trim() : "";
  let history: Array<{ role: "user" | "assistant"; content: string }> = [];
  let conversationId = requestedConversationId;

  if (conversationId) {
    const existing = await getConversationWithMessages(supabase, conversationId).catch(
      () => null
    );
    if (!existing) {
      return NextResponse.json(
        { error: "Conversation not found." },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }
    repositoryId = existing.repositoryId;
    history = existing.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
  }

  if (!repositoryId) {
    return NextResponse.json(
      { error: "Please select an indexed repository first." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  let retrieval;
  try {
    retrieval = await retrieveCodebaseContext({
      userClient: supabase,
      repositoryId,
      question,
      matchCount: 8,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to search repository context.";
    return NextResponse.json(
      { error: message },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  let answerStream: ReadableStream<string>;
  try {
    answerStream = await createGroundedAnswerStream({
      repositoryFullName: retrieval.repository.fullName,
      question,
      history,
      chunks: retrieval.chunks,
      signal: request.signal,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to start AI response stream.";
    return NextResponse.json(
      { error: message },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    if (!conversationId) {
      const created = await createConversation(supabase, {
        ownerId: user.id,
        repositoryId,
        title: deriveConversationTitle(question),
      });
      conversationId = created.id;
    }

    await appendConversationMessage(supabase, {
      ownerId: user.id,
      conversationId,
      role: "user",
      content: question,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to persist chat message.";
    return NextResponse.json(
      { error: message },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }

  const activeConversationId = conversationId;
  const citations = retrieval.citations;

  const sseStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(
        encodeSseEvent("meta", {
          conversationId: activeConversationId,
          repositoryId,
          repositoryFullName: retrieval.repository.fullName,
          citations,
        })
      );

      const reader = answerStream.getReader();
      let fullAnswer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          fullAnswer += value;
          controller.enqueue(encodeSseEvent("token", { text: value }));
        }

        const trimmedAnswer = fullAnswer.trim();
        if (trimmedAnswer.length > 0) {
          const savedAssistant = await appendConversationMessage(supabase, {
            ownerId: user.id,
            conversationId: activeConversationId,
            role: "assistant",
            content: trimmedAnswer,
            citations,
          });

          controller.enqueue(
            encodeSseEvent("done", {
              conversationId: activeConversationId,
              messageId: savedAssistant.id,
              citations,
            })
          );
        } else {
          controller.enqueue(
            encodeSseEvent("error", {
              error: "The AI model returned an empty response.",
            })
          );
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Streaming interrupted unexpectedly.";
        controller.enqueue(encodeSseEvent("error", { error: message }));
      } finally {
        reader.releaseLock();
        controller.close();
      }
    },
  });

  return new Response(sseStream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
