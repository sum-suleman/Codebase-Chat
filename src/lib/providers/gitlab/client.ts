import "server-only";

import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  GITLAB_BASE_URL,
  GITLAB_OAUTH_SCOPES,
  getGitLabOAuthConfig,
} from "@/lib/providers/gitlab/oauth";
import { createAdminClient } from "@/lib/supabase/admin";

const KEY_VERSION = "v1-env-aes256gcm";

export interface GitLabTokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  scopes: string[];
}

export interface GitLabUserProfile {
  externalAccountId: string;
  username: string;
  name: string;
}

export interface GitLabConnectionSummary {
  id: string;
  externalAccountId: string;
  accountLogin: string;
  status: "pending" | "active" | "revoked" | "error";
  createdAt: string;
  updatedAt: string;
}

export interface GitLabAuthorizedProject {
  connectionId: string;
  accountLogin: string;
  providerRepoId: string;
  fullName: string;
  canonicalUrl: string;
  defaultBranch: string | null;
  visibility: "public" | "private" | "internal";
  providerArchived: boolean;
}

function getMasterKey(): Buffer {
  const raw = (
    process.env.TOKEN_ENCRYPTION_KEY ??
    process.env.GITHUB_INSTALLATION_STATE_SECRET ??
    ""
  ).trim();

  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  if (raw.length >= 32) {
    return Buffer.from(raw.slice(0, 32), "utf8");
  }
  throw new Error("TOKEN_ENCRYPTION_KEY is not configured.");
}

function toPgByteaHex(buf: Buffer): string {
  return `\\x${buf.toString("hex")}`;
}

function fromPgByteaHex(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (typeof value === "string") {
    if (value.startsWith("\\x") || value.startsWith("0x")) {
      return Buffer.from(value.slice(2), "hex");
    }
    return Buffer.from(value, "base64");
  }
  throw new Error("Invalid bytea column encoding.");
}

export function envelopeEncryptToken(plaintext: string): {
  credentialCiphertext: string;
  wrappedDek: string;
  nonce: string;
  authTag: string;
  keyVersion: string;
} {
  const masterKey = getMasterKey();
  const dek = randomBytes(32);

  const dataIv = randomBytes(12);
  const dataCipher = createCipheriv("aes-256-gcm", dek, dataIv, {
    authTagLength: 16,
  });
  const ciphertext = Buffer.concat([
    dataCipher.update(plaintext, "utf8"),
    dataCipher.final(),
  ]);
  const dataTag = dataCipher.getAuthTag();

  const wrapIv = randomBytes(12);
  const wrapCipher = createCipheriv("aes-256-gcm", masterKey, wrapIv, {
    authTagLength: 16,
  });
  const wrapped = Buffer.concat([wrapCipher.update(dek), wrapCipher.final()]);
  const wrapTag = wrapCipher.getAuthTag();

  const wrappedDekPayload = Buffer.concat([wrapIv, wrapTag, wrapped]);

  return {
    credentialCiphertext: toPgByteaHex(ciphertext),
    wrappedDek: toPgByteaHex(wrappedDekPayload),
    nonce: toPgByteaHex(dataIv),
    authTag: toPgByteaHex(dataTag),
    keyVersion: KEY_VERSION,
  };
}

export function envelopeDecryptToken(row: {
  credential_ciphertext: unknown;
  wrapped_dek: unknown;
  nonce: unknown;
  auth_tag: unknown;
}): string {
  const masterKey = getMasterKey();
  const ciphertext = fromPgByteaHex(row.credential_ciphertext);
  const wrappedPayload = fromPgByteaHex(row.wrapped_dek);
  const dataIv = fromPgByteaHex(row.nonce);
  const dataTag = fromPgByteaHex(row.auth_tag);

  if (wrappedPayload.length < 28 + 32) {
    throw new Error("Corrupted wrapped DEK payload.");
  }

  const wrapIv = wrappedPayload.subarray(0, 12);
  const wrapTag = wrappedPayload.subarray(12, 28);
  const wrappedDek = wrappedPayload.subarray(28);

  const unwrapDecipher = createDecipheriv("aes-256-gcm", masterKey, wrapIv, {
    authTagLength: 16,
  });
  unwrapDecipher.setAuthTag(wrapTag);
  const dek = Buffer.concat([
    unwrapDecipher.update(wrappedDek),
    unwrapDecipher.final(),
  ]);

  const dataDecipher = createDecipheriv("aes-256-gcm", dek, dataIv, {
    authTagLength: 16,
  });
  dataDecipher.setAuthTag(dataTag);
  const plaintext = Buffer.concat([
    dataDecipher.update(ciphertext),
    dataDecipher.final(),
  ]);

  return plaintext.toString("utf8");
}

function parseTokenResponse(data: Record<string, unknown>): GitLabTokenSet {
  if (typeof data.access_token !== "string" || !data.access_token) {
    throw new Error("GitLab OAuth response did not include an access token.");
  }

  const refreshToken =
    typeof data.refresh_token === "string" && data.refresh_token.length > 0
      ? data.refresh_token
      : null;

  const expiresIn =
    typeof data.expires_in === "number" && Number.isFinite(data.expires_in)
      ? data.expires_in
      : null;

  const createdAtSec =
    typeof data.created_at === "number" && Number.isFinite(data.created_at)
      ? data.created_at
      : Math.floor(Date.now() / 1000);

  const expiresAt =
    expiresIn !== null
      ? new Date((createdAtSec + expiresIn) * 1000).toISOString()
      : null;

  const scopes =
    typeof data.scope === "string" && data.scope.trim().length > 0
      ? data.scope.trim().split(/\s+/)
      : [...GITLAB_OAUTH_SCOPES];

  return {
    accessToken: data.access_token,
    refreshToken,
    expiresAt,
    scopes,
  };
}

export async function exchangeGitLabAuthorizationCode(params: {
  code: string;
  codeVerifier: string;
}): Promise<GitLabTokenSet> {
  const config = getGitLabOAuthConfig();

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code: params.code,
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri,
    code_verifier: params.codeVerifier,
  });

  let response: Response;
  try {
    response = await fetch(`${GITLAB_BASE_URL}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("Unable to reach GitLab while exchanging authorization code.");
  }

  if (!response.ok) {
    throw new Error(
      `GitLab OAuth token exchange failed with HTTP ${response.status}.`
    );
  }

  const json = (await response.json()) as Record<string, unknown>;
  return parseTokenResponse(json);
}

async function refreshGitLabTokens(refreshToken: string): Promise<GitLabTokenSet> {
  const config = getGitLabOAuthConfig();

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    redirect_uri: config.redirectUri,
  });

  let response: Response;
  try {
    response = await fetch(`${GITLAB_BASE_URL}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("Unable to contact GitLab to refresh access token.");
  }

  if (!response.ok) {
    throw new Error(
      `GitLab token refresh failed with HTTP ${response.status}. Please reconnect GitLab in Settings.`
    );
  }

  const json = (await response.json()) as Record<string, unknown>;
  return parseTokenResponse(json);
}

export async function fetchGitLabAuthenticatedUser(
  accessToken: string
): Promise<GitLabUserProfile> {
  let response: Response;
  try {
    response = await fetch(`${GITLAB_BASE_URL}/api/v4/user`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("Unable to contact GitLab while verifying user profile.");
  }

  if (!response.ok) {
    throw new Error(`GitLab user lookup failed with HTTP ${response.status}.`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  const id =
    typeof data.id === "number" || typeof data.id === "string"
      ? String(data.id)
      : "";
  const username = typeof data.username === "string" ? data.username.trim() : "";
  const name = typeof data.name === "string" ? data.name.trim() : username;

  if (!id || !username) {
    throw new Error("GitLab returned incomplete user account details.");
  }

  return {
    externalAccountId: id,
    username,
    name: name || username,
  };
}

export async function upsertGitLabConnectionWithTokens(
  params: {
    ownerId: string;
    profile: GitLabUserProfile;
    tokens: GitLabTokenSet;
  },
  adminClient: SupabaseClient = createAdminClient()
): Promise<GitLabConnectionSummary> {
  const { ownerId, profile, tokens } = params;

  const { data: connRow, error: connError } = await adminClient
    .from("provider_connections")
    .upsert(
      {
        owner_id: ownerId,
        provider: "gitlab",
        external_account_id: profile.externalAccountId,
        account_login: profile.username,
        account_type: "user",
        installation_id: null,
        status: "active",
      },
      {
        onConflict: "owner_id,provider,external_account_id",
      }
    )
    .select(
      "id, external_account_id, account_login, status, created_at, updated_at"
    )
    .single();

  if (connError || !connRow) {
    throw new Error("Unable to save GitLab connection metadata.");
  }

  const connectionId = String((connRow as { id: unknown }).id);

  const tokenBundle = JSON.stringify({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    scopes: tokens.scopes,
  });

  const encrypted = envelopeEncryptToken(tokenBundle);

  const { error: credError } = await adminClient
    .from("provider_credentials")
    .upsert(
      {
        connection_id: connectionId,
        owner_id: ownerId,
        credential_type: "oauth_token_bundle",
        credential_ciphertext: encrypted.credentialCiphertext,
        wrapped_dek: encrypted.wrappedDek,
        nonce: encrypted.nonce,
        auth_tag: encrypted.authTag,
        key_version: encrypted.keyVersion,
      },
      {
        onConflict: "connection_id,credential_type",
      }
    );

  if (credError) {
    throw new Error("Unable to persist encrypted GitLab credentials.");
  }

  return {
    id: connectionId,
    externalAccountId: String(
      (connRow as { external_account_id: unknown }).external_account_id
    ),
    accountLogin: String((connRow as { account_login: unknown }).account_login),
    status: (connRow as { status: GitLabConnectionSummary["status"] }).status,
    createdAt: String((connRow as { created_at: unknown }).created_at),
    updatedAt: String((connRow as { updated_at: unknown }).updated_at),
  };
}

export async function getValidGitLabAccessToken(
  params: {
    ownerId: string;
    connectionId: string;
  },
  adminClient: SupabaseClient = createAdminClient()
): Promise<string> {
  const { ownerId, connectionId } = params;

  const { data: connRow, error: connError } = await adminClient
    .from("provider_connections")
    .select("id, status, provider")
    .eq("id", connectionId)
    .eq("owner_id", ownerId)
    .eq("provider", "gitlab")
    .single();

  if (connError || !connRow || (connRow as { status?: unknown }).status !== "active") {
    throw new Error("Active GitLab connection not found. Please reconnect GitLab in Settings.");
  }

  const { data: credRow, error: credError } = await adminClient
    .from("provider_credentials")
    .select("credential_ciphertext, wrapped_dek, nonce, auth_tag")
    .eq("connection_id", connectionId)
    .eq("owner_id", ownerId)
    .eq("credential_type", "oauth_token_bundle")
    .single();

  if (credError || !credRow) {
    throw new Error("GitLab credentials could not be retrieved.");
  }

  const decryptedJson = envelopeDecryptToken(
    credRow as {
      credential_ciphertext: unknown;
      wrapped_dek: unknown;
      nonce: unknown;
      auth_tag: unknown;
    }
  );
  const parsed = JSON.parse(decryptedJson) as GitLabTokenSet;

  const expiresAtMs = parsed.expiresAt ? Date.parse(parsed.expiresAt) : NaN;
  const isNearExpiry =
    Number.isFinite(expiresAtMs) && Date.now() >= expiresAtMs - 60_000;

  if (!isNearExpiry) {
    return parsed.accessToken;
  }

  if (!parsed.refreshToken) {
    throw new Error(
      "GitLab access token expired and no refresh token is available. Please reconnect GitLab in Settings."
    );
  }

  const rotated = await refreshGitLabTokens(parsed.refreshToken);
  const updatedBundle = JSON.stringify({
    accessToken: rotated.accessToken,
    refreshToken: rotated.refreshToken ?? parsed.refreshToken,
    expiresAt: rotated.expiresAt,
    scopes: rotated.scopes,
  });
  const reEncrypted = envelopeEncryptToken(updatedBundle);

  await adminClient
    .from("provider_credentials")
    .update({
      credential_ciphertext: reEncrypted.credentialCiphertext,
      wrapped_dek: reEncrypted.wrappedDek,
      nonce: reEncrypted.nonce,
      auth_tag: reEncrypted.authTag,
      key_version: reEncrypted.keyVersion,
    })
    .eq("connection_id", connectionId)
    .eq("owner_id", ownerId)
    .eq("credential_type", "oauth_token_bundle");

  return rotated.accessToken;
}

export async function listUserGitLabConnections(
  userClient: SupabaseClient
): Promise<GitLabConnectionSummary[]> {
  const { data, error } = await userClient
    .from("provider_connections")
    .select(
      "id, external_account_id, account_login, status, created_at, updated_at"
    )
    .eq("provider", "gitlab")
    .order("created_at", { ascending: false });

  if (error || !Array.isArray(data)) {
    throw new Error("Unable to load GitLab connections.");
  }

  return data.map((row) => ({
    id: String(row.id),
    externalAccountId: String(row.external_account_id),
    accountLogin: String(row.account_login),
    status: row.status as GitLabConnectionSummary["status"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }));
}

export async function disconnectUserGitLabConnection(
  params: {
    ownerId: string;
    connectionId: string;
  },
  userClient: SupabaseClient,
  adminClient: SupabaseClient = createAdminClient()
): Promise<void> {
  const { ownerId, connectionId } = params;

  const { data: existing, error: lookupError } = await userClient
    .from("provider_connections")
    .select("id")
    .eq("id", connectionId)
    .eq("provider", "gitlab")
    .single();

  if (lookupError || !existing) {
    throw new Error("GitLab connection not found.");
  }

  await adminClient
    .from("provider_credentials")
    .delete()
    .eq("connection_id", connectionId)
    .eq("owner_id", ownerId);

  await adminClient
    .from("repositories")
    .update({ disconnected_at: new Date().toISOString() })
    .eq("connection_id", connectionId)
    .eq("owner_id", ownerId)
    .is("disconnected_at", null);

  const { error: deleteError } = await adminClient
    .from("provider_connections")
    .delete()
    .eq("id", connectionId)
    .eq("owner_id", ownerId)
    .eq("provider", "gitlab");

  if (deleteError) {
    throw new Error("Unable to disconnect GitLab account.");
  }
}

const gitlabProjectsCache = new Map<
  string,
  { expiresAt: number; projects: GitLabAuthorizedProject[] }
>();

export async function listGitLabAuthorizedProjects(params: {
  connectionId: string;
  accountLogin: string;
  accessToken: string;
}): Promise<GitLabAuthorizedProject[]> {
  const cached = gitlabProjectsCache.get(params.connectionId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.projects;
  }

  const projects: GitLabAuthorizedProject[] = [];
  let page = 1;

  while (page <= 5) {
    const url = new URL(`${GITLAB_BASE_URL}/api/v4/projects`);
    url.searchParams.set("membership", "true");
    url.searchParams.set("order_by", "last_activity_at");
    url.searchParams.set("sort", "desc");
    url.searchParams.set("per_page", "50");
    url.searchParams.set("page", String(page));

    let response: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await fetch(url.toString(), {
          method: "GET",
          headers: {
            Authorization: `Bearer ${params.accessToken}`,
            Accept: "application/json",
            "User-Agent": "Codebase-Chat/1.0",
          },
          cache: "no-store",
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        throw new Error("Unable to contact GitLab while listing projects.");
      }

      if (response.status !== 429 || attempt === 2) {
        break;
      }

      const retryAfterSec = Number(response.headers.get("retry-after") || "2");
      const delayMs = Math.min(
        Math.max((Number.isFinite(retryAfterSec) ? retryAfterSec : 2) * 1000, 1000),
        4000
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    if (!response || !response.ok) {
      throw new Error(
        `GitLab project listing failed with HTTP ${response?.status ?? 502}.`
      );
    }

    const items = (await response.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(items) || items.length === 0) {
      break;
    }

    for (const item of items) {
      const id =
        typeof item.id === "number" || typeof item.id === "string"
          ? String(item.id)
          : "";
      const fullName =
        typeof item.path_with_namespace === "string"
          ? item.path_with_namespace.trim()
          : "";
      const canonicalUrl =
        typeof item.web_url === "string" ? item.web_url.trim() : "";

      if (!id || !fullName || !canonicalUrl.startsWith("https://")) {
        continue;
      }

      const rawVisibility =
        typeof item.visibility === "string" ? item.visibility : "private";
      const visibility: "public" | "private" | "internal" =
        rawVisibility === "public" ||
        rawVisibility === "private" ||
        rawVisibility === "internal"
          ? rawVisibility
          : "private";

      projects.push({
        connectionId: params.connectionId,
        accountLogin: params.accountLogin,
        providerRepoId: id,
        fullName,
        canonicalUrl,
        defaultBranch:
          typeof item.default_branch === "string" && item.default_branch.trim()
            ? item.default_branch.trim()
            : null,
        visibility,
        providerArchived: Boolean(item.archived),
      });
    }

    const nextPage = response.headers.get("x-next-page");
    if (!nextPage) {
      break;
    }
    page = Number(nextPage);
    if (!Number.isFinite(page) || page <= 1) {
      break;
    }
  }

  gitlabProjectsCache.set(params.connectionId, {
    expiresAt: Date.now() + 30_000,
    projects,
  });

  return projects;
}
