import { runDailySnapshot } from "../lib/snapshots/run";
import { setTimeout } from "node:timers/promises";

async function attempt() {
  try {
    const appended = await runDailySnapshot();
    console.log(
      `${new Date().toISOString()} ${appended ? "Daily portfolio snapshot appended." : "Saved dashboard updated; today's historical snapshot is unchanged."}`,
    );
    return true;
  } catch {
    // Never log SDK errors, account identifiers or response bodies.
    console.error(
      `${new Date().toISOString()} Snapshot not recorded. Check credentials, connection status, data availability and database permissions.`,
    );
    return false;
  }
}
async function main() {
  if (!process.argv.includes("--daemon")) {
    if (!(await attempt())) process.exitCode = 1;
    return;
  }
  const hour = Number(process.env.SNAPSHOT_UTC_HOUR || "22");
  if (!Number.isInteger(hour) || hour < 0 || hour > 23)
    throw new Error("SNAPSHOT_UTC_HOUR must be 0–23");
  let completed = "";
  let nextAttempt = 0;
  for (;;) {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    if (
      now.getUTCHours() >= hour &&
      day !== completed &&
      now.getTime() >= nextAttempt
    ) {
      if (await attempt()) completed = day;
      nextAttempt = Date.now() + 15 * 60 * 1000;
    }
    await setTimeout(60_000);
  }
}
void main();
