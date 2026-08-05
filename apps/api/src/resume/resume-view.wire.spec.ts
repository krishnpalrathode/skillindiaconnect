/**
 * S7-B2 — the SECOND privacy hop.
 *
 * S7-B1 proved omission at the PDF-byte level. This proves the same omission
 * survives the trip the API takes: render view → stored snapshot → wire. A
 * field the mapper withheld at generation time must not reappear in the JSON
 * the preview screen renders, and `photoDataUri` (kilobytes of base64) must
 * not travel at all.
 */
import { ResumeTemplate } from '@prisma/client';
import { ResumeSource } from '../candidate/candidate-read.service';
import { RESUME_SETTINGS_DEFAULTS, toResumeView } from './resume-view.mapper';
import { toStoredResumeView, toWireResumeView } from './resume-view.wire';

const PHONE = '+919812345678';
const PASSPORT = 'Z1234567';
const RELIGION = 'Hindu';
const FATHER = 'Ramesh Kumar';

const source: ResumeSource = {
  id: 'cand-1',
  fullName: 'Suresh Kumar',
  fatherName: FATHER,
  dob: new Date('1992-04-11'),
  phone: PHONE,
  maritalStatus: 'MARRIED',
  religion: RELIGION,
  languages: ['Hindi'],
  currentLocation: 'Lucknow, India',
  nationality: 'Indian',
  photoKey: 'photos/cand-1.jpg',
  videoR2Key: null,
  jobCategory: { nameEn: 'Electrician' },
  user: { email: 'suresh@example.com' },
  experiences: [
    {
      id: 'exp-1',
      type: 'FOREIGN',
      country: 'Oman',
      companyName: 'Gulf Wiring LLC',
      role: 'Senior Electrician',
      years: 4,
      months: 2,
      startDate: new Date('2020-01-01'),
      endDate: null,
    },
  ],
  skills: [{ id: 'sk-1', name: 'Panel Installation' }],
  documents: [
    { type: 'PASSPORT', expiryDate: new Date('2031-01-01'), documentNumber: PASSPORT },
  ],
};

function roundTrip(settings: Parameters<typeof toResumeView>[1]) {
  const view = toResumeView(source, settings, 'data:image/jpeg;base64,AAAA');
  const stored = toStoredResumeView(view, source.photoKey);
  return { stored, wire: toWireResumeView(stored, 'https://signed.example/photo') };
}

describe('stored → wire resume view', () => {
  it('ALL TOGGLES ON: every opt-in field survives the round trip', () => {
    const { wire } = roundTrip({
      ...RESUME_SETTINGS_DEFAULTS,
      showPhone: true,
      showReligion: true,
      showFatherName: true,
      showPassportNumber: true,
    });

    expect(wire.phone).toBe(PHONE);
    expect(wire.religion).toBe(RELIGION);
    expect(wire.fatherName).toBe(FATHER);
    expect(wire.passportNumber).toBe(PASSPORT);
  });

  it('DEFAULTS: religion and passport number are ABSENT — not null, absent', () => {
    const { wire } = roundTrip(RESUME_SETTINGS_DEFAULTS);

    expect('religion' in wire).toBe(false);
    expect('passportNumber' in wire).toBe(false);
    // ...while the ON-by-default pair is present.
    expect(wire.phone).toBe(PHONE);
    expect(wire.fatherName).toBe(FATHER);
    // The passport's VALIDITY still shows: only the NUMBER is gated.
    expect(wire.documents[0]).toEqual({ type: 'PASSPORT', uploaded: true, passportValid: true });
  });

  it('ALL TOGGLES OFF: none of the four values appears anywhere in the payload', () => {
    const { wire } = roundTrip({
      ...RESUME_SETTINGS_DEFAULTS,
      showPhone: false,
      showReligion: false,
      showFatherName: false,
      showPassportNumber: false,
    });

    for (const key of ['phone', 'religion', 'fatherName', 'passportNumber']) {
      expect(key in wire).toBe(false);
    }
    // Belt and braces: not hiding in a nested field either.
    const serialized = JSON.stringify(wire);
    for (const value of [PHONE, RELIGION, FATHER, PASSPORT]) {
      expect(serialized).not.toContain(value);
    }
  });

  it('the inlined photo never travels — the wire carries a signed url instead', () => {
    const { stored, wire } = roundTrip(RESUME_SETTINGS_DEFAULTS);

    expect('photoDataUri' in stored).toBe(false);
    expect(stored.photoKey).toBe('photos/cand-1.jpg');
    expect(wire.photoUrl).toBe('https://signed.example/photo');
    expect(JSON.stringify(wire)).not.toContain('base64');
  });

  it('settingsApplied states exactly what rendered — the snapshot, not live settings', () => {
    const { wire } = roundTrip({
      ...RESUME_SETTINGS_DEFAULTS,
      showPhone: false,
      showReligion: false,
      showFatherName: false,
      showPassportNumber: true,
    });
    // Exhaustive on purpose: toEqual fails if a NEW setting starts crossing the
    // wire without anyone deciding it should. `template` is listed because it
    // is a resume setting and the client needs it to show the current choice —
    // it says how the PDF LOOKS, never what it contains.
    expect(wire.settingsApplied).toEqual({
      language: 'en',
      showPhone: false,
      showReligion: false,
      showFatherName: false,
      showPassportNumber: true,
      template: ResumeTemplate.CLASSIC,
    });
  });
});
