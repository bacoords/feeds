# Feeds: web-first Spacefast prototype

A standalone React reader using WordPress UI and Theme, with a native Spacefast Zero application backend. The WordPress plugin at the repository root is unchanged. This app does not call WordPress REST APIs, use `wp` globals, or store reader state as global post statuses; Spacefast itself is backed by WordPress.

**This is a bounded web prototype, not a production migration. Live RSS polling is off by default.** You can sign in through the platform, manage personal sources, add clearly labeled sample articles, and use independent read/star state. Source metadata and sample data are persisted per authenticated app user, not shared across site visitors. Live authentication, hosted MySQL isolation and hosted recovery still require deployment validation.

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

For a hosted build, select this directory as the project root, use `npm ci --ignore-scripts`, `npm run build`, output `dist`, and a Node 24-compatible builder. The existing prototype has a public shell; reader data still requires an authenticated app session. Do not change access settings as part of a source build. No secrets are included. The default package build alone is not proof that the runtime was installed: inspect the deployed runtime and three tables, then test native sign-in, two users, sign-out and session expiry.

The UI uses the supported `@spacefast/zero/react` hooks. Its client discovers `/__zero/config`, `/__zero/run` and realtime on the same origin. Space access and native app accounts are different concepts; verify the Space's enabled app sign-in provider before claiming the sign-in button works. Do not substitute a management token as a reader credential.

The actual app lives in `frontend/` because the Zero compiler scans every file under `client/` and disallows CSS imports there. The declared absent `client/zero-shell.tsx` uses Zero's documented server-only generated shell; the framework's built index overrides that shell. The native server remains in `server/` with framework-free contracts in `shared/`.

## Data and behavior

- `sources`: owned subscription, folder label, enable state, validators and distinct attempt/success/next-poll timestamps.
- `articles`: source-scoped identity and content, owner ID, independent `read` and `starred` booleans. A subscription is private rather than sharing a global article record. Upserts preserve both flags.
- `jobs`: durable source job, due time, retry count, lease capability/version and last completed capability.

Every reader handler checks `isAuthenticated`, not just the presence of `userId` (guests also have IDs). Reads use owner indexes; mutations/details check ownership again. The client cannot supply an owner or server timestamp. Opening/closing a drawer does not implicitly change state; read/unread is explicit, unlike the legacy plugin's trash-on-close behavior.

Authentication is deliberately per handler, not a capsule-wide `requireSignIn` gate: Zero applies the blanket gate before every endpoint, including public health and machine-authenticated ingestion. Native sign-in remains the reader identity source. Compiled-adapter regression tests verify that signed-out/guest reader operations are denied before data access, health is public, and worker operations remain disabled or credential-protected.

Limits are deliberate: 25 sources/account; 200 stored articles/source; latest 200 articles shown across the account. Search/filter apply to that bounded result, not all historical content. Dashboard bodies are 2,000-character previews; a separate authenticated query loads one full body (50,000 characters max). Full sources pause with a visible capacity error rather than delete history. There is no retention expansion, article/history migration or export, newsletter ingestion, saved-links capture, billing, native iOS or offline sync in this slice.

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

## Native scheduled ingestion: not enabled yet

The preferred path runs entirely in this Space's Zero runtime: a protected `GET /api/cron/ingest` processes at most one due feed in a write transaction. It uses Spacefast's host fetch, a 256 KiB body limit and a portable maintained XML validator/tokenizer, returning at most 20 unique plaintext items. Due times, retries, leases and results remain in the existing database. No separately hosted Node service is needed for this path.

The official installed `@spacefast/common` 0.8.0 egress contract identifies private-range/cloud-metadata blocking, DNS pinning and redirect-hop checks as unconditional safeguards for both runtimes. Zero documents a five-second timeout for each write-side fetch. This is not a claim that every browser fetch API exists in QuickJS: the adapter **fails closed if a bounded readable body is unavailable**. No fully buffered `text()` fallback silently weakens the byte cap. A real capability test is required before activation.

The parser bundles unchanged, locked public ESM exports from `fast-xml-parser` (XMLValidator) and `htmlparser2` (tokenizer). It does not patch the compiler or shim forbidden globals. `shared/vendor/` contains source hashes, package integrity/provenance and licenses. `npm run check:native-parser` detects stale artifacts; `npm run build:native-parser` regenerates them. The regular `build:zero` verifies them before compilation.

### Protected trigger and staged verification

1. Provision a strong, random 32–256 printable non-space character `CRON_SECRET` through supported server-only Space variables, with approval. Keep `FEEDS_NATIVE_INGESTION_ENABLED` absent or `false`. Verify the queued re-finalization and runtime binding.
2. `GET /api/cron/ingest` requires `Authorization: Bearer <secret>`. With fetching disabled it returns only authenticated/enabled/outcome flags and logs those flags, never request headers or secrets. Missing configuration returns 503; missing/wrong bearer returns 401. A forged `x-spacefast-cron` is never sufficient.
3. Verify that the real native scheduler injects the expected bearer before relying on it. Current cron config exposes only path/schedule; historical `CRON_SECRET` injection documentation is not current proof. The manual run API deliberately lacks the platform cron marker. No cron is currently declared in `sf.jsonc`.
4. An authorized manual `POST` to the same path, while ingestion is disabled, performs one fixed public WordPress News request to inspect the fetch response shape. It accepts no URL, writes no data and returns no content/headers. It is a capability probe, not a live feed run. The endpoint is refused after activation.
5. Verify actual bounded reads, native sessions/two-user isolation, retry/rollback, and a single non-overlapping scheduler before enabling `FEEDS_NATIVE_INGESTION_ENABLED=true`. If native secret injection cannot be established, an approved external cron may send the bearer trigger; fetch/parse/persistence still run entirely on Spacefast.

Use one scheduler only, one invocation at a time. Native scheduler overlap prevention is scheduler-scoped, not a general database locking guarantee. The capsule DSL has no verified unique/CAS primitive; multi-trigger concurrency remains a gate. A tick catches expected fetch/parse failures and commits retry backoff. An unexpected failure or killed invocation rolls the entire attempt back, leaving the previous due job for a later tick. Network I/O is intentionally inside the bounded native write transaction; this differs from the optional Node adapter's two-phase lease protocol.

The existing `worker/` remains an optional tested adapter/reference, not a deployed service and not the selected hosting architecture. Native activation disables its worker-authorization path. Its separate environment names do not authorize native triggers. Never place real secrets in source, browser bundles, URLs, CLI arguments or logs.

## Verification boundaries

Local tests validate application contracts using injected networking and a persisted SQLite transaction harness. They do **not** prove hosted MySQL lock/isolation semantics, unique inserts under concurrency, QuickJS execution, native sessions or cron delivery. The Zero DSL currently declares nonunique indexes; application deduplication must not be represented as a database uniqueness guarantee. Hosted multiworker contention/rollback, migrations and export/restore remain launch gates. The worker stays disabled until those are established.

See [docs/VALIDATION.md](docs/VALIDATION.md) for the test record, security limits and manual release checklist. This branch must remain a draft until its platform gates are resolved.

## Dependencies and license

The standalone app uses `@wordpress/ui` 0.25.0, `@wordpress/theme` 3.0.0, DataViews 21.0.0 and icons 19.0.0 with React 18.3.1. Its controls, notices, inputs, switches and dialogs render the new UI package. A root ThemeProvider supplies shared light/dark tokens, including portaled overlays. DataViews still depends on `@wordpress/components` 43.0.0 internally, so the legacy package and its stylesheet remain; this is not a claim of complete removal. The original plugin dependency versions are untouched. Locked transitive overrides for `uuid` 11.1.1, `zod` 4.6.6, `happy-dom` 21.0.4 and `esbuild` 0.28.2 resolve current advisories; run the complete suite when changing these. No dependency-audit result is a security guarantee.

The application follows the original repository's GPL-2.0-or-later license. Dependencies retain their respective licenses. No migration or destructive change to the original plugin is included.

Primary platform references checked: [Zero](https://spacefast.com/docs/zero-runtime/), [React/auth and framework composition](https://spacefast.com/docs/changelog/v0-5-0/), [Crons](https://spacefast.com/docs/crons/), and the installed SDK/compiler type declarations (0.8.0).
