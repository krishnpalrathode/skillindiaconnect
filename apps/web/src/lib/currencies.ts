/**
 * Currencies a candidate may state a salary expectation in.
 *
 * These codes MUST stay in step with the `Currency` enum in
 * apps/api/prisma/schema.prisma — the API validates against it with
 * `@IsEnum(Currency)`, so an option offered here but missing there fails on
 * save. That is exactly what happened with USD: the dropdown listed
 * "USD — US Dollar" while the enum held only INR + the six GCC currencies, so
 * picking it produced a validation error the user could not act on.
 *
 * Ordered by corridor: India first (the default), then the GCC states the Gulf
 * jobs pay in, then the wider markets.
 */
export interface CurrencyOption {
  code: string;
  /** English name shown beside the code. */
  name: string;
}

export const CURRENCIES: readonly CurrencyOption[] = [
  { code: 'INR', name: 'Indian Rupee' },

  { code: 'AED', name: 'UAE Dirham' },
  { code: 'SAR', name: 'Saudi Riyal' },
  { code: 'QAR', name: 'Qatari Riyal' },
  { code: 'OMR', name: 'Omani Rial' },
  { code: 'KWD', name: 'Kuwaiti Dinar' },
  { code: 'BHD', name: 'Bahraini Dinar' },

  { code: 'USD', name: 'US Dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British Pound' },
  { code: 'CAD', name: 'Canadian Dollar' },
  { code: 'AUD', name: 'Australian Dollar' },
  { code: 'SGD', name: 'Singapore Dollar' },
  { code: 'JPY', name: 'Japanese Yen' },
  { code: 'MYR', name: 'Malaysian Ringgit' },
] as const;

export const DEFAULT_CURRENCY = 'INR';
