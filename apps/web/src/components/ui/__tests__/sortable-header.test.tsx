import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../../test-utils';
import { SortableHeader, parseSort } from '../sortable-header';

function renderHeader(current: string | undefined, onSort = vi.fn()) {
  render(
    <table>
      <thead>
        <tr>
          <SortableHeader field="name" current={current} onSort={onSort}>
            Name
          </SortableHeader>
        </tr>
      </thead>
    </table>,
  );
  return onSort;
}

describe('parseSort', () => {
  it('splits field and direction', () => {
    expect(parseSort('name:asc')).toEqual({ field: 'name', direction: 'asc' });
  });

  it('defaults to desc for a bare or malformed value', () => {
    expect(parseSort('name')).toEqual({ field: 'name', direction: 'desc' });
    expect(parseSort(undefined)).toEqual({ field: '', direction: 'desc' });
  });
});

describe('SortableHeader', () => {
  it('is a real button inside the th, so it is keyboard reachable', async () => {
    // A clickable <th> would be unreachable without a mouse — the header must
    // expose an actual control.
    const onSort = renderHeader(undefined);
    const btn = screen.getByRole('button', { name: /sort by name/i });

    await userEvent.tab();
    expect(btn).toHaveFocus();

    await userEvent.keyboard('{Enter}');
    expect(onSort).toHaveBeenCalledWith('name:asc');
  });

  it('exposes aria-sort on the th, not the button', () => {
    renderHeader('name:asc');
    // Assistive tech reads aria-sort from the column header itself.
    expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'ascending');
  });

  it('reports no sort state when another column is active', () => {
    renderHeader('created:desc');
    expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'none');
  });

  it('toggles direction when the column is already active', async () => {
    const onSort = renderHeader('name:asc');
    await userEvent.click(screen.getByRole('button'));
    expect(onSort).toHaveBeenCalledWith('name:desc');
  });

  it('reflects the SERVER sort, not the last click', () => {
    // `current` comes from meta.sort. If the server clamped the request, the
    // header must show what actually happened rather than what was asked for.
    renderHeader('created:desc');
    expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'none');
  });

  it('labels the ACTION, so a screen reader knows what pressing it does', () => {
    renderHeader('name:asc');
    expect(screen.getByRole('button', { name: /sort by name, descending/i })).toBeInTheDocument();
  });
});
