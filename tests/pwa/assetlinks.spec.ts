import { test, expect } from '@playwright/test';

/**
 * Digital Asset Links — the regression guard.
 *
 * This file is what proves to Android that we own the origin the TWA opens. If
 * it is missing, malformed, locale-redirected, or served as HTML, the app still
 * launches — with a Chrome address bar across the top. It does not error, it
 * just looks broken, which is why it needs a test rather than a memory.
 *
 * WHAT THIS ASSERTS: the shape and the delivery.
 * WHAT IT DOES NOT ASSERT: the fingerprint VALUE. That is environment-specific
 * (debug key vs Play App Signing key vs a local build) so pinning it here would
 * make the test lie in CI while telling the truth on exactly one machine. The
 * real end-to-end check is Google's statusList API — see docs/pwa-play-store.md.
 */

const PATH = '/.well-known/assetlinks.json';

/** The statement type a TWA requires. Anything else and the URL bar stays. */
const TWA_RELATION = 'delegate_permission/common.handle_all_urls';

test.describe('Digital Asset Links', () => {
  test('is served as JSON at the well-known path, not locale-redirected', async ({ request }) => {
    const res = await request.get(PATH, { maxRedirects: 0 });

    // A 307 here means next-intl middleware grabbed the path and sent it to
    // /en/.well-known/... — Android does not follow that, and verification fails.
    expect(res.status(), 'must be served directly, with no locale redirect').toBe(200);
    expect(res.headers()['content-type'] ?? '').toContain('json');
  });

  test('has the exact shape a TWA statement requires', async ({ request }) => {
    const body = await (await request.get(PATH)).json();

    expect(Array.isArray(body), 'the file must be a JSON array of statements').toBe(true);

    const statement = body.find((s: { relation?: string[] }) =>
      s.relation?.includes(TWA_RELATION),
    );
    expect(statement, `no statement with relation "${TWA_RELATION}"`).toBeTruthy();

    expect(statement.target.namespace).toBe('android_app');
    expect(typeof statement.target.package_name).toBe('string');
    expect(statement.target.package_name.length).toBeGreaterThan(0);

    const fingerprints = statement.target.sha256_cert_fingerprints;
    expect(Array.isArray(fingerprints)).toBe(true);
    expect(fingerprints.length).toBeGreaterThan(0);
    expect(typeof fingerprints[0]).toBe('string');
  });
});
