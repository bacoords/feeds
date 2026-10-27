import { setTimeout as delay } from 'node:timers/promises';
import { createWorkerApi, readConfig, runOnce } from './index.js';
import { IngestionError } from './safe-fetch.js';

// Run once by default. --loop polls sequentially with a short idle/backoff delay, never overlaps jobs.
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--loop')) throw new IngestionError('INVALID_ARGUMENT');
  const api = createWorkerApi(readConfig(process.env));
  const loop = args.includes('--loop');
  const stop = new AbortController();
  process.once('SIGINT', () => stop.abort());
  process.once('SIGTERM', () => stop.abort());
  do {
    let status: string;
    try {
      status = await runOnce(api);
      process.stdout.write(`Feeds worker: ${status}\n`);
    } catch {
      // Never print exceptions/config/headers: an upstream failure must not disclose the secret.
      process.stderr.write('Feeds worker: API operation failed; lease expiry will permit retry.\n');
      if (!loop) { process.exitCode = 1; return; }
      status = 'api_failure';
    }
    if (!loop || stop.signal.aborted) return;
    if (status === 'idle' || status === 'api_failure') {
      try { await delay(10_000, undefined, { signal: stop.signal }); } catch { return; }
    }
  } while (!stop.signal.aborted);
}

main().catch(() => {
  process.stderr.write('Feeds worker: invalid configuration. Set HTTPS FEEDS_APP_URL and a 32+ character FEEDS_WORKER_SECRET.\n');
  process.exitCode = 1;
});
