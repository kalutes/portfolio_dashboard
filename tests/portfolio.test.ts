import test from "node:test";
import assert from "node:assert/strict";
import type { Account } from "snaptrade-typescript-sdk";
import { loadPortfolio, safeError, type ReadClient } from "../lib/portfolio";
const account = (id: string): Account => ({
  id,
  brokerage_authorization: "connection",
  name: id,
  number: "123456",
  institution_name: "Example",
  created_date: "",
  sync_status: {},
  balance: {},
  is_paper: false,
});
// Fixtures are test-only. Production never imports these records.
function client(): ReadClient {
  return {
    accountInformation: {
      listUserAccounts: async () => ({
        data: [account("one"), account("two")],
      }),
      getUserAccountBalance: async () => ({
        data: [{ cash: 12, currency: { code: "CAD" } }],
      }),
      getAllAccountPositions: async () => ({
        data: {
          results: [],
          data_freshness: { as_of: "2026-09-09T00:00:00Z" },
        },
      }),
    },
    connections: { listBrokerageAuthorizations: async () => ({ data: [] }) },
  } as unknown as ReadClient;
}
test("one account balance failure retains its other sections and the other account", async () => {
  const c = client();
  const original = c.accountInformation.getUserAccountBalance;
  c.accountInformation.getUserAccountBalance = async (params) => {
    assert.deepEqual(Object.keys(params), ["accountId"]);
    if (params.accountId === "one")
      throw { response: { status: 403, data: "sensitive brokerage data" } };
    return original(params);
  };
  const result = await loadPortfolio(c);
  assert.equal(result.details[0].balances.data, null);
  assert.match(result.details[0].balances.error!, /Access denied/);
  assert.deepEqual(result.details[0].positions.data?.rows, []);
  assert.equal(result.details[1].balances.data?.[0].amount, 12);
  assert.ok(!JSON.stringify(result).includes("sensitive"));
});
test("accounts and connections fail independently", async () => {
  const c = client();
  c.accountInformation.listUserAccounts = async () => {
    throw new Error("secret");
  };
  const result = await loadPortfolio(c);
  assert.equal(result.accounts.data, null);
  assert.deepEqual(result.connections.data, []);
  assert.deepEqual(result.details, []);
  const d = client();
  d.connections.listBrokerageAuthorizations = async () => {
    throw new Error("secret");
  };
  const next = await loadPortfolio(d);
  assert.equal(next.details.length, 2);
  assert.ok(next.connections.error);
});
test("independent per-account reads begin concurrently", async () => {
  const c = client();
  const started = new Set<string>();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = c.accountInformation.getUserAccountBalance;
  c.accountInformation.getUserAccountBalance = async (params) => {
    started.add(params.accountId);
    if (started.size === 2) release();
    await gate;
    return original(params);
  };
  const result = await loadPortfolio(c);
  assert.equal(started.size, 2);
  assert.equal(result.details.length, 2);
});
test("public errors never reuse API response messages", () => {
  assert.match(
    safeError({ response: { status: 429, data: "private" } }),
    /rate limit/,
  );
  assert.ok(!safeError(new Error("private")).includes("private"));
});
