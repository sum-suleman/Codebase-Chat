import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  deleteConversation,
  renameConversation,
} from "@/lib/chat/conversations";

describe("chat/conversations management", () => {
  it("rejects invalid UUIDs in renameConversation before querying", async () => {
    let called = false;
    const mockClient = {
      from: () => {
        called = true;
        throw new Error("Should not query");
      },
    } as unknown as SupabaseClient;

    await assert.rejects(
      () => renameConversation(mockClient, "not-a-uuid", "Valid Title"),
      /Invalid conversation identifier/
    );
    assert.equal(called, false);
  });

  it("rejects empty or whitespace-only titles in renameConversation", async () => {
    const validId = "11111111-1111-4111-8111-111111111111";
    const mockClient = {} as unknown as SupabaseClient;

    await assert.rejects(
      () => renameConversation(mockClient, validId, "   \n\t  "),
      /Conversation title cannot be empty/
    );
  });

  it("normalizes whitespace, caps length at 200 chars, and updates the title", async () => {
    const validId = "11111111-1111-4111-8111-111111111111";
    const captured = { payload: null as Record<string, unknown> | null };

    const mockClient = {
      from: (table: string) => {
        assert.equal(table, "conversations");
        return {
          update: (payload: Record<string, unknown>) => {
            captured.payload = payload;
            return {
              eq: (col: string, val: string) => {
                assert.equal(col, "id");
                assert.equal(val, validId);
                return {
                  select: () => ({
                    single: async () => ({
                      data: {
                        id: validId,
                        title: payload.title,
                        updated_at: "2026-11-14T14:30:00.000Z",
                      },
                      error: null,
                    }),
                  }),
                };
              },
            };
          },
        };
      },
    } as unknown as SupabaseClient;

    const longInput = `  Auth   flow   ${"x".repeat(250)}  `;
    const result = await renameConversation(mockClient, validId, longInput);

    assert.ok(captured.payload);
    assert.equal(typeof captured.payload!.title, "string");
    assert.equal((captured.payload!.title as string).length, 200);
    assert.ok((captured.payload!.title as string).startsWith("Auth flow x"));
    assert.equal(result.id, validId);
    assert.equal(result.updatedAt, "2026-11-14T14:30:00.000Z");
  });

  it("rejects invalid UUIDs in deleteConversation", async () => {
    const mockClient = {} as unknown as SupabaseClient;
    await assert.rejects(
      () => deleteConversation(mockClient, "bad-id"),
      /Invalid conversation identifier/
    );
  });
});
