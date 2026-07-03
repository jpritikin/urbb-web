import type { Fulfillment } from './products';

export interface CountryOption {
  code: string;
  name: string;
}

const ACUTRACK_FREE: CountryOption[] = [
  { code: 'US', name: 'United States' },
  { code: 'CA', name: 'Canada' },
];

const ACUTRACK_TIER1: CountryOption[] = [
  { code: 'CZ', name: 'Czechia' },
  { code: 'DK', name: 'Denmark' },
  { code: 'FR', name: 'France' },
  { code: 'DE', name: 'Germany' },
  { code: 'HK', name: 'Hong Kong SAR' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'PL', name: 'Poland' },
  { code: 'SG', name: 'Singapore' },
  { code: 'KR', name: 'South Korea' },
  { code: 'ES', name: 'Spain' },
  { code: 'SE', name: 'Sweden' },
  { code: 'GB', name: 'United Kingdom' },
];

const ACUTRACK_TIER2: CountryOption[] = [
  { code: 'AU', name: 'Australia' },
  { code: 'AT', name: 'Austria' },
  { code: 'BE', name: 'Belgium' },
  { code: 'FI', name: 'Finland' },
  { code: 'IE', name: 'Ireland' },
  { code: 'IL', name: 'Israel' },
  { code: 'IT', name: 'Italy' },
  { code: 'JP', name: 'Japan' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'NO', name: 'Norway' },
  { code: 'PT', name: 'Portugal' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'GH', name: 'Ghana' },
  { code: 'IN', name: 'India' },
  { code: 'JM', name: 'Jamaica' },
  { code: 'KE', name: 'Kenya' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'PK', name: 'Pakistan' },
  { code: 'PH', name: 'Philippines' },
  { code: 'ZA', name: 'South Africa' },
];

const LULU_FREE: CountryOption[] = [
  { code: 'GB', name: 'United Kingdom' },
  { code: 'US', name: 'United States' },
];

const LULU_TIER1: CountryOption[] = [
  { code: 'CA', name: 'Canada' },
  { code: 'IE', name: 'Ireland' },
];

const LULU_TIER2: CountryOption[] = [
  { code: 'AU', name: 'Australia' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'SG', name: 'Singapore' },
  { code: 'GH', name: 'Ghana' },
  { code: 'KE', name: 'Kenya' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'IN', name: 'India' },
  { code: 'PK', name: 'Pakistan' },
  { code: 'PH', name: 'Philippines' },
  { code: 'JM', name: 'Jamaica' },
  { code: 'HK', name: 'Hong Kong SAR' },
];

const PRINTFUL_FREE: CountryOption[] = [{ code: 'US', name: 'United States' }];

function rateFor(country: string, free: CountryOption[], tier1: CountryOption[], tier1Cents: number, tier2: CountryOption[], tier2Cents: number): number | null {
  if (free.some(c => c.code === country)) return 0;
  if (tier1.some(c => c.code === country)) return tier1Cents;
  if (tier2.some(c => c.code === country)) return tier2Cents;
  return null;
}

// Returns the shipping cost in cents for a fulfillment backend + destination
// country, or null if that backend cannot ship there.
export function shippingCentsFor(fulfillment: Fulfillment, country: string): number | null {
  switch (fulfillment) {
    case 'acutrack':
      return rateFor(country, ACUTRACK_FREE, ACUTRACK_TIER1, 1600, ACUTRACK_TIER2, 3200);
    case 'lulu':
      return rateFor(country, LULU_FREE, LULU_TIER1, 400, LULU_TIER2, 1020);
    case 'printful':
      return rateFor(country, PRINTFUL_FREE, [], 0, [], 0);
  }
}

export const ALL_SUPPORTED_COUNTRIES: CountryOption[] = Array.from(
  new Map(
    [
      ...ACUTRACK_FREE, ...ACUTRACK_TIER1, ...ACUTRACK_TIER2,
      ...LULU_FREE, ...LULU_TIER1, ...LULU_TIER2,
      ...PRINTFUL_FREE,
    ].map(c => [c.code, c])
  ).values()
).sort((a, b) => a.name.localeCompare(b.name));
