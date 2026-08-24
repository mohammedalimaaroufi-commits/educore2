const ARABIC_TEXT = /[\u0600-\u06ff]/;

export function localizeApiError(error, t, locale, fallbackKey) {
  const raw = typeof error === 'string' ? error : error?.response?.data?.error;
  if (!raw) return t(fallbackKey);
  if (locale === 'en' && ARABIC_TEXT.test(String(raw))) return t(fallbackKey);
  return String(raw);
}

export function hasArabicText(value) {
  return ARABIC_TEXT.test(String(value || ''));
}
