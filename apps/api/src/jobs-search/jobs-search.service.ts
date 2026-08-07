/**
 * JobsSearchService — public FTS + pg_trgm job search with keyset cursor pagination.
 *
 * CRITICAL INVARIANTS:
 * 1. searchVector is Unsupported("tsvector") — queried via $queryRaw ONLY.
 *    The Prisma query builder cannot reference it. All FTS/rank/trgm is raw SQL.
 * 2. User-supplied values (especially `q`) are ALWAYS bound parameters via
 *    Prisma.sql tagged templates — never string-interpolated (SQL injection guard).
 * 3. Only ACTIVE jobs are returned: enforced in the WHERE clause (status = 'ACTIVE')
 *    and in the detail endpoint (findFirst + status filter).
 * 4. Hydration is via a Prisma findMany with an explicit select (JOB_CARD_SELECT /
 *    JOB_DETAIL_SELECT) so only public-subset fields ever leave this service.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { JobStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import {
  JOB_CARD_SELECT,
  JOB_DETAIL_SELECT,
  JobCard,
  JobDetail,
  toJobCard,
  toJobDetail,
} from './public-job.mapper';
import { SearchCacheService } from './search-cache.service';
import { SavedJobsService } from './saved-jobs.service';
import { SearchQueryDto } from './dto/search-query.dto';

/** The optionally-authenticated viewer of a public job feed. */
export interface JobViewer {
  userId: string;
  role: UserRole;
}

// ─────── Cursor types ─────────────────────────────────────────────────────────

interface RelevanceCursor {
  rank: number;
  publishedAt: string | null;
  id: string;
}

interface RecentCursor {
  publishedAt: string | null;
  id: string;
}

interface SalaryCursor {
  salaryMax: number;
  id: string;
}

type SearchCursor = RelevanceCursor | RecentCursor | SalaryCursor;

function encodeCursor(cursor: SearchCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(raw: string): SearchCursor | null {
  try {
    return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as SearchCursor;
  } catch {
    return null;
  }
}

function isRelevanceCursor(c: SearchCursor): c is RelevanceCursor {
  return 'rank' in c;
}

function isSalaryCursor(c: SearchCursor): c is SalaryCursor {
  return 'salaryMax' in c;
}

// ─────── Raw query row shape ──────────────────────────────────────────────────

interface RawSearchRow {
  id: string;
  publishedAt: Date | null;
  salaryMax: number;
  rank: number;
}

// ─────── Service ──────────────────────────────────────────────────────────────

@Injectable()
export class JobsSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: SearchCacheService,
    private readonly savedJobs: SavedJobsService,
  ) {}

  /**
   * Public job search with cache-through on first pages.
   * Cursor pages (pagination) bypass cache since they are low-traffic and
   * per-cursor caching would require more complex invalidation.
   *
   * `viewer` is optional (routes are @Public with @OptionalAuth): when a
   * candidate is present, isSaved is applied AFTER the cache read so the shared
   * public cache never carries per-user state.
   */
  async search(
    dto: SearchQueryDto,
    viewer?: JobViewer | null,
  ): Promise<{ data: JobCard[]; nextCursor: string | null }> {
    const result = await this.searchPublic(dto);
    await this.applySavedState(result.data, viewer);
    return result;
  }

  /**
   * S8-H1 — SINGLE-FLIGHT (request coalescing) for first-page searches.
   *
   * In-flight uncached searches, keyed by the SAME cache key. When N requests
   * for one key miss together, only the first runs the FTS query; the rest await
   * its promise and share the result.
   *
   * Measured motivation: with a cold cache, a wave of concurrent requests each
   * ran their own copy of the full FTS query. p95 on that path went from ~66ms
   * warm to >12s, while the cache hit rate collapsed — every request paid for a
   * query its neighbours were already running. Note what did NOT fix this: TTL
   * jitter was tried first on a synchronised-expiry hypothesis and the cliff
   * survived it unchanged, because the misses are concurrent rather than
   * simultaneous-on-expiry. Coalescing is the mitigation that matches the cause.
   *
   * Scope is deliberately per-process, not a distributed lock: it needs no Redis
   * round-trip and no lock lifetime to get wrong, and with N API replicas it
   * still cuts concurrent duplicate queries by roughly the per-replica
   * concurrency factor. Entries are always removed in `finally`, so a failed
   * query is never cached as a poisoned promise.
   */
  private readonly inFlight = new Map<string, Promise<{ data: JobCard[]; nextCursor: string | null }>>();

  private async runSearchCoalesced(
    cacheKey: string,
    dto: SearchQueryDto,
  ): Promise<{ data: JobCard[]; nextCursor: string | null }> {
    // ⚠️ EVERY caller gets its OWN clone — waiters included, which is why the
    // clone wraps this lookup rather than sitting only on the producer's path.
    // Coalescing resolves all waiters with the SAME object, and applySavedState
    // MUTATES the returned cards to stamp the viewer's isSaved. Handing two
    // viewers one instance would leak one candidate's saved-jobs state into the
    // other's response — a privacy bug, not just an aliasing bug. The
    // non-coalesced paths are safe because each builds fresh objects (or
    // JSON.parses them from Redis), which is the invariant applySavedState
    // documents.
    const existing = this.inFlight.get(cacheKey);
    if (existing) return structuredClone(await existing);

    const promise = (async () => {
      const result = await this.runSearch(dto);
      await this.cache.setSearch(cacheKey, result);
      return result;
    })();

    this.inFlight.set(cacheKey, promise);
    try {
      return structuredClone(await promise);
    } finally {
      this.inFlight.delete(cacheKey);
    }
  }

  /**
   * The recruiting countries that currently have ACTIVE jobs.
   *
   * Data-driven on purpose: the candidate-facing filter is built from this, so
   * a country becomes searchable the moment an employer publishes a job there
   * and drops off when the last one is archived — no hard-coded list to update.
   *
   * Cached under the SAME version counter as the search itself, so the existing
   * job-state-change bump invalidates this too; a country cannot linger in the
   * filter after its last job goes away (beyond the shared TTL).
   */
  async listCountries(): Promise<Array<{ country: string; count: number }>> {
    const version = await this.cache.getSearchVersion();
    const cacheKey = `search:${version}:countries`;

    const cached = await this.cache.getSearch<Array<{ country: string; count: number }>>(cacheKey);
    if (cached) return cached;

    const rows = await this.prisma.$queryRaw<Array<{ country: string; count: bigint }>>(
      Prisma.sql`
        SELECT j.country AS country, COUNT(*) AS count
        FROM jobs j
        WHERE j.status = 'ACTIVE' AND j.country IS NOT NULL
        GROUP BY j.country
        ORDER BY j.country ASC
      `,
    );

    // COUNT() comes back as bigint, which JSON.stringify throws on.
    const result = rows.map((r) => ({ country: r.country, count: Number(r.count) }));
    await this.cache.setSearch(cacheKey, result);
    return result;
  }

  private async searchPublic(
    dto: SearchQueryDto,
  ): Promise<{ data: JobCard[]; nextCursor: string | null }> {
    if (!dto.cursor) {
      const version = await this.cache.getSearchVersion();
      // Exclude `cursor` from hash — first-page key must not depend on cursor value
      const paramsHash = this.cache.hashParams({
        q: dto.q,
        market: dto.market,
        // MUST be part of the key: two searches differing only by country would
        // otherwise collide and one country's results would be served for another.
        country: dto.country,
        category: dto.category,
        salaryMin: dto.salaryMin,
        salaryMax: dto.salaryMax,
        currency: dto.currency,
        badge: dto.badge,
        sort: dto.sort,
        limit: dto.limit,
      });
      const cacheKey = this.cache.searchCacheKey(version, paramsHash);

      const cached = await this.cache.getSearch<{ data: JobCard[]; nextCursor: string | null }>(cacheKey);
      if (cached) return cached;

      // Miss: coalesce with any identical search already running (S8-H1).
      return this.runSearchCoalesced(cacheKey, dto);
    }

    return this.runSearch(dto);
  }

  /**
   * Sets isSaved on each card for an authenticated CANDIDATE viewer (true/false);
   * leaves it null for guests and non-candidates. Mutates the passed cards, which
   * are always freshly built or freshly deserialized from cache — safe to mutate.
   */
  private async applySavedState(
    cards: { id: string; isSaved: boolean | null }[],
    viewer?: JobViewer | null,
  ): Promise<void> {
    if (!viewer || viewer.role !== UserRole.CANDIDATE || cards.length === 0) return;
    const savedIds = await this.savedJobs.getSavedJobIds(
      viewer.userId,
      cards.map((c) => c.id),
    );
    for (const card of cards) card.isSaved = savedIds.has(card.id);
  }

  /**
   * Active job categories — used to populate the public search filter and the
   * employer job-post category picker. Ordered by English name for stable UI.
   */
  async listCategories(): Promise<
    { id: string; slug: string; nameEn: string; nameHi: string | null; nameAr: string | null }[]
  > {
    return this.prisma.jobCategory.findMany({
      where: { isActive: true },
      select: { id: true, slug: true, nameEn: true, nameHi: true, nameAr: true },
      orderBy: { nameEn: 'asc' },
    });
  }

  /**
   * Public job detail. Returns the public-subset JobDetail for ACTIVE jobs only.
   * Non-active or unknown id → 404 (a paused/archived/draft job is not public).
   * Detail is briefly cached and invalidated by SearchCacheSubscriber on state change.
   *
   * `viewer` is optional; isSaved (on the detail AND its similar cards) is applied
   * AFTER the public cache read so the shared cache stays per-user-agnostic.
   */
  async getDetail(jobId: string, viewer?: JobViewer | null): Promise<JobDetail> {
    const detail = await this.getDetailPublic(jobId);
    // The detail itself is a JobCard-shaped object; batch it with its similar cards.
    await this.applySavedState([detail, ...detail.similar], viewer);
    return detail;
  }

  private async getDetailPublic(jobId: string): Promise<JobDetail> {
    const cached = await this.cache.getDetail<JobDetail>(jobId);
    if (cached) return cached;

    const job = await this.prisma.job.findFirst({
      where: { id: jobId, status: JobStatus.ACTIVE },
      select: JOB_DETAIL_SELECT,
    });
    if (!job) throw new NotFoundException({ code: 'JOB_NOT_FOUND' });

    // Simple same-category OR same-market similar jobs (Phase-2 will add ML ranking)
    const similarRaw = await this.prisma.job.findMany({
      where: {
        id: { not: jobId },
        status: JobStatus.ACTIVE,
        OR: [{ categoryId: job.categoryId }, { market: job.market }],
      },
      orderBy: { publishedAt: 'desc' },
      take: 5,
      select: JOB_CARD_SELECT,
    });

    const detail = toJobDetail(job, similarRaw.map(toJobCard));
    await this.cache.setDetail(jobId, detail);
    return detail;
  }

  // ─────── Core search query ──────────────────────────────────────────────────

  private async runSearch(dto: SearchQueryDto): Promise<{ data: JobCard[]; nextCursor: string | null }> {
    const limit = Math.min(dto.limit ?? 20, 50);
    const q = dto.q?.trim() || null;
    const sortBy = dto.sort ?? (q ? 'relevance' : 'recent');

    // Build parameterized WHERE conditions (all user values are bound parameters)
    const filters: Prisma.Sql[] = [Prisma.sql`j.status = 'ACTIVE'`];

    if (q) {
      // FTS primary match OR trgm similarity for typo tolerance.
      // websearch_to_tsquery parses user input without syntax errors (safer than to_tsquery).
      // q is a bound parameter ($N) — never interpolated.
      //
      // S8-H1 — `title % ${q}`, NOT `similarity(j.title, ${q}) > 0.3`.
      // Semantically identical; the plans are not. `similarity(...) > 0.3` is a
      // function call, and no operator class can index it — Postgres had to
      // Seq Scan `jobs` and evaluate similarity() on EVERY row, which is O(corpus)
      // and measured 256ms over 10k jobs. `%` IS the indexable trgm operator, so
      // the planner can BitmapOr the two GIN indexes (jobs_searchVector_idx +
      // jobs_title_idx): same 445 rows, 47ms, and the cost now scales with the
      // number of MATCHES rather than the size of the corpus.
      //
      // `%` takes its threshold from pg_trgm.similarity_threshold, whose Postgres
      // default is 0.3 — exactly the literal it replaces, so behaviour is
      // unchanged. If that default ever needs pinning, it is a database-level
      // setting (`ALTER DATABASE … SET pg_trgm.similarity_threshold = 0.3`), not
      // a code change. See docs/performance-report.md.
      filters.push(
        Prisma.sql`(j."searchVector" @@ websearch_to_tsquery('english', ${q}) OR j.title % ${q})`,
      );
    }
    if (dto.market) {
      filters.push(Prisma.sql`j.market::text = ${dto.market}`);
    }
    if (dto.country) {
      filters.push(Prisma.sql`j.country = ${dto.country}`);
    }
    if (dto.category) {
      filters.push(Prisma.sql`jc.slug = ${dto.category}`);
    }
    if (dto.salaryMin !== undefined) {
      // Salary range overlap: job's max must be >= requested min
      filters.push(Prisma.sql`j."salaryMax" >= ${dto.salaryMin}`);
    }
    if (dto.salaryMax !== undefined) {
      // Salary range overlap: job's min must be <= requested max
      filters.push(Prisma.sql`j."salaryMin" <= ${dto.salaryMax}`);
    }
    if (dto.currency) {
      filters.push(Prisma.sql`j.currency::text = ${dto.currency}`);
    }
    if (dto.badge === 'featured') {
      filters.push(Prisma.sql`j."isFeatured" = true`);
    } else if (dto.badge === 'urgent') {
      filters.push(Prisma.sql`j."isUrgent" = true`);
    } else if (dto.badge === 'new') {
      filters.push(Prisma.sql`j."publishedAt" >= NOW() - INTERVAL '7 days'`);
    }

    // Keyset cursor WHERE — must match the sort order exactly for stable pagination
    const cursor = dto.cursor ? decodeCursor(dto.cursor) : null;
    if (cursor) {
      if (sortBy === 'relevance' && q && isRelevanceCursor(cursor)) {
        // ORDER BY ts_rank DESC, publishedAt DESC, id DESC
        // Cursor comparison: next page has smaller (rank, publishedAt, id) tuple.
        // publishedAt is a `timestamp without time zone` column — cast the ISO
        // cursor string to ::timestamp (naive, TZ-independent), NOT ::timestamptz,
        // which would force a session-TZ conversion of the column and break
        // pagination whenever the DB session TZ isn't UTC.
        filters.push(
          Prisma.sql`(ts_rank(j."searchVector", websearch_to_tsquery('english', ${q})), j."publishedAt", j.id) < (${cursor.rank}::float4, ${cursor.publishedAt}::timestamp, ${cursor.id}::text)`,
        );
      } else if (sortBy === 'salary' && isSalaryCursor(cursor)) {
        // ORDER BY salaryMax DESC, id DESC
        filters.push(
          Prisma.sql`(j."salaryMax", j.id) < (${cursor.salaryMax}::int, ${cursor.id}::text)`,
        );
      } else if ('publishedAt' in cursor && 'id' in cursor) {
        // ORDER BY publishedAt DESC, id DESC (recent sort). ::timestamp (not
        // ::timestamptz) to match the naive `timestamp without time zone` column
        // — avoids TZ-dependent comparison. See relevance branch above.
        filters.push(
          Prisma.sql`(j."publishedAt", j.id) < (${(cursor as RecentCursor).publishedAt}::timestamp, ${(cursor as RecentCursor).id}::text)`,
        );
      }
    }

    // Rank expression — computed in SELECT and ORDER BY (q value bound each time)
    const rankExpr: Prisma.Sql = q
      ? Prisma.sql`ts_rank(j."searchVector", websearch_to_tsquery('english', ${q}))`
      : Prisma.sql`0::float4`;

    // ORDER BY must be TOTAL (unique) to guarantee stable keyset pagination.
    // Adding `id DESC` as the final tiebreaker makes it injective.
    const orderByClause: Prisma.Sql =
      sortBy === 'relevance' && q
        ? Prisma.sql`${rankExpr} DESC, j."publishedAt" DESC, j.id DESC`
        : sortBy === 'salary'
        ? Prisma.raw('j."salaryMax" DESC, j.id DESC')
        : Prisma.raw('j."publishedAt" DESC, j.id DESC');

    const whereClause = Prisma.join(filters, ' AND ');

    // Execute raw query — searchVector only accessible via $queryRaw
    const rows = await this.prisma.$queryRaw<RawSearchRow[]>(Prisma.sql`
      SELECT
        j.id,
        j."publishedAt" AS "publishedAt",
        j."salaryMax"   AS "salaryMax",
        ${rankExpr}    AS rank
      FROM jobs j
      LEFT JOIN job_categories jc ON jc.id = j."categoryId"
      WHERE ${whereClause}
      ORDER BY ${orderByClause}
      LIMIT ${limit + 1}
    `);

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    if (pageRows.length === 0) return { data: [], nextCursor: null };

    // Encode cursor from the last row on this page
    let nextCursor: string | null = null;
    if (hasMore) {
      const last = pageRows[pageRows.length - 1]!;
      if (sortBy === 'relevance') {
        nextCursor = encodeCursor({
          rank: last.rank,
          publishedAt: last.publishedAt?.toISOString() ?? null,
          id: last.id,
        } satisfies RelevanceCursor);
      } else if (sortBy === 'salary') {
        nextCursor = encodeCursor({ salaryMax: last.salaryMax, id: last.id } satisfies SalaryCursor);
      } else {
        nextCursor = encodeCursor({
          publishedAt: last.publishedAt?.toISOString() ?? null,
          id: last.id,
        } satisfies RecentCursor);
      }
    }

    // Hydrate: fetch public-subset fields via Prisma (type-safe, no searchVector leakage)
    const ids = pageRows.map((r) => r.id);
    const jobs = await this.prisma.job.findMany({
      where: { id: { in: ids } },
      select: JOB_CARD_SELECT,
    });

    // Restore the ranked order from the raw query (Prisma findMany order is undefined)
    const byId = new Map(jobs.map((j) => [j.id, j]));
    const data = ids
      .map((id) => {
        const job = byId.get(id);
        return job ? toJobCard(job) : null;
      })
      .filter((j): j is JobCard => j !== null);

    return { data, nextCursor };
  }
}
