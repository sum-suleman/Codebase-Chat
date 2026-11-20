import assert from "node:assert/strict";
import {
  after,
  beforeEach,
  describe,
  it,
} from "node:test";

import {
  listGitHubInstallationRepositories,
} from "@/lib/providers/github/repositories";

const originalFetch = globalThis.fetch;

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

function createRepository(id: number) {
  return {
    id,
    full_name: `owner/repository-${id}`,
    html_url: `https://github.com/owner/repository-${id}`,
    default_branch: "main",
    visibility: "private",
    archived: false,
  };
}

function createListing(
  repositories: unknown[],
  totalCount = repositories.length
): Response {
  return Response.json({
    total_count: totalCount,
    repositories,
  });
}

describe("listGitHubInstallationRepositories", () => {
  beforeEach(() => {
    fetchCalls = [];
    globalThis.fetch = originalFetch;
  });

  after(() => {
    globalThis.fetch = originalFetch;
  });

  it("retrieves and normalizes repositories from one page", async () => {
    mockFetch(async () =>
      createListing([
        createRepository(101),
        {
          ...createRepository(202),
          default_branch: null,
          visibility: "public",
          archived: true,
        },
      ])
    );

    const repositories =
      await listGitHubInstallationRepositories("ghs_test_token");

    assert.equal(repositories.length, 2);

    assert.deepEqual(repositories[0], {
      providerRepoId: "101",
      fullName: "owner/repository-101",
      canonicalUrl: "https://github.com/owner/repository-101",
      defaultBranch: "main",
      visibility: "private",
      providerArchived: false,
    });

    assert.deepEqual(repositories[1], {
      providerRepoId: "202",
      fullName: "owner/repository-202",
      canonicalUrl: "https://github.com/owner/repository-202",
      defaultBranch: null,
      visibility: "public",
      providerArchived: true,
    });

    assert.equal(fetchCalls.length, 1);
  });

  it("retrieves all repositories across multiple pages", async () => {
    const firstPage = Array.from(
      { length: 100 },
      (_, index) => createRepository(index + 1)
    );

    const secondPage = [createRepository(101)];

    mockFetch(async (url) => {
      const page = Number(new URL(url).searchParams.get("page"));

      if (page === 1) {
        return createListing(firstPage, 101);
      }

      if (page === 2) {
        return createListing(secondPage, 101);
      }

      throw new Error("Unexpected page request");
    });

    const repositories =
      await listGitHubInstallationRepositories("ghs_test_token");

    assert.equal(repositories.length, 101);
    assert.equal(repositories[0].providerRepoId, "1");
    assert.equal(repositories[100].providerRepoId, "101");
    assert.equal(fetchCalls.length, 2);

    for (const call of fetchCalls) {
      const url = new URL(call.url);

      assert.equal(
        url.pathname,
        "/installation/repositories"
      );

      assert.equal(url.searchParams.get("per_page"), "100");

      assert.equal(
        new Headers(call.options.headers).get("Authorization"),
        "Bearer ghs_test_token"
      );

      assert.equal(call.options.method, "GET");
      assert.equal(call.options.cache, "no-store");
    }
  });

  it("returns an empty array when the installation has no repositories", async () => {
    mockFetch(async () => createListing([], 0));

    const repositories =
      await listGitHubInstallationRepositories("ghs_test_token");

    assert.deepEqual(repositories, []);
    assert.equal(fetchCalls.length, 1);
  });

  it("rejects an empty installation token without making a request", async () => {
    await assert.rejects(
      listGitHubInstallationRepositories(" "),
      /valid GitHub installation token/
    );

    assert.equal(fetchCalls.length, 0);
  });

  it("rejects GitHub HTTP errors without exposing response data", async () => {
    mockFetch(async () =>
      new Response("sensitive response content", {
        status: 401,
      })
    );

    await assert.rejects(
      listGitHubInstallationRepositories("ghs_test_token"),
      (error: Error) => {
        assert.match(error.message, /HTTP 401/);
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
      listGitHubInstallationRepositories("ghs_test_token"),
      /invalid repository listing response/
    );
  });

  it("rejects incomplete listing responses", async () => {
    mockFetch(async () =>
      Response.json({
        repositories: [],
      })
    );

    await assert.rejects(
      listGitHubInstallationRepositories("ghs_test_token"),
      /incomplete repository listing response/
    );
  });

  it("rejects malformed repository records", async () => {
    mockFetch(async () =>
      createListing([
        {
          ...createRepository(101),
          html_url: "https://example.com/not-github",
        },
      ])
    );

    await assert.rejects(
      listGitHubInstallationRepositories("ghs_test_token"),
      /incomplete repository record/
    );
  });

  it("rejects an unexpected empty page before all repositories are retrieved", async () => {
    mockFetch(async (url) => {
      const page = Number(new URL(url).searchParams.get("page"));

      if (page === 1) {
        return createListing(
          Array.from(
            { length: 100 },
            (_, index) => createRepository(index + 1)
          ),
          101
        );
      }

      return createListing([], 101);
    });

    await assert.rejects(
      listGitHubInstallationRepositories("ghs_test_token"),
      /incomplete repository listing/
    );
  });

  it("handles network failures without exposing internal errors", async () => {
    mockFetch(async () => {
      throw new Error("internal network detail");
    });

    await assert.rejects(
      listGitHubInstallationRepositories("ghs_test_token"),
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
