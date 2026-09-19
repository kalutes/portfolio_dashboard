import "server-only";
import type { PersonalApiKeyAuth, Snaptrade } from "snaptrade-typescript-sdk";
import {
  normalizeAccount,
  normalizeBalance,
  normalizePosition,
  normalizeConnection,
  timestamp,
} from "./normalize";

type Client = Snaptrade<PersonalApiKeyAuth>;
export type ReadClient = {
  accountInformation: Pick<
    Client["accountInformation"],
    "listUserAccounts" | "getUserAccountBalance" | "getAllAccountPositions"
  >;
  connections: Pick<Client["connections"], "listBrokerageAuthorizations">;
};
export type Section<T> = {
  data: T | null;
  error: string | null;
  retrievedAt: string;
};
export function safeError(error: unknown): string {
  const status = (error as { response?: { status?: number } } | null)?.response
    ?.status;
  if (status === 401 || status === 403)
    return "Access denied. Check your Personal API credentials and brokerage connection.";
  if (status === 429)
    return "SnapTrade rate limit reached during background sync. Saved data will update on the next scheduled sync.";
  return "Could not retrieve this data from SnapTrade during background sync. The next scheduled sync will try again.";
}
async function section<T>(request: () => Promise<T>): Promise<Section<T>> {
  try {
    return {
      data: await request(),
      error: null,
      retrievedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      data: null,
      error: safeError(error),
      retrievedAt: new Date().toISOString(),
    };
  }
}
export async function loadPortfolio(client: ReadClient) {
  const [accounts, connections] = await Promise.all([
    section(async () =>
      (await client.accountInformation.listUserAccounts()).data.map(
        normalizeAccount,
      ),
    ),
    section(async () =>
      (await client.connections.listBrokerageAuthorizations()).data.map(
        normalizeConnection,
      ),
    ),
  ]);
  const details = await Promise.all(
    (accounts.data ?? []).map(async (account) => {
      const accountId = account.id;
      const [balances, positions] = await Promise.all([
        section(async () =>
          (
            await client.accountInformation.getUserAccountBalance({ accountId })
          ).data.map(normalizeBalance),
        ),
        section(async () => {
          const { data } =
            await client.accountInformation.getAllAccountPositions({
              accountId,
            });
          return {
            rows: data.results.map(normalizePosition),
            asOf: timestamp(data.data_freshness?.as_of),
          };
        }),
      ]);
      return { account, balances, positions };
    }),
  );
  return {
    accounts,
    connections,
    details,
    retrievedAt: new Date().toISOString(),
  };
}
