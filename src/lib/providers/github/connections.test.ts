import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  listUserGitHubConnections,
  upsertGitHubInstallationConnection,
} from "@/lib/providers/github/connections";
import type { VerifiedGitHubInstallation } from "@/lib/providers/github/verify-installation";
import { createAdminClient } from "@/lib/supabase/admin";

const TEST_OWNER_ID = "550e8400-e29b-41d4-a716-446655440000";
const TEST_CONNECTION_ID = "660e8400-e29b-41d4-a716-446655440000";

const validInstallation: VerifiedGitHubInstallation = {
  installationId: "987654321",
  accountId: "123456",
  accountLogin: "octocat",
  accountType: "user",
};

interface RecordedUpsertCall {
  table: string;
  values: Record<string, unknown>;
  options: { onConflict?: string } | undefined;
  selectColumns: string;
}

function createMockAdminClient(options: {
  result?: { data: unknown; error: unknown };
  recorded?: RecordedUpsertCall[];
}): SupabaseClient {
  const recorded = options.recorded ?? [];
  const result = options.result ?? {
    data: {
      id: TEST_CONNECTION_ID,
      owner_id: TEST_OWNER_ID,
      provider: "github",
      external_account_id: validInstallation.accountId,
      account_login: validInstallation.accountLogin,
      account_type: validInstallation.accountType,
      installation_id: validInstallation.installationId,
      status: "active",
    },
    error: null,
  };

  const client = {
    from(table: string) {
      return {
        upsert(
          values: Record<string, unknown>,
          upsertOptions?: { onConflict?: string }
        ) {
          return {
            select(selectColumns: string) {
              return {
                async single() {
                  recorded.push({
                    table,
                    values,
                    options: upsertOptions,
                    selectColumns,
                  });
                  return result;
                },
              };
            },
          };
        },
      };
    },
  };

  return client as unknown as SupabaseClient;
}

describe("createAdminClient", () => {
  const originalEnv = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    serviceRole: process.env.SUPABASE_SERVICE_ROLE_KEY,
    publishable: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-secret-key";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
      "test-publishable-key";
  });

  afterEach(() => {
    if (originalEnv.url === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = originalEnv.url;
    }

    if (originalEnv.serviceRole === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = originalEnv.serviceRole;
    }

    if (originalEnv.publishable === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
        originalEnv.publishable;
    }
  });

  it("creates a Supabase client when valid admin environment variables are configured", () => {
    const client = createAdminClient();
    assert.equal(typeof client.from, "function");
  });

  it("throws when required Supabase admin environment variables are missing", () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    assert.throws(
      () => createAdminClient(),
      /Missing required Supabase admin environment variables/
    );

    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-secret-key";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    assert.throws(
      () => createAdminClient(),
      /Missing required Supabase admin environment variables/
    );
  });

  it("rejects invalid Supabase URLs", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "not-a-valid-url";
    assert.throws(
      () => createAdminClient(),
      /NEXT_PUBLIC_SUPABASE_URL is invalid/
    );

    process.env.NEXT_PUBLIC_SUPABASE_URL = "ftp://example.com";
    assert.throws(
      () => createAdminClient(),
      /must use HTTP or HTTPS/
    );
  });

  it("rejects when SUPABASE_SERVICE_ROLE_KEY matches NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "shared-key";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "shared-key";

    assert.throws(
      () => createAdminClient(),
      /must not match NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/
    );
  });
});

describe("upsertGitHubInstallationConnection", () => {
  it("upserts a verified personal GitHub installation with expected conflict key and no credentials", async () => {
    const recorded: RecordedUpsertCall[] = [];
    const mockClient = createMockAdminClient({ recorded });

    const persisted = await upsertGitHubInstallationConnection(
      TEST_OWNER_ID,
      validInstallation,
      mockClient
    );

    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].table, "provider_connections");
    assert.deepEqual(recorded[0].options, {
      onConflict: "owner_id,provider,external_account_id",
    });
    assert.deepEqual(recorded[0].values, {
      owner_id: TEST_OWNER_ID,
      provider: "github",
      external_account_id: "123456",
      account_login: "octocat",
      account_type: "user",
      installation_id: "987654321",
      status: "active",
    });
    assert.equal("access_token" in recorded[0].values, false);
    assert.equal("credential_ciphertext" in recorded[0].values, false);

    assert.deepEqual(persisted, {
      id: TEST_CONNECTION_ID,
      ownerId: TEST_OWNER_ID,
      provider: "github",
      externalAccountId: "123456",
      accountLogin: "octocat",
      accountType: "user",
      installationId: "987654321",
      status: "active",
    });
  });

  it("upserts an organization installation and normalizes numeric BIGINT responses", async () => {
    const orgInstallation: VerifiedGitHubInstallation = {
      installationId: "42424242",
      accountId: "777888",
      accountLogin: "acme-corp",
      accountType: "organization",
    };

    const mockClient = createMockAdminClient({
      result: {
        data: {
          id: TEST_CONNECTION_ID,
          owner_id: TEST_OWNER_ID,
          provider: "github",
          external_account_id: "777888",
          account_login: "acme-corp",
          account_type: "organization",
          installation_id: 42424242,
          status: "active",
        },
        error: null,
      },
    });

    const persisted = await upsertGitHubInstallationConnection(
      TEST_OWNER_ID,
      orgInstallation,
      mockClient
    );

    assert.equal(persisted.accountType, "organization");
    assert.equal(persisted.installationId, "42424242");
  });

  it("rejects non-UUID owner IDs before issuing database queries", async () => {
    const recorded: RecordedUpsertCall[] = [];
    const mockClient = createMockAdminClient({ recorded });

    for (const badOwnerId of ["", "not-a-uuid", "12345"]) {
      await assert.rejects(
        upsertGitHubInstallationConnection(
          badOwnerId,
          validInstallation,
          mockClient
        ),
        /valid authenticated owner ID/
      );
    }

    assert.equal(recorded.length, 0);
  });

  it("rejects invalid verified installation payloads before issuing database queries", async () => {
    const recorded: RecordedUpsertCall[] = [];
    const mockClient = createMockAdminClient({ recorded });

    const invalidInstallations: VerifiedGitHubInstallation[] = [
      { ...validInstallation, installationId: "0" },
      { ...validInstallation, installationId: "-12" },
      { ...validInstallation, accountId: "0" },
      { ...validInstallation, accountLogin: "" },
      {
        ...validInstallation,
        accountType: "bot" as "user",
      },
    ];

    for (const badInstallation of invalidInstallations) {
      await assert.rejects(
        upsertGitHubInstallationConnection(
          TEST_OWNER_ID,
          badInstallation,
          mockClient
        ),
        /valid verified GitHub installation/
      );
    }

    assert.equal(recorded.length, 0);
  });

  it("sanitizes database errors without leaking internal details", async () => {
    const mockClient = createMockAdminClient({
      result: {
        data: null,
        error: { message: "duplicate key value violates internal constraint detail" },
      },
    });

    await assert.rejects(
      upsertGitHubInstallationConnection(
        TEST_OWNER_ID,
        validInstallation,
        mockClient
      ),
      (error: Error) => {
        assert.match(error.message, /Unable to persist the GitHub provider connection/);
        assert.doesNotMatch(error.message, /internal constraint detail/);
        return true;
      }
    );
  });

  it("rejects unexpected returned row metadata", async () => {
    const mockClient = createMockAdminClient({
      result: {
        data: {
          id: TEST_CONNECTION_ID,
          owner_id: "11111111-1111-1111-1111-111111111111",
          provider: "github",
          external_account_id: validInstallation.accountId,
          account_login: validInstallation.accountLogin,
          account_type: validInstallation.accountType,
          installation_id: validInstallation.installationId,
          status: "active",
        },
        error: null,
      },
    });

    await assert.rejects(
      upsertGitHubInstallationConnection(
        TEST_OWNER_ID,
        validInstallation,
        mockClient
      ),
      /unexpected metadata/
    );
  });
});

function createMockUserSelectClient(result: {
  data: unknown;
  error: unknown;
}): SupabaseClient {
  const client = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                async order() {
                  return result;
                },
              };
            },
          };
        },
      };
    },
  };

  return client as unknown as SupabaseClient;
}

describe("listUserGitHubConnections", () => {
  it("returns normalized personal and organization GitHub connections", async () => {
    const mockClient = createMockUserSelectClient({
      data: [
        {
          id: TEST_CONNECTION_ID,
          external_account_id: "123456",
          account_login: "octocat",
          account_type: "user",
          installation_id: 987654321,
          status: "active",
          updated_at: "2026-11-13T15:00:00Z",
        },
        {
          id: "770e8400-e29b-41d4-a716-446655440000",
          external_account_id: "777888",
          account_login: "acme-corp",
          account_type: "organization",
          installation_id: null,
          status: "revoked",
          updated_at: "2026-11-13T15:10:00Z",
        },
      ],
      error: null,
    });

    const connections = await listUserGitHubConnections(mockClient);

    assert.deepEqual(connections, [
      {
        id: TEST_CONNECTION_ID,
        externalAccountId: "123456",
        accountLogin: "octocat",
        accountType: "user",
        installationId: "987654321",
        status: "active",
        updatedAt: "2026-11-13T15:00:00Z",
      },
      {
        id: "770e8400-e29b-41d4-a716-446655440000",
        externalAccountId: "777888",
        accountLogin: "acme-corp",
        accountType: "organization",
        installationId: null,
        status: "revoked",
        updatedAt: "2026-11-13T15:10:00Z",
      },
    ]);
  });

  it("skips malformed rows without crashing", async () => {
    const mockClient = createMockUserSelectClient({
      data: [
        {
          id: 123,
          external_account_id: "bad",
          account_login: "bad",
          account_type: "user",
          installation_id: "1",
          status: "active",
          updated_at: "2026-11-13T15:00:00Z",
        },
        {
          id: TEST_CONNECTION_ID,
          external_account_id: "123456",
          account_login: "octocat",
          account_type: "user",
          installation_id: "555",
          status: "active",
          updated_at: "2026-11-13T15:00:00Z",
        },
      ],
      error: null,
    });

    const connections = await listUserGitHubConnections(mockClient);
    assert.equal(connections.length, 1);
    assert.equal(connections[0].accountLogin, "octocat");
  });

  it("throws a sanitized error when the database query fails", async () => {
    const mockClient = createMockUserSelectClient({
      data: null,
      error: { message: "RLS internal policy error detail" },
    });

    await assert.rejects(listUserGitHubConnections(mockClient), (err: Error) => {
      assert.match(err.message, /Unable to load GitHub provider connections/);
      assert.doesNotMatch(err.message, /RLS internal policy error detail/);
      return true;
    });
  });
});
