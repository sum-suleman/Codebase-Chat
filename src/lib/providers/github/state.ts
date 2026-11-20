import "server-only";

import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const STATE_LIFETIME_MS = 10 * 60 * 1000;
const STATE_SECRET_ENV = "GITHUB_INSTALLATION_STATE_SECRET";

interface GitHubInstallationStatePayload {
  userId: string;
  state: string;
  issuedAt: number;
  expiresAt: number;
}

export interface GitHubInstallationState {
  state: string;
  cookieValue: string;
  expiresAt: number;
}

function getStateSecret(): string {
  const secret = process.env[STATE_SECRET_ENV];

  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error(
      `${STATE_SECRET_ENV} must contain at least 32 bytes of secret material.`
    );
  }

  return secret;
}

function signPayload(encodedPayload: string): string {
  return createHmac("sha256", getStateSecret())
    .update(encodedPayload)
    .digest("base64url");
}

export function createGitHubInstallationState(
  userId: string,
  now = Date.now()
): GitHubInstallationState {
  if (
    typeof userId !== "string" ||
    userId.trim().length === 0 ||
    userId.length > 255
  ) {
    throw new Error("A valid authenticated user ID is required.");
  }

  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error("A valid state creation time is required.");
  }

  const state = randomBytes(32).toString("base64url");
  const expiresAt = now + STATE_LIFETIME_MS;

  const payload: GitHubInstallationStatePayload = {
    userId,
    state,
    issuedAt: now,
    expiresAt,
  };

  const encodedPayload = Buffer
    .from(JSON.stringify(payload))
    .toString("base64url");

  const signature = signPayload(encodedPayload);

  return {
    state,
    cookieValue: `${encodedPayload}.${signature}`,
    expiresAt,
  };
}

export function verifyGitHubInstallationState(
  cookieValue: string,
  returnedState: string,
  authenticatedUserId: string,
  now = Date.now()
): boolean {
  if (
    typeof cookieValue !== "string" ||
    cookieValue.length === 0 ||
    cookieValue.length > 2048 ||
    typeof returnedState !== "string" ||
    typeof authenticatedUserId !== "string" ||
    authenticatedUserId.length === 0 ||
    !Number.isSafeInteger(now) ||
    now < 0
  ) {
    return false;
  }

  const separatorIndex = cookieValue.lastIndexOf(".");

  if (separatorIndex <= 0) {
    return false;
  }

  const encodedPayload = cookieValue.slice(0, separatorIndex);
  const suppliedSignature = cookieValue.slice(separatorIndex + 1);

  if (!encodedPayload || !suppliedSignature) {
    return false;
  }

  let expectedSignature: string;

  try {
    expectedSignature = signPayload(encodedPayload);
  } catch {
    return false;
  }

  const suppliedSignatureBuffer = Buffer.from(
    suppliedSignature,
    "base64url"
  );

  const expectedSignatureBuffer = Buffer.from(
    expectedSignature,
    "base64url"
  );

  if (
    suppliedSignatureBuffer.length !== expectedSignatureBuffer.length ||
    suppliedSignatureBuffer.toString("base64url") !== suppliedSignature ||
    !timingSafeEqual(
      suppliedSignatureBuffer,
      expectedSignatureBuffer
    )
  ) {
    return false;
  }

  let payload: GitHubInstallationStatePayload;

  try {
    payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8")
    ) as GitHubInstallationStatePayload;
  } catch {
    return false;
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof payload.userId !== "string" ||
    typeof payload.state !== "string" ||
    typeof payload.issuedAt !== "number" ||
    typeof payload.expiresAt !== "number"
  ) {
    return false;
  }

  if (
    payload.userId !== authenticatedUserId ||
    payload.state !== returnedState ||
    !Number.isSafeInteger(payload.issuedAt) ||
    !Number.isSafeInteger(payload.expiresAt) ||
    payload.issuedAt > now ||
    payload.expiresAt <= now ||
    payload.expiresAt - payload.issuedAt !== STATE_LIFETIME_MS ||
    now - payload.issuedAt > STATE_LIFETIME_MS
  ) {
    return false;
  }

  return true;
}
