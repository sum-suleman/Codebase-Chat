import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  exchangeGitLabAuthorizationCode,
  fetchGitLabAuthenticatedUser,
  upsertGitLabConnectionWithTokens,
} from "@/lib/providers/gitlab/client";
import {
  GITLAB_STATE_COOKIE_NAME,
  verifySignedGitLabStateCookie,
} from "@/lib/providers/gitlab/oauth";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const siteUrl = (process.env.SITE_URL ?? url.origin)
    .trim()
    .replace(/\/+$/, "");

  const redirectWithError = (message: string) => {
    const res = NextResponse.redirect(
      `${siteUrl}/settings?gitlab_error=${encodeURIComponent(message)}`
    );
    res.cookies.delete(GITLAB_STATE_COOKIE_NAME);
    return res;
  };

  const providerError = url.searchParams.get("error");
  if (providerError) {
    return redirectWithError("GitLab authorization was cancelled or denied.");
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) {
    return redirectWithError("GitLab callback was missing required parameters.");
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.redirect(`${siteUrl}/login`);
  }

  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(GITLAB_STATE_COOKIE_NAME)?.value;
  const verifiedState = verifySignedGitLabStateCookie(
    cookieValue,
    state,
    user.id
  );

  if (!verifiedState) {
    return redirectWithError(
      "Invalid or expired GitLab OAuth state. Please try connecting again."
    );
  }

  try {
    const tokens = await exchangeGitLabAuthorizationCode({
      code,
      codeVerifier: verifiedState.codeVerifier,
    });
    const profile = await fetchGitLabAuthenticatedUser(tokens.accessToken);
    await upsertGitLabConnectionWithTokens({
      ownerId: user.id,
      profile,
      tokens,
    });

    const response = NextResponse.redirect(
      `${siteUrl}/settings?gitlab=connected`
    );
    response.cookies.delete(GITLAB_STATE_COOKIE_NAME);
    return response;
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Unable to complete GitLab account connection.";
    return redirectWithError(message);
  }
}
