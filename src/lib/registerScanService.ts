import type { Student } from '../types';

export type AttendanceScanMark = '/' | 'غ' | 'م';

export interface ScannedAttendanceEntry {
  studentName: string;
  rawMark: AttendanceScanMark;
  status: 'present' | 'absent' | 'excused';
  note?: string;
}

export interface ScannedStudentEntry {
  fullName: string;
}

export function generateRandomAcademicCode(existingCodes?: Iterable<string>): string {
  const used = new Set<string>(existingCodes ? Array.from(existingCodes) : []);
  const yearPrefix = new Date().getFullYear().toString().slice(-2);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const randomNum = Math.floor(10000 + Math.random() * 90000);
    const candidate = `MDR-${yearPrefix}${randomNum}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
  return `MDR-${Date.now().toString().slice(-6)}`;
}

export function normalizeArabicText(value: string): string {
  return value
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function findBestStudentMatch(
  scannedName: string,
  students: Student[],
): { student: Student | null; score: number } {
  const normalizedTarget = normalizeArabicText(scannedName);
  if (!normalizedTarget || students.length === 0) {
    return { student: null, score: 0 };
  }

  const targetTokens = normalizedTarget.split(' ').filter(Boolean);
  let bestStudent: Student | null = null;
  let bestScore = 0;

  for (const student of students) {
    const candidateNorm = normalizeArabicText(student.fullName);
    if (!candidateNorm) continue;

    if (candidateNorm === normalizedTarget) {
      return { student, score: 1 };
    }

    let score = 0;
    if (candidateNorm.includes(normalizedTarget) || normalizedTarget.includes(candidateNorm)) {
      score = 0.85;
    } else {
      const candidateTokens = candidateNorm.split(' ').filter(Boolean);
      const matchedTokens = targetTokens.filter((token) =>
        candidateTokens.some((ct) => ct === token || (token.length >= 3 && (ct.startsWith(token) || token.startsWith(ct)))),
      );
      const unionSize = Math.max(targetTokens.length, candidateTokens.length, 1);
      score = matchedTokens.length / unionSize;

      // Boost when first + last tokens match cleanly
      if (
        targetTokens.length >= 2 &&
        candidateTokens.length >= 2 &&
        targetTokens[0] === candidateTokens[0] &&
        targetTokens[targetTokens.length - 1] === candidateTokens[candidateTokens.length - 1]
      ) {
        score = Math.max(score, 0.72);
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestStudent = student;
    }
  }

  if (bestScore < 0.4) {
    return { student: null, score: bestScore };
  }

  return { student: bestStudent, score: bestScore };
}

export function statusFromAttendanceMark(mark: AttendanceScanMark): 'present' | 'absent' | 'excused' {
  if (mark === 'غ') return 'absent';
  if (mark === 'م') return 'excused';
  return 'present';
}

export function markFromAttendanceStatus(status: 'present' | 'absent' | 'excused'): AttendanceScanMark {
  if (status === 'absent') return 'غ';
  if (status === 'excused') return 'م';
  return '/';
}

export async function compressImageToJpegBase64(
  source: Blob,
): Promise<{ base64: string; mimeType: 'image/jpeg'; previewDataUrl: string }> {
  const bitmap = await createImageBitmap(source);
  const maxDimension = 1600;
  let targetWidth = bitmap.width;
  let targetHeight = bitmap.height;

  if (targetWidth > maxDimension || targetHeight > maxDimension) {
    const ratio = Math.min(maxDimension / targetWidth, maxDimension / targetHeight);
    targetWidth = Math.max(1, Math.round(targetWidth * ratio));
    targetHeight = Math.max(1, Math.round(targetHeight * ratio));
  }

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('تعذر تجهيز سياق الرسم لضغط الصورة.');
  }

  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  bitmap.close();

  const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
  const base64 = dataUrl.split(',')[1] || '';
  if (!base64) {
    throw new Error('تعذر تحويل الصورة إلى صيغة صالحة للتحليل.');
  }

  return {
    base64,
    mimeType: 'image/jpeg',
    previewDataUrl: dataUrl,
  };
}

export async function scanRegisterImage(params: {
  mode: 'attendance';
  imageBase64: string;
  mimeType: string;
  knownStudentNames?: string[];
}): Promise<{ entries: ScannedAttendanceEntry[] }>;
export async function scanRegisterImage(params: {
  mode: 'students';
  imageBase64: string;
  mimeType: string;
}): Promise<{ students: ScannedStudentEntry[] }>;
export async function scanRegisterImage(params: {
  mode: 'attendance' | 'students';
  imageBase64: string;
  mimeType: string;
  knownStudentNames?: string[];
}): Promise<{ entries?: ScannedAttendanceEntry[]; students?: ScannedStudentEntry[] }> {
  const response = await fetch('/api/scan-register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  const data = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    entries?: ScannedAttendanceEntry[];
    students?: ScannedStudentEntry[];
  };

  if (!response.ok) {
    throw new Error(data.error || 'تعذر الاتصال بخدمة قراءة السجل عبر الكاميرا.');
  }

  return {
    entries: data.entries,
    students: data.students,
  };
}
