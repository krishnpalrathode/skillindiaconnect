'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/format/date';

export interface DatePickerProps {
  /** id for the trigger button (so a <label htmlFor> associates with it). */
  id?: string;
  /** Current value as `YYYY-MM-DD`, or '' when unset. */
  value: string;
  onChange: (value: string) => void;
  /** Inclusive bounds as `YYYY-MM-DD`. Out-of-range days are disabled. */
  min?: string;
  max?: string;
  placeholder?: string;
  className?: string;
  hasError?: boolean;
  'aria-label'?: string;
  /** Control labels (localize by passing translated strings; sensible English defaults). */
  labels?: Partial<{
    prevMonth: string;
    nextMonth: string;
    month: string;
    year: string;
    clear: string;
    today: string;
  }>;
}

// ── date helpers (local time, day-granular) ─────────────────────────────────────
function parseISO(s?: string): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}
function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
function clampDate(d: Date, min: Date | null, max: Date | null): Date {
  if (min && d < min) return new Date(min);
  if (max && d > max) return new Date(max);
  return d;
}

export function DatePicker({
  id,
  value,
  onChange,
  min,
  max,
  placeholder = 'Select date',
  className,
  hasError,
  labels,
  ...aria
}: DatePickerProps) {
  const locale = useLocale();
  const isRtl = locale === 'ar';
  const L = {
    prevMonth: labels?.prevMonth ?? 'Previous month',
    nextMonth: labels?.nextMonth ?? 'Next month',
    month: labels?.month ?? 'Month',
    year: labels?.year ?? 'Year',
    clear: labels?.clear ?? 'Clear',
    today: labels?.today ?? 'Today',
  };

  const selected = useMemo(() => parseISO(value), [value]);
  const minDate = useMemo(() => parseISO(min), [min]);
  const maxDate = useMemo(() => parseISO(max), [max]);
  const today = useMemo(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }, []);

  const [open, setOpen] = useState(false);
  // Which month the grid shows. Default: the value's month, else the max bound
  // (for a DOB that lands the user near a plausible birth year, not 100y ago).
  const initialView = selected ?? maxDate ?? today;
  const [view, setView] = useState({
    year: initialView.getFullYear(),
    month: initialView.getMonth(),
  });
  // The date holding roving focus inside the grid.
  const [focused, setFocused] = useState<Date>(
    clampDate(selected ?? maxDate ?? today, minDate, maxDate),
  );

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Localized labels for month names and weekday headers (the trigger uses the
  // shared formatDate so it matches every other date in the app).
  const dayLabelFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    [locale],
  );
  const monthNames = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { month: 'long' });
    return Array.from({ length: 12 }, (_, m) => fmt.format(new Date(2020, m, 1)));
  }, [locale]);
  const weekdayNames = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short' });
    // 2023-01-01 is a Sunday → Sunday-first headers.
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2023, 0, 1 + i)));
  }, [locale]);

  const minYear = minDate ? minDate.getFullYear() : today.getFullYear() - 100;
  const maxYear = maxDate ? maxDate.getFullYear() : today.getFullYear() + 10;
  const years = useMemo(
    () => Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i),
    [minYear, maxYear],
  );

  // Sync the view + focus when the value changes externally or the popover opens.
  useEffect(() => {
    if (!open) return;
    const base = clampDate(selected ?? maxDate ?? today, minDate, maxDate);
    setView({ year: base.getFullYear(), month: base.getMonth() });
    setFocused(base);
    // Focus the active day once rendered.
    const raf = requestAnimationFrame(() => {
      gridRef.current?.querySelector<HTMLButtonElement>('[data-active="true"]')?.focus();
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const isDisabled = (d: Date) =>
    (minDate != null && d < minDate) || (maxDate != null && d > maxDate);

  const commit = (d: Date) => {
    if (isDisabled(d)) return;
    onChange(toISO(d));
    setOpen(false);
    triggerRef.current?.focus();
  };

  const moveFocus = (next: Date) => {
    const clamped = clampDate(next, minDate, maxDate);
    setFocused(clamped);
    setView({ year: clamped.getFullYear(), month: clamped.getMonth() });
    requestAnimationFrame(() => {
      gridRef.current?.querySelector<HTMLButtonElement>(`[data-iso="${toISO(clamped)}"]`)?.focus();
    });
  };

  const onGridKeyDown = (e: React.KeyboardEvent) => {
    const step: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: 7,
      ArrowUp: -7,
    };
    if (e.key in step) {
      e.preventDefault();
      moveFocus(addDays(focused, step[e.key]!));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      commit(focused);
    } else if (e.key === 'Escape') {
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  // Build the 6×7 grid for the current view month.
  const cells = useMemo(() => {
    const first = new Date(view.year, view.month, 1);
    const start = addDays(first, -first.getDay()); // back to Sunday
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [view]);

  return (
    <div ref={rootRef} className="relative">
      <button
        id={id}
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        {...aria}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex h-12 w-full items-center justify-between gap-2 rounded-xl border bg-background px-3.5 text-base outline-none transition-colors',
          'focus-visible:border-primary-600 focus-visible:ring-[3px] focus-visible:ring-ring/70',
          hasError ? 'border-error' : 'border-input',
          className,
        )}
      >
        <span className={cn(selected ? 'text-foreground' : 'text-neutral-500')}>
          {selected ? formatDate(selected, locale) : placeholder}
        </span>
        <Calendar className="size-5 shrink-0 text-neutral-500" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label={aria['aria-label']}
          className="absolute z-40 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-neutral-200 bg-white p-3 shadow-xl"
        >
          {/* Header: prev · month/year selects · next */}
          <div className="mb-2 flex items-center gap-1.5">
            <button
              type="button"
              aria-label={L.prevMonth}
              onClick={() =>
                setView((v) =>
                  v.month === 0 ? { year: v.year - 1, month: 11 } : { ...v, month: v.month - 1 },
                )
              }
              className="flex size-9 shrink-0 items-center justify-center rounded-lg text-neutral-600 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
            >
              {isRtl ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
            </button>

            <select
              aria-label={L.month}
              value={view.month}
              onChange={(e) => setView((v) => ({ ...v, month: Number(e.target.value) }))}
              className="h-9 min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
            >
              {monthNames.map((name, m) => (
                <option key={m} value={m}>
                  {name}
                </option>
              ))}
            </select>

            <select
              aria-label={L.year}
              value={view.year}
              onChange={(e) => setView((v) => ({ ...v, year: Number(e.target.value) }))}
              className="h-9 w-[4.75rem] shrink-0 rounded-lg border border-neutral-300 bg-white px-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>

            <button
              type="button"
              aria-label={L.nextMonth}
              onClick={() =>
                setView((v) =>
                  v.month === 11 ? { year: v.year + 1, month: 0 } : { ...v, month: v.month + 1 },
                )
              }
              className="flex size-9 shrink-0 items-center justify-center rounded-lg text-neutral-600 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
            >
              {isRtl ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
            </button>
          </div>

          {/* Weekday header */}
          <div className="grid grid-cols-7 text-center text-xs font-medium text-neutral-500">
            {weekdayNames.map((w, i) => (
              <span key={i} className="py-1">
                {w}
              </span>
            ))}
          </div>

          {/* Day grid — roving tabindex + arrow keys (no ARIA grid roles, which
              would require row wrappers; plain labelled buttons are valid). */}
          <div ref={gridRef} onKeyDown={onGridKeyDown} className="grid grid-cols-7 gap-0.5">
            {cells.map((d) => {
              const inMonth = d.getMonth() === view.month;
              const disabled = isDisabled(d);
              const isSelected = selected != null && sameDay(d, selected);
              const isToday = sameDay(d, today);
              const isFocused = sameDay(d, focused);
              return (
                <button
                  key={toISO(d)}
                  type="button"
                  data-iso={toISO(d)}
                  data-active={isFocused ? 'true' : undefined}
                  aria-label={dayLabelFmt.format(d)}
                  aria-pressed={isSelected}
                  aria-current={isToday ? 'date' : undefined}
                  disabled={disabled}
                  tabIndex={isFocused ? 0 : -1}
                  onClick={() => commit(d)}
                  className={cn(
                    'flex h-9 items-center justify-center rounded-lg text-sm transition-colors',
                    'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
                    !inMonth && 'text-neutral-300',
                    inMonth && !disabled && 'text-neutral-800 hover:bg-primary-50',
                    disabled && 'cursor-not-allowed text-neutral-300',
                    isToday && !isSelected && 'font-semibold text-primary-700',
                    isSelected && 'bg-primary-600 font-semibold text-white hover:bg-primary-600',
                  )}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>

          {/* Footer */}
          <div className="mt-2 flex items-center justify-between border-t border-neutral-100 pt-2 text-sm">
            <button
              type="button"
              onClick={() => {
                onChange('');
                setOpen(false);
                triggerRef.current?.focus();
              }}
              className="rounded-lg px-2 py-1 font-medium text-neutral-600 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
            >
              {L.clear}
            </button>
            <button
              type="button"
              disabled={isDisabled(today)}
              onClick={() => commit(today)}
              className="rounded-lg px-2 py-1 font-medium text-primary-600 hover:bg-primary-50 disabled:cursor-not-allowed disabled:text-neutral-300 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
            >
              {L.today}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
