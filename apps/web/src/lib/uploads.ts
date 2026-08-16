/**
 * Client mirror of the upload ceiling.
 *
 * The SERVER is the gate — the presign DTO rejects an oversized declaration and
 * `confirm()` re-checks the real size from a HEAD, because a client can lie
 * about both. This exists so the candidate is told the limit BEFORE they pick a
 * 9 MB photo and wait for it to upload, and so the "Max N MB" hint on the
 * dropzone is the same number the server will actually enforce.
 *
 * Previously each call site passed its own `maxMb` and they had drifted — the
 * onboarding form said 10 MB for a passport while the profile page said 10 and
 * the contract said 5. One constant is the only version of this that stays true.
 *
 * ⚠️ Duplicated from `apps/api/src/core/uploads.ts`, which owns the reasoning
 * and does the enforcing. A test asserts the two agree.
 */
export const MAX_UPLOAD_MB = 2;

export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
