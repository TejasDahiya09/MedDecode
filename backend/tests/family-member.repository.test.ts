import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { UserSupabaseClient } from "../src/config/supabase-user.js";
import {
  FAMILY_MEMBER_FIELDS,
  FamilyMemberRepositoryError,
  supabaseFamilyMemberRepository
} from "../src/repositories/family-member.repository.js";
import type { FamilyMemberRow } from "../src/types/family-members.js";

const userId = "00000000-0000-4000-8000-000000000001";
const memberId = "60000000-0000-4000-8000-000000000001";
const row: FamilyMemberRow = {
  id: memberId,
  user_id: userId,
  name: "Synthetic Member",
  relationship: "parent",
  created_at: "2026-11-11T10:00:00.000Z",
  updated_at: "2026-11-11T10:00:00.000Z"
};

function queryClient(data: unknown, error: unknown = null) {
  const calls: Array<{ operation: string; value?: unknown }> = [];
  const result = { data, error };
  const query = {
    select(value: string) { calls.push({ operation: "select", value }); return query; },
    insert(value: unknown) { calls.push({ operation: "insert", value }); return query; },
    update(value: unknown) { calls.push({ operation: "update", value }); return query; },
    delete() { calls.push({ operation: "delete" }); return query; },
    eq(column: string, value: unknown) {
      calls.push({ operation: `eq:${column}`, value }); return query;
    },
    order(column: string, value: unknown) {
      calls.push({ operation: `order:${column}`, value }); return query;
    },
    range(from: number, to: number) {
      calls.push({ operation: "range", value: { from, to } });
      return Promise.resolve(result);
    },
    async single() { calls.push({ operation: "single" }); return result; },
    async maybeSingle() { calls.push({ operation: "maybeSingle" }); return result; }
  };
  const client = {
    from(table: string) { calls.push({ operation: "from", value: table }); return query; }
  } as unknown as UserSupabaseClient;
  return { client, calls };
}

describe("Family member repository", () => {
  it("lists with explicit projection, owner scope and stable pagination", async () => {
    const { client, calls } = queryClient([row]);
    assert.deepEqual(await supabaseFamilyMemberRepository.listOwned(
      client, userId, { limit: 20, offset: 40 }
    ), [row]);
    assert.deepEqual(calls, [
      { operation: "from", value: "family_members" },
      { operation: "select", value: FAMILY_MEMBER_FIELDS },
      { operation: "eq:user_id", value: userId },
      { operation: "order:created_at", value: { ascending: false } },
      { operation: "order:id", value: { ascending: false } },
      { operation: "range", value: { from: 40, to: 60 } }
    ]);
    assert.equal(FAMILY_MEMBER_FIELDS.includes("*"), false);
  });

  it("scopes detail, update and delete by both ID and verified owner", async () => {
    for (const [operation, execute] of [
      ["detail", (client: UserSupabaseClient) =>
        supabaseFamilyMemberRepository.findOwned(client, userId, memberId)],
      ["update", (client: UserSupabaseClient) =>
        supabaseFamilyMemberRepository.updateOwned(
          client, userId, memberId, { relationship: null }
        )],
      ["delete", (client: UserSupabaseClient) =>
        supabaseFamilyMemberRepository.deleteOwned(client, userId, memberId)]
    ] as const) {
      const { client, calls } = queryClient(row);
      assert.deepEqual(await execute(client), row, operation);
      assert.equal(calls.some((call) =>
        call.operation === "eq:id" && call.value === memberId), true);
      assert.equal(calls.some((call) =>
        call.operation === "eq:user_id" && call.value === userId), true);
    }
  });

  it("assigns create ownership exclusively from the verified identity", async () => {
    const { client, calls } = queryClient(row);
    await supabaseFamilyMemberRepository.createOwned(client, userId, {
      name: "Synthetic Member",
      relationship: null
    });
    assert.deepEqual(calls.find(({ operation }) => operation === "insert")?.value, {
      user_id: userId,
      name: "Synthetic Member",
      relationship: null
    });
  });

  it("constructs exact mutation allowlists and drops unexpected runtime properties", async () => {
    const createQuery = queryClient(row);
    await supabaseFamilyMemberRepository.createOwned(
      createQuery.client,
      userId,
      {
        name: "Synthetic Member",
        relationship: null,
        user_id: "attacker-controlled",
        id: "attacker-controlled",
        unexpected: true
      } as never
    );
    assert.deepEqual(
      createQuery.calls.find(({ operation }) => operation === "insert")?.value,
      { user_id: userId, name: "Synthetic Member", relationship: null }
    );

    const updateQuery = queryClient(row);
    await supabaseFamilyMemberRepository.updateOwned(
      updateQuery.client,
      userId,
      memberId,
      {
        relationship: "guardian",
        user_id: "attacker-controlled",
        updated_at: "attacker-controlled",
        unexpected: true
      } as never
    );
    assert.deepEqual(
      updateQuery.calls.find(({ operation }) => operation === "update")?.value,
      { relationship: "guardian" }
    );
  });

  it("rejects malformed direct mutation input before a provider mutation", async () => {
    for (const input of [
      { name: " untrimmed ", relationship: null },
      { name: "X".repeat(101), relationship: null }
    ]) {
      const current = queryClient(row);
      await assert.rejects(
        supabaseFamilyMemberRepository.createOwned(
          current.client,
          userId,
          input
        ),
        (error: unknown) => error instanceof FamilyMemberRepositoryError &&
          error.code === "QUERY_FAILED"
      );
      assert.equal(current.calls.some(({ operation }) => operation === "insert"), false);
    }

    for (const input of [
      {},
      { name: " untrimmed " },
      { relationship: "" }
    ]) {
      const current = queryClient(row);
      await assert.rejects(
        supabaseFamilyMemberRepository.updateOwned(
          current.client,
          userId,
          memberId,
          input
        ),
        (error: unknown) => error instanceof FamilyMemberRepositoryError &&
          error.code === "QUERY_FAILED"
      );
      assert.equal(current.calls.some(({ operation }) => operation === "update"), false);
    }
  });

  it("returns null for missing owner-scoped detail, update and delete", async () => {
    for (const execute of [
      (client: UserSupabaseClient) =>
        supabaseFamilyMemberRepository.findOwned(client, userId, memberId),
      (client: UserSupabaseClient) =>
        supabaseFamilyMemberRepository.updateOwned(client, userId, memberId, { name: "X" }),
      (client: UserSupabaseClient) =>
        supabaseFamilyMemberRepository.deleteOwned(client, userId, memberId)
    ]) {
      assert.equal(await execute(queryClient(null).client), null);
    }
  });

  it("maps FK errors safely and redacts other provider failures", async () => {
    await assert.rejects(
      supabaseFamilyMemberRepository.createOwned(
        queryClient(null, { code: "23503", detail: "private" }).client,
        userId,
        { name: "Synthetic", relationship: null }
      ),
      (error: unknown) => error instanceof FamilyMemberRepositoryError &&
        error.code === "MISSING_APPLICATION_PROFILE" &&
        !error.message.includes("private")
    );
    const thrown = ({
      from() { throw new Error("private provider diagnostic"); }
    }) as unknown as UserSupabaseClient;
    await assert.rejects(
      supabaseFamilyMemberRepository.deleteOwned(thrown, userId, memberId),
      (error: unknown) => error instanceof FamilyMemberRepositoryError &&
        error.code === "QUERY_FAILED" &&
        !error.message.includes("private")
    );

    await assert.rejects(
      supabaseFamilyMemberRepository.updateOwned(
        queryClient(null, { code: "42501", message: "private RLS diagnostic" }).client,
        userId,
        memberId,
        { name: "Synthetic Member" }
      ),
      (error: unknown) => error instanceof FamilyMemberRepositoryError &&
        error.code === "QUERY_FAILED" &&
        !error.message.includes("private")
    );
  });

  it("does not retry an ambiguous provider failure", async () => {
    const current = queryClient(null, { code: "NETWORK_ERROR", detail: "private" });
    await assert.rejects(
      supabaseFamilyMemberRepository.updateOwned(
        current.client,
        userId,
        memberId,
        { name: "Synthetic Member" }
      ),
      (error: unknown) => error instanceof FamilyMemberRepositoryError &&
        error.code === "QUERY_FAILED"
    );
    assert.equal(
      current.calls.filter(({ operation }) => operation === "update").length,
      1
    );
  });

  it("never accesses medicine or medicine_cabinet tables", async () => {
    const { client, calls } = queryClient([row]);
    await supabaseFamilyMemberRepository.listOwned(client, userId, { limit: 20, offset: 0 });
    assert.deepEqual(calls.filter(({ operation }) => operation === "from"), [
      { operation: "from", value: "family_members" }
    ]);
  });
});
