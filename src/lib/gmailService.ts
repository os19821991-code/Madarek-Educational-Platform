export type EmailAlertCategoryKey =
  | 'attendance'
  | 'behavior'
  | 'homework'
  | 'grade'
  | 'payment'
  | 'circular'
  | 'monthly_report'
  | 'custom';

export const EMAIL_CATEGORY_LABELS: Record<EmailAlertCategoryKey, string> = {
  attendance: 'الحضور والغياب',
  behavior: 'السلوك والانضباط',
  homework: 'الواجبات المنزلية',
  grade: 'الدرجات الأكاديمية',
  payment: 'الرسوم والفواتير',
  circular: 'التعاميم والاستطلاعات',
  monthly_report: 'تقرير الأداء الشهري',
  custom: 'تنبيه مخصص',
};

export class GmailAuthError extends Error {
  code: 'TOKEN_EXPIRED' | 'API_ERROR';
  constructor(message: string, code: 'TOKEN_EXPIRED' | 'API_ERROR' = 'API_ERROR') {
    super(message);
    this.code = code;
  }
}

function encodeUtf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function encodeBase64Url(text: string): string {
  return encodeUtf8ToBase64(text)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function encodeMimeSubject(subject: string): string {
  return `=?UTF-8?B?${encodeUtf8ToBase64(subject)}?=`;
}

export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildAlertEmailHtml(params: {
  subject: string;
  bodyText: string;
  categoryLabel: string;
  senderName: string;
}): string {
  const { subject, bodyText, categoryLabel, senderName } = params;
  const paragraphs = bodyText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(
      (line) =>
        `<p style="margin:0 0 10px 0;font-size:14px;line-height:1.75;color:#1e293b;">${escapeHtml(line)}</p>`,
    )
    .join('');

  return [
    '<!DOCTYPE html>',
    '<html lang="ar" dir="rtl">',
    '<head><meta charset="UTF-8" /></head>',
    '<body style="margin:0;padding:24px;background-color:#f8fafc;font-family:Tahoma,Arial,sans-serif;direction:rtl;text-align:right;">',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">',
    '<tr>',
    '<td style="background:#0f766e;padding:20px 24px;color:#ffffff;">',
    `<div style="font-size:12px;opacity:0.9;margin-bottom:6px;">منصة مدارك المدرسية · ${escapeHtml(categoryLabel)}</div>`,
    `<div style="font-size:18px;font-weight:700;line-height:1.4;">${escapeHtml(subject)}</div>`,
    '</td>',
    '</tr>',
    '<tr>',
    '<td style="padding:24px;">',
    paragraphs || `<p style="margin:0;font-size:14px;color:#1e293b;">${escapeHtml(bodyText)}</p>`,
    '</td>',
    '</tr>',
    '<tr>',
    `<td style="padding:14px 24px;background:#f1f5f9;border-top:1px solid #e2e8f0;font-size:12px;color:#475569;">المرسل: ${escapeHtml(senderName)} · إشعار تلقائي عبر نظام البريد المدرسي</td>`,
    '</tr>',
    '</table>',
    '</body>',
    '</html>',
  ].join('');
}

export function isValidEmailAddress(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export async function sendGmailEmail(params: {
  accessToken: string;
  to: string;
  subject: string;
  bodyText: string;
  categoryLabel: string;
  senderName: string;
  htmlContent?: string;
}): Promise<{ id: string; threadId?: string }> {
  const { accessToken, to, subject, bodyText, categoryLabel, senderName, htmlContent } = params;
  const cleanTo = to.trim();
  if (!isValidEmailAddress(cleanTo)) {
    throw new GmailAuthError(`عنوان البريد الإلكتروني غير صالح: ${cleanTo}`, 'API_ERROR');
  }

  const html =
    htmlContent && htmlContent.trim().length > 0
      ? htmlContent
      : buildAlertEmailHtml({
          subject,
          bodyText,
          categoryLabel,
          senderName,
        });

  const mimeLines = [
    `To: ${cleanTo}`,
    `Subject: ${encodeMimeSubject(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    encodeUtf8ToBase64(html),
  ];

  const raw = encodeBase64Url(mimeLines.join('\r\n'));

  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });

  if (response.status === 401) {
    throw new GmailAuthError(
      'انتهت صلاحية جلسة Gmail. يرجى إعادة ربط حساب Google للمتابعة.',
      'TOKEN_EXPIRED',
    );
  }

  const data = (await response.json().catch(() => ({}))) as {
    id?: string;
    threadId?: string;
    error?: { message?: string };
  };

  if (!response.ok || !data.id) {
    throw new GmailAuthError(
      data.error?.message || `فشل إرسال الرسالة عبر Gmail (رمز ${response.status})`,
      'API_ERROR',
    );
  }

  return { id: data.id, threadId: data.threadId };
}
