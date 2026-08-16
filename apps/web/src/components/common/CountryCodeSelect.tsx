'use client';

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CountryFlag } from '@/components/common/CountryFlag';
import { DIAL_CODE_OPTIONS, type DialCodeOption } from '@/lib/dial-codes';

/**
 * Country dial-code picker — flag, code and name, over ~200 countries.
 *
 * ── Why this is not a <select> ──────────────────────────────────────────────
 * An `<option>` may contain TEXT ONLY. No image, no SVG, no markup — that is an
 * HTML constraint, not a styling one. The previous native select could therefore
 * only show the flag EMOJI, which Windows has no glyphs for and renders as the
 * two ISO letters. Showing a real flag on every platform means owning the list,
 * so this is a combobox built to the ARIA pattern rather than a styled select.
 *
 * The trade is real and worth naming: a native select gets the OS picker on
 * Android for free — big touch targets, familiar scrolling. That is why the
 * LANGUAGE switcher stays native (see LanguageSwitcher). Here the list is 200
 * long rather than 22, so it needs a search box regardless, and a native select
 * gives no way to type-filter beyond jumping to the first letter.
 *
 * ── Accessibility ───────────────────────────────────────────────────────────
 * Trigger is `role="combobox"` with `aria-expanded`/`aria-controls`; the list is
 * `role="listbox"` with `role="option"` rows carrying `aria-selected`. Keyboard:
 * Arrow keys move, Enter/Space select, Escape closes and returns focus, Home/End
 * jump. The active row is tracked with `aria-activedescendant` so focus can stay
 * in the search box while arrowing through results.
 */

export interface CountryCodeSelectProps {
  /** Selected ISO 3166-1 alpha-2 code. */
  value: string;
  onChange: (option: DialCodeOption) => void;
  /** Id of the trigger — pair with a <label htmlFor>. */
  id: string;
  disabled?: boolean;
  invalid?: boolean;
  /** Placeholder for the filter box. */
  searchLabel: string;
  /** Announced when the filter matches nothing. */
  emptyLabel: string;
  className?: string;
  /** Compact hides the country name on the trigger, leaving flag + dial code. */
  compact?: boolean;
}

export function CountryCodeSelect({
  value,
  onChange,
  id,
  disabled,
  invalid,
  searchLabel,
  emptyLabel,
  className,
  compact = false,
}: CountryCodeSelectProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  /**
   * Where the list is painted, in viewport coordinates.
   *
   * The list is PORTALLED to <body> rather than positioned inside this
   * component, because an ancestor with `overflow: hidden` clips an absolutely
   * positioned child no matter its z-index. The candidate phone field is exactly
   * that: dial code and number share one rounded, clipped box, so the dropdown
   * appeared as a single sliver of a row inside a 48px control. A portal removes
   * the whole class of bug — no mount can clip this, now or later.
   *
   * The cost of leaving the DOM subtree is that positioning becomes ours, hence
   * the measure below and the recompute on scroll/resize.
   */
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  const selected = useMemo(
    () => DIAL_CODE_OPTIONS.find((o) => o.iso === value) ?? DIAL_CODE_OPTIONS[0]!,
    [value],
  );

  /*
    Matches name, dial code or ISO, so "+63", "63", "phil" and "ph" all find the
    Philippines. The leading + is stripped from the query because nobody types it
    consistently.
  */
  const results = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^\+/, '');
    if (!q) return DIAL_CODE_OPTIONS;
    return DIAL_CODE_OPTIONS.filter(
      (o) =>
        o.name.toLowerCase().includes(q) ||
        o.iso.toLowerCase() === q ||
        o.dialCode.replace('+', '').startsWith(q),
    );
  }, [query]);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    setQuery('');
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  const commit = useCallback(
    (option: DialCodeOption) => {
      onChange(option);
      close();
    },
    [onChange, close],
  );

  /**
   * Measure the trigger and choose a side.
   *
   * Opens downward when there is room, flips above when there is not — on a
   * 360px phone with the keyboard up, a field near the bottom would otherwise
   * render its list off-screen. `MIN_LIST` is the height below which flipping is
   * better than shrinking; it is ~5 rows, which is the point the list stops
   * being usable.
   */
  const measure = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const GAP = 4;
    const MARGIN = 8;
    const MIN_LIST = 240;
    const below = window.innerHeight - rect.bottom - GAP - MARGIN;
    const above = rect.top - GAP - MARGIN;
    const flip = below < MIN_LIST && above > below;
    const maxHeight = Math.max(160, Math.min(320, flip ? above : below));
    // Wide enough for the longest country names, but never wider than the
    // viewport on a small screen.
    const width = Math.min(320, Math.max(rect.width, 260), window.innerWidth - MARGIN * 2);
    const left = Math.min(Math.max(MARGIN, rect.left), window.innerWidth - width - MARGIN);
    setPosition({
      top: flip ? rect.top - GAP - maxHeight : rect.bottom + GAP,
      left,
      width,
      maxHeight,
    });
  }, []);

  useEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    measure();
    // `true` captures scrolls on any ancestor, not just the window — the form
    // itself scrolls inside a panel on some screens.
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open, measure]);

  // Opening lands the caret in the search box and highlights the current value.
  useEffect(() => {
    if (!open) return;
    const index = results.findIndex((o) => o.iso === selected.iso);
    setActiveIndex(index >= 0 ? index : 0);
    searchRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Filtering invalidates the old highlight — always point at the first hit.
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Keep the highlighted row visible while arrowing. Feature-detected because
  // this is a convenience, not behaviour: jsdom has no `scrollIntoView` at all,
  // and letting that throw would take the whole form down in a test — or in any
  // embedded webview missing it — over a scroll position.
  useEffect(() => {
    if (!open) return;
    const row = listRef.current?.querySelector<HTMLLIElement>(`[data-index="${activeIndex}"]`);
    if (typeof row?.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  /*
    Close on any interaction outside the whole control. `mousedown` rather than
    `click` so the list is gone before a click on the page behind it lands, and a
    focusin listener catches Tab moving focus away.
  */
  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => {
      const target = e.target as Node;
      // BOTH subtrees: the list is portalled to <body>, so it is no longer a
      // descendant of the root and a click on a country would otherwise read as
      // "outside" and close the list before the selection landed.
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('focusin', outside);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('focusin', outside);
    };
  }, [open]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, results.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        break;
      case 'Home':
        e.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setActiveIndex(results.length - 1);
        break;
      case 'Enter':
        e.preventDefault();
        if (results[activeIndex]) commit(results[activeIndex]);
        break;
      case 'Escape':
        e.preventDefault();
        close();
        break;
      default:
        break;
    }
  }

  return (
    <div ref={rootRef} className={cn('relative', className)} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-invalid={invalid || undefined}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex h-10 w-full items-center gap-2 rounded-lg border border-input bg-background px-3 text-sm',
          'shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
          'disabled:cursor-not-allowed disabled:opacity-50',
          invalid && 'border-error',
        )}
      >
        <CountryFlag iso={selected.iso} />
        {/* A dial code reads left-to-right even in an Arabic or Urdu layout. */}
        <span dir="ltr" className="font-medium">
          {selected.dialCode}
        </span>
        {!compact && <span className="truncate text-neutral-600">{selected.name}</span>}
        <ChevronDown className="ms-auto size-4 shrink-0 text-neutral-500" aria-hidden="true" />
      </button>

      {open &&
        position &&
        createPortal(
          <div
            ref={popoverRef}
            style={{
              position: 'fixed',
              top: position.top,
              left: position.left,
              width: position.width,
              maxHeight: position.maxHeight,
            }}
            className={cn(
              'z-50 flex flex-col overflow-hidden rounded-xl',
              'border border-neutral-200 bg-white shadow-lg',
            )}
          >
            <div className="flex items-center gap-2 border-b border-neutral-100 px-3 py-2">
              <Search className="size-4 shrink-0 text-neutral-500" aria-hidden="true" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchLabel}
                aria-label={searchLabel}
                aria-controls={listId}
                aria-activedescendant={
                  results[activeIndex] ? `${listId}-${results[activeIndex].iso}` : undefined
                }
                className="h-8 w-full bg-transparent text-sm outline-none placeholder:text-neutral-500"
              />
            </div>

            {/* flex-1 + min-h-0: the list takes whatever height is left after the
              search row, and `min-h-0` is what lets a flex child actually shrink
              and scroll rather than growing past its parent. */}
            <ul
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label={searchLabel}
              className="min-h-0 flex-1 overflow-y-auto py-1"
            >
              {results.length === 0 && (
                <li className="px-3 py-6 text-center text-sm text-neutral-600">{emptyLabel}</li>
              )}
              {results.map((o, i) => {
                const isSelected = o.iso === selected.iso;
                return (
                  <li
                    key={o.iso}
                    id={`${listId}-${o.iso}`}
                    role="option"
                    aria-selected={isSelected}
                    data-index={i}
                    // Pointer, not click: mousedown would fire the outside-close
                    // handler before the selection landed.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      commit(o);
                    }}
                    onMouseEnter={() => setActiveIndex(i)}
                    className={cn(
                      'flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm',
                      i === activeIndex && 'bg-[#E8F0FE]',
                      isSelected && 'font-semibold',
                    )}
                  >
                    <CountryFlag iso={o.iso} />
                    <span dir="ltr" className="w-14 shrink-0 tabular-nums text-neutral-700">
                      {o.dialCode}
                    </span>
                    <span className="truncate text-neutral-900">{o.name}</span>
                  </li>
                );
              })}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}
