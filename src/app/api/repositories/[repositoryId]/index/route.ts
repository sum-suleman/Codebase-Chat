import { NextResponse } from "next/server";

import {
  listLatestRepositoryIndexJobs,
  scheduleRepositoryIndexJob,
} from "@/lib/indexing/pipeline";
import { createClient } from "@/lib/supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

interface RouteContext {
  params: Promise<{ repositoryId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { repositoryId } = await context.params;
  if (!UUID_PATTERN.test(repositoryId)) {
    return NextResponse.json(
      { error: "Invalid repository ID." },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401, headers: NO_STORE_HEADERS }
    );
  }

  const { data: repoData, error: repoError } = await supabase
    .from("repositories")
    .select("id")
    .eq("id", repositoryId)
    .is("disconnected_at", null)
    .single();

  if (repoError || !repoData) {
    return NextResponse.json(
      { error: "Repository not found." },
      { status: 404, headers: NO_STORE_HEADERS }
    );
  }

  const latestJobs = await listLatestRepositoryIndexJobs(supabase, [
    repositoryId,
  ]);
  const job = latestJobs.get(repositoryId) ?? null;

  return NextResponse.json({ job }, { headers: NO_STORE_HEADERS });
}

export async function POST(_request: Request, context: RouteContext) {
  const { repositoryId } = await context.params;
  if (!UUID_PATTERN.test(repositoryId)) {
    return NextResponse.json(
      { error: "Invalid repository ID." },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401, headers: NO_STORE_HEADERS }
    );
  }

  const { data: repoData, error: repoError } = await supabase
    .from("repositories")
    .select("id")
    .eq("id", repositoryId)
    .is("disconnected_at", null)
    .single();

  if (repoError || !repoData) {
    return NextResponse.json(
      { error: "Repository not found." },
      { status: 404, headers: NO_STORE_HEADERS }
    );
  }

  try {
    const result = await scheduleRepositoryIndexJob({
      ownerId: user.id,
      repositoryId,
    });

    return NextResponse.json(
      {
        job: result.job,
        alreadyActive: result.alreadyActive,
      },
      { status: 202, headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Unable to queue repository indexing.";

    return NextResponse.json(
      { error: message },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
