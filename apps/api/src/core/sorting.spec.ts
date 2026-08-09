import { buildOrderBy, resolveSort, type SortWhitelist } from './sorting';

const WL: SortWhitelist = {
  name: 'fullName',
  created: 'createdAt',
  company: 'company.name',
};

describe('resolveSort', () => {
  it('accepts a whitelisted field and direction', () => {
    expect(resolveSort('name:asc', WL, 'created:desc')).toEqual({
      field: 'name',
      direction: 'asc',
      applied: 'name:asc',
    });
  });

  it('falls back for a field that is NOT whitelisted', () => {
    // The security property: an arbitrary column name must never reach Prisma.
    expect(resolveSort('phone:asc', WL, 'created:desc').field).toBe('created');
    expect(resolveSort('passwordHash:desc', WL, 'created:desc').field).toBe('created');
  });

  it('falls back for a nonsense direction rather than erroring', () => {
    // A stale bookmark should still render a list, not a 400.
    expect(resolveSort('name:sideways', WL, 'created:desc').direction).toBe('desc');
  });

  it('uses the endpoint default when sort is absent', () => {
    expect(resolveSort(undefined, WL, 'created:desc').applied).toBe('created:desc');
  });

  it('honours an ascending default', () => {
    expect(resolveSort(undefined, WL, 'name:asc')).toEqual({
      field: 'name',
      direction: 'asc',
      applied: 'name:asc',
    });
  });

  it('ignores a bare field with no direction, keeping the default direction', () => {
    expect(resolveSort('name', WL, 'created:desc')).toEqual({
      field: 'name',
      direction: 'desc',
      applied: 'name:desc',
    });
  });
});

describe('buildOrderBy', () => {
  it('maps the client field to the model column', () => {
    const sort = resolveSort('name:asc', WL, 'created:desc');
    expect(buildOrderBy(sort, WL)).toEqual([{ fullName: 'asc' }, { id: 'asc' }]);
  });

  it('ALWAYS appends id as a tiebreaker', () => {
    // Without it, ordering by a non-unique column is not a total order, and
    // offset pagination can then repeat or skip rows between pages.
    const sort = resolveSort('created:desc', WL, 'created:desc');
    expect(buildOrderBy(sort, WL)).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('expands a dotted target into a nested orderBy', () => {
    const sort = resolveSort('company:asc', WL, 'created:desc');
    expect(buildOrderBy(sort, WL)).toEqual([{ company: { name: 'asc' } }, { id: 'asc' }]);
  });

  it('does not double up when the sort field IS id', () => {
    const sort = resolveSort('id:desc', { id: 'id' }, 'id:desc');
    expect(buildOrderBy(sort, { id: 'id' })).toEqual([{ id: 'desc' }]);
  });
});
