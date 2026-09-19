# Private portfolio dashboard

Next.js App Router and TypeScript frontend/backend for one SnapTrade Personal account, plus editable manual holdings. Home page loads read only the local databases; they never call SnapTrade or Yahoo. The daily background worker makes all brokerage requests through the official `snaptrade-typescript-sdk`. The app has no trading endpoints, user-registration flow, or custom request signing.

## Local development

Use Node.js 22.13 or newer and install dependencies:

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Fill in `SNAPTRADE_CLIENT_ID`, `SNAPTRADE_CONSUMER_KEY`, `DASHBOARD_PASSWORD` and `DASHBOARD_SESSION_SECRET` in `.env.local`. Use a long unique password and a random session secret of at least 32 characters (generate one with `openssl rand -hex 32`). Keep these values server-side. Existing installations should keep their existing `.env.local` and add the new names.

The app opens at http://127.0.0.1:3000. Open **Manual holdings** to manage outside accounts, purchase-lot quantities, acquisition dates, total cost basis and Yahoo quote symbols. Manual edits affect current values and future daily snapshots; previously recorded history does not change.

## Password protection

`DASHBOARD_PASSWORD` is the single shared password. `DASHBOARD_SESSION_SECRET` signs the 30-day HttpOnly, SameSite=Lax session cookie. The app stays locked when either setting is missing or the secret is shorter than 32 characters. There are no authentication database tables. Changing either value and restarting the web container invalidates every existing session. **Sign out** removes the cookie from the current browser.

Pages, history API requests and manual-edit Server Actions all enforce authentication. Login has a global limit of ten attempts per minute per web process, reset on restart; run one web replica for this single-user app. Next.js also checks the origin of Server Action requests. Behind a reverse proxy, preserve the original host (or `X-Forwarded-Host`) and protocol headers so these checks work. The health endpoint and generic PWA/static assets are public and expose no portfolio data.

Production cookies require HTTPS by default. `AUTH_COOKIE_SECURE=false` is an explicit exception for private HTTP access; do not use it on an untrusted network. Development over localhost works without that override. Passwords and secrets are runtime configuration only, never Docker build arguments or GitHub workflow secrets.

## Runtime data

Only two databases are needed:

| File / setting                              | Purpose                                                        |
| ------------------------------------------- | -------------------------------------------------------------- |
| `data/portfolio.sqlite` / `HISTORY_DB_PATH` | Frozen historical values plus appended daily snapshots         |
| `data/manual.sqlite` / `MANUAL_DB_PATH`     | Editable manual accounts, holdings and last-known Yahoo quotes |

The portfolio database has five small tables:

- `portfolio_values`: one total per UTC date, including missing-value, estimate and stale-data flags, plus retrieval time for new observations.
- `portfolio_holdings`: that date's consolidated symbols, quantities, values and valuation-method labels. No account reconciliation is needed.
- `dashboard_state`: the latest normalized accounts, balances, positions and connection status for rendering the home page, including observation times and partial-sync errors.
- `metadata`: schema version, read revision, historical cutoff and original seed checksum.
- `latest_sources`: the latest normalized cash/holdings for each hashed source, used only to carry data forward during outages. This contains no transfer or transaction history.

All 3,135 imported dates and 44,355 holding records through August 31, 2026 were preserved during compaction. Estimates, missing values and interpolation dates remain visible. The frozen seed retains its existing coverage limits; a fully priced date means the known imported portfolio, not proof that every former provider was covered. The application assumes USD for these consolidated values, as agreed; it does not convert currencies.

SQLite triggers prevent editing/deleting recorded days and inserting into the frozen historical period. New snapshots combine available updates with the most recently observed holdings for unavailable sources, including manual accounts. Holdings are never added on top of the previous portfolio total. No raw brokerage responses, credentials, full account numbers, PDFs, transaction histories or transfer records are stored by the daily worker. The dashboard state retains normalized display fields, including account identifiers, names, number suffixes and available position cost-basis/lot details. Source keys in `latest_sources` are hashes used to match successive observations.

The old `HISTORY_POINTER_PATH` setting is no longer used. Set `HISTORY_DB_PATH` to the actual compact SQLite file if you use a custom location.

## Daily snapshots

Run `npm run snapshot` once after upgrading to populate the saved account display; then keep the daily worker running. Until the first sync, the page shows a clear notice alongside any available manual holdings and history. There is no refresh button or automatic API fallback on page load. New manual quote symbols receive pricing at the next background sync.

```bash
npm run snapshot          # populate saved dashboard and append today's observation once
npm run snapshot:daemon   # run the daily worker locally
```

The worker runs at 22:00 UTC by default. Override `SNAPSHOT_UTC_HOUR` with an integer from 0 to 23. Docker starts the worker automatically as a separate service. If it starts after the scheduled hour, it attempts today's snapshot immediately. A failed database/credentials run retries every 15 minutes until midnight; the next day gets its own scheduled attempt. It never invents observations for missed days.

Independent API requests run concurrently. Available sections update; an unavailable account, cash balance, positions section, or manual source carries its last successful observation forward. Carried holdings retain their source date and are labeled stale. If a position has current units but no value, a known prior per-unit value can supply an explicitly stale estimate. If no prior observation exists, the missing holding remains unpriced: the total is NULL and the known subtotal remains visible. The cache begins with the first daily observation; the consolidated historical seed cannot unambiguously initialize per-account holdings. Stale or unknown source freshness is also labeled. Cash equivalents already represented by account cash are not counted twice. Multiple lots of the same symbol aggregate into one daily holding.

Writes are transactional and idempotent: the first successful observation for a UTC date wins. Running the job again cannot overwrite that historical date, but does update the saved dashboard display. This also means a manual edit after today's snapshot appears in the next snapshot. Holdings are rounded to cents before the stored total is summed. SnapTrade itself may return accounts with different source sync times; this is an observed snapshot, not a guaranteed exchange closing valuation.

## Docker and Tailscale

```bash
docker compose --env-file .env.local up --build -d
```

Set `DASHBOARD_BIND_IP` in `.env.local` to the server's Tailscale IP for Tailscale access. It defaults to loopback. Use HTTPS through Tailscale Serve or your reverse proxy (see below). For a deliberate HTTP-only deployment over your private tailnet, set `AUTH_COOKIE_SECURE=false` and visit `http://<tailscale-ip>:3000`; the default production cookie requires HTTPS. The dashboard prompts for one password; there are no usernames or user accounts. Keep the bind address, host firewall and Tailscale restrictions as well.

`MANUAL_DATA_DIR` and `HISTORY_DATA_DIR` select host directories mounted into the containers; both default to `./data`. The manual file must be named `manual.sqlite` and the portfolio file `portfolio.sqlite` in their respective directories. The web container mounts portfolio history read-only, while the snapshot worker can append to it. The web service saves manual edits; only the worker fetches and updates Yahoo quotes. SnapTrade credentials are provided only to the worker. Custom path settings used by local development do not rename the fixed container paths.

Compose runs both containers as UID/GID 1000 by default, matching this host. On another host, set `DASHBOARD_UID` and `DASHBOARD_GID` to the owner of the data files (`id -u` and `id -g`). Ensure the data directories allow that user to create SQLite journals and that both database files have appropriate read/write permissions for the worker. The web container needs read access to the portfolio database. No data or `.env.local` is included in the image. The compact database is prepared already; a fresh checkout must restore it from a backup before history or snapshots can work.

Stop both services before copying SQLite databases for a filesystem backup, or use SQLite's online backup API. Copying only the main file while WAL writes are active is unsafe. Keep backups outside version control.

## TrueNAS deployment and published images

Target: Docker-based TrueNAS Apps (24.10 or newer), on an amd64/x86-64 server. The image template is [deploy/truenas.yaml](deploy/truenas.yaml), ready for the **Install via YAML** custom-app editor described in the [TrueNAS documentation](https://www.truenas.com/docs/scale/apps/installcustomappscreens/). It deploys the web app and daily worker together, with no builds on the NAS.

1. Push this project, including `.github/workflows/docker-publish.yml`, to GitHub. The workflow tests and builds on pull requests; successful pushes to `main`, `v*` tags, or a manual workflow run publish images to GHCR using the built-in `GITHUB_TOKEN` (`packages: write`). No registry password needs to be added to repository secrets.
2. The two image names for this repository are `ghcr.io/kalutes/portfolio_dashboard` and `ghcr.io/kalutes/portfolio_dashboard-snapshots`. The main branch publishes `latest`; version tags publish their literal tag (for example `v1.0.0`), and builds also publish a `sha-…` tag. Use the same version on both services. For a fork, update the image names in the template.
3. New GHCR packages may be private. Either make **both image packages** public (images contain code only, no databases or secrets) or configure TrueNAS registry credentials with a GitHub token permitted to read those packages. See [GitHub Container Registry authentication](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry). The workflow does not change package visibility.
4. Create local ZFS directories such as `/mnt/tank/portfolio/manual` and `/mnt/tank/portfolio/history`. With the old services stopped, copy `manual.sqlite` into the first and `portfolio.sqlite` into the second, including any outstanding SQLite WAL files; alternatively use SQLite online backups. Do not start with an empty historical database. Keep regular dataset backups. Use local storage, not an SMB/NFS share for live SQLite files.
5. Grant the selected UID/GID read/write access to both directories and files for the worker. The template uses `1000:1000`; change both service users to your chosen TrueNAS dataset owner and set the corresponding dataset ACLs. The web service mounts history read-only and manual storage read/write. Neither image runs as root.
6. Replace every `CHANGE_ME` in the YAML: dataset paths, password, random session secret and SnapTrade credentials. Paste the completed YAML into TrueNAS **Apps → Discover Apps → Install via YAML** and give the app a name. Store your completed YAML securely; it contains secrets. The repository template is only an example.
7. The default port bind is loopback for an HTTPS reverse proxy/Tailscale Serve running on the host. If your proxy runs in another container or host, bind to the appropriate private server IP and configure the proxy to reach it. Use HTTPS for PWA installation and secure cookies. The health check uses `/api/health` inside the container. It checks web liveness, not SnapTrade connectivity or database completeness.
8. Verify the login screen, saved portfolio and `snapshots` logs. The worker schedules at 22:00 UTC by default. Existing saved dashboard data displays immediately; for an initial sync before the scheduled hour, run `node --conditions=react-server --import tsx scripts/snapshot.ts` in the snapshots container shell. Normal page loads never trigger a provider request.

To update, back up the databases, change both image tags (or pull the updated `latest` images) and redeploy the custom app. Keep the dataset mounts unchanged. Prefer a matching release/sha tag for reproducible deployments and rollback. No financial data, passwords or API keys are needed by the publish workflow.

Local image verification uses disposable data and does not call SnapTrade:

```bash
docker build --target runner -t portfolio-web:test .
docker build --target snapshots -t portfolio-snapshots:test .
npm run test:docker
```

The same checks run before publishing: password failure/success, missing-configuration lockout, logout, protected API/RSC/manual actions, manual database persistence, worker appends and image data exclusions.

## Historical archive

All one-time PDF parsing, transaction extraction, manual imports, reconciliation, historical price downloading, ledger builders and their tests now live in:

`/home/kalutes/portfolio-ledger-scripts`

That directory also retains the original source statements, detailed ledger databases, pricing caches, reports and trade/cost-basis evidence. Nothing needed for later trade analysis was discarded. Its `archive-manifest.json` records file checksums; see its README for the archived workflow. The app does not import code or read files from that directory. `data/archive-location.json` records where it was placed.

## Checks

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
# After building the two test images (see below):
npm run test:docker
```

Tests cover normalization, independent API failures, manual holdings, historical reads and transactional daily appends, including frozen-history protection, source carry-forward, partial values and prevention of duplicate cash equivalents.

## Troubleshooting

- **Login unavailable:** set both `DASHBOARD_PASSWORD` and a `DASHBOARD_SESSION_SECRET` of at least 32 characters, then restart the web service.
- **Login returns to the password screen:** confirm you are using HTTPS when secure cookies are enabled. For private HTTP only, explicitly set `AUTH_COOKIE_SECURE=false`. For rejected Server Actions, check reverse-proxy host headers.
- **Image pull denied:** check the visibility and registry credentials for both GHCR image packages; the first publish must finish before TrueNAS can pull.
- **Historical section unavailable:** check `HISTORY_DB_PATH` (or the Docker history mount), file permissions and that you restored the compact database rather than a source ledger. Refresh if a daily append changes the revision while you are hovering over the chart.
- **Daily snapshot missing:** inspect `docker compose logs snapshots`. Check credentials and database permissions. Brokerage outages normally produce labeled carried holdings; a source with no prior observation remains explicitly unknown.
- **Yahoo unavailable:** an explicitly labeled saved quote/manual value remains visible. Missing manual values use the last known source observation where possible; otherwise the daily record has an explicitly incomplete total. Quote symbols should identify the intended USD instruments.
- **Stale data:** SnapTrade sync timestamps and Yahoo market timestamps may lag the retrieval time, especially on weekends. Retrieval time does not mean all holdings were updated simultaneously.
- **Manual account disappeared after deployment:** verify `MANUAL_DATA_DIR` points to the directory containing the existing manual database.
- **SQLite experimental warning:** expected on some Node 22 releases.

## Install on Android or iPhone

The same dashboard is an installable PWA, with standalone display, home-screen icons, touch controls, phone-sized position cards and safe-area spacing. It shares the existing backend and databases; there is no separate mobile data copy.

Installation and service workers require HTTPS (localhost is a development exception). A plain HTTP Tailscale IP is insufficient. For this private deployment, use [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve):

1. Keep the phone and home server connected to Tailscale.
2. Bind Docker to loopback with `DASHBOARD_BIND_IP=127.0.0.1` and start the app normally.
3. On the server, run `tailscale serve --bg http://127.0.0.1:3000`. Follow its HTTPS enablement instructions if prompted. Use the HTTPS `.ts.net` hostname it prints; Serve keeps access within your tailnet. Do not use Funnel for this private app.
4. **Android / Chrome:** open that URL and choose **Install app** or **Add to Home screen** from the menu. The app also offers an install button when Chrome makes it available.
5. **iPhone / Safari:** open the URL, tap **Share → Add to Home Screen**, and keep **Open as Web App** enabled if offered. See [WebKit's home-screen app guidance](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/).

Tailscale Serve must target the port actually running your dashboard. The example uses Docker's port 3000; use your development port if different. A production build registers the service worker automatically on HTTPS or localhost. `next dev` intentionally does not register it. Installing a PWA does not remove the need for Tailscale/network access.

Only the generic offline screen is saved in service-worker Cache Storage. Financial HTML, API responses, server actions and React Server Component responses are never stored there. Without connectivity, a new launch shows reconnection instructions instead of cached balances. An already open page can still show its in-memory values, with an offline notice. Manual edits are not queued offline. On reconnect, reload to display the latest saved background-sync data. Normal app updates arrive from the server; no app-store release is needed.

To troubleshoot installation, verify the HTTPS URL, check that `/manifest.webmanifest`, `/sw.js` and the `/icons/` images load, and try the browser's install menu. Safari uses its Share menu rather than Chrome's programmable install prompt. If changing between development and production on the same origin, remove the old service worker in browser developer tools or clear that site's storage.
