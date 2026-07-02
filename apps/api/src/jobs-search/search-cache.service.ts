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

@Injectable()
export class SearchCacheService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async getSearchVersion(): Promise<number> {
    const v = await this.redis.get(CACHE_VER_KEY);
    return v ? parseInt(v, 10) : 0;
  }

  async bumpSearchVersion(): Promise<void> {
    await this.redis.incr(CACHE_VER_KEY);
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
    await this.redis.setex(key, SEARCH_TTL_S, JSON.stringify(value));
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
