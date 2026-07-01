// No category-enumeration endpoint exists yet (the API only exposes a
// freeform `categoryId: string` on Job/JobCard) — this is a static stand-in
// for the category chips until S2-0's contract grows one. Keep in sync with
// the `categoryId` values used in mocks/data.ts's job fixtures.
export interface JobCategory {
  id: string;
  labelKey: string;
}

export const JOB_CATEGORIES: JobCategory[] = [
  { id: 'cat-construction', labelKey: 'construction' },
  { id: 'cat-electrical', labelKey: 'electrical' },
  { id: 'cat-plumbing', labelKey: 'plumbing' },
  { id: 'cat-welding', labelKey: 'welding' },
  { id: 'cat-driving', labelKey: 'driving' },
  { id: 'cat-housekeeping', labelKey: 'housekeeping' },
  { id: 'cat-hospitality', labelKey: 'hospitality' },
  { id: 'cat-security', labelKey: 'security' },
  { id: 'cat-general', labelKey: 'general' },
];
