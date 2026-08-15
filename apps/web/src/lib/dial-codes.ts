/**
 * Every country's international dial code — for PHONE ENTRY ONLY.
 *
 * ── Why this is separate from `countries.ts` ────────────────────────────────
 * `COUNTRIES` there is deliberately India + the six GCC states, because it
 * answers a BUSINESS question: which countries this platform recruits into. It
 * drives the Country select, and widening it would silently let an employer
 * register a hiring market the product does not serve.
 *
 * A dial code answers a different question: where is this company's PHONE. An
 * international recruiter headquartered in Manila or London may legitimately
 * hire into the Gulf, and forcing their switchboard number under +91 makes the
 * one field we use to call them wrong. So the two lists are separate ON
 * PURPOSE, and `countries.ts` keeps its narrow scope untouched.
 *
 * ── Flags ───────────────────────────────────────────────────────────────────
 * Rendered by `<CountryFlag>` as an SVG from `/public/flags`, NOT by the
 * `flagEmoji()` helper in `countries.ts`. Emoji flags have no glyphs on Windows,
 * where Chrome draws the two ISO letters instead — so the same picker showed
 * flags on a phone and "IN"/"AE" on a desktop. Every `iso` below therefore needs
 * a matching `public/flags/<iso>.svg`, which `catalogs`-style coverage is
 * asserted by the dial-code spec.
 *
 * ── Shared codes ────────────────────────────────────────────────────────────
 * Dial codes are NOT unique: +1 covers the US, Canada and much of the Caribbean;
 * +7 covers Russia and Kazakhstan. Each country therefore gets its own option
 * keyed by ISO, so a Canadian employer can find Canada rather than hunting under
 * a US flag. Only the DIAL CODE is stored (`Company.phoneCode`), so on a later
 * edit a shared code resolves back to the first country holding it — the flag
 * shown may differ from the one originally picked, while the number itself is
 * unaffected.
 */

export interface DialCodeOption {
  /** ISO 3166-1 alpha-2. Unique — used as the option value. */
  iso: string;
  /** English country name. */
  name: string;
  /** E.164 dial code, stored in `Company.phoneCode`. */
  dialCode: string;
}

/**
 * Ordered India first, then the six GCC states, then everything else
 * alphabetically. The corridor this product serves sits at the top of the list
 * where it is reachable without scrolling; the long tail stays findable by
 * typing, which is what a native `<select>` gives for free.
 */
export const DIAL_CODE_OPTIONS: readonly DialCodeOption[] = [
  { iso: 'IN', name: 'India', dialCode: '+91' },
  { iso: 'AE', name: 'United Arab Emirates', dialCode: '+971' },
  { iso: 'SA', name: 'Saudi Arabia', dialCode: '+966' },
  { iso: 'QA', name: 'Qatar', dialCode: '+974' },
  { iso: 'KW', name: 'Kuwait', dialCode: '+965' },
  { iso: 'OM', name: 'Oman', dialCode: '+968' },
  { iso: 'BH', name: 'Bahrain', dialCode: '+973' },

  { iso: 'AF', name: 'Afghanistan', dialCode: '+93' },
  { iso: 'AL', name: 'Albania', dialCode: '+355' },
  { iso: 'DZ', name: 'Algeria', dialCode: '+213' },
  { iso: 'AD', name: 'Andorra', dialCode: '+376' },
  { iso: 'AO', name: 'Angola', dialCode: '+244' },
  { iso: 'AG', name: 'Antigua and Barbuda', dialCode: '+1' },
  { iso: 'AR', name: 'Argentina', dialCode: '+54' },
  { iso: 'AM', name: 'Armenia', dialCode: '+374' },
  { iso: 'AU', name: 'Australia', dialCode: '+61' },
  { iso: 'AT', name: 'Austria', dialCode: '+43' },
  { iso: 'AZ', name: 'Azerbaijan', dialCode: '+994' },
  { iso: 'BS', name: 'Bahamas', dialCode: '+1' },
  { iso: 'BD', name: 'Bangladesh', dialCode: '+880' },
  { iso: 'BB', name: 'Barbados', dialCode: '+1' },
  { iso: 'BY', name: 'Belarus', dialCode: '+375' },
  { iso: 'BE', name: 'Belgium', dialCode: '+32' },
  { iso: 'BZ', name: 'Belize', dialCode: '+501' },
  { iso: 'BJ', name: 'Benin', dialCode: '+229' },
  { iso: 'BT', name: 'Bhutan', dialCode: '+975' },
  { iso: 'BO', name: 'Bolivia', dialCode: '+591' },
  { iso: 'BA', name: 'Bosnia and Herzegovina', dialCode: '+387' },
  { iso: 'BW', name: 'Botswana', dialCode: '+267' },
  { iso: 'BR', name: 'Brazil', dialCode: '+55' },
  { iso: 'BN', name: 'Brunei', dialCode: '+673' },
  { iso: 'BG', name: 'Bulgaria', dialCode: '+359' },
  { iso: 'BF', name: 'Burkina Faso', dialCode: '+226' },
  { iso: 'BI', name: 'Burundi', dialCode: '+257' },
  { iso: 'KH', name: 'Cambodia', dialCode: '+855' },
  { iso: 'CM', name: 'Cameroon', dialCode: '+237' },
  { iso: 'CA', name: 'Canada', dialCode: '+1' },
  { iso: 'CV', name: 'Cape Verde', dialCode: '+238' },
  { iso: 'CF', name: 'Central African Republic', dialCode: '+236' },
  { iso: 'TD', name: 'Chad', dialCode: '+235' },
  { iso: 'CL', name: 'Chile', dialCode: '+56' },
  { iso: 'CN', name: 'China', dialCode: '+86' },
  { iso: 'CO', name: 'Colombia', dialCode: '+57' },
  { iso: 'KM', name: 'Comoros', dialCode: '+269' },
  { iso: 'CG', name: 'Congo', dialCode: '+242' },
  { iso: 'CD', name: 'Congo (DRC)', dialCode: '+243' },
  { iso: 'CR', name: 'Costa Rica', dialCode: '+506' },
  { iso: 'CI', name: "Côte d'Ivoire", dialCode: '+225' },
  { iso: 'HR', name: 'Croatia', dialCode: '+385' },
  { iso: 'CU', name: 'Cuba', dialCode: '+53' },
  { iso: 'CY', name: 'Cyprus', dialCode: '+357' },
  { iso: 'CZ', name: 'Czechia', dialCode: '+420' },
  { iso: 'DK', name: 'Denmark', dialCode: '+45' },
  { iso: 'DJ', name: 'Djibouti', dialCode: '+253' },
  { iso: 'DM', name: 'Dominica', dialCode: '+1' },
  { iso: 'DO', name: 'Dominican Republic', dialCode: '+1' },
  { iso: 'EC', name: 'Ecuador', dialCode: '+593' },
  { iso: 'EG', name: 'Egypt', dialCode: '+20' },
  { iso: 'SV', name: 'El Salvador', dialCode: '+503' },
  { iso: 'GQ', name: 'Equatorial Guinea', dialCode: '+240' },
  { iso: 'ER', name: 'Eritrea', dialCode: '+291' },
  { iso: 'EE', name: 'Estonia', dialCode: '+372' },
  { iso: 'SZ', name: 'Eswatini', dialCode: '+268' },
  { iso: 'ET', name: 'Ethiopia', dialCode: '+251' },
  { iso: 'FJ', name: 'Fiji', dialCode: '+679' },
  { iso: 'FI', name: 'Finland', dialCode: '+358' },
  { iso: 'FR', name: 'France', dialCode: '+33' },
  { iso: 'GA', name: 'Gabon', dialCode: '+241' },
  { iso: 'GM', name: 'Gambia', dialCode: '+220' },
  { iso: 'GE', name: 'Georgia', dialCode: '+995' },
  { iso: 'DE', name: 'Germany', dialCode: '+49' },
  { iso: 'GH', name: 'Ghana', dialCode: '+233' },
  { iso: 'GR', name: 'Greece', dialCode: '+30' },
  { iso: 'GD', name: 'Grenada', dialCode: '+1' },
  { iso: 'GT', name: 'Guatemala', dialCode: '+502' },
  { iso: 'GN', name: 'Guinea', dialCode: '+224' },
  { iso: 'GW', name: 'Guinea-Bissau', dialCode: '+245' },
  { iso: 'GY', name: 'Guyana', dialCode: '+592' },
  { iso: 'HT', name: 'Haiti', dialCode: '+509' },
  { iso: 'HN', name: 'Honduras', dialCode: '+504' },
  { iso: 'HK', name: 'Hong Kong', dialCode: '+852' },
  { iso: 'HU', name: 'Hungary', dialCode: '+36' },
  { iso: 'IS', name: 'Iceland', dialCode: '+354' },
  { iso: 'ID', name: 'Indonesia', dialCode: '+62' },
  { iso: 'IR', name: 'Iran', dialCode: '+98' },
  { iso: 'IQ', name: 'Iraq', dialCode: '+964' },
  { iso: 'IE', name: 'Ireland', dialCode: '+353' },
  { iso: 'IL', name: 'Israel', dialCode: '+972' },
  { iso: 'IT', name: 'Italy', dialCode: '+39' },
  { iso: 'JM', name: 'Jamaica', dialCode: '+1' },
  { iso: 'JP', name: 'Japan', dialCode: '+81' },
  { iso: 'JO', name: 'Jordan', dialCode: '+962' },
  { iso: 'KZ', name: 'Kazakhstan', dialCode: '+7' },
  { iso: 'KE', name: 'Kenya', dialCode: '+254' },
  { iso: 'KI', name: 'Kiribati', dialCode: '+686' },
  { iso: 'XK', name: 'Kosovo', dialCode: '+383' },
  { iso: 'KG', name: 'Kyrgyzstan', dialCode: '+996' },
  { iso: 'LA', name: 'Laos', dialCode: '+856' },
  { iso: 'LV', name: 'Latvia', dialCode: '+371' },
  { iso: 'LB', name: 'Lebanon', dialCode: '+961' },
  { iso: 'LS', name: 'Lesotho', dialCode: '+266' },
  { iso: 'LR', name: 'Liberia', dialCode: '+231' },
  { iso: 'LY', name: 'Libya', dialCode: '+218' },
  { iso: 'LI', name: 'Liechtenstein', dialCode: '+423' },
  { iso: 'LT', name: 'Lithuania', dialCode: '+370' },
  { iso: 'LU', name: 'Luxembourg', dialCode: '+352' },
  { iso: 'MO', name: 'Macau', dialCode: '+853' },
  { iso: 'MG', name: 'Madagascar', dialCode: '+261' },
  { iso: 'MW', name: 'Malawi', dialCode: '+265' },
  { iso: 'MY', name: 'Malaysia', dialCode: '+60' },
  { iso: 'MV', name: 'Maldives', dialCode: '+960' },
  { iso: 'ML', name: 'Mali', dialCode: '+223' },
  { iso: 'MT', name: 'Malta', dialCode: '+356' },
  { iso: 'MH', name: 'Marshall Islands', dialCode: '+692' },
  { iso: 'MR', name: 'Mauritania', dialCode: '+222' },
  { iso: 'MU', name: 'Mauritius', dialCode: '+230' },
  { iso: 'MX', name: 'Mexico', dialCode: '+52' },
  { iso: 'FM', name: 'Micronesia', dialCode: '+691' },
  { iso: 'MD', name: 'Moldova', dialCode: '+373' },
  { iso: 'MC', name: 'Monaco', dialCode: '+377' },
  { iso: 'MN', name: 'Mongolia', dialCode: '+976' },
  { iso: 'ME', name: 'Montenegro', dialCode: '+382' },
  { iso: 'MA', name: 'Morocco', dialCode: '+212' },
  { iso: 'MZ', name: 'Mozambique', dialCode: '+258' },
  { iso: 'MM', name: 'Myanmar', dialCode: '+95' },
  { iso: 'NA', name: 'Namibia', dialCode: '+264' },
  { iso: 'NR', name: 'Nauru', dialCode: '+674' },
  { iso: 'NP', name: 'Nepal', dialCode: '+977' },
  { iso: 'NL', name: 'Netherlands', dialCode: '+31' },
  { iso: 'NZ', name: 'New Zealand', dialCode: '+64' },
  { iso: 'NI', name: 'Nicaragua', dialCode: '+505' },
  { iso: 'NE', name: 'Niger', dialCode: '+227' },
  { iso: 'NG', name: 'Nigeria', dialCode: '+234' },
  { iso: 'KP', name: 'North Korea', dialCode: '+850' },
  { iso: 'MK', name: 'North Macedonia', dialCode: '+389' },
  { iso: 'NO', name: 'Norway', dialCode: '+47' },
  { iso: 'PK', name: 'Pakistan', dialCode: '+92' },
  { iso: 'PW', name: 'Palau', dialCode: '+680' },
  { iso: 'PS', name: 'Palestine', dialCode: '+970' },
  { iso: 'PA', name: 'Panama', dialCode: '+507' },
  { iso: 'PG', name: 'Papua New Guinea', dialCode: '+675' },
  { iso: 'PY', name: 'Paraguay', dialCode: '+595' },
  { iso: 'PE', name: 'Peru', dialCode: '+51' },
  { iso: 'PH', name: 'Philippines', dialCode: '+63' },
  { iso: 'PL', name: 'Poland', dialCode: '+48' },
  { iso: 'PT', name: 'Portugal', dialCode: '+351' },
  { iso: 'PR', name: 'Puerto Rico', dialCode: '+1' },
  { iso: 'RO', name: 'Romania', dialCode: '+40' },
  { iso: 'RU', name: 'Russia', dialCode: '+7' },
  { iso: 'RW', name: 'Rwanda', dialCode: '+250' },
  { iso: 'KN', name: 'Saint Kitts and Nevis', dialCode: '+1' },
  { iso: 'LC', name: 'Saint Lucia', dialCode: '+1' },
  { iso: 'VC', name: 'Saint Vincent and the Grenadines', dialCode: '+1' },
  { iso: 'WS', name: 'Samoa', dialCode: '+685' },
  { iso: 'SM', name: 'San Marino', dialCode: '+378' },
  { iso: 'ST', name: 'São Tomé and Príncipe', dialCode: '+239' },
  { iso: 'SN', name: 'Senegal', dialCode: '+221' },
  { iso: 'RS', name: 'Serbia', dialCode: '+381' },
  { iso: 'SC', name: 'Seychelles', dialCode: '+248' },
  { iso: 'SL', name: 'Sierra Leone', dialCode: '+232' },
  { iso: 'SG', name: 'Singapore', dialCode: '+65' },
  { iso: 'SK', name: 'Slovakia', dialCode: '+421' },
  { iso: 'SI', name: 'Slovenia', dialCode: '+386' },
  { iso: 'SB', name: 'Solomon Islands', dialCode: '+677' },
  { iso: 'SO', name: 'Somalia', dialCode: '+252' },
  { iso: 'ZA', name: 'South Africa', dialCode: '+27' },
  { iso: 'KR', name: 'South Korea', dialCode: '+82' },
  { iso: 'SS', name: 'South Sudan', dialCode: '+211' },
  { iso: 'ES', name: 'Spain', dialCode: '+34' },
  { iso: 'LK', name: 'Sri Lanka', dialCode: '+94' },
  { iso: 'SD', name: 'Sudan', dialCode: '+249' },
  { iso: 'SR', name: 'Suriname', dialCode: '+597' },
  { iso: 'SE', name: 'Sweden', dialCode: '+46' },
  { iso: 'CH', name: 'Switzerland', dialCode: '+41' },
  { iso: 'SY', name: 'Syria', dialCode: '+963' },
  { iso: 'TW', name: 'Taiwan', dialCode: '+886' },
  { iso: 'TJ', name: 'Tajikistan', dialCode: '+992' },
  { iso: 'TZ', name: 'Tanzania', dialCode: '+255' },
  { iso: 'TH', name: 'Thailand', dialCode: '+66' },
  { iso: 'TL', name: 'Timor-Leste', dialCode: '+670' },
  { iso: 'TG', name: 'Togo', dialCode: '+228' },
  { iso: 'TO', name: 'Tonga', dialCode: '+676' },
  { iso: 'TT', name: 'Trinidad and Tobago', dialCode: '+1' },
  { iso: 'TN', name: 'Tunisia', dialCode: '+216' },
  { iso: 'TR', name: 'Türkiye', dialCode: '+90' },
  { iso: 'TM', name: 'Turkmenistan', dialCode: '+993' },
  { iso: 'TV', name: 'Tuvalu', dialCode: '+688' },
  { iso: 'UG', name: 'Uganda', dialCode: '+256' },
  { iso: 'UA', name: 'Ukraine', dialCode: '+380' },
  { iso: 'GB', name: 'United Kingdom', dialCode: '+44' },
  { iso: 'US', name: 'United States', dialCode: '+1' },
  { iso: 'UY', name: 'Uruguay', dialCode: '+598' },
  { iso: 'UZ', name: 'Uzbekistan', dialCode: '+998' },
  { iso: 'VU', name: 'Vanuatu', dialCode: '+678' },
  { iso: 'VA', name: 'Vatican City', dialCode: '+39' },
  { iso: 'VE', name: 'Venezuela', dialCode: '+58' },
  { iso: 'VN', name: 'Vietnam', dialCode: '+84' },
  { iso: 'YE', name: 'Yemen', dialCode: '+967' },
  { iso: 'ZM', name: 'Zambia', dialCode: '+260' },
  { iso: 'ZW', name: 'Zimbabwe', dialCode: '+263' },
] as const;

/**
 * First country holding a dial code.
 *
 * Used to turn a stored `phoneCode` back into a selected option. Ambiguous for
 * shared codes by construction (see the header) — the number is unaffected, only
 * which flag is shown beside it.
 */
export function optionForDialCode(dialCode: string): DialCodeOption | undefined {
  return DIAL_CODE_OPTIONS.find((o) => o.dialCode === dialCode);
}

export function optionForIso(iso: string): DialCodeOption | undefined {
  return DIAL_CODE_OPTIONS.find((o) => o.iso === iso);
}

/** India — the default selection on both phone fields. */
export const DEFAULT_DIAL_OPTION: DialCodeOption = DIAL_CODE_OPTIONS[0]!;

/**
 * Split a stored E.164 number into its dial code and the national part.
 *
 * The LONGEST code wins, so +971 is never read as +97. This is the full-list
 * twin of `splitE164` in `countries.ts`, which only knows the seven recruit
 * markets and therefore returns null — falling the caller back to +91 — for a
 * candidate whose number is Filipino or British.
 *
 * Unambiguous for this dataset: every NANP country is listed as plain `+1`, so
 * no code here is a strict prefix of another that would let "+1242…" resolve two
 * ways.
 */
export function splitDialCode(e164: string): { country: DialCodeOption; national: string } | null {
  const match = [...DIAL_CODE_OPTIONS]
    .sort((a, b) => b.dialCode.length - a.dialCode.length)
    .find((c) => e164.startsWith(c.dialCode));
  return match ? { country: match, national: e164.slice(match.dialCode.length) } : null;
}
