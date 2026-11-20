import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import {
  buildGitLabAuthorizeUrl,
  createSignedGitLabStateCookie,
  generatePkcePair,
  verifySignedGitLabStateCookie,
} from "./oauth";
import {
  envelopeDecryptToken,
  envelopeEncryptToken,
} from "./client";

process.env.GITHUB_INSTALLATION_STATE_SECRET =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.TOKEN_ENCRYPTION_KEY =
  "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

describe("GitLab PKCE & OAuth state", () => {
  it("generates a valid S256 PKCE code_verifier and code_challenge", () => {
    const { codeVerifier, codeChallenge } = generatePkcePair();
    assert.ok(codeVerifier.length >= 43);
    const expected = createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");
    assert.equal(codeChallenge, expected);
  });

  it("verifies a valid signed state cookie bound to the user", () => {
    const userId = "11111111-1111-4111-8111-111111111111";
    const { cookieValue, state } = createSignedGitLabStateCookie(userId);
    const verified = verifySignedGitLabStateCookie(cookieValue, state, userId);
    assert.ok(verified);
    assert.equal(verified.userId, userId);
    assert.equal(verified.state, state);
    assert.ok(verified.codeVerifier.length >= 43);
  });

  it("rejects mismatched state, wrong user, or tampered signature", () => {
    const userId = "11111111-1111-4111-8111-111111111111";
    const { cookieValue, state } = createSignedGitLabStateCookie(userId);

    assert.equal(
      verifySignedGitLabStateCookie(cookieValue, "wrong-state", userId),
      null
    );
    assert.equal(
      verifySignedGitLabStateCookie(
        cookieValue,
        state,
        "22222222-2222-4222-8222-222222222222"
      ),
      null
    );
    assert.equal(
      verifySignedGitLabStateCookie(`${cookieValue}tampered`, state, userId),
      null
    );
  });

  it("builds GitLab authorize URL with S256 PKCE and read_api scope", () => {
    const url = new URL(
      buildGitLabAuthorizeUrl(
        {
          clientId: "client-123",
          clientSecret: "secret-456",
          redirectUri: "http://localhost:3000/api/gitlab/callback",
        },
        "state-xyz",
        "challenge-abc"
      )
    );
    assert.equal(url.origin + url.pathname, "https://gitlab.com/oauth/authorize");
    assert.equal(url.searchParams.get("client_id"), "client-123");
    assert.equal(url.searchParams.get("scope"), "read_api");
    assert.equal(url.searchParams.get("code_challenge"), "challenge-abc");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  });
});

describe("Envelope token encryption", () => {
  it("encrypts and decrypts GitLab OAuth token bundles cleanly", () => {
    const secret = JSON.stringify({
      accessToken: "glpat-secret-access",
      refreshToken: "glrt-secret-refresh",
    });

    const encrypted = envelopeEncryptToken(secret);
    const decrypted = envelopeDecryptToken({
      credential_ciphertext: encrypted.credentialCiphertext,
      wrapped_dek: encrypted.wrappedDek,
      nonce: encrypted.nonce,
      auth_tag: encrypted.authTag,
    });

    assert.equal(decrypted, secret);
  });
});
