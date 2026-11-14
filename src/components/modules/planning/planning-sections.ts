/** UI grouping only. Never changes stored source labels, permissions or calculations. */
export type PlanningCategory = { id: number; name: string; code?: string | null };
const label = (value: string | null | undefined) =>
  (value ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
export function isBrandingCategory(category: PlanningCategory, planType: string) {
  return (
    planType === 'BRANDING' ||
    label(category.code) === 'BRANDING' ||
    label(category.name) === 'BRANDING'
  );
}
export function consumableGroup(
  category: PlanningCategory | undefined,
): 'OPD' | 'DENTAL' | 'OTHER' {
  if (label(category?.code) === 'OPD' || label(category?.name) === 'OPD CONSUMABLES') return 'OPD';
  if (
    label(category?.code) === 'DENTAL' ||
    ['DENTAL CONSUMABLES', 'DENTAL CONSUABLES'].includes(label(category?.name))
  )
    return 'DENTAL';
  return 'OTHER';
}
export const consumableLabels = {
  OPD: 'OPD consumables',
  DENTAL: 'Dental consumables',
  OTHER: 'Other consumables',
};
export function sectionItems<T extends { category_id: number }>(
  items: T[],
  categories: PlanningCategory[],
  planType: string,
  section: 'stationery' | 'branding',
  group = '',
): T[] {
  const branding = new Set(
    categories.filter((c) => isBrandingCategory(c, planType)).map((c) => c.id),
  );
  return items.filter((item) =>
    section === 'branding'
      ? branding.has(item.category_id)
      : !branding.has(item.category_id) &&
        (!group || consumableGroup(categories.find((c) => c.id === item.category_id)) === group),
  );
}
