import { NextResponse } from "next/server";

import { searchCodebaseSemantically } from "@/lib/search/code-search";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON request body." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const record =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};

  const query = typeof record.query === "string" ? record.query.trim() : "";
  const repositoryId =
    typeof record.repositoryId === "string" && record.repositoryId.trim()
      ? record.repositoryId.trim()
      : null;
  const limit =
    typeof record.limit === "number" && Number.isFinite(record.limit)
      ? Math.max(1, Math.min(30, Math.floor(record.limit)))
      : 15;

  if (!query) {
    return NextResponse.json(
      { error: "Please enter a search query." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (query.length > 500) {
    return NextResponse.json(
      { error: "Search query must be 500 characters or fewer." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const result = await searchCodebaseSemantically({
      userClient: supabase,
      query,
      repositoryId,
      limit,
    });

    return NextResponse.json(result, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to complete semantic search.";
    return NextResponse.json(
      { error: message },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
}
