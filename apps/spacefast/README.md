# Feeds: web-first Spacefast prototype

A standalone React reader using WordPress UI and Theme, with a native Spacefast Zero application backend. The WordPress plugin at the repository root is unchanged. This app does not call WordPress REST APIs, use `wp` globals, or store reader state as global post statuses; Spacefast itself is backed by WordPress.

**This is a bounded web prototype, not a production migration. Native scheduled fetching uses the supported hourly schedule.** You can sign in through the platform, manage personal sources, add clearly labeled sample articles, and use independent read/star state. Source metadata and sample data are persisted per authenticated app user, not shared across site visitors. Live authentication, hosted MySQL isolation and hosted recovery still require deployment validation.

## Build and verify

Use Node 24 and npm:

```sh
cd apps/spacefast
npm ci --ignore-scripts
npm run check
```

`check` runs ESLint, strict TypeScript, domain/UI/ingestion tests, a Vite production build and the actual `@spacefast/zero-compile` compiler. A separate GitHub Actions workflow runs the same checks without deployment credentials. The source plugin's original build remains separate.

- `npm run build`: bundles the React frontend to `dist/`.
- `npm run build:zero`: compiles the Zero capsule and validates its declared database schema. Output goes to ignored `.artifacts/`.
- `npx vite`: UI development only; native auth/data need a Zero runtime on the same origin.
- `sf dev`: official local Zero development server; local test identity behavior is not production sign-in.
- `sf build --skip-install`: official framework + Zero assembly. This is a local build, not a publish.

No login, credentials or account provisioning are needed for the unit/build checks. Do not add real data to tests.

## Spacefast deployment shape

Publish the `apps/spacefast` project root, **not only `dist/`**. `sf.jsonc` declares the Zero server and framework build. Current official CLI assembly was exercised: Vite's `index.html` and assets are served, while the root Zero capsule, schema, queries, mutations and endpoints are compiled into runtime metadata. Native hosted source builds must retain that composition.

For a hosted build, select this directory as the project root, use `npm ci --ignore-scripts`, `npm run build`, output `dist`, and a Node 24-compatible builder. The existing prototype has a public shell; reader data still requires an authenticated app session. Do not change access settings as part of a source build. No secrets are included. The default package build alone is not proof that the runtime was installed: inspect the deployed runtime and schema, then test native sign-in, two users, sign-out and session expiry.

The UI uses the supported `@spacefast/zero/react` hooks. Its client discovers `/__zero/config`, `/__zero/run` and realtime on the same origin. Space access and native app accounts are different concepts; verify the Space's enabled app sign-in provider before claiming the sign-in button works. Do not substitute a management token as a reader credential.

The actual app lives in `frontend/` because the Zero compiler scans every file under `client/` and disallows CSS imports there. The declared absent `client/zero-shell.tsx` uses Zero's documented server-only generated shell; the framework's built index overrides that shell. The native server remains in `server/` with framework-free contracts in `shared/`.

## Data and behavior

- `sources`: private subscription settings, including each person's title, folder and enable state.
- `feedPools` and `feedItems`: one pool and article set for a confirmed public feed URL; uncertain or token-bearing URLs keep an owner-private pool. Pool rows hold validators, due time, retry/backoff and fenced lease state.
- `subscriptions` and `itemStates`: private source-to-pool links and per-person read/star state. Saved stars remain visible after an unsubscribe.
- `articles`, `jobs` and `legacyItemMaps`: old owner-scoped history and jobs remain as a rollback copy; mappings accept previous article IDs while accounts move to the new model. Migration parks old jobs rather than deleting user data.

Every reader handler checks `isAuthenticated`, not just the presence of `userId` (guests also have IDs). Reads use owner indexes; mutations/details check ownership again. The client cannot supply an owner or server timestamp. Opening/closing a drawer does not implicitly change state; read/unread is explicit, unlike the legacy plugin's trash-on-close behavior.

Authentication is deliberately per handler, not a capsule-wide `requireSignIn` gate: Zero applies the blanket gate before every endpoint, including public health and machine-authenticated ingestion. Native sign-in remains the reader identity source. Compiled-adapter regression tests verify that signed-out/guest reader operations are denied before data access, health is public, and worker operations remain disabled or credential-protected.

Limits are deliberate: 25 sources/account; 200 stored articles/feed pool; latest 200 articles shown across the account. Search/filter apply to that bounded result, not all historical content. Dashboard bodies are 2,000-character previews; a separate authenticated query loads one full body (50,000 characters max). Full feeds pause with a visible capacity error rather than delete history. Old sources and their articles migrate in transactions of at most two sources; the client continues those batches after sign-in, and the scheduler also maps due legacy jobs. No old rows are removed during migration. Retention expansion, export, newsletter ingestion, saved-links capture, billing, native iOS and offline sync remain outside this slice.

Article bodies are plain text. There is no `innerHTML`, remote image, embed, tracking pixel or external font fetch. Rich article HTML is intentionally out of scope.

## OPML subscription import

Choose **Import OPML**, upload a UTF-8 `.opml` or XML file, review its feed rows and nested folder paths, and select the sources to add. The preview shows invalid feeds, duplicates and subscriptions already in your library. Only the confirmed original XML and selected row IDs are submitted; the server reparses and independently validates them for the signed-in account.

The prototype deliberately retains **25 sources per account**. The dialog shows used/remaining slots, accepts a preview of up to 500 feed outlines, and blocks an over-capacity selection instead of silently truncating it. When an export does not fit, nothing is preselected. Existing subscriptions, articles, read/star state and jobs are not overwritten. New subscriptions are always paused, even if an ingestion service is configured. Importing does not enable fetching.

Files are limited to 256 KiB, valid UTF-8 XML, bounded depth/nodes/attributes and public HTTPS URLs. DTD/entity declarations, malformed XML and unsupported encodings are rejected. HTTP URLs are reported for correction, not silently upgraded. Nested folder labels use ` / `; labels exceeding supported lengths are shown as invalid rather than truncated. Exact URL normalization preserves query parameters and does not guess that different feed addresses are equivalent. Files are parsed locally for preview and are not uploaded before confirmation; filenames are not sent or stored. No user's OPML file has been imported during development.

## WordPress UI migration and sample QA

App action buttons, inputs, switches, notices and dialogs use WordPress UI through small adapters in `frontend/controls.tsx`. WordPress Theme provides root semantic light/dark tokens, including portaled overlays. DataViews and legacy Components are removed from the standalone app dependencies and frontend imports; the original WordPress plugin remains unchanged.

The reader is a semantic list with one native button per article. Tapping any part of the row immediately opens its reading drawer; there is no selection step or separate Open/Read link. Native click activation preserves normal touch scrolling and keyboard semantics. Read/star actions remain in the drawer and remain independent. Mobile content uses the full viewport width with a compact current-view header. Feed navigation, source management, import, sorting and read filters live behind labeled controls instead of above the list. Search is opt-in. The list initially shows 40 articles, with an explicit Show more control for the bounded remaining results.

`/?preview=sample` is a labeled, nonpersistent test fixture using the **same** Workspace/ArticleDrawer views. It creates synthetic data in memory and never mounts auth/query/mutation hooks, sends account writes, or fetches articles. Light/dark and sample/empty/loading/article-error controls are in a collapsed disclosure below the reader, rather than consuming the first screen. Read/star and source removal affect only that tab; reload/reset restores fixtures. Source adding and importing cannot save from the fixture. Passing fixture checks is not proof of authenticated sessions, real database behavior or iOS-specific browser behavior.

The prior invisible-hit-target and hover-revealed action layout are no longer present because DataViews was replaced, not further restyled. Mounted tests cover direct row activation, repeated open/close, search/filter/navigation, and options/import transitions. Browser geometry and touch/keyboard event behavior must still be verified on the exact new build.

## Native scheduled ingestion

`sf.jsonc` declares one `GET /api/cron/ingest` on the basic `hourly` schedule. The live API contract retired crontab expressions: the requested `*/15 * * * *` declaration remained visible but reported `scheduled: false`. Publishing the basic hourly fallback is the supported repair. Verify `scheduled: true` separately from declaration presence, then verify an actual runtime tick. The provider picks the approximate fire time; exact quarter-hour scheduling is unavailable through this native path. The handler requires Spacefast's platform-owned `x-spacefast-cron` marker; ordinary visitor requests, reader sessions and bearer headers do not authorize it. The official [cron guide](https://spacefast.com/docs/crons/) documents marker-gated handlers and says manual runs cannot send this marker. No extra secret or external scheduler is required. Native ingestion is enabled in source; an explicit `FEEDS_NATIVE_INGESTION_ENABLED=false` remains an emergency off switch. Native mode disables the optional external worker routes.

Each tick processes **up to four due feed pools**, sequentially, within a 22-second admission budget and one write transaction. Each outbound fetch has its own five-second limit. Successful feeds become due again after one hour; expected failures back off individually. A larger backlog remains due for later ticks, so this is not an unlimited hourly guarantee. The scheduler skips overlapping runs. Do not add another trigger or expose a global tick through user Refresh; Refresh only queues the authenticated owner's enabled source.

New URLs start owner-private. Only a credential-free successful response from a query-free `/feed`, `/rss`, `/atom`, or `.xml` variant of those conventional root paths permits promotion to a public pool. Query strings and uncertain paths stay owner-private. A second subscriber attaches to an already confirmed public pool. Per-feed leases and completion tokens fence stale results, and ETag/Last-Modified validators and retry state belong to the pool. Zero's named indexes are not unique constraints: hosted concurrent insert/promotion behavior still needs verification, so the single native scheduler remains important.

New manually added sources are enabled and queued. Existing paused sources and OPML imports remain paused until their owner enables them in Manage feeds. Demo sources never fetch. A tick with no eligible source logs `feeds.native-scheduled-tick` with `outcome: idle`; this proves scheduled handler execution, not external fetching. Logs contain outcome flags only, no feed URLs, user identities, request headers or content. Check runtime logs for real scheduled execution; the cron list exposes failures only, and a manual run is not equivalent.

Fetching uses Spacefast's host egress protections (private-range/cloud-metadata blocking, DNS pinning and redirect-hop checks), HTTPS-only URL validation, up to two redirects, and a 256 KiB streaming body cap. Zero documents a five-second write-side fetch timeout. The adapter fails closed if bounded readable bodies are unavailable; no fully buffered fallback weakens the limit. Live RSS/Atom fetching still needs verification with an actual enabled subscription; no user feed is invented for that test.

The portable parser bundles unchanged locked public ESM exports from `fast-xml-parser` and `htmlparser2`, with provenance/licenses in `shared/vendor/`. It produces at most 20 unique plaintext items. `npm run check:native-parser` verifies its reproducibility. Expected network/parser failures persist retry backoff; unexpected failures roll the transaction back. Internal native lease hashes fence replay; only the optional external worker needs secret-backed lease capabilities, and its endpoints are disabled while native mode is on. Hosted multi-consumer isolation remains unproven, so keep the single native scheduler.

## Verification boundaries

Local tests validate application contracts using injected networking and a persisted SQLite transaction harness. They do **not** prove hosted MySQL lock/isolation semantics, unique inserts under concurrency, QuickJS execution, native sessions or cron delivery. The Zero DSL currently declares nonunique indexes; application deduplication must not be represented as a database uniqueness guarantee. Hosted multiworker contention/rollback, migrations and export/restore remain launch gates. The optional external worker remains disabled; native scheduling is intentionally a bounded prototype, not a production-readiness claim.

See [docs/VALIDATION.md](docs/VALIDATION.md) for the test record, security limits and manual release checklist. This branch must remain a draft until its platform gates are resolved.

## Dependencies and license

The standalone app uses `@wordpress/ui` 0.25.0, `@wordpress/theme` 3.0.0, DataViews 21.0.0 and icons 19.0.0 with React 18.3.1. Its controls, notices, inputs, switches and dialogs render the new UI package. A root ThemeProvider supplies shared light/dark tokens, including portaled overlays. DataViews still depends on `@wordpress/components` 43.0.0 internally, so the legacy package and its stylesheet remain; this is not a claim of complete removal. The original plugin dependency versions are untouched. Locked transitive overrides for `uuid` 11.1.1, `zod` 4.6.6, `happy-dom` 21.0.4 and `esbuild` 0.28.2 resolve current advisories; run the complete suite when changing these. No dependency-audit result is a security guarantee.

The application follows the original repository's GPL-2.0-or-later license. Dependencies retain their respective licenses. No migration or destructive change to the original plugin is included.

Primary platform references checked: [Zero](https://spacefast.com/docs/zero-runtime/), [React/auth and framework composition](https://spacefast.com/docs/changelog/v0-5-0/), [Crons](https://spacefast.com/docs/crons/), and the installed SDK/compiler type declarations (0.8.0).
