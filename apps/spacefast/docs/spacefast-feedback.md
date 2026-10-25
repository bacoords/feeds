# Spacefast feedback log

Questions and developer-experience notes collected while building the Feeds prototype. This is a working log for a future conversation with the Spacefast team, **not a submitted support report or a list of confirmed platform defects**.

Last updated: **2026-10-25 (UTC)**. Implementation reference: `77888e3f0039ec562fa306790fa001bfaa441b33`, using `@spacefast/zero`, `@spacefast/zero-compile` and `@spacefast/common` 0.8.0. Historical observations below are not promises about future releases.

Recurring ingestion remains disabled. The project owner has deferred scheduler/auth investigation and plans to ask the Spacefast team. Recording these questions does not authorize new credentials, settings changes, scheduled jobs, or sending feedback to the team.

## SF-001: Authenticating a native scheduled request

- **Logged:** 2026-10-25.
- **Type:** Documentation/contract clarification; not an established vulnerability.
- **Unclear behavior:** What trusted evidence should an app use to distinguish a genuine native scheduled request from a public request to the same endpoint?
- **Observed evidence:** The [cron guide](https://spacefast.com/docs/crons/) describes scheduled requests and a platform-owned `x-spacefast-cron` header. The [manual run API](https://spacefast.com/docs/api/reference/spaces/runspacecron) does not supply that scheduler marker. The current documentation reviewed did not establish its exact value or an explicit guarantee that caller-supplied copies are stripped before application code. We also did not verify automatic `CRON_SECRET` bearer injection in the current runtime. A manual run without scheduler authentication therefore cannot prove how an actual scheduled invocation authenticates.
- **Impact:** We cannot yet establish which supported authentication contract our recurring endpoint should rely on. The prototype rejects marker-only requests and leaves fetching disabled.
- **Our implementation choice:** A server-only bearer secret named `CRON_SECRET` is our proposed safeguard. It is **not a verified Spacefast requirement**, and using that name does not prove the platform injects it. No secret was provisioned for this proposed test. The [trigger implementation](../server/native-ingestion.ts) fails closed when it is unconfigured.
- **Questions for the team:**
  1. Is there a documented, spoof-resistant native scheduler identity contract, including edge stripping and the exact application-visible signal?
  2. Does the current scheduler inject a configured bearer secret? If so, what variable/configuration and runtime-finalization steps are required?
  3. What is the supported way to test genuine scheduled authentication without enabling feed ingestion? How should developers interpret differences from a manual cron run?
- **Status:** Deferred at the owner's request; awaiting a future team discussion. No further scheduler/auth investigation or activation is planned now.

## SF-002: App-specific accounts versus the generic Spacefast sign-in screen

- **Logged:** 2026-10-25.
- **Type:** Configuration/onboarding clarity; no provider failure established.
- **Unclear behavior:** Which sign-in experience should a standalone app expose, and how do app accounts relate to Spacefast access and management accounts?
- **Observed evidence:** The prototype's signed-out button opened a Spacefast sign-in entry, but a successful app login and reader session were not verified. A read-only settings inspection showed the app-account master setting off; managed Google was available but its mode was off; Gravatar and Spacefast provider flags were true beneath the disabled master setting. Those subordinate flags are not evidence that the providers are effectively enabled. The [0.5.0 release notes](https://spacefast.com/docs/changelog/v0-5-0/#spacefastzero) introduce per-Space accounts and providers. The [settings API](https://spacefast.com/docs/api/reference/spaces/getspaceuserssettings) distinguishes app accounts from team/Space access. The [CLI reference](https://spacefast.com/docs/cli/reference#sf-users-settings) exposes a master switch and separate provider settings.
- **Impact:** A working sign-in link alone is insufficient to claim that app-specific onboarding, sessions, or per-user reader data work. The current settings need interpretation before any approved configuration change.
- **Questions for the team:**
  1. What is the recommended configuration and UI flow for a public standalone app whose readers should not need a Spacefast management account?
  2. How does the master setting interact with provider flags, and can the UI/API clearly report effective availability rather than just stored preferences?
  3. Is email-code sign-in available for app accounts, or only through another access flow? Which providers require app-owned credentials versus managed configuration?
  4. What stable user identifier should applications persist? How are guest upgrades, provider linking, and migration between sign-in methods handled without orphaning existing user data?
- **Status:** Open clarification, deferred alongside auth setup. No account/provider settings changed and no defect asserted.

## SF-003: Bounded outbound reads and Zero runtime limits

- **Logged:** 2026-10-25.
- **Type:** Runtime contract clarification and correction to our initial architecture assumption.
- **Unclear behavior:** Which response-reading APIs and resource limits are guaranteed by Zero's hosted fetch bridge, rather than by a browser or Node fetch implementation?
- **Observed evidence:** The [Zero guide](https://spacefast.com/docs/zero-runtime/) documents outbound fetching and a five-second timeout per write-side fetch. The installed `@spacefast/common` 0.8.0 package's `dist/contracts/egress.js` explicitly describes private-range/cloud-metadata blocking, DNS pinning, and redirect-hop checks as unconditional safeguards for both Zero and Functions. This is positive evidence of platform protections, not evidence of an SSRF defect. The reviewed material did not establish `Response.body.getReader()` availability, a host-enforced decoded-body byte cap, cancellation behavior, or whether a fetch deadline includes consuming the body.
- **Correction:** We initially treated the absence of Node DNS/socket APIs as a reason to require a separately hosted worker. That was too restrictive given the platform egress contract. The selected implementation now targets the same Zero Space; the old Node adapter is optional reference code, not a deployment requirement.
- **Impact:** The [native adapter](../server/native-fetch.ts) requires bounded body reads and refuses to silently fall back to buffering an entire response. Its 256 KiB limit and timeout/error handling pass injected-network tests, but those tests do not establish hosted QuickJS capabilities. Native recurring ingestion therefore remains unverified and disabled.
- **Questions for the team:**
  1. What exact fetch/Response subset is supported, including streaming, manual redirects, cancellation, and compression?
  2. Are response bytes capped before buffering, and does the deadline cover headers and complete body consumption? How are those failures surfaced to a write handler?
  3. What execution/memory limits apply to a write endpoint doing one bounded fetch, parse, and database update? Can a short native ingestion recipe document the supported combination and link to the egress guarantees?
- **Status:** Open documentation question; implementation is fail-closed. The external-worker assumption is corrected. No additional runtime probing is planned while this work is deferred.

## SF-004: Diagnosing authentication errors before endpoint handlers

- **Logged:** 2026-10-25, from the initial deployed prototype and its subsequent fix.
- **Type:** Our resolved configuration error, with a developer-diagnostics suggestion.
- **Observed evidence:** We originally set capsule-wide `auth.requireSignIn: true` while also defining public health and machine-authenticated endpoints. Signed-out requests returned HTTP 500 with `zero_js_execution_failed` and a generic QuickJS exception before the endpoint handler ran. The runtime logs checked during diagnosis did not expose a useful stack. Executing the actual compiler-generated adapter in an isolated test reproduced the pre-handler authentication rejection. This was not evidence that all Zero handlers or the database were broken.
- **Our fix and result:** We removed the blanket gate and retained explicit authenticated-owner checks in every reader query/mutation, plus separate machine-endpoint authorization. Hosted checks then confirmed health HTTP 200 and disabled ingestion endpoints HTTP 503. [Compiled-runtime regression tests](../tests/compiled-runtime.test.ts) cover these boundaries. Signed-in reader/session validation remains separate and incomplete.
- **Impact:** The generic runtime error initially made an application authentication-policy mistake look like a bundle/runtime failure.
- **Questions for the team:** Could the docs show the interaction between capsule-wide sign-in requirements and mixed public/machine/user endpoints? Could expected authentication failures expose an actionable, non-sensitive error category or diagnostic reference without leaking user information?
- **Status:** Application error fixed. Optional documentation/diagnostics feedback remains open; no unresolved platform defect claimed.

## Updating this log

Add dated observations, exact version context, and reproducible evidence when available. Separate confirmed behavior, unverified assumptions, application mistakes, and product suggestions. Record team answers and resolved items rather than deleting their history. Never include credentials, cookies, user records, or raw private logs. Sharing this log with the team is a separate decision.

For the broader test record and release gates, see [VALIDATION.md](VALIDATION.md).
