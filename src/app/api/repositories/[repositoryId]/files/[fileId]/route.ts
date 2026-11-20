import { NextResponse } from "next/server";

import { getIndexedRepositoryFileContent } from "@/lib/repositories/browser";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    repositoryId: string;
    fileId: string;
  }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { repositoryId, fileId } = await context.params;
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

  const file = await getIndexedRepositoryFileContent(
    supabase,
    repositoryId,
    fileId
  );

  if (!file) {
    return NextResponse.json(
      { error: "Indexed file not found." },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }

  return NextResponse.json(
    { file },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
