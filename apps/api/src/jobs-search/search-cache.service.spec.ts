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

    // S8-H1: the version read is memoized in-process for a second. Without it,
    // EVERY cached search paid a second sequential Redis round-trip — and one
    // that always MISSES until the first job state change ever writes the key.
    it('memoizes the version so back-to-back reads hit Redis once', async () => {
      redis.get.mockResolvedValue('3');
      expect(await cache.getSearchVersion()).toBe(3);
      expect(await cache.getSearchVersion()).toBe(3);
      expect(await cache.getSearchVersion()).toBe(3);
      expect(redis.get).toHaveBeenCalledTimes(1);
    });

    it('drops the memo on bump so the bumping process never serves its own stale version', async () => {
      redis.get.mockResolvedValue('3');
      expect(await cache.getSearchVersion()).toBe(3);

      redis.incr.mockResolvedValue(4);
      await cache.bumpSearchVersion();

      redis.get.mockResolvedValue('4');
      expect(await cache.getSearchVersion()).toBe(4);
      expect(redis.get).toHaveBeenCalledTimes(2);
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
    it('calls SETEX with the base TTL plus jitter (60–74s)', async () => {
      redis.setex.mockResolvedValue('OK');
      await cache.setSearch('search:1:abc', { data: [], nextCursor: null });
      const [key, ttl, payload] = redis.setex.mock.calls[0]!;
      expect(key).toBe('search:1:abc');
      expect(typeof payload).toBe('string');
      // S8-H1: jittered so a burst of keys does not expire as one cohort and
      // stampede the FTS query. Never below the documented 60s floor.
      expect(ttl).toBeGreaterThanOrEqual(60);
      expect(ttl).toBeLessThan(75);
    });

    it('spreads TTLs across writes rather than reusing one value', async () => {
      redis.setex.mockResolvedValue('OK');
      for (let i = 0; i < 40; i++) {
        await cache.setSearch(`search:1:k${i}`, { data: [], nextCursor: null });
      }
      const ttls = new Set(redis.setex.mock.calls.map((c) => c[1]));
      // With a 15s window over 40 writes, a fixed TTL (the pre-S8-H1 bug this
      // guards) would collapse this to exactly one distinct value.
      expect(ttls.size).toBeGreaterThan(1);
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
        .mockResolvedValueOnce(null) // miss
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
