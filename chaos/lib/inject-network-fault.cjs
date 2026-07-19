/**
 * S8-H3 — outbound-network fault injector (a `--require` preload).
 *
 * Loaded into the API/worker process with
 * `NODE_OPTIONS=--require ./chaos/lib/inject-network-fault.cjs`, this patches
 * Node's http/https client so that requests to configured hosts FAIL or HANG
 * instead of leaving the machine.
 *
 * Why a preload rather than a flag in the application code:
 *
 *  - It touches ZERO production code. A `if (process.env.CHAOS_…)` branch
 *    inside CheckoutService would be a permanent, shippable footgun and would
 *    also mean the chaos test exercises a special path rather than the real one.
 *  - It is the honest shape of the failure. A gateway outage IS a socket that
 *    refuses or never answers; injecting there means every layer above —
 *    the SDK's own retry/timeout handling, the adapter, the service's catch
 *    block, the exception filter — runs exactly as it would in production.
 *  - It GUARANTEES no packet reaches the real provider, which is a hard
 *    requirement of this unit. The failure happens before DNS resolution.
 *
 * Configuration (env):
 *   CHAOS_FAIL_HOSTS   comma-separated host substrings to break
 *                      e.g. "api.razorpay.com,api.stripe.com"
 *   CHAOS_FAIL_MODE    "refuse"  → immediate ECONNREFUSED-style error (default)
 *                      "timeout" → the socket accepts and then never answers
 *   CHAOS_FAIL_DELAY_MS  for "timeout": how long to hang before erroring
 *                        (default 600000 — effectively forever)
 */
'use strict';

const http = require('node:http');
const https = require('node:https');
const { EventEmitter } = require('node:events');

const HOSTS = (process.env.CHAOS_FAIL_HOSTS || '')
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean);

if (HOSTS.length > 0) {
  const MODE = process.env.CHAOS_FAIL_MODE || 'refuse';
  const DELAY = Number(process.env.CHAOS_FAIL_DELAY_MS || 600_000);

  const targetOf = (args) => {
    // http.request accepts (url), (url, opts), (opts) — normalise to a string
    // we can substring-match against.
    const parts = [];
    for (const a of args) {
      if (typeof a === 'string') parts.push(a);
      else if (a && typeof a === 'object') {
        if (a.host) parts.push(String(a.host));
        if (a.hostname) parts.push(String(a.hostname));
        if (a.href) parts.push(String(a.href));
      }
    }
    return parts.join(' ');
  };

  const shouldBreak = (args) => {
    const t = targetOf(args);
    return HOSTS.some((h) => t.includes(h));
  };

  /**
   * A ClientRequest-shaped stub. It must accept the writes the SDK makes
   * (`write`, `end`, `setTimeout`, `destroy`) and then emit `error`, because
   * that is what a real refused/hung socket does — anything less and the SDK
   * would throw a TypeError instead of exercising its error handling.
   */
  function brokenRequest(cb) {
    const req = new EventEmitter();
    req.write = () => true;
    req.setHeader = () => req;
    req.getHeader = () => undefined;
    req.removeHeader = () => req;
    req.setTimeout = (ms, handler) => {
      if (handler) setTimeout(handler, ms);
      return req;
    };
    req.destroy = (err) => {
      if (err) req.emit('error', err);
      return req;
    };
    req.abort = () => req.destroy();
    req.end = () => {
      const fire = () => {
        const err = new Error(
          MODE === 'timeout'
            ? 'CHAOS: upstream timed out (injected)'
            : 'CHAOS: connect ECONNREFUSED (injected)',
        );
        err.code = MODE === 'timeout' ? 'ETIMEDOUT' : 'ECONNREFUSED';
        err.chaosInjected = true;
        req.emit('error', err);
      };
      // `setImmediate` for refuse so the caller has attached its listeners.
      if (MODE === 'timeout') setTimeout(fire, DELAY).unref?.();
      else setImmediate(fire);
      return req;
    };
    if (typeof cb === 'function') {
      // Never invoke the response callback — the whole point is no response.
    }
    return req;
  }

  for (const mod of [http, https]) {
    const realRequest = mod.request.bind(mod);
    const realGet = mod.get.bind(mod);

    mod.request = function patchedRequest(...args) {
      if (shouldBreak(args)) {
        const cb = args.find((a) => typeof a === 'function');
        return brokenRequest(cb);
      }
      return realRequest(...args);
    };
    mod.get = function patchedGet(...args) {
      if (shouldBreak(args)) {
        const cb = args.find((a) => typeof a === 'function');
        const req = brokenRequest(cb);
        req.end();
        return req;
      }
      return realGet(...args);
    };
  }

  // Announce loudly — a chaos run that silently failed to inject would
  // "pass" every assertion while proving nothing at all.
  console.log(
    `[chaos] network fault ACTIVE mode=${MODE} hosts=${HOSTS.join(',')}` +
      (MODE === 'timeout' ? ` delay=${DELAY}ms` : ''),
  );
}
