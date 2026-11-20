import { NextResponse } from "next/server";

import {
  deleteConversation,
  getConversationWithMessages,
  renameConversation,
} from "@/lib/chat/conversations";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ conversationId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { conversationId } = await context.params;
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

  try {
    const conversation = await getConversationWithMessages(
      supabase,
      conversationId
    );
    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found." },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }

    return NextResponse.json(
      { conversation },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to load conversation.";
    return NextResponse.json(
      { error: message },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { conversationId } = await context.params;
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON request body." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const title =
    typeof body === "object" && body !== null && "title" in body
      ? (body as { title?: unknown }).title
      : undefined;

  if (typeof title !== "string") {
    return NextResponse.json(
      { error: "A valid title string is required." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const updated = await renameConversation(supabase, conversationId, title);
    return NextResponse.json(
      { conversation: updated },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to rename conversation.";
    return NextResponse.json(
      { error: message },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { conversationId } = await context.params;
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

  try {
    await deleteConversation(supabase, conversationId);
    return NextResponse.json(
      { deleted: true },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to delete conversation.";
    return NextResponse.json(
      { error: message },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
}
