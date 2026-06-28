import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OtpEntry } from './OtpEntry';

function setup(onComplete = vi.fn()) {
  render(<OtpEntry onComplete={onComplete} />);
  const cells = screen.getAllByRole('textbox') as HTMLInputElement[];
  return { onComplete, cells };
}

describe('OtpEntry', () => {
  it('renders 6 inputs with correct aria labels', () => {
    const { cells } = setup();
    expect(cells).toHaveLength(6);
    expect(cells[0]).toHaveAccessibleName('OTP digit 1 of 6');
    expect(cells[5]).toHaveAccessibleName('OTP digit 6 of 6');
  });

  it('auto-advances focus on digit entry', async () => {
    const user = userEvent.setup();
    const { cells } = setup();

    await user.type(cells[0]!, '1');
    expect(document.activeElement).toBe(cells[1]);
  });

  it('calls onComplete when all 6 digits are entered', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<OtpEntry onComplete={onComplete} />);
    const cells = screen.getAllByRole('textbox') as HTMLInputElement[];

    for (let i = 0; i < 6; i++) {
      await user.type(cells[i]!, String(i + 1));
    }
    expect(onComplete).toHaveBeenCalledWith('123456');
  });

  it('pastes a 6-digit string across all cells', () => {
    const onComplete = vi.fn();
    render(<OtpEntry onComplete={onComplete} />);
    const firstCell = screen.getAllByRole('textbox')[0] as HTMLInputElement;

    fireEvent.paste(firstCell, {
      clipboardData: { getData: () => '654321' },
    });

    expect(onComplete).toHaveBeenCalledWith('654321');
  });

  it('strips non-digits from pasted text', () => {
    const onComplete = vi.fn();
    render(<OtpEntry onComplete={onComplete} />);
    const firstCell = screen.getAllByRole('textbox')[0] as HTMLInputElement;

    fireEvent.paste(firstCell, {
      clipboardData: { getData: () => '12 34 56' },
    });

    expect(onComplete).toHaveBeenCalledWith('123456');
  });

  it('backspace in empty cell moves focus to previous cell', async () => {
    const user = userEvent.setup();
    const { cells } = setup();

    // Fill first two cells
    await user.type(cells[0]!, '1');
    await user.type(cells[1]!, '2');
    // Now focus is on cell[2]; backspace twice to reach cell[0]
    await user.keyboard('{Backspace}');
    await user.keyboard('{Backspace}');
    await user.keyboard('{Backspace}');
    // After clearing cell[1] we should be back on cell[0]
    expect(document.activeElement).toBe(cells[0]);
  });

  it('disables all inputs when disabled=true', () => {
    render(<OtpEntry onComplete={vi.fn()} disabled />);
    screen.getAllByRole('textbox').forEach((cell) => {
      expect(cell).toBeDisabled();
    });
  });
});
