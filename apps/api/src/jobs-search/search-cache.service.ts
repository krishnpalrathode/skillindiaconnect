/**
 * Redis search cache — cache-version-bump approach.
 *
 * Strategy (chosen over pattern-delete for performance):
 *   - A monotonic version integer lives at `search:ver`.
 *   - Every search result key embeds that version: `search:{ver}:{paramsHash}`.
 *   - On any job-state change (published / paused / archived), SearchCacheSubscriber
 *     calls bumpSearchVersion() which INCRs the counter. All keys from the previous
 *     version become unreachable and expire naturally via their TTL. No SCAN needed.
 *   - Job detail pages are cached separately at `job:detail:{id}` and explicitly DEL'd
 *     on each state change so the detail reflects the new state immediately.
 *
 * Cache scope:
 *   - First-page (no cursor) search results are cached (these are the hot shapes hit
 *     by landing page / SSR). Cursor pages are NOT cached — they are rare enough
 *     that per-cursor caching would bloat Redis without material benefit.
 *   - Job detail is cached with a shorter TTL for SSR warm-up.
 */
import { createHash } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../core/redis/redis.provider';

const CACHE_VER_KEY = 'search:ver';
const SEARCH_TTL_S = 60;
const DETAIL_TTL_S = 30;

/**
 * S8-H1 — TTL JITTER. Every key written in the same burst used to carry exactly
 * SEARCH_TTL_S, so a burst of traffic created a cohort of keys that all expired
 * in the SAME second. Load testing reproduced the consequence twice: the request
 * wave arriving just after a cohort expiry found every shape uncached at once and
 * ran the full FTS query concurrently — p95 jumped from ~106ms to ~5.5s while
 * neighbouring load levels were fine. Spreading expiry over a window breaks the
 * cohort up so misses trickle instead of arriving all at once.
 */
const SEARCH_TTL_JITTER_S = 15;

/**
 * S8-H1 — how long a process may reuse the cache version without re-reading it.
 * See getSearchVersion below.
 */
const VERSION_MEMO_MS = 1_000;

@Injectable()
export class SearchCacheService {
  private memoVersion: { value: number; readAt: number } | null = null;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * The cache version, memoized in-process for VERSION_MEMO_MS.
   *
   * Why: every cached search costs TWO SEQUENTIAL Redis round-trips — read the
   * version, then read the result keyed by it (the second key is not knowable
   * until the first returns, so they cannot be pipelined). Worse, `search:ver`
   * does not exist until the first job state change ever bumps it, so on a fresh
   * deployment that first round-trip is a GUARANTEED MISS on every single search
   * request — measured as a flat ~50% Redis keyspace hit rate on this path that
   * was purely the version lookup, not the result cache.
   *
   * The memo halves the round-trips. It costs up to VERSION_MEMO_MS of delay in
   * noticing an invalidation — which is immaterial, because a cached RESULT is
   * already allowed to be up to SEARCH_TTL_S (60s) stale. One second of extra
   * version staleness cannot make the feed staler than the TTL already permits.
   */
  async getSearchVersion(): Promise<number> {
    const now = Date.now();
    if (this.memoVersion && now - this.memoVersion.readAt < VERSION_MEMO_MS) {
      return this.memoVersion.value;
    }
    const v = await this.redis.get(CACHE_VER_KEY);
    const value = v ? parseInt(v, 10) : 0;
    this.memoVersion = { value, readAt: now };
    return value;
  }

  async bumpSearchVersion(): Promise<void> {
    await this.redis.incr(CACHE_VER_KEY);
    // Drop this process's memo immediately so the bumping process at least
    // never serves its own stale version. Other replicas converge within
    // VERSION_MEMO_MS.
    this.memoVersion = null;
  }

  /**
   * Deterministic hash of the query params used as the per-version cache discriminator.
   * Undefined/null values are excluded so `?q=` and `?q` hash the same as no-q.
   */
  hashParams(params: Record<string, unknown>): string {
    const normalized = Object.fromEntries(
      Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .sort(([a], [b]) => a.localeCompare(b)),
    );
    return createHash('sha256').update(JSON.stringify(normalized)).digest('hex').slice(0, 16);
  }

  searchCacheKey(version: number, paramsHash: string): string {
    return `search:${version}:${paramsHash}`;
  }

  detailCacheKey(jobId: string): string {
    return `job:detail:${jobId}`;
  }

  async getSearch<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async setSearch<T>(key: string, value: T): Promise<void> {
    // Jittered TTL — see SEARCH_TTL_JITTER_S. Never shorter than SEARCH_TTL_S,
    // so this only ever lengthens cache lifetime; it cannot make results staler
    // than the documented ceiling by more than the jitter window.
    const ttl = SEARCH_TTL_S + Math.floor(Math.random() * SEARCH_TTL_JITTER_S);
    await this.redis.setex(key, ttl, JSON.stringify(value));
  }

  async getDetail<T>(jobId: string): Promise<T | null> {
    const raw = await this.redis.get(this.detailCacheKey(jobId));
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async setDetail<T>(jobId: string, value: T): Promise<void> {
    await this.redis.setex(this.detailCacheKey(jobId), DETAIL_TTL_S, JSON.stringify(value));
  }

  async invalidateJobDetail(jobId: string): Promise<void> {
    await this.redis.del(this.detailCacheKey(jobId));
  }
}
