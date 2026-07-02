/**
 * Unit tests for SearchCacheService — verifies the version-bump caching contract.
 *
 * All Redis calls are mocked. Tests:
 * - Cache hit: repeated search key returns cached data without re-querying.
 * - Version bump: bumpSearchVersion increments the version counter.
 * - Key derivation: searchCacheKey embeds the version and a stable param hash.
 * - Detail invalidation: invalidateJobDetail deletes the correct key.
 * - hashParams: excludes undefined/null/empty values; is order-invariant.
 */
import { SearchCacheService } from './search-cache.service';

function makeRedisMock() {
  return {
    get: jest.fn(),
    set: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
    incr: jest.fn(),
  };
}

function makeModule(redisMock: ReturnType<typeof makeRedisMock>): SearchCacheService {
  // Directly construct to avoid NestJS DI overhead in unit tests
  const service = new SearchCacheService(redisMock as never);
  // Inject the mock under the expected token key (bypass DI)
  Object.defineProperty(service, 'redis', { value: redisMock, writable: false });
  return service;
}

describe('SearchCacheService', () => {
  let redis: ReturnType<typeof makeRedisMock>;
  let cache: SearchCacheService;

  beforeEach(() => {
    redis = makeRedisMock();
    cache = makeModule(redis);
  });

  // ── Version management ────────────────────────────────────────────────────

  describe('getSearchVersion', () => {
    it('returns 0 when key does not exist', async () => {
      redis.get.mockResolvedValue(null);
      expect(await cache.getSearchVersion()).toBe(0);
    });

    it('returns parsed integer from Redis', async () => {
      redis.get.mockResolvedValue('7');
      expect(await cache.getSearchVersion()).toBe(7);
    });
  });

  describe('bumpSearchVersion', () => {
    it('calls INCR on the version key', async () => {
      redis.incr.mockResolvedValue(2);
      await cache.bumpSearchVersion();
      expect(redis.incr).toHaveBeenCalledWith('search:ver');
    });
  });

  // ── Key derivation ────────────────────────────────────────────────────────

  describe('searchCacheKey', () => {
    it('embeds version and hash', () => {
      const key = cache.searchCacheKey(5, 'abc123');
      expect(key).toBe('search:5:abc123');
    });
  });

  describe('detailCacheKey', () => {
    it('returns job:detail:{id}', () => {
      expect(cache.detailCacheKey('job-xyz')).toBe('job:detail:job-xyz');
    });
  });

  // ── hashParams ────────────────────────────────────────────────────────────

  describe('hashParams', () => {
    it('produces consistent hashes regardless of key order', () => {
      const h1 = cache.hashParams({ q: 'plumber', market: 'LOCAL' });
      const h2 = cache.hashParams({ market: 'LOCAL', q: 'plumber' });
      expect(h1).toBe(h2);
    });

    it('excludes undefined and null values', () => {
      const h1 = cache.hashParams({ q: 'plumber', market: undefined, cursor: null });
      const h2 = cache.hashParams({ q: 'plumber' });
      expect(h1).toBe(h2);
    });

    it('excludes empty string values', () => {
      const h1 = cache.hashParams({ q: 'plumber', category: '' });
      const h2 = cache.hashParams({ q: 'plumber' });
      expect(h1).toBe(h2);
    });

    it('produces different hashes for different params', () => {
      const h1 = cache.hashParams({ q: 'plumber' });
      const h2 = cache.hashParams({ q: 'electrician' });
      expect(h1).not.toBe(h2);
    });

    it('returns a 16-char hex string', () => {
      const h = cache.hashParams({ q: 'test' });
      expect(h).toMatch(/^[0-9a-f]{16}$/);
    });
  });

  // ── Search get/set ────────────────────────────────────────────────────────

  describe('getSearch', () => {
    it('returns null on cache miss', async () => {
      redis.get.mockResolvedValue(null);
      expect(await cache.getSearch('search:1:abc')).toBeNull();
    });

    it('returns parsed value on cache hit', async () => {
      const data = { data: [{ id: 'j1' }], nextCursor: null };
      redis.get.mockResolvedValue(JSON.stringify(data));
      expect(await cache.getSearch('search:1:abc')).toEqual(data);
    });
  });

  describe('setSearch', () => {
    it('calls SETEX with SEARCH_TTL (60s)', async () => {
      redis.setex.mockResolvedValue('OK');
      await cache.setSearch('search:1:abc', { data: [], nextCursor: null });
      expect(redis.setex).toHaveBeenCalledWith('search:1:abc', 60, expect.any(String));
    });
  });

  // ── Detail get/set/invalidate ─────────────────────────────────────────────

  describe('getDetail / setDetail / invalidateJobDetail', () => {
    it('getDetail returns null on miss', async () => {
      redis.get.mockResolvedValue(null);
      expect(await cache.getDetail('job-1')).toBeNull();
    });

    it('setDetail calls SETEX with DETAIL_TTL (30s)', async () => {
      redis.setex.mockResolvedValue('OK');
      await cache.setDetail('job-1', { id: 'job-1' });
      expect(redis.setex).toHaveBeenCalledWith('job:detail:job-1', 30, expect.any(String));
    });

    it('invalidateJobDetail calls DEL on the detail key', async () => {
      redis.del.mockResolvedValue(1);
      await cache.invalidateJobDetail('job-1');
      expect(redis.del).toHaveBeenCalledWith('job:detail:job-1');
    });
  });

  // ── Read-through simulation ───────────────────────────────────────────────

  describe('cache read-through pattern', () => {
    it('a cache hit means the DB query is not called a second time', async () => {
      const result = { data: [{ id: 'j1', title: 'Mason' }], nextCursor: null };
      const mockQuery = jest.fn().mockResolvedValue(result);

      // First call: miss → call query → store in cache
      redis.get
        .mockResolvedValueOnce(null)       // miss
        .mockResolvedValueOnce(JSON.stringify(result)); // hit on second
      redis.incr.mockResolvedValue(1);
      redis.setex.mockResolvedValue('OK');

      // Simulate the cache-through pattern used by JobsSearchService
      async function cachedSearch(key: string) {
        const hit = await cache.getSearch(key);
        if (hit) return hit;
        const data = await mockQuery();
        await cache.setSearch(key, data);
        return data;
      }

      await cachedSearch('search:1:aabbcc');
      await cachedSearch('search:1:aabbcc');

      expect(mockQuery).toHaveBeenCalledTimes(1);
    });
  });
});
