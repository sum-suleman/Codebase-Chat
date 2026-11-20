import { NextResponse } from "next/server";

import {
  getValidGitLabAccessToken,
  listGitLabAuthorizedProjects,
  listUserGitLabConnections,
  type GitLabAuthorizedProject,
} from "@/lib/providers/gitlab/client";
import { createClient } from "@/lib/supabase/server";

export type AvailableGitLabRepository = GitLabAuthorizedProject;

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 }
    );
  }

  try {
    const connections = await listUserGitLabConnections(supabase);
    const activeConnections = connections.filter((c) => c.status === "active");

    if (activeConnections.length === 0) {
      return NextResponse.json({
        repositories: [],
        hasActiveConnection: false,
      });
    }

    const allProjects: AvailableGitLabRepository[] = [];
    for (const conn of activeConnections) {
      const accessToken = await getValidGitLabAccessToken({
        ownerId: user.id,
        connectionId: conn.id,
      });
      const projects = await listGitLabAuthorizedProjects({
        connectionId: conn.id,
        accountLogin: conn.accountLogin,
        accessToken,
      });
      allProjects.push(...projects);
    }

    return NextResponse.json({
      repositories: allProjects,
      hasActiveConnection: true,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Unable to load GitLab repositories.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
