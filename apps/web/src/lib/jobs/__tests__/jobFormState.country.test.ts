import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FORM_VALUES,
  validateJobForm,
  formToPayload,
  jobToFormValues,
  formToPreview,
  type JobFormValues,
} from '../jobFormState';
import { countriesForMarket } from '../../countries';
import type { Job } from '../../api/jobs-employer';

const valid = (over: Partial<JobFormValues> = {}): JobFormValues => ({
  ...DEFAULT_FORM_VALUES,
  title: 'Welder',
  categoryId: 'cat-1',
  location: 'Dubai',
  description: 'desc',
  salaryMin: '1500',
  salaryMax: '2000',
  market: 'GULF',
  country: 'United Arab Emirates',
  ...over,
});

describe('countriesForMarket', () => {
  it('LOCAL → India only', () => {
    expect(countriesForMarket('LOCAL').map((c) => c.name)).toEqual(['India']);
  });
  it('GULF → the six GCC states (no India)', () => {
    const names = countriesForMarket('GULF').map((c) => c.name);
    expect(names).toContain('United Arab Emirates');
    expect(names).toContain('Saudi Arabia');
    expect(names).not.toContain('India');
    expect(names).toHaveLength(6);
  });
});

describe('validateJobForm — country is required and market-consistent', () => {
  it('flags a missing country', () => {
    expect(validateJobForm(valid({ country: '' })).country).toBe('Country is required');
  });
  it('flags a country that does not match the market (India on a GULF job)', () => {
    expect(validateJobForm(valid({ market: 'GULF', country: 'India' })).country).toMatch(
      /valid for the chosen market/i,
    );
  });
  it('accepts India for a LOCAL job', () => {
    expect(validateJobForm(valid({ market: 'LOCAL', country: 'India' })).country).toBeUndefined();
  });
  it('accepts a GCC country for a GULF job', () => {
    expect(validateJobForm(valid({ market: 'GULF', country: 'Qatar' })).country).toBeUndefined();
  });
});

describe('country round-trips through payload / edit / preview', () => {
  it('formToPayload carries country', () => {
    expect(formToPayload(valid({ country: 'Oman' })).country).toBe('Oman');
  });
  it('jobToFormValues maps a null country to empty string', () => {
    expect(jobToFormValues({ country: null, market: 'GULF' } as Job).country).toBe('');
  });
  it('formToPreview exposes country (null when unset)', () => {
    expect(formToPreview(valid({ country: 'Kuwait' }), 'Acme').country).toBe('Kuwait');
    expect(formToPreview(valid({ country: '' }), 'Acme').country).toBeNull();
  });
});
