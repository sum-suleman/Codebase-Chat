import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  createGitHubInstallationState,
  verifyGitHubInstallationState,
} from "./state";

const TEST_SECRET = "0123456789abcdef0123456789abcdef";
const TEST_USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const FIXED_NOW = 1_700_000_000_000;
const TEN_MINUTES_MS = 10 * 60 * 1000;

let originalSecret: string | undefined;

beforeEach(() => {
  originalSecret = process.env.GITHUB_INSTALLATION_STATE_SECRET;
  process.env.GITHUB_INSTALLATION_STATE_SECRET = TEST_SECRET;
});

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.GITHUB_INSTALLATION_STATE_SECRET;
  } else {
    process.env.GITHUB_INSTALLATION_STATE_SECRET = originalSecret;
  }
});

describe("GitHub installation state management", () => {
  it("generates a 256-bit random state value and signed cookie", () => {
    const first = createGitHubInstallationState(TEST_USER_ID, FIXED_NOW);
    const second = createGitHubInstallationState(TEST_USER_ID, FIXED_NOW);

    assert.equal(typeof first.state, "string");
    assert.equal(Buffer.from(first.state, "base64url").length, 32);
    assert.notEqual(first.state, second.state);
    assert.equal(first.expiresAt, FIXED_NOW + TEN_MINUTES_MS);

    const parts = first.cookieValue.split(".");
    assert.equal(parts.length, 2);
    assert.ok(parts[0].length > 0);
    assert.ok(parts[1].length > 0);
  });

  it("verifies a valid state within its 10-minute lifetime", () => {
    const created = createGitHubInstallationState(TEST_USER_ID, FIXED_NOW);

    assert.equal(
      verifyGitHubInstallationState(
        created.cookieValue,
        created.state,
        TEST_USER_ID,
        FIXED_NOW
      ),
      true
    );

    assert.equal(
      verifyGitHubInstallationState(
        created.cookieValue,
        created.state,
        TEST_USER_ID,
        FIXED_NOW + TEN_MINUTES_MS - 1
      ),
      true
    );
  });

  it("rejects an incorrect returned state", () => {
    const created = createGitHubInstallationState(TEST_USER_ID, FIXED_NOW);
    const other = createGitHubInstallationState(TEST_USER_ID, FIXED_NOW);

    assert.equal(
      verifyGitHubInstallationState(
        created.cookieValue,
        other.state,
        TEST_USER_ID,
        FIXED_NOW + 1000
      ),
      false
    );

    assert.equal(
      verifyGitHubInstallationState(
        created.cookieValue,
        "",
        TEST_USER_ID,
        FIXED_NOW + 1000
      ),
      false
    );
  });

  it("rejects state bound to a different authenticated user", () => {
    const created = createGitHubInstallationState(TEST_USER_ID, FIXED_NOW);

    assert.equal(
      verifyGitHubInstallationState(
        created.cookieValue,
        created.state,
        "11111111-1111-1111-1111-111111111111",
        FIXED_NOW + 1000
      ),
      false
    );
  });

  it("rejects expired state at and after expiresAt", () => {
    const created = createGitHubInstallationState(TEST_USER_ID, FIXED_NOW);

    assert.equal(
      verifyGitHubInstallationState(
        created.cookieValue,
        created.state,
        TEST_USER_ID,
        FIXED_NOW + TEN_MINUTES_MS
      ),
      false
    );

    assert.equal(
      verifyGitHubInstallationState(
        created.cookieValue,
        created.state,
        TEST_USER_ID,
        FIXED_NOW + TEN_MINUTES_MS + 60_000
      ),
      false
    );
  });

  it("rejects future-issued state", () => {
    const created = createGitHubInstallationState(TEST_USER_ID, FIXED_NOW);

    assert.equal(
      verifyGitHubInstallationState(
        created.cookieValue,
        created.state,
        TEST_USER_ID,
        FIXED_NOW - 1
      ),
      false
    );
  });

  it("rejects malformed or oversized cookies", () => {
    const created = createGitHubInstallationState(TEST_USER_ID, FIXED_NOW);

    const malformedCookies = [
      "",
      "no-dot-separator",
      ".only-signature",
      "only-payload.",
      "not-valid-base64.signature",
      "a".repeat(2049),
    ];

    for (const cookie of malformedCookies) {
      assert.equal(
        verifyGitHubInstallationState(
          cookie,
          created.state,
          TEST_USER_ID,
          FIXED_NOW + 1000
        ),
        false
      );
    }
  });

  it("rejects modified payloads", () => {
    const created = createGitHubInstallationState(TEST_USER_ID, FIXED_NOW);
    const [, signature] = created.cookieValue.split(".");

    const tamperedPayload = Buffer.from(
      JSON.stringify({
        userId: "attacker-user-id",
        state: created.state,
        issuedAt: FIXED_NOW,
        expiresAt: FIXED_NOW + TEN_MINUTES_MS,
      })
    ).toString("base64url");

    assert.equal(
      verifyGitHubInstallationState(
        `${tamperedPayload}.${signature}`,
        created.state,
        "attacker-user-id",
        FIXED_NOW + 1000
      ),
      false
    );
  });

  it("rejects modified or truncated signatures", () => {
    const created = createGitHubInstallationState(TEST_USER_ID, FIXED_NOW);
    const [encodedPayload, signature] = created.cookieValue.split(".");

    const flippedFirstChar =
      signature.startsWith("A")
        ? `B${signature.slice(1)}`
        : `A${signature.slice(1)}`;

    assert.equal(
      verifyGitHubInstallationState(
        `${encodedPayload}.${flippedFirstChar}`,
        created.state,
        TEST_USER_ID,
        FIXED_NOW + 1000
      ),
      false
    );

    assert.equal(
      verifyGitHubInstallationState(
        `${encodedPayload}.${signature.slice(0, -4)}`,
        created.state,
        TEST_USER_ID,
        FIXED_NOW + 1000
      ),
      false
    );
  });

  it("rejects missing or weak signing secrets", () => {
    const created = createGitHubInstallationState(TEST_USER_ID, FIXED_NOW);

    delete process.env.GITHUB_INSTALLATION_STATE_SECRET;
    assert.throws(
      () => createGitHubInstallationState(TEST_USER_ID, FIXED_NOW),
      /GITHUB_INSTALLATION_STATE_SECRET/
    );
    assert.equal(
      verifyGitHubInstallationState(
        created.cookieValue,
        created.state,
        TEST_USER_ID,
        FIXED_NOW + 1000
      ),
      false
    );

    process.env.GITHUB_INSTALLATION_STATE_SECRET = "too-short-secret";
    assert.throws(
      () => createGitHubInstallationState(TEST_USER_ID, FIXED_NOW),
      /GITHUB_INSTALLATION_STATE_SECRET/
    );
    assert.equal(
      verifyGitHubInstallationState(
        created.cookieValue,
        created.state,
        TEST_USER_ID,
        FIXED_NOW + 1000
      ),
      false
    );
  });

  it("rejects invalid user IDs", () => {
    assert.throws(
      () => createGitHubInstallationState("", FIXED_NOW),
      /valid authenticated user ID/
    );
    assert.throws(
      () => createGitHubInstallationState("   ", FIXED_NOW),
      /valid authenticated user ID/
    );
    assert.throws(
      () => createGitHubInstallationState("u".repeat(256), FIXED_NOW),
      /valid authenticated user ID/
    );

    const created = createGitHubInstallationState(TEST_USER_ID, FIXED_NOW);
    assert.equal(
      verifyGitHubInstallationState(
        created.cookieValue,
        created.state,
        "",
        FIXED_NOW + 1000
      ),
      false
    );
  });

  it("rejects invalid timestamps", () => {
    const invalidTimes = [-1, Number.NaN, Number.POSITIVE_INFINITY, 1.5];

    for (const badNow of invalidTimes) {
      assert.throws(
        () => createGitHubInstallationState(TEST_USER_ID, badNow),
        /valid state creation time/
      );
    }

    const created = createGitHubInstallationState(TEST_USER_ID, FIXED_NOW);
    for (const badNow of invalidTimes) {
      assert.equal(
        verifyGitHubInstallationState(
          created.cookieValue,
          created.state,
          TEST_USER_ID,
          badNow
        ),
        false
      );
    }
  });
});
