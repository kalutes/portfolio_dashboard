import { readFileSync } from "node:fs";
import {
  readAccountExclusions,
  removeAccountExclusion,
  setAccountExclusion,
  setAccountExclusions,
} from "../lib/account-exclusion-store";

// Read private identifiers/reasons from stdin, not committed config or CLI arguments.
try {
  const [action, ...extra] = process.argv.slice(2);
  if (action === "--import-from" && extra.length === 1) {
    const entries = readAccountExclusions(extra[0]);
    if (!entries.length) throw new Error("No settings to import");
    setAccountExclusions(entries);
    console.log(
      "Account accounting settings imported. Existing historical days are unchanged.",
    );
  } else if (extra.length) {
    throw new Error("Unexpected arguments");
  } else if (action === "--list") {
    console.log(JSON.stringify(readAccountExclusions(), null, 2));
  } else if (action === "--set" || action === "--remove") {
    const input = JSON.parse(readFileSync(0, "utf8"));
    if (action === "--set") setAccountExclusion(input);
    else removeAccountExclusion(input.accountId);
    console.log(
      "Account accounting setting saved. Existing historical days are unchanged.",
    );
  } else {
    throw new Error("Unknown action");
  }
} catch {
  console.error(
    "Could not read or save account exclusions. Use --list, --set, --remove or --import-from DATABASE; --set/--remove require valid JSON on stdin. Writes require a writable HISTORY_DB_PATH with saved brokerage accounts.",
  );
  process.exitCode = 1;
}
