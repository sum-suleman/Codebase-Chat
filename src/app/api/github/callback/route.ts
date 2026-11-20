import { NextResponse, type NextRequest } from "next/server";

import {
  GITHUB_INSTALLATION_COOKIE_PATH,
  GITHUB_INSTALLATION_STATE_COOKIE,
} from "@/app/api/github/install/route";
import { upsertGitHubInstallationConnection } from "@/lib/providers/github/connections";
import { verifyGitHubInstallationState } from "@/lib/providers/github/state";
import { verifyGitHubInstallation } from "@/lib/providers/github/verify-installation";
import { createClient } from "@/lib/supabase/server";

const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;
const ALLOWED_SETUP_ACTIONS = new Set(["install", "update"]);

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

function redirectAndClearStateCookie(destination: URL): NextResponse {
  const response = NextResponse.redirect(destination, { status: 302 });
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(GITHUB_INSTALLATION_STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: GITHUB_INSTALLATION_COOKIE_PATH,
    maxAge: 0,
  });
  return response;
}

function parseInstallationId(rawInstallationId: string | null): number | null {
  if (
    typeof rawInstallationId !== "string" ||
    !POSITIVE_INTEGER_PATTERN.test(rawInstallationId)
  ) {
    return null;
  }

  const parsed = Number(rawInstallationId);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

export async function GET(request: NextRequest) {
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
    return redirectAndClearStateCookie(new URL("/login", siteUrl));
  }

  const requestUrl = new URL(request.url);
  const returnedState = requestUrl.searchParams.get("state") ?? "";
  const stateCookie =
    request.cookies.get(GITHUB_INSTALLATION_STATE_COOKIE)?.value ?? "";

  if (!verifyGitHubInstallationState(stateCookie, returnedState, user.id)) {
    return redirectAndClearStateCookie(
      new URL("/settings?github_error=invalid_state", siteUrl)
    );
  }

  const setupAction = requestUrl.searchParams.get("setup_action");
  if (setupAction !== null && !ALLOWED_SETUP_ACTIONS.has(setupAction)) {
    return redirectAndClearStateCookie(
      new URL("/settings?github_error=invalid_request", siteUrl)
    );
  }

  const installationId = parseInstallationId(
    requestUrl.searchParams.get("installation_id")
  );
  if (installationId === null) {
    return redirectAndClearStateCookie(
      new URL("/settings?github_error=invalid_installation", siteUrl)
    );
  }

  let verifiedInstallation;
  try {
    verifiedInstallation = await verifyGitHubInstallation(installationId);
  } catch {
    return redirectAndClearStateCookie(
      new URL("/settings?github_error=verification_failed", siteUrl)
    );
  }

  try {
    await upsertGitHubInstallationConnection(user.id, verifiedInstallation);
  } catch {
    return redirectAndClearStateCookie(
      new URL("/settings?github_error=connection_failed", siteUrl)
    );
  }

  const statusValue = setupAction === "update" ? "updated" : "connected";
  return redirectAndClearStateCookie(
    new URL(`/settings?github=${statusValue}`, siteUrl)
  );
}
