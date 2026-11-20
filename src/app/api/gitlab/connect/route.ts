import { NextResponse } from "next/server";

import {
  buildGitLabAuthorizeUrl,
  createSignedGitLabStateCookie,
  getGitLabOAuthConfig,
  GITLAB_STATE_COOKIE_NAME,
} from "@/lib/providers/gitlab/oauth";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const siteUrl = (process.env.SITE_URL ?? new URL(request.url).origin)
    .trim()
    .replace(/\/+$/, "");

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.redirect(`${siteUrl}/login`);
  }

  try {
    const config = getGitLabOAuthConfig();
    const { cookieValue, state, codeChallenge } = createSignedGitLabStateCookie(
      user.id
    );
    const authorizeUrl = buildGitLabAuthorizeUrl(config, state, codeChallenge);

    const response = NextResponse.redirect(authorizeUrl);
    response.cookies.set(GITLAB_STATE_COOKIE_NAME, cookieValue, {
      httpOnly: true,
      sameSite: "lax",
      secure: siteUrl.startsWith("https://"),
      path: "/",
      maxAge: 600,
    });

    return response;
  } catch {
    return NextResponse.redirect(
      `${siteUrl}/settings?gitlab_error=${encodeURIComponent(
        "GitLab OAuth is not configured on the server."
      )}`
    );
  }
}
