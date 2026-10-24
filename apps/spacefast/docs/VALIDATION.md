# Prototype verification record

Baseline: `bacoords/feeds` main `a4b9cd386630f8f24cbe9c62bcb6fa1b909f53a8`. Original plugin files, root dependency manifests, PHP and WordPress UI are preserved. Only `apps/spacefast/` and a scoped CI workflow are added.

## Passed locally

- ESLint and strict TypeScript across UI, server, worker, scripts and tests.
- Unit/contract tests for guest rejection and cross-user read/mutation isolation; independent read/star state and content upserts; idempotent add/refresh/result handling; missed dispatches, transient retries, lease expiry, restart persistence, stale lease fencing and transaction rollback in the test harness; conditional HTTP responses; bounded dashboard/details and storage limits.
- Ingestion tests for DNS/IP classification and pinning, TLS hostname checks, redirects/rebinding, private/cloud-metadata ranges, header injection, response/deadline limits, compression rejection, DTD/entities, malformed/deep XML, RSS/Atom/RDF, stable source-scoped IDs, plaintext output and payload budgets.
- Native Zero ingestion tests cover bearer rejection, disabled trigger/probe, one-feed ticks, durable retry/recovery, rollback, read/star preservation, bounded streaming and strict UTF-8, plus an unchanged maintained validator/tokenizer bundle accepted by the real compiler. Vendor source hashes/licenses reproduce from the lockfile; parser tests run without Node/DOM globals. These are injected-network tests, not proof of hosted streaming.
- React UI state tests and real React server-render tests demonstrating article markup stays escaped.
- Compiler-generated runtime adapters executed in an isolated Node VM: public health, disabled/missing-credential worker routes, and every reader query/mutation rejecting signed-out/guest identities before data access. This caught a blanket `requireSignIn` gate that otherwise preempted machine authentication. Node VM execution is not hosted QuickJS or a real session test.
- Narrow-layout source regression removes the fixed 320px body minimum so a 313px content area (320px-class viewport minus scrollbar) can shrink without concealing overflow. V2 hosted signed-out checks confirmed no overflow at 321px/200% zoom, public health 200 and disabled worker routes 503. Native-ingestion changes require their own hosted check.
- Vite production build with no `wp` globals; native Zero compiler including explicit schema/index parity assertions, three tables, native queries/mutations and worker endpoints.
- Official `spacefast` CLI 0.5 framework+Zero assembly exercised locally, including Vite index/assets plus server/runtime metadata and migrations. Configuration dry-run accepted.
- Locked dependency audit repeated after transitive fixes. See the PR's final check output for the exact count/date; audit results change over time.

## Not yet established

- Signed-in browser/keyboard/320px/200% zoom/both-theme coverage. Signed-out V2 screenshots and native sign-in entry were inspected in the cloud browser. Local Chromium could not start because the executor rejected socket creation; an approved retry failed environment mount setup. Validate the exact new deployed version, not a different mocked artifact.
- Native app login, callback, interrupted login/retry, logout, expiry/revocation and two real user accounts. A connected Spacefast management account does not establish these.
- Hosted native-ingestion QuickJS execution and bounded response reads, MySQL uniqueness/locking/isolation, concurrent add/claim/result behavior, transaction rollback, data migration and export/restore. V2 health/disabled endpoints execute; the SQLite harness serializes transactions and is not a MySQL simulator.
- Actual external feed network fetches, native scheduler bearer injection, finalized server-secret binding and credential rotation. Current docs do not establish the historical `CRON_SECRET` injection behavior. Marker headers alone are never accepted. Network tests use injected transports.
- Live scheduled polling. There is no active cron or worker; source activation fails closed by default.
- Full WordPress regression test/build. No original plugin file is changed, and its existing tests/build are not represented as passing.

## Required before enabling ingestion

1. Verify native app sessions and every ownership boundary using two independent identities. Reject guests, invalid/expired sessions and cross-user IDs.
2. Validate source/job uniqueness and competing claims against the actual database. Add supported unique constraints/atomic locking or a verified single-consumer guarantee. Do not infer them from transaction-shaped handlers or unit tests.
3. Prove rollback of a result that fails midway and replay rejection across pause/delete/restart. Test large inputs against actual response/request limits.
4. Verify `CRON_SECRET` server binding and `/api/cron/ingest`, including missing/wrong secret, unexpected cookies and redacted logs. First prove actual scheduled bearer delivery with ingestion disabled. If native injection is unavailable, use only an approved external bearer trigger; ingestion stays on Spacefast. Verify actual bounded body reads and host deadline behavior before activation. Do not treat a marker header as scheduler identity.
5. Exercise a real HTTPS RSS and Atom feed, redirects, conditional fetch, retry and interrupted native-tick recovery; show attempt/success/next-check timestamps accurately. Keep one non-overlapping trigger; do not infer general concurrency safety from the native scheduler's overlap protection.
6. Demonstrate backup/export and restore before importing valuable reading history. OPML alone does not preserve history or stars.
7. Measure signed-in bundle performance and UI accessibility on the actual private version. DataViews is a relatively large dependency: initial frontend approximately153KB gzip plus the lazy reader approximately253KB gzip (exact final hashes/sizes from build output).

## Design review

No saved team design system was available, so design-system conformance cannot be marked passed. The user's existing WordPress UI language governs the implementation. Source review follows the available front-end standards: semantic landmarks, clear labels, focus states, responsive CSS and light/dark tokens; no invented testimonials, public metrics or decorative landing-page claims. The mandatory deployed visual/keyboard checks remain explicit gates.
