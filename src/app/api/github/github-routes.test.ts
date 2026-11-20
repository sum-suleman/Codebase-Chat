import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import Module from "node:module";
import {
  after,
  before,
  beforeEach,
  describe,
  it,
} from "node:test";

import { NextRequest } from "next/server";

import { createGitHubInstallationState } from "@/lib/providers/github/state";

const TEST_USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const OTHER_USER_ID = "11111111-1111-1111-1111-111111111111";
const TEST_CONNECTION_ID = "660e8400-e29b-41d4-a716-446655440000";
const TEST_ORG_CONNECTION_ID = "770e8400-e29b-41d4-a716-446655440000";
const TEST_STATE_SECRET = "0123456789abcdef0123456789abcdef";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

let currentUser: { id: string } | null = { id: TEST_USER_ID };
let authError: Error | null = null;
let dbUpsertResult: { data: unknown; error: unknown } = {
  data: null,
  error: null,
};
let providerConnectionsQueryResult: { data: unknown; error: unknown } = {
  data: [],
  error: null,
};
let repositoriesQueryResult: { data: unknown; error: unknown } = {
  data: [],
  error: null,
};
let recordedDbUpserts: Array<{
  table: string;
  values: Record<string, unknown>;
  options?: { onConflict?: string };
}> = [];

type InstallRouteModule = typeof import("@/app/api/github/install/route");
type CallbackRouteModule = typeof import("@/app/api/github/callback/route");
type RepositoriesRouteModule = typeof import("@/app/api/github/repositories/route");

let installGET: InstallRouteModule["GET"];
let callbackGET: CallbackRouteModule["GET"];
let repositoriesGET: RepositoriesRouteModule["GET"];
let cookieName: string;
let cookiePath: string;

const originalFetch = globalThis.fetch;
const originalEnv = {
  SITE_URL: process.env.SITE_URL,
  GITHUB_APP_ID: process.env.GITHUB_APP_ID,
  GITHUB_APP_SLUG: process.env.GITHUB_APP_SLUG,
  GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY,
  GITHUB_INSTALLATION_STATE_SECRET:
    process.env.GITHUB_INSTALLATION_STATE_SECRET,
};

type ModuleLoadFn = (
  request: string,
  parent: unknown,
  isMain: boolean
) => unknown;

const moduleWithLoad = Module as unknown as { _load: ModuleLoadFn };
const originalModuleLoad = moduleWithLoad._load;

before(async () => {
  process.env.SITE_URL = "http://localhost:3000";
  process.env.GITHUB_APP_ID = "123456";
  process.env.GITHUB_APP_SLUG = "codebase-chat-test";
  process.env.GITHUB_APP_PRIVATE_KEY = privateKey;
  process.env.GITHUB_INSTALLATION_STATE_SECRET = TEST_STATE_SECRET;

  moduleWithLoad._load = function (
    request: string,
    parent: unknown,
    isMain: boolean
  ) {
    if (request === "@/lib/supabase/server") {
      return {
        async createClient() {
          return {
            auth: {
              async getUser() {
                return {
                  data: { user: currentUser },
                  error: authError,
                };
              },
            },
            from(table: string) {
              if (table === "provider_connections") {
                return {
                  select() {
                    return {
                      eq() {
                        return {
                          async order() {
                            return providerConnectionsQueryResult;
                          },
                        };
                      },
                    };
                  },
                };
              }

              if (table === "repositories") {
                return {
                  select() {
                    return {
                      eq() {
                        return {
                          async is() {
                            return repositoriesQueryResult;
                          },
                        };
                      },
                    };
                  },
                };
              }

              throw new Error(`Unexpected user table query: ${table}`);
            },
          };
        },
      };
    }

    if (request === "@/lib/supabase/admin") {
      return {
        createAdminClient() {
          return {
            from(table: string) {
              return {
                upsert(
                  values: Record<string, unknown>,
                  options?: { onConflict?: string }
                ) {
                  return {
                    select() {
                      return {
                        async single() {
                          recordedDbUpserts.push({ table, values, options });
                          return dbUpsertResult;
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    }

    return originalModuleLoad.call(this, request, parent, isMain);
  };

  const installModule = await import("@/app/api/github/install/route");
  const callbackModule = await import("@/app/api/github/callback/route");
  const repositoriesModule = await import(
    "@/app/api/github/repositories/route"
  );

  installGET = installModule.GET;
  cookieName = installModule.GITHUB_INSTALLATION_STATE_COOKIE;
  cookiePath = installModule.GITHUB_INSTALLATION_COOKIE_PATH;
  callbackGET = callbackModule.GET;
  repositoriesGET = repositoriesModule.GET;
});

after(() => {
  globalThis.fetch = originalFetch;
  moduleWithLoad._load = originalModuleLoad;

  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

beforeEach(() => {
  process.env.SITE_URL = "http://localhost:3000";
  process.env.GITHUB_APP_ID = "123456";
  process.env.GITHUB_APP_SLUG = "codebase-chat-test";
  process.env.GITHUB_APP_PRIVATE_KEY = privateKey;
  process.env.GITHUB_INSTALLATION_STATE_SECRET = TEST_STATE_SECRET;

  currentUser = { id: TEST_USER_ID };
  authError = null;
  recordedDbUpserts = [];
  providerConnectionsQueryResult = { data: [], error: null };
  repositoriesQueryResult = { data: [], error: null };
  dbUpsertResult = {
    data: {
      id: TEST_CONNECTION_ID,
      owner_id: TEST_USER_ID,
      provider: "github",
      external_account_id: "98765",
      account_login: "octocat",
      account_type: "user",
      installation_id: "54321",
      status: "active",
    },
    error: null,
  };

  globalThis.fetch = async () =>
    Response.json({
      id: 54321,
      app_id: 123456,
      app_slug: "codebase-chat-test",
      account: {
        id: 98765,
        login: "octocat",
        type: "User",
      },
    });
});

function buildCallbackRequest(
  query: Record<string, string>,
  cookieValue?: string
): NextRequest {
  const url = new URL("http://localhost:3000/api/github/callback");
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }

  const headers = new Headers();
  if (cookieValue !== undefined) {
    headers.set("cookie", `${cookieName}=${cookieValue}`);
  }

  return new NextRequest(url, { headers });
}

function assertStateCookieCleared(response: Response): void {
  const setCookie = response.headers.get("set-cookie") ?? "";
  assert.match(setCookie, new RegExp(`${cookieName}=;`));
  assert.match(setCookie, /Max-Age=0/);
  assert.match(setCookie, new RegExp(`Path=${cookiePath}`));
  assert.equal(response.headers.get("cache-control"), "no-store");
}

describe("GET /api/github/install", () => {
  it("redirects unauthenticated users to /login without setting a state cookie", async () => {
    currentUser = null;

    const response = await installGET();

    assert.equal(response.status, 302);
    assert.equal(
      response.headers.get("location"),
      "http://localhost:3000/login"
    );
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });

  it("redirects authenticated users to GitHub App installation URL and sets HttpOnly state cookie", async () => {
    const response = await installGET();

    assert.equal(response.status, 302);
    assert.equal(response.headers.get("cache-control"), "no-store");

    const location = new URL(response.headers.get("location")!);
    assert.equal(location.origin, "https://github.com");
    assert.equal(
      location.pathname,
      "/apps/codebase-chat-test/installations/new"
    );

    const stateParam = location.searchParams.get("state");
    assert.ok(stateParam && stateParam.length > 0);

    const setCookie = response.headers.get("set-cookie") ?? "";
    assert.match(setCookie, new RegExp(`${cookieName}=[^;]+`));
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.match(setCookie, new RegExp(`Path=${cookiePath}`));
    assert.match(setCookie, /Max-Age=600/);
  });

  it("redirects safely to /settings when GitHub App configuration is missing", async () => {
    delete process.env.GITHUB_APP_SLUG;

    const response = await installGET();

    assert.equal(response.status, 302);
    assert.equal(
      response.headers.get("location"),
      "http://localhost:3000/settings?github_error=unavailable"
    );
    assert.equal(response.headers.get("set-cookie"), null);
  });
});

describe("GET /api/github/callback", () => {
  it("redirects unauthenticated users to /login and clears any state cookie", async () => {
    currentUser = null;
    const generated = createGitHubInstallationState(TEST_USER_ID);

    const request = buildCallbackRequest(
      {
        installation_id: "54321",
        setup_action: "install",
        state: generated.state,
      },
      generated.cookieValue
    );

    const response = await callbackGET(request);

    assert.equal(response.status, 302);
    assert.equal(
      response.headers.get("location"),
      "http://localhost:3000/login"
    );
    assertStateCookieCleared(response);
    assert.equal(recordedDbUpserts.length, 0);
  });

  it("rejects missing, mismatched, expired, or wrong-user state and clears state cookie", async () => {
    const generated = createGitHubInstallationState(TEST_USER_ID);
    const expired = createGitHubInstallationState(
      TEST_USER_ID,
      Date.now() - 15 * 60 * 1000
    );
    const otherUserState = createGitHubInstallationState(OTHER_USER_ID);

    const badCases: Array<{
      query: Record<string, string>;
      cookie?: string;
    }> = [
      {
        query: { installation_id: "54321", state: generated.state },
      },
      {
        query: { installation_id: "54321", state: "wrong-state" },
        cookie: generated.cookieValue,
      },
      {
        query: { installation_id: "54321", state: expired.state },
        cookie: expired.cookieValue,
      },
      {
        query: { installation_id: "54321", state: otherUserState.state },
        cookie: otherUserState.cookieValue,
      },
    ];

    for (const testCase of badCases) {
      const response = await callbackGET(
        buildCallbackRequest(testCase.query, testCase.cookie)
      );

      assert.equal(response.status, 302);
      assert.equal(
        response.headers.get("location"),
        "http://localhost:3000/settings?github_error=invalid_state"
      );
      assertStateCookieCleared(response);
    }

    assert.equal(recordedDbUpserts.length, 0);
  });

  it("rejects invalid installation IDs and unexpected setup actions", async () => {
    const generated = createGitHubInstallationState(TEST_USER_ID);

    const badActionResponse = await callbackGET(
      buildCallbackRequest(
        {
          installation_id: "54321",
          setup_action: "evil_action",
          state: generated.state,
        },
        generated.cookieValue
      )
    );
    assert.equal(
      badActionResponse.headers.get("location"),
      "http://localhost:3000/settings?github_error=invalid_request"
    );
    assertStateCookieCleared(badActionResponse);

    for (const badId of ["", "0", "-5", "abc", "54321;DROP"]) {
      const response = await callbackGET(
        buildCallbackRequest(
          {
            installation_id: badId,
            setup_action: "install",
            state: generated.state,
          },
          generated.cookieValue
        )
      );
      assert.equal(
        response.headers.get("location"),
        "http://localhost:3000/settings?github_error=invalid_installation"
      );
      assertStateCookieCleared(response);
    }

    assert.equal(recordedDbUpserts.length, 0);
  });

  it("rejects installations belonging to another GitHub App", async () => {
    globalThis.fetch = async () =>
      Response.json({
        id: 54321,
        app_id: 999999,
        app_slug: "another-app",
        account: {
          id: 98765,
          login: "octocat",
          type: "User",
        },
      });

    const generated = createGitHubInstallationState(TEST_USER_ID);
    const response = await callbackGET(
      buildCallbackRequest(
        {
          installation_id: "54321",
          setup_action: "install",
          state: generated.state,
        },
        generated.cookieValue
      )
    );

    assert.equal(
      response.headers.get("location"),
      "http://localhost:3000/settings?github_error=verification_failed"
    );
    assertStateCookieCleared(response);
    assert.equal(recordedDbUpserts.length, 0);
  });

  it("handles database persistence failures gracefully", async () => {
    dbUpsertResult = {
      data: null,
      error: { message: "database connection failed" },
    };

    const generated = createGitHubInstallationState(TEST_USER_ID);
    const response = await callbackGET(
      buildCallbackRequest(
        {
          installation_id: "54321",
          setup_action: "install",
          state: generated.state,
        },
        generated.cookieValue
      )
    );

    assert.equal(
      response.headers.get("location"),
      "http://localhost:3000/settings?github_error=connection_failed"
    );
    assertStateCookieCleared(response);
  });

  it("persists verified installation and redirects to /settings?github=connected on install", async () => {
    const generated = createGitHubInstallationState(TEST_USER_ID);
    const response = await callbackGET(
      buildCallbackRequest(
        {
          installation_id: "54321",
          setup_action: "install",
          state: generated.state,
        },
        generated.cookieValue
      )
    );

    assert.equal(response.status, 302);
    assert.equal(
      response.headers.get("location"),
      "http://localhost:3000/settings?github=connected"
    );
    assertStateCookieCleared(response);

    assert.equal(recordedDbUpserts.length, 1);
    assert.equal(recordedDbUpserts[0].table, "provider_connections");
    assert.deepEqual(recordedDbUpserts[0].values, {
      owner_id: TEST_USER_ID,
      provider: "github",
      external_account_id: "98765",
      account_login: "octocat",
      account_type: "user",
      installation_id: "54321",
      status: "active",
    });
  });

  it("redirects to /settings?github=updated when setup_action=update", async () => {
    const generated = createGitHubInstallationState(TEST_USER_ID);
    const response = await callbackGET(
      buildCallbackRequest(
        {
          installation_id: "54321",
          setup_action: "update",
          state: generated.state,
        },
        generated.cookieValue
      )
    );

    assert.equal(response.status, 302);
    assert.equal(
      response.headers.get("location"),
      "http://localhost:3000/settings?github=updated"
    );
    assertStateCookieCleared(response);
    assert.equal(recordedDbUpserts.length, 1);
  });
});

describe("GET /api/github/repositories", () => {
  it("returns 401 with no-store cache header when unauthenticated", async () => {
    currentUser = null;

    const response = await repositoriesGET();
    const body = (await response.json()) as { error?: string };

    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(body.error, "Authentication required.");
  });

  it("returns empty repository list when user has no active GitHub connections", async () => {
    providerConnectionsQueryResult = {
      data: [
        {
          id: TEST_CONNECTION_ID,
          external_account_id: "98765",
          account_login: "octocat",
          account_type: "user",
          installation_id: "54321",
          status: "revoked",
          updated_at: "2026-11-13T15:00:00Z",
        },
      ],
      error: null,
    };
    repositoriesQueryResult = {
      data: [{ provider_repo_id: "1001" }],
      error: null,
    };

    const response = await repositoriesGET();
    const body = (await response.json()) as {
      repositories: unknown[];
      activeCount: number;
      maxRepositories: number;
      hasActiveConnection: boolean;
    };

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(body, {
      repositories: [],
      activeCount: 1,
      maxRepositories: 5,
      hasActiveConnection: false,
    });
  });

  it("lists, sorts, and tags repositories across active personal and organization connections without leaking tokens", async () => {
    providerConnectionsQueryResult = {
      data: [
        {
          id: TEST_CONNECTION_ID,
          external_account_id: "98765",
          account_login: "octocat",
          account_type: "user",
          installation_id: 54321,
          status: "active",
          updated_at: "2026-11-13T15:00:00Z",
        },
        {
          id: TEST_ORG_CONNECTION_ID,
          external_account_id: "77788",
          account_login: "acme-corp",
          account_type: "organization",
          installation_id: 99887,
          status: "active",
          updated_at: "2026-11-13T15:05:00Z",
        },
      ],
      error: null,
    };
    repositoriesQueryResult = {
      data: [{ provider_repo_id: "1001" }],
      error: null,
    };

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url.endsWith("/app/installations/54321/access_tokens")) {
        return Response.json(
          {
            token: "ghs_secret_personal_token",
            expires_at: "2026-11-13T16:00:00Z",
            repository_selection: "selected",
            permissions: { contents: "read", metadata: "read" },
          },
          { status: 201 }
        );
      }

      if (url.endsWith("/app/installations/99887/access_tokens")) {
        return Response.json(
          {
            token: "ghs_secret_org_token",
            expires_at: "2026-11-13T16:00:00Z",
            repository_selection: "all",
            permissions: { contents: "read", metadata: "read" },
          },
          { status: 201 }
        );
      }

      if (url.includes("/installation/repositories")) {
        const authHeader = new Headers(init?.headers).get("Authorization");
        if (authHeader === "Bearer ghs_secret_personal_token") {
          return Response.json({
            total_count: 1,
            repositories: [
              {
                id: 1001,
                full_name: "octocat/zeta-service",
                html_url: "https://github.com/octocat/zeta-service",
                default_branch: "main",
                visibility: "private",
                archived: false,
              },
            ],
          });
        }

        if (authHeader === "Bearer ghs_secret_org_token") {
          return Response.json({
            total_count: 1,
            repositories: [
              {
                id: 2002,
                full_name: "acme-corp/alpha-api",
                html_url: "https://github.com/acme-corp/alpha-api",
                default_branch: "develop",
                visibility: "internal",
                archived: false,
              },
            ],
          });
        }
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    }) as typeof fetch;

    const response = await repositoriesGET();
    const rawText = await response.text();
    const body = JSON.parse(rawText) as {
      repositories: Array<{
        providerRepoId: string;
        fullName: string;
        connectionId: string;
        accountLogin: string;
        alreadyConnected: boolean;
      }>;
      activeCount: number;
      maxRepositories: number;
      hasActiveConnection: boolean;
    };

    assert.equal(response.status, 200);
    assert.equal(rawText.includes("ghs_secret_personal_token"), false);
    assert.equal(rawText.includes("ghs_secret_org_token"), false);
    assert.equal(body.activeCount, 1);
    assert.equal(body.maxRepositories, 5);
    assert.equal(body.hasActiveConnection, true);
    assert.equal(body.repositories.length, 2);
    assert.equal(body.repositories[0].fullName, "acme-corp/alpha-api");
    assert.equal(body.repositories[0].connectionId, TEST_ORG_CONNECTION_ID);
    assert.equal(body.repositories[0].alreadyConnected, false);
    assert.equal(body.repositories[1].fullName, "octocat/zeta-service");
    assert.equal(body.repositories[1].connectionId, TEST_CONNECTION_ID);
    assert.equal(body.repositories[1].alreadyConnected, true);
  });

  it("returns 502 with a sanitized message when GitHub API calls fail", async () => {
    providerConnectionsQueryResult = {
      data: [
        {
          id: TEST_CONNECTION_ID,
          external_account_id: "98765",
          account_login: "octocat",
          account_type: "user",
          installation_id: 54321,
          status: "active",
          updated_at: "2026-11-13T15:00:00Z",
        },
      ],
      error: null,
    };

    globalThis.fetch = async () =>
      new Response("Internal GitHub secret error stack", { status: 500 });

    const response = await repositoriesGET();
    const body = (await response.json()) as { error?: string };

    assert.equal(response.status, 502);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(body.error ?? "", /Unable to fetch repositories from GitHub/);
    assert.doesNotMatch(body.error ?? "", /secret error stack/);
  });
});
