import "server-only";
import { Snaptrade, SnaptradeAuth } from "snaptrade-typescript-sdk";

export function createSnaptrade() {
  const clientId = process.env.SNAPTRADE_CLIENT_ID;
  const consumerKey = process.env.SNAPTRADE_CONSUMER_KEY;
  if (!clientId?.trim() || !consumerKey?.trim()) return null;
  return new Snaptrade({
    auth: SnaptradeAuth.personalApiKey({ clientId, consumerKey }),
    baseOptions: { timeout: 20_000 },
  });
}
