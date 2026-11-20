import assert from "node:assert/strict";
import {
  after,
  before,
  beforeEach,
  describe,
  it,
} from "node:test";

import { generateKeyPairSync } from "node:crypto";

import {
  createGitHubInstallationToken,
} from "@/lib/providers/github/installation";

const originalFetch = globalThis.fetch;

const originalEnvironment = {
  appId: process.env.GITHUB_APP_ID,
  appSlug: process.env.GITHUB_APP_SLUG,
  privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
};

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: {
    type: "pkcs8",
    format: "pem",
  },
  publicKeyEncoding: {
    type: "spki",
    format: "pem",
  },
});

const validResponse = {
  token: "ghs_test_token",
  expires_at: "2027-01-01T00:00:00Z",
  repository_selection: "all",
  permissions: {
    contents: "read",
    metadata: "read",
  },
};

let fetchCalls: Array<{
  url: string;
  options: RequestInit;
}> = [];

function mockFetch(
  handler: (
    url: string,
    options: RequestInit
  ) => Promise<Response>
): void {
  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    const options = init ?? {};

    fetchCalls.push({ url, options });

    return handler(url, options);
  };
}

function mockSuccessfulFetch(): void {
  mockFetch(async () => Response.json(validResponse));
}

before(() => {
  process.env.GITHUB_APP_ID = "123456";
  process.env.GITHUB_APP_SLUG = "codebase-chat-test";
  process.env.GITHUB_APP_PRIVATE_KEY = privateKey;
});

after(() => {
  globalThis.fetch = originalFetch;

  if (originalEnvironment.appId === undefined) {
    delete process.env.GITHUB_APP_ID;
  } else {
    process.env.GITHUB_APP_ID = originalEnvironment.appId;
  }

  if (originalEnvironment.appSlug === undefined) {
    delete process.env.GITHUB_APP_SLUG;
  } else {
    process.env.GITHUB_APP_SLUG = originalEnvironment.appSlug;
  }

  if (originalEnvironment.privateKey === undefined) {
    delete process.env.GITHUB_APP_PRIVATE_KEY;
  } else {
    process.env.GITHUB_APP_PRIVATE_KEY =
      originalEnvironment.privateKey;
  }
});

describe("createGitHubInstallationToken", () => {
  beforeEach(() => {
    fetchCalls = [];
    globalThis.fetch = originalFetch;
  });

  it("creates a read-only installation token", async () => {
    mockSuccessfulFetch();

    const result = await createGitHubInstallationToken(12345);

    assert.equal(result.token, validResponse.token);
    assert.equal(result.expiresAt, validResponse.expires_at);
    assert.equal(result.repositorySelection, "all");

    assert.deepEqual(result.permissions, {
      contents: "read",
      metadata: "read",
    });

    assert.equal(fetchCalls.length, 1);

    const request = fetchCalls[0];

    assert.equal(
      request.url,
      "https://api.github.com/app/installations/12345/access_tokens"
    );

    assert.equal(request.options.method, "POST");
    assert.equal(
      new Headers(request.options.headers).get("Content-Type"),
      "application/json"
    );

    const authorization = new Headers(
      request.options.headers
    ).get("Authorization");

    assert.match(authorization ?? "", /^Bearer /);

    const jwt = authorization!.slice("Bearer ".length);
    assert.equal(jwt.split(".").length, 3);

    assert.deepEqual(JSON.parse(request.options.body as string), {
      permissions: {
        contents: "read",
        metadata: "read",
      },
    });
  });

  it("restricts the token to selected repositories", async () => {
    mockFetch(async () =>
      Response.json({
        ...validResponse,
        repository_selection: "selected",
      })
    );

    const result = await createGitHubInstallationToken(
      12345,
      [101, 202]
    );

    assert.equal(result.repositorySelection, "selected");

    const body = JSON.parse(
      fetchCalls[0].options.body as string
    );

    assert.deepEqual(body.repository_ids, [101, 202]);

    assert.deepEqual(body.permissions, {
      contents: "read",
      metadata: "read",
    });
  });

  it("rejects an invalid installation ID", async () => {
    await assert.rejects(
      createGitHubInstallationToken(0),
      /valid GitHub installation ID/
    );

    assert.equal(fetchCalls.length, 0);
  });

  it("rejects invalid repository ID lists", async () => {
    const invalidLists = [
      [],
      [0],
      [-1],
      [1.5],
      [Number.MAX_SAFE_INTEGER + 1],
      [101, 101],
      Array.from({ length: 501 }, (_, index) => index + 1),
    ];

    for (const repositoryIds of invalidLists) {
      await assert.rejects(
        createGitHubInstallationToken(12345, repositoryIds),
        /Repository IDs must contain/
      );
    }

    assert.equal(fetchCalls.length, 0);
  });

  it("reports GitHub HTTP errors without exposing response data", async () => {
    mockFetch(async () =>
      new Response("sensitive response content", {
        status: 403,
      })
    );

    await assert.rejects(
      createGitHubInstallationToken(12345),
      (error: Error) => {
        assert.match(error.message, /HTTP 403/);
        assert.doesNotMatch(
          error.message,
          /sensitive response content/
        );
        return true;
      }
    );
  });

  it("rejects invalid JSON responses", async () => {
    mockFetch(async () =>
      new Response("not-json", {
        status: 200,
      })
    );

    await assert.rejects(
      createGitHubInstallationToken(12345),
      /invalid installation token response/
    );
  });

  it("rejects incomplete API responses", async () => {
    mockFetch(async () =>
      Response.json({
        token: "ghs_test_token",
        expires_at: "not-a-date",
        repository_selection: "all",
        permissions: {},
      })
    );

    await assert.rejects(
      createGitHubInstallationToken(12345),
      /incomplete installation token response/
    );
  });

  it("handles network failures without exposing internal errors", async () => {
    mockFetch(async () => {
      throw new Error("internal network detail");
    });

    await assert.rejects(
      createGitHubInstallationToken(12345),
      (error: Error) => {
        assert.match(error.message, /Unable to contact GitHub/);
        assert.doesNotMatch(
          error.message,
          /internal network detail/
        );
        return true;
      }
    );
  });
});

