import { ApplicationStatus } from '@prisma/client';
import {
  ADMIN_LEGAL,
  EMPLOYER_LEGAL,
  allowedTransitions,
  isLegalTransition,
} from './transition.matrix';

/**
 * Pure iteration over EVERY from→to cell for BOTH actors. The state machine is
 * data; these tests are its contract. No sampling — the full 4×4 grid.
 */
const ALL: ApplicationStatus[] = [
  ApplicationStatus.PENDING,
  ApplicationStatus.SHORTLISTED,
  ApplicationStatus.SELECTED,
  ApplicationStatus.REJECTED,
];

// The independent source of truth the implementation is checked against.
const EMPLOYER_EXPECTED: Record<ApplicationStatus, ApplicationStatus[]> = {
  PENDING: [ApplicationStatus.SHORTLISTED, ApplicationStatus.SELECTED, ApplicationStatus.REJECTED],
  SHORTLISTED: [ApplicationStatus.SELECTED, ApplicationStatus.REJECTED],
  SELECTED: [],
  REJECTED: [],
};

describe('transition.matrix — employer', () => {
  for (const from of ALL) {
    for (const to of ALL) {
      const legal = EMPLOYER_EXPECTED[from].includes(to);
      it(`${from} → ${to} is ${legal ? 'LEGAL' : 'illegal'}`, () => {
        expect(isLegalTransition('EMPLOYER', from, to)).toBe(legal);
      });
    }
  }

  it('never allows a same-state move', () => {
    for (const s of ALL) expect(isLegalTransition('EMPLOYER', s, s)).toBe(false);
  });

  it('SELECTED and REJECTED are terminal for employers', () => {
    expect(EMPLOYER_LEGAL.SELECTED).toEqual([]);
    expect(EMPLOYER_LEGAL.REJECTED).toEqual([]);
  });

  it('PENDING allows skip-to-SELECTED', () => {
    expect(
      isLegalTransition('EMPLOYER', ApplicationStatus.PENDING, ApplicationStatus.SELECTED),
    ).toBe(true);
  });
});

describe('transition.matrix — admin', () => {
  for (const from of ALL) {
    for (const to of ALL) {
      const legal = from !== to; // admin: any move except same-state
      it(`${from} → ${to} is ${legal ? 'LEGAL' : 'illegal'}`, () => {
        expect(isLegalTransition('ADMIN', from, to)).toBe(legal);
      });
    }
  }

  it('never allows a same-state move (illegal for admin too)', () => {
    for (const s of ALL) {
      expect(isLegalTransition('ADMIN', s, s)).toBe(false);
      expect(ADMIN_LEGAL[s]).not.toContain(s);
    }
  });

  it('allows every backward/corrective move', () => {
    expect(isLegalTransition('ADMIN', ApplicationStatus.SELECTED, ApplicationStatus.REJECTED)).toBe(
      true,
    );
    expect(isLegalTransition('ADMIN', ApplicationStatus.REJECTED, ApplicationStatus.SELECTED)).toBe(
      true,
    );
    expect(isLegalTransition('ADMIN', ApplicationStatus.SELECTED, ApplicationStatus.PENDING)).toBe(
      true,
    );
  });
});

describe('allowedTransitions returns the exact set surfaced in ILLEGAL_TRANSITION meta', () => {
  it('employer terminal states expose []', () => {
    expect(allowedTransitions('EMPLOYER', ApplicationStatus.SELECTED)).toEqual([]);
  });
  it('admin exposes the 3 non-self states', () => {
    expect(allowedTransitions('ADMIN', ApplicationStatus.PENDING).sort()).toEqual(
      [
        ApplicationStatus.SHORTLISTED,
        ApplicationStatus.SELECTED,
        ApplicationStatus.REJECTED,
      ].sort(),
    );
  });
});
