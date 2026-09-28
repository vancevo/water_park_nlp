import type { Locale, PoiDraft } from './poi-contract';
export type ValidationErrors = Record<string, string>;
const coordinate = (value: number, min: number, max: number) =>
  Number.isFinite(value) && value >= min && value <= max;
const time = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export function validatePoi(input: PoiDraft): ValidationErrors {
  const errors: ValidationErrors = {};
  if (!/^[a-z][a-z0-9-]{0,99}$/.test(input.slug))
    errors.slug = 'Slug dùng chữ thường, số và dấu gạch ngang.';
  if (!/^[a-z][a-z0-9_-]{0,49}$/.test(input.category))
    errors.category = 'Category slug không hợp lệ.';
  if (!coordinate(input.location.latitude, -90, 90))
    errors.latitude = 'Vĩ độ phải từ -90 đến 90.';
  if (!coordinate(input.location.longitude, -180, 180))
    errors.longitude = 'Kinh độ phải từ -180 đến 180.';
  (['vi', 'en'] as Locale[]).forEach((locale) => {
    const item = input.translations.find(
      (translation) => translation.locale === locale,
    );
    for (const field of [
      'name',
      'shortDescription',
      'longDescription',
    ] as const) {
      if (!item?.[field].trim())
        errors[`translations.${locale}.${field}`] =
          `Thiếu ${field} ${locale.toUpperCase()}.`;
    }
  });
  if (!input.entrances.length)
    errors.entrances = 'POI cần ít nhất một cổng vào.';
  if (input.entrances.length && !input.entrances.some((item) => item.isPrimary))
    errors.entrances = 'Cần chọn một cổng chính.';
  input.entrances.forEach((item, index) => {
    if (!item.labelVi.trim())
      errors[`entrances.${index}.labelVi`] = 'Thiếu tên cổng VI.';
    if (!item.labelEn.trim())
      errors[`entrances.${index}.labelEn`] = 'Thiếu tên cổng EN.';
    if (!item.graphNodeRef.trim())
      errors[`entrances.${index}.graphNodeRef`] = 'Graph node ref là bắt buộc.';
    if (!coordinate(item.location.latitude, -90, 90))
      errors[`entrances.${index}.latitude`] = 'Vĩ độ cổng không hợp lệ.';
    if (!coordinate(item.location.longitude, -180, 180))
      errors[`entrances.${index}.longitude`] = 'Kinh độ cổng không hợp lệ.';
  });
  input.operatingHours.forEach((hour, index) => {
    if (
      !hour.isClosed &&
      (!time(hour.opensAt) ||
        !time(hour.closesAt) ||
        hour.opensAt >= hour.closesAt)
    )
      errors[`operatingHours.${index}`] = 'Giờ hoạt động không hợp lệ.';
  });
  return errors;
}
