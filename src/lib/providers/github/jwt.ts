import "server-only";

import { createSign } from "node:crypto";

import { getGitHubAppConfig } from "@/lib/providers/github/config";

interface GitHubAppJwtPayload {
  iss: string;
  iat: number;
  exp: number;
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

export function createGitHubAppJwt(): string {
  const config = getGitHubAppConfig();

  const currentTime = Math.floor(Date.now() / 1000);

  const issuedAt = currentTime - 60;
  const expiresAt = issuedAt + 9 * 60;

  const header = {
    alg: "RS256",
    typ: "JWT",
  };

  const payload: GitHubAppJwtPayload = {
    iss: config.appId,
    iat: issuedAt,
    exp: expiresAt,
  };

  const encodedHeader = encodeBase64Url(JSON.stringify(header));
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));

  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signer = createSign("RSA-SHA256");

  signer.update(signingInput);
  signer.end();

  const signature = signer.sign(config.privateKey, "base64url");

  return `${signingInput}.${signature}`;
}
