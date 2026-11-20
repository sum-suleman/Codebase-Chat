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
  verifyGitHubInstallation,
} from "@/lib/providers/github/verify-installation";

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
  id: 12345,
  app_id: 123456,
  app_slug: "codebase-chat-test",
  account: {
    id: 98765,
    login: "test-user",
    type: "User",
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

function mockSuccessfulFetch(
  response: unknown = validResponse
): void {
  mockFetch(async () => Response.json(response));
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

describe("verifyGitHubInstallation", () => {
  beforeEach(() => {
    fetchCalls = [];
    globalThis.fetch = originalFetch;
  });

  it("verifies a personal GitHub account installation", async () => {
    mockSuccessfulFetch();

    const result = await verifyGitHubInstallation(12345);

    assert.deepEqual(result, {
      installationId: "12345",
      accountId: "98765",
      accountLogin: "test-user",
      accountType: "user",
    });

    assert.equal(fetchCalls.length, 1);
  });

  it("verifies a GitHub organization installation", async () => {
    mockSuccessfulFetch({
      ...validResponse,
      account: {
        id: 54321,
        login: "test-organization",
        type: "Organization",
      },
    });

    const result = await verifyGitHubInstallation(12345);

    assert.deepEqual(result, {
      installationId: "12345",
      accountId: "54321",
      accountLogin: "test-organization",
      accountType: "organization",
    });
  });

  it("uses the correct GitHub installation endpoint", async () => {
    mockSuccessfulFetch();

    await verifyGitHubInstallation(12345);

    assert.equal(
      fetchCalls[0].url,
      "https://api.github.com/app/installations/12345"
    );

    assert.equal(fetchCalls[0].options.method, "GET");
    assert.equal(fetchCalls[0].options.cache, "no-store");

    assert.equal(
      new Headers(fetchCalls[0].options.headers).get("Accept"),
      "application/vnd.github+json"
    );

    assert.equal(
      new Headers(fetchCalls[0].options.headers).get(
        "X-GitHub-Api-Version"
      ),
      "2022-11-28"
    );
  });

  it("authenticates using a GitHub App JWT", async () => {
    mockSuccessfulFetch();

    await verifyGitHubInstallation(12345);

    const authorization = new Headers(
      fetchCalls[0].options.headers
    ).get("Authorization");

    assert.match(authorization ?? "", /^Bearer /);

    const jwt = authorization!.slice("Bearer ".length);

    assert.equal(jwt.split(".").length, 3);

    const payload = JSON.parse(
      Buffer.from(jwt.split(".")[1], "base64url").toString()
    );

    assert.equal(payload.iss, "123456");
  });

  it("rejects invalid installation IDs without making a request", async () => {
    const invalidIds = [
      0,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ];

    for (const installationId of invalidIds) {
      await assert.rejects(
        verifyGitHubInstallation(installationId),
        /valid GitHub installation ID/
      );
    }

    assert.equal(fetchCalls.length, 0);
  });

  it("rejects an installation belonging to another GitHub App", async () => {
    mockSuccessfulFetch({
      ...validResponse,
      app_id: 999999,
    });

    await assert.rejects(
      verifyGitHubInstallation(12345),
      /does not belong to the configured GitHub App/
    );
  });

  it("rejects an installation with an incorrect App slug", async () => {
    mockSuccessfulFetch({
      ...validResponse,
      app_slug: "another-github-app",
    });

    await assert.rejects(
      verifyGitHubInstallation(12345),
      /does not belong to the configured GitHub App/
    );
  });

  it("rejects a mismatched installation ID", async () => {
    mockSuccessfulFetch({
      ...validResponse,
      id: 99999,
    });

    await assert.rejects(
      verifyGitHubInstallation(12345),
      /does not belong to the configured GitHub App/
    );
  });

  it("rejects invalid account information", async () => {
    const invalidAccounts = [
      {
        id: 0,
        login: "test-user",
        type: "User",
      },
      {
        id: 98765,
        login: "",
        type: "User",
      },
      {
        id: 98765,
        login: "test-user",
        type: "Bot",
      },
    ];

    for (const account of invalidAccounts) {
      mockSuccessfulFetch({
        ...validResponse,
        account,
      });

      await assert.rejects(
        verifyGitHubInstallation(12345),
        /invalid installation account/
      );
    }
  });

  it("rejects GitHub HTTP errors without exposing response data", async () => {
    mockFetch(async () =>
      new Response("sensitive response content", {
        status: 404,
      })
    );

    await assert.rejects(
      verifyGitHubInstallation(12345),
      (error: Error) => {
        assert.match(error.message, /HTTP 404/);
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
      verifyGitHubInstallation(12345),
      /invalid installation verification response/
    );
  });

  it("rejects incomplete installation responses", async () => {
    mockSuccessfulFetch({
      id: 12345,
      app_id: 123456,
      app_slug: "codebase-chat-test",
    });

    await assert.rejects(
      verifyGitHubInstallation(12345),
      /does not belong to the configured GitHub App/
    );
  });

  it("handles network failures without exposing internal errors", async () => {
    mockFetch(async () => {
      throw new Error("internal network detail");
    });

    await assert.rejects(
      verifyGitHubInstallation(12345),
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
