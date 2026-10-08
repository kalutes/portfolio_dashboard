<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Private financial data

Never put personal account names, identifiers, number suffixes, balances, transaction records, credentials, or user-specific accounting rules in tracked source files, tests, documentation, or deployment templates. Store account exclusions and other personal configuration only in the private databases. Tests must use synthetic fixtures. Keep production exports and audit findings under ignored `data/`; inspect changes for personal data before finishing work.
