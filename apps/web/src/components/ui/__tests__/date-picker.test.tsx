import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { DatePicker } from '../date-picker';
import { formatDate } from '../../../lib/format/date';

function renderDP(props: Partial<React.ComponentProps<typeof DatePicker>> = {}) {
  const onChange = vi.fn();
  const utils = render(
    <NextIntlClientProvider locale="en" messages={{}}>
      <DatePicker value="" onChange={onChange} {...props} />
    </NextIntlClientProvider>,
  );
  return { onChange, ...utils };
}

describe('DatePicker', () => {
  it('shows the placeholder when empty and the formatted date when set', () => {
    const { rerender } = renderDP({ placeholder: 'Pick a date' });
    expect(screen.getByRole('button', { name: /pick a date/i })).toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={{}}>
        <DatePicker value="2000-06-15" onChange={() => {}} placeholder="Pick a date" />
      </NextIntlClientProvider>,
    );
    // Trigger uses the shared formatDate (en → en-IN, "15 Jun 2000").
    expect(screen.getByText(formatDate(new Date(2000, 5, 15), 'en'))).toBeInTheDocument();
  });

  it('opens the calendar and selecting a day emits YYYY-MM-DD', async () => {
    const user = userEvent.setup();
    const { onChange, container } = renderDP({ value: '2000-06-15' });

    await user.click(screen.getByRole('button'));
    // Month + Year dropdowns are present (exact names avoid the prev/next buttons).
    expect(screen.getByRole('combobox', { name: 'Month' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Year' })).toBeInTheDocument();

    // Click June 10, 2000 (targeted by ISO to avoid adjacent-month collisions).
    await user.click(container.querySelector('[data-iso="2000-06-10"]')!);
    expect(onChange).toHaveBeenCalledWith('2000-06-10');
  });

  it('disables days outside [min, max]', async () => {
    const user = userEvent.setup();
    const { container } = renderDP({ value: '2000-06-15', min: '2000-06-10', max: '2000-06-20' });
    await user.click(screen.getByRole('button'));

    expect(container.querySelector('[data-iso="2000-06-09"]')).toBeDisabled();
    expect(container.querySelector('[data-iso="2000-06-10"]')).not.toBeDisabled();
    expect(container.querySelector('[data-iso="2000-06-20"]')).not.toBeDisabled();
    expect(container.querySelector('[data-iso="2000-06-21"]')).toBeDisabled();
  });

  it('year navigation jumps the grid (the DOB win)', async () => {
    const user = userEvent.setup();
    const { container } = renderDP({ value: '2000-06-15', min: '1990-01-01', max: '2010-12-31' });
    await user.click(screen.getByRole('button'));

    await user.selectOptions(screen.getByLabelText(/year/i), '1995');
    // The grid now shows June 1995 → the 15th of that month exists.
    expect(container.querySelector('[data-iso="1995-06-15"]')).toBeInTheDocument();
    expect(container.querySelector('[data-iso="2000-06-15"]')).toBeNull();
  });

  it('Clear emits an empty string', async () => {
    const user = userEvent.setup();
    const { onChange } = renderDP({ value: '2000-06-15' });
    await user.click(screen.getByRole('button'));
    await user.click(screen.getByRole('button', { name: /clear/i }));
    expect(onChange).toHaveBeenCalledWith('');
  });
});
