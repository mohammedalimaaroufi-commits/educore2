export const APP_NAME = 'السجل المصاحب الإلكتروني';
export const APP_NAME_SHORT = 'السجل المصاحب';

// Icon keys map to lucide-react components (see IconPicker / iconMap.js)
export const POSITIVE_BEHAVIOR_ICONS = ['star', 'heart', 'check', 'trophy', 'thumbsUp', 'flag'];
export const NEGATIVE_BEHAVIOR_ICONS = ['clock', 'alert', 'x', 'thumbsDown', 'volumeX', 'frown'];

export const ATTENDANCE_STATUS = {
  present: { label: 'حاضر', icon: 'check', color: 'text-primary', bg: 'bg-primary text-white' },
  absent: { label: 'غائب', icon: 'x', color: 'text-danger', bg: 'bg-danger text-white' },
  late: { label: 'متأخر', icon: 'clock', color: 'text-accent', bg: 'bg-accent text-ink' },
  excused: { label: 'بعذر', icon: 'fileCheck', color: 'text-ink/60', bg: 'bg-ink/10 text-ink' },
};

// Approx conversion for display only (OMR is the currency actually charged)
const OMR_TO_USD = 2.6;
export function omrWithEquivalent(omr) {
  return `${omr} ر.ع (≈ $${(omr * OMR_TO_USD).toFixed(1)})`;
}
