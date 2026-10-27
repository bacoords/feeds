# Safe ingestion worker

This is a separate Node 24 process, not code running inside a Zero transaction. Zero owns the durable queue, retries, lease expiry, result deduplication and tenant-owned records. No credentials or deployment are included.

Set `FEEDS_APP_URL` to the deployed app's HTTPS origin (no path), and `FEEDS_WORKER_SECRET` to the same strong, random secret configured in the app (at least 32 printable characters). Do not put secrets in committed files or command-line arguments. The app must separately enable live ingestion.

From `apps/spacefast`, run `node --import tsx worker/cli.ts` for one claim, or `node --import tsx worker/cli.ts --loop` for a sequential worker. The loop sleeps 10 seconds when idle or after API errors. SIGINT/SIGTERM finish the in-flight bounded operation before stopping. A failed result submission is left to lease expiry, not blindly retried. Worker logs contain fixed status messages only.

Only fixed `POST /api/worker/claim` and `POST /api/worker/result` routes receive the bearer secret. API redirects are never followed. A claim is either `null` or `{jobId, leaseToken, sourceId, url, etag?, lastModified?}`. Results use `shared/contracts.ts`.

Feed fetching allows HTTPS port 443 only, rejects credentials and IP-literal/special hostnames, checks every returned DNS address, and pins a checked address on each connection. TLS SNI/certificate verification still use the feed's hostname. At most three redirects are revalidated and pinned independently. No authorization headers or cookies are sent to feed hosts. Requests have a 15-second total deadline and a 2 MiB response cap; compression is not accepted. ETag and Last-Modified validators are bounded and not forwarded across origins.

XML is UTF-8 only; DTD/entity declarations are rejected before parsing, entity expansion is disabled, and nested tags are bounded. RSS 2, RSS 1/RDF and Atom normalize into at most 50 unique source-scoped keys. Titles, author names and article bodies are plaintext (500, 200 and 50,000 characters respectively); scripts, styles, images, embeds and external content are never rendered/fetched. A 750,000-byte result budget may further shorten body excerpts, preserving all item identities and metadata instead of dropping articles. Missing/unsafe article links become empty strings. Always render `bodyText` as a text node, not `innerHTML`. This deliberately favors safe failure over compatibility with HTTP, legacy encodings, compressed-only endpoints, nonstandard ports or private feeds.

Tests inject the DNS resolver and transport, never relax production validation or access external feeds. Run `node --import tsx --test tests/ingestion.test.ts`.

Before production, put the worker behind egress controls that independently block private/reserved address ranges, provision/rotate the shared secret securely, and test the deployed claim/result contract. Unit coverage does not prove the platform's live endpoint behavior.
