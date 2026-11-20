import { NextResponse } from "next/server";

import { getGitHubAppConfig } from "@/lib/providers/github/config";
import { createGitHubInstallationState } from "@/lib/providers/github/state";
import { createClient } from "@/lib/supabase/server";

export const GITHUB_INSTALLATION_STATE_COOKIE = "github_installation_state";
export const GITHUB_INSTALLATION_COOKIE_PATH = "/api/github";
const GITHUB_INSTALLATION_COOKIE_MAX_AGE_SECONDS = 10 * 60;

function getSafeSiteUrl(): URL {
  const value = process.env.SITE_URL;

  if (!value) {
    throw new Error("SITE_URL is not configured.");
  }

  const url = new URL(value);

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("SITE_URL is invalid.");
  }

  if (
    process.env.NODE_ENV === "production" &&
    url.protocol !== "https:"
  ) {
    throw new Error("Production SITE_URL must use HTTPS.");
  }

  return url;
}

function redirectNoStore(destination: URL): NextResponse {
  const response = NextResponse.redirect(destination, { status: 302 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET() {
  let siteUrl: URL;

  try {
    siteUrl = getSafeSiteUrl();
  } catch {
    return NextResponse.json(
      { error: "Application site configuration is unavailable." },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return redirectNoStore(new URL("/login", siteUrl));
  }

  let appSlug: string;
  let installationState: ReturnType<typeof createGitHubInstallationState>;

  try {
    const config = getGitHubAppConfig();
    appSlug = config.appSlug;
    installationState = createGitHubInstallationState(user.id);
  } catch {
    return redirectNoStore(
      new URL("/settings?github_error=unavailable", siteUrl)
    );
  }

  const githubInstallUrl = new URL(
    `https://github.com/apps/${encodeURIComponent(appSlug)}/installations/new`
  );
  githubInstallUrl.searchParams.set("state", installationState.state);

  const response = redirectNoStore(githubInstallUrl);
  response.cookies.set(
    GITHUB_INSTALLATION_STATE_COOKIE,
    installationState.cookieValue,
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: GITHUB_INSTALLATION_COOKIE_PATH,
      maxAge: GITHUB_INSTALLATION_COOKIE_MAX_AGE_SECONDS,
    }
  );

  return response;
}
