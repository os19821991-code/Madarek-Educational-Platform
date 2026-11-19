export const SCHOOL_GRADES = [
  'صف أول متوسط',
  'صف ثاني متوسط',
  'صف ثالث متوسط',
  'صف رابع علمي',
  'صف خامس علمي',
  'صف السادس علمي',
] as const;

export const LEGACY_GRADE_MAP: Record<string, string> = {
  'الصف السابع': 'صف أول متوسط',
  'الصف الثامن': 'صف ثاني متوسط',
  'الصف التاسع': 'صف ثالث متوسط',
  'الصف العاشر': 'صف رابع علمي',
  'الصف الحادي عشر': 'صف خامس علمي',
  'الصف الثاني عشر': 'صف السادس علمي',
};

export function normalizeGradeName(grade: string | undefined | null): string {
  const trimmed = (grade || '').trim();
  if (!trimmed) return SCHOOL_GRADES[0];
  return LEGACY_GRADE_MAP[trimmed] || trimmed;
}

export function mergeSchoolGrades(existingGrades: string[]): string[] {
  const merged = new Set<string>(SCHOOL_GRADES);
  for (const g of existingGrades) {
    const normalized = normalizeGradeName(g);
    if (normalized) merged.add(normalized);
  }
  return Array.from(merged);
}

export const SCHOOL_PERIODS = [
  { number: 1, label: 'الحصة الأولى', shortLabel: 'ح1', timeRange: '07:30 - 08:15' },
  { number: 2, label: 'الحصة الثانية', shortLabel: 'ح2', timeRange: '08:20 - 09:05' },
  { number: 3, label: 'الحصة الثالثة', shortLabel: 'ح3', timeRange: '09:10 - 09:55' },
  { number: 4, label: 'الحصة الرابعة', shortLabel: 'ح4', timeRange: '10:15 - 11:00' },
  { number: 5, label: 'الحصة الخامسة', shortLabel: 'ح5', timeRange: '11:05 - 11:50' },
  { number: 6, label: 'الحصة السادسة', shortLabel: 'ح6', timeRange: '11:55 - 12:40' },
  { number: 7, label: 'الحصة السابعة', shortLabel: 'ح7', timeRange: '12:45 - 01:30' },
] as const;

export const DEFAULT_SECTIONS = ['أ', 'ب', 'ج', 'د'] as const;

export const PERIOD_CATEGORY_PRESETS = [
  'منضبط',
  'متفاعل ومتميز',
  'مشارك',
  'يحتاج متابعة',
  'غائب عن الحصة',
  'متأخر عن الحصة',
  'مستأذن بعذر',
] as const;

export const SCHOOL_SUBJECTS = [
  'الرياضيات',
  'الفيزياء',
  'الكيمياء',
  'الأحياء',
  'اللغة العربية',
  'اللغة الإنجليزية',
  'التربية الإسلامية',
  'الحاسوب',
] as const;

export function mergeSchoolSections(existingSections: string[]): string[] {
  const merged = new Set<string>(DEFAULT_SECTIONS);
  for (const sec of existingSections) {
    const trimmed = (sec || '').trim();
    if (trimmed) merged.add(trimmed);
  }
  return Array.from(merged);
}
