/** `field-<ascii-name>-<suffix>`: unique, URL-safe slug for a place added on site. */
export function makeFieldSlug(
  name: string,
  suffix: string = Math.random().toString(36).slice(2, 6),
): string {
  const ascii = name
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  const safeSuffix = suffix
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 8);
  return ['field', ascii, safeSuffix].filter(Boolean).join('-');
}
