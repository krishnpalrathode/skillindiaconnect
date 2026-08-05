/**
 * CR-001 B1 — the template registry.
 *
 * The registry is the seam B2 lands three templates into, so these tests are
 * about its CONTRACT rather than about any rendering: that every declared
 * template resolves to something, and that a value this build does not
 * recognise degrades to CLASSIC instead of failing a render.
 */
import { ResumeTemplate } from '@prisma/client';
import {
  DEFAULT_TEMPLATE,
  TEMPLATE_REGISTRY,
  selectTemplate,
} from './registry';
import { renderClassic } from './classic.template';

describe('TEMPLATE_REGISTRY', () => {
  it('has an entry for EVERY declared ResumeTemplate value', () => {
    // The Record<> type already makes a gap a compile error; this asserts the
    // same thing at runtime so the guarantee survives a future refactor to a
    // looser type without anyone noticing.
    for (const value of Object.values(ResumeTemplate)) {
      expect(typeof TEMPLATE_REGISTRY[value]).toBe('function');
    }
  });

  it('resolves CLASSIC to the existing renderer', () => {
    expect(selectTemplate(ResumeTemplate.CLASSIC)).toBe(renderClassic);
  });

  it('defaults to CLASSIC', () => {
    expect(DEFAULT_TEMPLATE).toBe(ResumeTemplate.CLASSIC);
  });
});

describe('selectTemplate — degrades, never throws', () => {
  // The input is read back from the database or from a generation snapshot, so
  // it can legitimately be a value this build does not know (a row written by a
  // newer release that was rolled back, or a pre-B1 snapshot). Failing the
  // render would turn a cosmetic unknown into a candidate who cannot produce a
  // CV at all.
  it.each([
    ['undefined (a pre-B1 snapshot)', undefined],
    ['null', null],
    ['an unknown template', 'HOLOGRAPHIC'],
    ['a non-string', 42],
    ['an object', { template: 'MODERN' }],
  ])('%s → the CLASSIC renderer, no throw', (_label, value) => {
    expect(() => selectTemplate(value)).not.toThrow();
    expect(selectTemplate(value)).toBe(TEMPLATE_REGISTRY[DEFAULT_TEMPLATE]);
  });

  it('does not warn for a legitimately absent value', () => {
    // undefined is the EXPECTED shape of a legacy snapshot — warning on it
    // would make the log noisy for a condition that is not a problem.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    selectTemplate(undefined);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
