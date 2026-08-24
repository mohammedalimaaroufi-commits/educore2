export const APP_NAME = 'EduCore Manager';
export const APP_NAME_SHORT = 'EduCore';

// Icon keys map to lucide-react components (see IconPicker / iconMap.js)
export const POSITIVE_BEHAVIOR_ICONS = ['star', 'heart', 'check', 'trophy', 'thumbsUp', 'flag'];
export const NEGATIVE_BEHAVIOR_ICONS = ['clock', 'alert', 'x', 'thumbsDown', 'volumeX', 'frown'];

export const ATTENDANCE_STATUS = {
  present: { label: 'present', icon: 'check', color: 'text-primary', bg: 'bg-primary text-white' },
  absent: { label: 'absent', icon: 'x', color: 'text-danger', bg: 'bg-danger text-white' },
  late: { label: 'late', icon: 'clock', color: 'text-accent', bg: 'bg-accent text-ink' },
  excused: { label: 'excused', icon: 'fileCheck', color: 'text-ink/60', bg: 'bg-ink/10 text-ink' },
};

// Approx conversion for display only (OMR is the currency actually charged)
const OMR_TO_USD = 2.6;
export function omrWithEquivalent(omr, locale = 'ar') {
  const amount = Number(omr);
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  const currency = locale === 'en' ? 'OMR' : 'ر.ع';
  return `${safeAmount.toFixed(3)} ${currency} (≈ $${(safeAmount * OMR_TO_USD).toFixed(1)})`;
}
