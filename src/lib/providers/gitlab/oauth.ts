import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const GITLAB_BASE_URL = "https://gitlab.com";
export const GITLAB_OAUTH_SCOPES = ["read_api"] as const;
export const GITLAB_STATE_COOKIE_NAME = "codebase_chat_gitlab_oauth";
const STATE_TTL_MS = 10 * 60 * 1000;

export interface GitLabOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GitLabOAuthStatePayload {
  userId: string;
  state: string;
  codeVerifier: string;
  expiresAt: number;
}

export function getGitLabOAuthConfig(): GitLabOAuthConfig {
  const clientId = (process.env.GITLAB_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.GITLAB_CLIENT_SECRET ?? "").trim();
  const siteUrl = (process.env.SITE_URL ?? "http://localhost:3000")
    .trim()
    .replace(/\/+$/, "");

  if (!clientId || !clientSecret) {
    throw new Error(
      "GITLAB_CLIENT_ID and GITLAB_CLIENT_SECRET must be configured."
    );
  }

  return {
    clientId,
    clientSecret,
    redirectUri: `${siteUrl}/api/gitlab/callback`,
  };
}

function getSigningSecret(): string {
  const secret = (
    process.env.GITHUB_INSTALLATION_STATE_SECRET ??
    process.env.TOKEN_ENCRYPTION_KEY ??
    ""
  ).trim();
  if (secret.length < 32) {
    throw new Error("OAuth state signing secret is not configured.");
  }
  return secret;
}

function signPayload(encodedPayload: string): string {
  return createHmac("sha256", getSigningSecret())
    .update(encodedPayload)
    .digest("base64url");
}

export function generatePkcePair(): {
  codeVerifier: string;
  codeChallenge: string;
} {
  const codeVerifier = randomBytes(48).toString("base64url");
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  return { codeVerifier, codeChallenge };
}

export function createSignedGitLabStateCookie(userId: string): {
  cookieValue: string;
  state: string;
  codeChallenge: string;
} {
  const state = randomBytes(32).toString("base64url");
  const { codeVerifier, codeChallenge } = generatePkcePair();

  const payload: GitLabOAuthStatePayload = {
    userId,
    state,
    codeVerifier,
    expiresAt: Date.now() + STATE_TTL_MS,
  };

  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url"
  );
  const signature = signPayload(encoded);

  return {
    cookieValue: `${encoded}.${signature}`,
    state,
    codeChallenge,
  };
}

export function verifySignedGitLabStateCookie(
  cookieValue: string | undefined,
  returnedState: string | null,
  expectedUserId: string
): GitLabOAuthStatePayload | null {
  if (!cookieValue || !returnedState) {
    return null;
  }

  const parts = cookieValue.split(".");
  if (parts.length !== 2) {
    return null;
  }

  const [encoded, signature] = parts;
  const expectedSig = signPayload(encoded);

  const sigBuf = Buffer.from(signature, "utf8");
  const expectedBuf = Buffer.from(expectedSig, "utf8");
  if (
    sigBuf.length !== expectedBuf.length ||
    !timingSafeEqual(sigBuf, expectedBuf)
  ) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8")
    ) as unknown;
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  if (
    typeof record.userId !== "string" ||
    typeof record.state !== "string" ||
    typeof record.codeVerifier !== "string" ||
    typeof record.expiresAt !== "number"
  ) {
    return null;
  }

  if (record.userId !== expectedUserId || record.state !== returnedState) {
    return null;
  }

  if (Date.now() >= record.expiresAt) {
    return null;
  }

  return {
    userId: record.userId,
    state: record.state,
    codeVerifier: record.codeVerifier,
    expiresAt: record.expiresAt,
  };
}

export function buildGitLabAuthorizeUrl(
  config: GitLabOAuthConfig,
  state: string,
  codeChallenge: string
): string {
  const url = new URL(`${GITLAB_BASE_URL}/oauth/authorize`);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  url.searchParams.set("scope", GITLAB_OAUTH_SCOPES.join(" "));
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}
