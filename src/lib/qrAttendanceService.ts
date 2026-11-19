import jsQR from 'jsqr';
import QRCode from 'qrcode';
import { SCHOOL_GRADES } from './grades';

export type ParsedQrPayload =
  | {
      kind: 'class';
      sessionId: string;
      token: string;
      raw: string;
    }
  | {
      kind: 'student';
      studentId: string;
      studentCode: string;
      raw: string;
    };

export function buildQrSessionDocId(date: string, grade: string): string {
  const cleanDate = date.replace(/[^0-9]/g, '');
  const knownIdx = (SCHOOL_GRADES as readonly string[]).indexOf(grade);
  if (knownIdx >= 0) {
    return `qr_${cleanDate}_g${knownIdx}`;
  }
  let hash = 0;
  for (let i = 0; i < grade.length; i += 1) {
    hash = (hash * 31 + grade.charCodeAt(i)) >>> 0;
  }
  return `qr_${cleanDate}_c${hash.toString(16)}`;
}

export function generateQrToken(length = 12): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghjkmnpqrstuvwxyz';
  const bytes = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

export function encodeClassQrPayload(sessionId: string, token: string): string {
  return `MADARIK_QR:CLASS:${sessionId}:${token}`;
}

export function encodeStudentQrPayload(studentId: string, studentCode: string): string {
  return `MADARIK_QR:STUDENT:${studentId}:${studentCode}`;
}

export function parseQrPayload(rawText: string): ParsedQrPayload | null {
  const trimmed = rawText.trim();
  if (!trimmed.startsWith('MADARIK_QR:')) return null;
  const parts = trimmed.split(':');
  if (parts.length < 4) return null;

  const kind = parts[1];
  if (kind === 'CLASS' && parts[2] && parts[3]) {
    return {
      kind: 'class',
      sessionId: parts[2].trim(),
      token: parts[3].trim(),
      raw: trimmed,
    };
  }
  if (kind === 'STUDENT' && parts[2] && parts[3]) {
    return {
      kind: 'student',
      studentId: parts[2].trim(),
      studentCode: parts[3].trim(),
      raw: trimmed,
    };
  }
  return null;
}

export async function generateQrDataUrl(payload: string, width = 320): Promise<string> {
  return QRCode.toDataURL(payload, {
    width,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#0f172a',
      light: '#ffffff',
    },
  });
}

export function decodeQrFromImageData(imageData: ImageData): string | null {
  const result = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: 'attemptBoth',
  });
  return result?.data || null;
}

export async function decodeQrFromImageFile(file: Blob): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  const maxDim = 1400;
  let width = bitmap.width;
  let height = bitmap.height;
  if (width > maxDim || height > maxDim) {
    const ratio = Math.min(maxDim / width, maxDim / height);
    width = Math.max(1, Math.round(width * ratio));
    height = Math.max(1, Math.round(height * ratio));
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return null;
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const imgData = ctx.getImageData(0, 0, width, height);
  return decodeQrFromImageData(imgData);
}
