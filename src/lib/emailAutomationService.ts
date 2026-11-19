import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db, setGmailAccessToken } from '../firebase';
import { formatIQD } from './currency';
import {
  EMAIL_CATEGORY_LABELS,
  escapeHtml,
  GmailAuthError,
  isValidEmailAddress,
  sendGmailEmail,
} from './gmailService';
import { findDueTomorrowHomework, getLocalDateIso } from './homeworkReminderService';
import { formatArabicMonth, getAcademicRating } from './pdfReportGenerator';
import type {
  AttendanceRecord,
  BehaviorDeduction,
  EmailAlertCategory,
  EmailAlertLog,
  EmailAlertSubscription,
  GradeRecord,
  HomeworkItem,
  Invoice,
  Student,
  UserRole,
} from '../types';

export interface AutomatedEmailItem {
  id: string;
  autoDispatchKey: string;
  track: 'monthly_report' | 'school_warning';
  category: EmailAlertCategory;
  recipientUid: string;
  recipientName: string;
  recipientEmail: string;
  recipientRole: UserRole;
  studentName?: string;
  gradeLabel?: string;
  severity: 'info' | 'warning' | 'urgent';
  subject: string;
  bodyText: string;
  htmlContent: string;
  highlights: string[];
  alreadySent: boolean;
  sentAtSeconds?: number;
}

export interface BatchDispatchResult {
  sentCount: number;
  failedCount: number;
  sentKeys: string[];
}

function sanitizeKeyPart(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48) || 'id';
}

function buildSentKeyMap(emailLogs: EmailAlertLog[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const log of emailLogs) {
    if (log.status === 'sent' && log.autoDispatchKey) {
      map.set(log.autoDispatchKey, log.createdAt?.seconds || 0);
    }
  }
  return map;
}

function wrapSchoolEmailHtml(params: {
  headerColor: string;
  badgeText: string;
  title: string;
  subtitle: string;
  innerHtml: string;
  senderName: string;
}): string {
  const { headerColor, badgeText, title, subtitle, innerHtml, senderName } = params;
  return [
    '<!DOCTYPE html>',
    '<html lang="ar" dir="rtl">',
    '<head><meta charset="UTF-8" /></head>',
    '<body style="margin:0;padding:24px;background-color:#f8fafc;font-family:Tahoma,Arial,sans-serif;direction:rtl;text-align:right;color:#0f172a;">',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">',
    '<tr>',
    `<td style="background:${headerColor};padding:22px 24px;color:#ffffff;">`,
    `<div style="font-size:12px;opacity:0.92;margin-bottom:6px;">منصة مدارك المدرسية · ${escapeHtml(badgeText)}</div>`,
    `<div style="font-size:19px;font-weight:700;line-height:1.45;">${escapeHtml(title)}</div>`,
    `<div style="font-size:12px;opacity:0.88;margin-top:4px;">${escapeHtml(subtitle)}</div>`,
    '</td>',
    '</tr>',
    '<tr>',
    `<td style="padding:24px;">${innerHtml}</td>`,
    '</tr>',
    '<tr>',
    `<td style="padding:14px 24px;background:#f1f5f9;border-top:1px solid #e2e8f0;font-size:12px;color:#475569;">المرسل: ${escapeHtml(senderName)} · خدمة التنبيهات وتقارير الأداء الشهرية التلقائية عبر Gmail</td>`,
    '</tr>',
    '</table>',
    '</body>',
    '</html>',
  ].join('');
}

function resolveStudentsForSubscriber(
  sub: EmailAlertSubscription,
  students: Student[],
): Student[] {
  const owned = students.filter((s) => s.parentUid === sub.uid);
  if (owned.length > 0) {
    return owned;
  }
  if (sub.role !== 'parent') {
    if (sub.gradeLabel && sub.gradeLabel !== 'جميع الصفوف') {
      return students.filter((s) => s.grade === sub.gradeLabel);
    }
    return students;
  }
  if (sub.gradeLabel && sub.gradeLabel !== 'جميع الصفوف') {
    return students.filter((s) => s.grade === sub.gradeLabel);
  }
  return [];
}

function buildStudentMonthlySection(params: {
  student: Student;
  monthKey: string;
  monthLabel: string;
  attendance: AttendanceRecord[];
  grades: GradeRecord[];
  behaviorDeductions: BehaviorDeduction[];
  invoices: Invoice[];
}) {
  const { student, monthKey, monthLabel, attendance, grades, behaviorDeductions, invoices } = params;
  const monthAtt = attendance.filter(
    (a) => a.studentId === student.id && a.date.startsWith(monthKey),
  );
  const present = monthAtt.filter((a) => a.status === 'present').length;
  const absent = monthAtt.filter((a) => a.status === 'absent').length;
  const late = monthAtt.filter((a) => a.status === 'late').length;
  const excused = monthAtt.filter((a) => a.status === 'excused').length;
  const monthAttendancePct =
    monthAtt.length > 0
      ? Math.round(((present + late + excused) / monthAtt.length) * 100)
      : student.attendanceRate;

  const stuGrades = grades.filter((g) => g.studentId === student.id);
  const avgGpa =
    stuGrades.length > 0
      ? Number(
          (stuGrades.reduce((sum, g) => sum + g.totalScore, 0) / stuGrades.length).toFixed(1),
        )
      : student.gpa;

  const behaviorScore = typeof student.behaviorScore === 'number' ? student.behaviorScore : 100;
  const stuDeductions = behaviorDeductions.filter((d) => d.studentId === student.id);

  const unpaidInvoices = invoices.filter(
    (inv) => inv.studentId === student.id && inv.status !== 'paid',
  );
  const overdueAmount = unpaidInvoices
    .filter((i) => i.status === 'overdue')
    .reduce((sum, i) => sum + i.amount, 0);

  const warnings: string[] = [];
  if (absent >= 2) {
    warnings.push(`ارتفاع حالات الغياب (${absent} أيام خلال ${monthLabel}).`);
  } else if (absent === 1) {
    warnings.push(`رصد حالة غياب واحدة خلال ${monthLabel}.`);
  }
  if (behaviorScore < 85) {
    warnings.push(`تنبيه سلوكي: رصيد السلوك الحالي ${behaviorScore}/100 ويحتاج لمتابعة.`);
  }
  if (overdueAmount > 0) {
    warnings.push(`توجد مستحقات متأخرة بقيمة ${formatIQD(overdueAmount)}.`);
  }

  const gradeRowsHtml = stuGrades
    .map(
      (g) => `
      <tr>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-weight:600;color:#0f172a;">${escapeHtml(g.subject)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;color:#475569;font-size:12px;">${escapeHtml(g.term)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-family:monospace;color:#334155;">${g.midtermScore}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-family:monospace;color:#334155;">${g.courseworkScore}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-family:monospace;color:#334155;">${g.finalScore}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-family:monospace;font-weight:700;color:#0f766e;">${g.totalScore}/100</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#0f172a;">${escapeHtml(getAcademicRating(g.totalScore))}</td>
      </tr>`,
    )
    .join('');

  const htmlBlock = `
    <div style="border:1px solid #cbd5e1;border-radius:10px;padding:18px;margin-bottom:18px;background:#ffffff;">
      <div style="border-bottom:1px solid #e2e8f0;padding-bottom:10px;margin-bottom:14px;">
        <div style="font-size:16px;font-weight:700;color:#0f172a;">${escapeHtml(student.fullName)}</div>
        <div style="font-size:12px;color:#64748b;margin-top:2px;">
          ${escapeHtml(student.grade)} — الشعبة ${escapeHtml(student.section)} · الرقم الأكاديمي: ${escapeHtml(student.studentCode)}
        </div>
      </div>

      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:14px;">
        <tr>
          <td width="25%" style="padding:4px;">
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px;">
              <div style="font-size:11px;color:#64748b;">المعدل الأكاديمي</div>
              <div style="font-size:17px;font-weight:700;color:#0f766e;margin-top:3px;">${avgGpa}%</div>
              <div style="font-size:11px;color:#475569;">${escapeHtml(getAcademicRating(avgGpa))}</div>
            </div>
          </td>
          <td width="25%" style="padding:4px;">
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px;">
              <div style="font-size:11px;color:#64748b;">نسبة الحضور</div>
              <div style="font-size:17px;font-weight:700;color:#047857;margin-top:3px;">${monthAttendancePct}%</div>
              <div style="font-size:11px;color:#475569;">${monthAtt.length} سجل بالشهر</div>
            </div>
          </td>
          <td width="25%" style="padding:4px;">
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px;">
              <div style="font-size:11px;color:#64748b;">درجة السلوك</div>
              <div style="font-size:17px;font-weight:700;color:${behaviorScore < 85 ? '#b91c1c' : '#0f172a'};margin-top:3px;">${behaviorScore}/100</div>
              <div style="font-size:11px;color:#475569;">${stuDeductions.length} ملاحظات</div>
            </div>
          </td>
          <td width="25%" style="padding:4px;">
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px;">
              <div style="font-size:11px;color:#64748b;">غياب / تأخر الشهر</div>
              <div style="font-size:17px;font-weight:700;color:${absent > 0 ? '#b91c1c' : '#334155'};margin-top:3px;">${absent} / ${late}</div>
              <div style="font-size:11px;color:#475569;">حضور: ${present} · بعذر: ${excused}</div>
            </div>
          </td>
        </tr>
      </table>

      ${
        stuGrades.length > 0
          ? `<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #e2e8f0;font-size:13px;margin-bottom:12px;">
              <thead>
                <tr style="background:#f1f5f9;color:#475569;font-size:11px;">
                  <th style="padding:8px 10px;text-align:right;border-bottom:1px solid #cbd5e1;">المادة</th>
                  <th style="padding:8px 10px;text-align:right;border-bottom:1px solid #cbd5e1;">الفصل</th>
                  <th style="padding:8px 10px;text-align:right;border-bottom:1px solid #cbd5e1;">نصفي</th>
                  <th style="padding:8px 10px;text-align:right;border-bottom:1px solid #cbd5e1;">أعمال</th>
                  <th style="padding:8px 10px;text-align:right;border-bottom:1px solid #cbd5e1;">نهائي</th>
                  <th style="padding:8px 10px;text-align:right;border-bottom:1px solid #cbd5e1;">المجموع</th>
                  <th style="padding:8px 10px;text-align:right;border-bottom:1px solid #cbd5e1;">التقدير</th>
                </tr>
              </thead>
              <tbody>${gradeRowsHtml}</tbody>
            </table>`
          : `<p style="font-size:12px;color:#64748b;margin:8px 0;">لا توجد درجات تفصيلية مرصودة حالياً لهذا الطالب (المعدل العام المسجل: ${student.gpa}%).</p>`
      }

      ${
        warnings.length > 0
          ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 12px;font-size:12px;color:#991b1b;">
              <strong>ملاحظات وتنبيهات المتابعة:</strong>
              <ul style="margin:6px 0 0 0;padding-right:18px;">
                ${warnings.map((w) => `<li style="margin-bottom:3px;">${escapeHtml(w)}</li>`).join('')}
              </ul>
            </div>`
          : `<div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:10px 12px;font-size:12px;color:#065f46;">
              أداء الطالب منتظم ومتميز خلال شهر ${escapeHtml(monthLabel)} دون تسجيل إنذارات غياب أو سلوك.
            </div>`
      }
    </div>`;

  const textSummary = [
    `• ${student.fullName} (${student.grade} - ${student.section}):`,
    `  المعدل الأكاديمي: ${avgGpa}% (${getAcademicRating(avgGpa)}) | نسبة الحضور: ${monthAttendancePct}% (حاضر: ${present}، غائب: ${absent}، متأخر: ${late}) | السلوك: ${behaviorScore}/100`,
    ...(warnings.length > 0 ? [`  تنبيهات: ${warnings.join(' ')}`] : []),
  ].join('\n');

  return {
    htmlBlock,
    textSummary,
    avgGpa,
    monthAttendancePct,
    behaviorScore,
    absent,
    late,
  };
}

export function buildMonthlyPerformanceReportEmails(params: {
  monthKey: string;
  subscriptions: EmailAlertSubscription[];
  students: Student[];
  attendance: AttendanceRecord[];
  grades: GradeRecord[];
  behaviorDeductions: BehaviorDeduction[];
  invoices: Invoice[];
  emailLogs: EmailAlertLog[];
  senderName: string;
}): AutomatedEmailItem[] {
  const {
    monthKey,
    subscriptions,
    students,
    attendance,
    grades,
    behaviorDeductions,
    invoices,
    emailLogs,
    senderName,
  } = params;

  const monthLabel = formatArabicMonth(monthKey);
  const sentMap = buildSentKeyMap(emailLogs);
  const results: AutomatedEmailItem[] = [];

  for (const sub of subscriptions) {
    if (!sub.enabled || !isValidEmailAddress(sub.email)) continue;
    if (!sub.alertGrades && !sub.alertAttendance && !sub.alertBehavior) continue;

    const matchedStudents = resolveStudentsForSubscriber(sub, students);
    if (matchedStudents.length === 0) continue;

    const autoDispatchKey = `monthly_${monthKey}_${sanitizeKeyPart(sub.uid)}`.slice(0, 160);
    const sections = matchedStudents.map((stu) =>
      buildStudentMonthlySection({
        student: stu,
        monthKey,
        monthLabel,
        attendance,
        grades,
        behaviorDeductions,
        invoices,
      }),
    );

    const avgAllGpa = (
      sections.reduce((sum, s) => sum + s.avgGpa, 0) / sections.length
    ).toFixed(1);
    const avgAllAtt = Math.round(
      sections.reduce((sum, s) => sum + s.monthAttendancePct, 0) / sections.length,
    );
    const totalAbsents = sections.reduce((sum, s) => sum + s.absent, 0);

    const isSingleStudent = matchedStudents.length === 1;
    const subject = isSingleStudent
      ? `تقرير الأداء الشهري (${monthLabel}) — الطالب ${matchedStudents[0].fullName}`.slice(0, 180)
      : `ملخص تقارير الأداء الشهرية (${monthLabel}) — ${matchedStudents.length} طلاب`.slice(0, 180);

    const bodyText = [
      `السلام عليكم ورحمة الله وبركاته ${sub.displayName}،`,
      ``,
      `نرفع لكم تقرير الأداء الأكاديمي والانضباطي لشهر ${monthLabel}:`,
      ...sections.map((s) => s.textSummary),
      ``,
      `يمكنكم مراجعة التفاصيل الكاملة وطباعة التقرير المعتمد من خلال منصة مدارك المدرسية.`,
    ].join('\n');

    const introHtml = `
      <p style="margin:0 0 14px 0;font-size:14px;line-height:1.7;color:#1e293b;">
        السلام عليكم ورحمة الله وبركاته <strong>${escapeHtml(sub.displayName)}</strong>،<br/>
        فيما يلي خلاصة الأداء الشهري (الأكاديمي، الحضور والغياب، والسلوك والانضباط) لشهر <strong>${escapeHtml(monthLabel)}</strong>:
      </p>`;

    const htmlContent = wrapSchoolEmailHtml({
      headerColor: '#0f766e',
      badgeText: `تقرير الأداء الشهري · ${monthLabel}`,
      title: subject,
      subtitle: `المستلم: ${sub.displayName} · عدد الطلبة المشمولين: ${matchedStudents.length}`,
      innerHtml: introHtml + sections.map((s) => s.htmlBlock).join(''),
      senderName,
    });

    results.push({
      id: autoDispatchKey,
      autoDispatchKey,
      track: 'monthly_report',
      category: 'monthly_report',
      recipientUid: sub.uid,
      recipientName: sub.displayName,
      recipientEmail: sub.email,
      recipientRole: sub.role,
      studentName: isSingleStudent ? matchedStudents[0].fullName : `${matchedStudents.length} طلاب`,
      gradeLabel: sub.gradeLabel || matchedStudents[0]?.grade || 'جميع الصفوف',
      severity: totalAbsents > 0 ? 'warning' : 'info',
      subject,
      bodyText,
      htmlContent,
      highlights: [
        `الطلبة: ${matchedStudents.length}`,
        `متوسط المعدل: ${avgAllGpa}%`,
        `متوسط الحضور: ${avgAllAtt}%`,
      ],
      alreadySent: sentMap.has(autoDispatchKey),
      sentAtSeconds: sentMap.get(autoDispatchKey),
    });
  }

  return results;
}

export function buildSingleAttendanceWarningEmail(params: {
  record: AttendanceRecord;
  subscriber: EmailAlertSubscription;
  senderName: string;
  sentMap?: Map<string, number>;
}): AutomatedEmailItem {
  const { record, subscriber, senderName, sentMap } = params;
  const isAbsent = record.status === 'absent';
  const statusAr = isAbsent ? 'غائب' : 'متأخر عن الطابور الصباحي';
  const autoDispatchKey = `warn_att_${sanitizeKeyPart(record.id)}_${sanitizeKeyPart(subscriber.uid)}`.slice(
    0,
    160,
  );
  const subject = isAbsent
    ? `إنذار غياب مدرسي: ${record.studentName} (${record.date})`.slice(0, 180)
    : `تنبيه تأخر صباحي: ${record.studentName} (${record.date})`.slice(0, 180);

  const bodyText = [
    `السلام عليكم ورحمة الله وبركاته ${subscriber.displayName}،`,
    ``,
    `نود إشعاركم بتسجيل حالة "${statusAr}" للطالب/ة ${record.studentName} (${record.grade}) بتاريخ ${record.date}${
      record.checkInTime && record.checkInTime !== '--:--'
        ? ` في تمام الساعة ${record.checkInTime}`
        : ''
    }.`,
    record.notes ? `ملاحظة الرصد: ${record.notes}` : '',
    ``,
    `يرجى التواصل مع إدارة المدرسة أو إرسال العذر الرسمي عبر البوابة المباشرة.`,
  ]
    .filter(Boolean)
    .join('\n');

  const htmlContent = wrapSchoolEmailHtml({
    headerColor: isAbsent ? '#b91c1c' : '#b45309',
    badgeText: 'إنذار حضور وغياب آلي',
    title: subject,
    subtitle: `${record.studentName} · ${record.grade}`,
    innerHtml: `
      <p style="margin:0 0 14px 0;font-size:14px;line-height:1.75;color:#1e293b;">
        السلام عليكم ورحمة الله وبركاته <strong>${escapeHtml(subscriber.displayName)}</strong>،
      </p>
      <div style="background:${isAbsent ? '#fef2f2' : '#fffbeb'};border:1px solid ${
        isAbsent ? '#fecaca' : '#fde68a'
      };border-radius:10px;padding:16px;margin-bottom:16px;">
        <div style="font-size:14px;font-weight:700;color:${
          isAbsent ? '#991b1b' : '#92400e'
        };margin-bottom:8px;">
          تفاصيل الإنذار المسجل:
        </div>
        <div style="font-size:13px;color:#334155;line-height:1.8;">
          • <strong>اسم الطالب:</strong> ${escapeHtml(record.studentName)}<br/>
          • <strong>الصف الدراسي:</strong> ${escapeHtml(record.grade)}<br/>
          • <strong>الحالة:</strong> ${escapeHtml(statusAr)}<br/>
          • <strong>التاريخ:</strong> ${escapeHtml(record.date)}${
            record.checkInTime && record.checkInTime !== '--:--'
              ? ` · <strong>الوقت:</strong> ${escapeHtml(record.checkInTime)}`
              : ''
          }
        </div>
      </div>
      <p style="margin:0;font-size:13px;color:#475569;line-height:1.7;">
        يرجى المتابعة مع شؤون الطلبة أو تقديم العذر الرسمي عبر تبويب التواصل المباشر في منصة مدارك.
      </p>`,
    senderName,
  });

  return {
    id: autoDispatchKey,
    autoDispatchKey,
    track: 'school_warning',
    category: 'attendance',
    recipientUid: subscriber.uid,
    recipientName: subscriber.displayName,
    recipientEmail: subscriber.email,
    recipientRole: subscriber.role,
    studentName: record.studentName,
    gradeLabel: record.grade,
    severity: isAbsent ? 'urgent' : 'warning',
    subject,
    bodyText,
    htmlContent,
    highlights: [record.studentName, statusAr, record.date],
    alreadySent: sentMap?.has(autoDispatchKey) ?? false,
    sentAtSeconds: sentMap?.get(autoDispatchKey),
  };
}

export function buildSingleBehaviorWarningEmail(params: {
  deduction: BehaviorDeduction;
  subscriber: EmailAlertSubscription;
  senderName: string;
  sentMap?: Map<string, number>;
}): AutomatedEmailItem {
  const { deduction, subscriber, senderName, sentMap } = params;
  const autoDispatchKey = `warn_beh_${sanitizeKeyPart(deduction.id)}_${sanitizeKeyPart(
    subscriber.uid,
  )}`.slice(0, 160);

  const isSevere = deduction.newScore < 80;
  const subject = `${isSevere ? 'إنذار سلوكي هام' : 'إشعار خصم سلوكي'}: ${deduction.studentName} (${deduction.newScore}/100)`.slice(
    0,
    180,
  );

  const bodyText = [
    `السلام عليكم ورحمة الله وبركاته ${subscriber.displayName}،`,
    ``,
    `نود إبلاغكم بتسجيل خصم سلوكي للطالب/ة ${deduction.studentName} (${deduction.grade}):`,
    `- النقاط المخصومة: ${deduction.pointsDeducted} درجات`,
    `- الدرجة السابقة ← الحالية: ${deduction.previousScore} ← ${deduction.newScore} / 100`,
    `- السبب: ${deduction.reason}`,
    `- تم التسجيل بواسطة: ${deduction.deductedByName}`,
    ``,
    `نأمل التعاون المشترك لتعزيز الانضباط والالتزام المدرسي.`,
  ].join('\n');

  const htmlContent = wrapSchoolEmailHtml({
    headerColor: isSevere ? '#b91c1c' : '#b45309',
    badgeText: 'إنذار السلوك والانضباط المدرسي',
    title: subject,
    subtitle: `${deduction.studentName} · ${deduction.grade}`,
    innerHtml: `
      <p style="margin:0 0 14px 0;font-size:14px;line-height:1.75;color:#1e293b;">
        السلام عليكم ورحمة الله وبركاته <strong>${escapeHtml(subscriber.displayName)}</strong>،
      </p>
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:16px;margin-bottom:14px;">
        <div style="font-size:13px;color:#334155;line-height:1.9;">
          • <strong>الطالب/ة:</strong> ${escapeHtml(deduction.studentName)} (${escapeHtml(deduction.grade)})<br/>
          • <strong>النقاط المخصومة:</strong> -${deduction.pointsDeducted} درجات<br/>
          • <strong>رصيد السلوك الحالي:</strong> <strong>${deduction.newScore} / 100</strong> (كان ${deduction.previousScore})<br/>
          • <strong>سبب الإجراء:</strong> ${escapeHtml(deduction.reason)}<br/>
          • <strong>المسجل:</strong> ${escapeHtml(deduction.deductedByName)}
        </div>
      </div>
      <p style="margin:0;font-size:13px;color:#475569;line-height:1.7;">
        نأمل التواصل مع المرشد التربوي وإدارة المدرسة لمتابعة تقويم السلوك وتعزيز الجوانب الإيجابية.
      </p>`,
    senderName,
  });

  return {
    id: autoDispatchKey,
    autoDispatchKey,
    track: 'school_warning',
    category: 'behavior',
    recipientUid: subscriber.uid,
    recipientName: subscriber.displayName,
    recipientEmail: subscriber.email,
    recipientRole: subscriber.role,
    studentName: deduction.studentName,
    gradeLabel: deduction.grade,
    severity: isSevere ? 'urgent' : 'warning',
    subject,
    bodyText,
    htmlContent,
    highlights: [
      deduction.studentName,
      `خصم -${deduction.pointsDeducted}`,
      `الرصيد ${deduction.newScore}/100`,
    ],
    alreadySent: sentMap?.has(autoDispatchKey) ?? false,
    sentAtSeconds: sentMap?.get(autoDispatchKey),
  };
}

export function collectAutomatedSchoolWarnings(params: {
  subscriptions: EmailAlertSubscription[];
  attendance: AttendanceRecord[];
  behaviorDeductions: BehaviorDeduction[];
  invoices: Invoice[];
  homework: HomeworkItem[];
  emailLogs: EmailAlertLog[];
  senderName: string;
  referenceDate?: Date;
}): AutomatedEmailItem[] {
  const {
    subscriptions,
    attendance,
    behaviorDeductions,
    invoices,
    homework,
    emailLogs,
    senderName,
    referenceDate = new Date(),
  } = params;

  const sentMap = buildSentKeyMap(emailLogs);
  const warnings: AutomatedEmailItem[] = [];
  const activeSubs = subscriptions.filter((s) => s.enabled && isValidEmailAddress(s.email));
  const subByUid = new Map<string, EmailAlertSubscription>();
  for (const sub of activeSubs) {
    subByUid.set(sub.uid, sub);
  }

  // 1. Absence & lateness warnings (sorted newest first, capped reasonably for clean queue)
  const attIssues = [...attendance]
    .filter((r) => r.status === 'absent' || r.status === 'late')
    .sort((a, b) => b.date.localeCompare(a.date));

  for (const rec of attIssues) {
    const sub = subByUid.get(rec.parentUid);
    if (!sub || !sub.alertAttendance) continue;
    warnings.push(
      buildSingleAttendanceWarningEmail({
        record: rec,
        subscriber: sub,
        senderName,
        sentMap,
      }),
    );
  }

  // 2. Behavior deduction warnings
  const sortedBeh = [...behaviorDeductions].sort(
    (a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0),
  );
  for (const ded of sortedBeh) {
    const sub = subByUid.get(ded.parentUid);
    if (!sub || !sub.alertBehavior) continue;
    warnings.push(
      buildSingleBehaviorWarningEmail({
        deduction: ded,
        subscriber: sub,
        senderName,
        sentMap,
      }),
    );
  }

  // 3. Overdue tuition fee warnings (IQD)
  const overdueInvoices = invoices.filter((inv) => inv.status === 'overdue');
  for (const inv of overdueInvoices) {
    const sub = subByUid.get(inv.parentUid);
    if (!sub || !sub.alertPayments) continue;
    const autoDispatchKey = `warn_pay_${sanitizeKeyPart(inv.id)}_${sanitizeKeyPart(sub.uid)}`.slice(
      0,
      160,
    );
    const subject = `إنذار استحقاق فاتورة متأخرة: ${inv.studentName} (${inv.invoiceNumber})`.slice(
      0,
      180,
    );
    const amountFormatted = formatIQD(inv.amount);
    const bodyText = [
      `السلام عليكم ورحمة الله وبركاته ${sub.displayName}،`,
      ``,
      `نذكّركم بوجود فاتورة دراسية متأخرة السداد للطالب/ة ${inv.studentName}:`,
      `- رقم الفاتورة: ${inv.invoiceNumber}`,
      `- البيان: ${inv.title}`,
      `- المبلغ المستحق: ${amountFormatted}`,
      `- تاريخ الاستحقاق: ${inv.dueDate}`,
      ``,
      `يرجى المبادرة بالسداد عبر بوابة الرسوم والفواتير في منصة مدارك.`,
    ].join('\n');

    const htmlContent = wrapSchoolEmailHtml({
      headerColor: '#b91c1c',
      badgeText: 'تنبيه الرسوم والفواتير المتأخرة',
      title: subject,
      subtitle: `${inv.studentName} · رقم الفاتورة ${inv.invoiceNumber}`,
      innerHtml: `
        <p style="margin:0 0 14px 0;font-size:14px;color:#1e293b;">
          السلام عليكم ورحمة الله وبركاته <strong>${escapeHtml(sub.displayName)}</strong>،
        </p>
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:16px;font-size:13px;color:#334155;line-height:1.9;">
          • <strong>الطالب/ة:</strong> ${escapeHtml(inv.studentName)}<br/>
          • <strong>تفاصيل الفاتورة:</strong> ${escapeHtml(inv.title)}<br/>
          • <strong>المبلغ المطلوب:</strong> <strong style="color:#991b1b;">${escapeHtml(amountFormatted)}</strong><br/>
          • <strong>تاريخ الاستحقاق:</strong> ${escapeHtml(inv.dueDate)}
        </div>`,
      senderName,
    });

    warnings.push({
      id: autoDispatchKey,
      autoDispatchKey,
      track: 'school_warning',
      category: 'payment',
      recipientUid: sub.uid,
      recipientName: sub.displayName,
      recipientEmail: sub.email,
      recipientRole: sub.role,
      studentName: inv.studentName,
      severity: 'urgent',
      subject,
      bodyText,
      htmlContent,
      highlights: [inv.studentName, amountFormatted, `استحقاق ${inv.dueDate}`],
      alreadySent: sentMap.has(autoDispatchKey),
      sentAtSeconds: sentMap.get(autoDispatchKey),
    });
  }

  // 4. Due-tomorrow homework reminders
  const dueTomorrow = findDueTomorrowHomework(homework, referenceDate);
  for (const hw of dueTomorrow) {
    for (const sub of activeSubs) {
      if (!sub.alertHomework) continue;
      if (sub.gradeLabel && sub.gradeLabel !== 'جميع الصفوف' && sub.gradeLabel !== hw.grade) {
        continue;
      }
      const autoDispatchKey = `warn_hw_${sanitizeKeyPart(hw.id)}_${sanitizeKeyPart(sub.uid)}`.slice(
        0,
        160,
      );
      const subject = `تذكير واجب مستحق غداً: ${hw.title} (${hw.subject})`.slice(0, 180);
      const bodyText = [
        `السلام عليكم ورحمة الله وبركاته ${sub.displayName}،`,
        ``,
        `نذكّركم بقرب موعد تسليم الواجب المنزلي غداً (${hw.dueDate}):`,
        `- العنوان: ${hw.title}`,
        `- المادة والصف: ${hw.subject} — ${hw.grade}`,
        `- المعلم: ${hw.teacherName}`,
        `- التفاصيل: ${hw.description}`,
      ].join('\n');

      const htmlContent = wrapSchoolEmailHtml({
        headerColor: '#0f766e',
        badgeText: 'تذكير آلي للواجبات المنزلية',
        title: subject,
        subtitle: `${hw.subject} · ${hw.grade} · التسليم ${hw.dueDate}`,
        innerHtml: `
          <p style="margin:0 0 12px 0;font-size:14px;color:#1e293b;">
            السلام عليكم ورحمة الله وبركاته <strong>${escapeHtml(sub.displayName)}</strong>،
          </p>
          <div style="background:#f0fdfa;border:1px solid #99f6e4;border-radius:10px;padding:16px;font-size:13px;color:#134e4a;line-height:1.85;">
            <strong>${escapeHtml(hw.title)}</strong><br/>
            المادة: ${escapeHtml(hw.subject)} · الصف: ${escapeHtml(hw.grade)}<br/>
            موعد التسليم النهائي: <strong>${escapeHtml(hw.dueDate)}</strong><br/>
            التفاصيل: ${escapeHtml(hw.description)}
          </div>`,
        senderName,
      });

      warnings.push({
        id: autoDispatchKey,
        autoDispatchKey,
        track: 'school_warning',
        category: 'homework',
        recipientUid: sub.uid,
        recipientName: sub.displayName,
        recipientEmail: sub.email,
        recipientRole: sub.role,
        gradeLabel: hw.grade,
        severity: 'info',
        subject,
        bodyText,
        htmlContent,
        highlights: [hw.subject, hw.grade, `غداً ${hw.dueDate}`],
        alreadySent: sentMap.has(autoDispatchKey),
        sentAtSeconds: sentMap.get(autoDispatchKey),
      });
    }
  }

  return warnings;
}

export async function dispatchAutomatedEmailsViaGmail(params: {
  accessToken: string;
  items: AutomatedEmailItem[];
  senderUid: string;
  senderName: string;
  senderEmail: string;
}): Promise<BatchDispatchResult> {
  const { accessToken, items, senderUid, senderName, senderEmail } = params;
  const safeSenderName =
    senderName && senderName.trim().length >= 2 ? senderName.trim().slice(0, 120) : 'إدارة المدرسة';
  const safeSenderEmail = (senderEmail || 'school@madarek.edu').slice(0, 160);

  let sentCount = 0;
  let failedCount = 0;
  const sentKeys: string[] = [];
  const logEntries: Omit<EmailAlertLog, 'id' | 'createdAt'>[] = [];

  for (const item of items) {
    try {
      const result = await sendGmailEmail({
        accessToken,
        to: item.recipientEmail,
        subject: item.subject,
        bodyText: item.bodyText,
        categoryLabel: EMAIL_CATEGORY_LABELS[item.category],
        senderName: safeSenderName,
        htmlContent: item.htmlContent,
      });
      sentCount += 1;
      sentKeys.push(item.autoDispatchKey);
      logEntries.push({
        senderUid,
        senderName: safeSenderName,
        senderEmail: safeSenderEmail,
        recipientUid: item.recipientUid.slice(0, 128),
        recipientName: item.recipientName.slice(0, 120),
        recipientEmail: item.recipientEmail.slice(0, 160),
        category: item.category,
        subject: item.subject.slice(0, 180),
        bodyPreview: item.bodyText.slice(0, 500),
        status: 'sent',
        gmailMessageId: result.id.slice(0, 128),
        autoDispatchKey: item.autoDispatchKey.slice(0, 160),
      });
    } catch (err) {
      if (err instanceof GmailAuthError && err.code === 'TOKEN_EXPIRED') {
        setGmailAccessToken(null);
        // Save any partial logs already sent before throwing auth error
        if (logEntries.length > 0) {
          const partialBatch = writeBatch(db);
          const now = serverTimestamp();
          const stamp = Date.now();
          logEntries.forEach((entry, idx) => {
            partialBatch.set(doc(db, 'emailAlertLogs', `autolog_${stamp}_${idx}`), {
              ...entry,
              createdAt: now,
            });
          });
          await partialBatch.commit();
        }
        throw err;
      }
      failedCount += 1;
      logEntries.push({
        senderUid,
        senderName: safeSenderName,
        senderEmail: safeSenderEmail,
        recipientUid: item.recipientUid.slice(0, 128),
        recipientName: item.recipientName.slice(0, 120),
        recipientEmail: item.recipientEmail.slice(0, 160),
        category: item.category,
        subject: item.subject.slice(0, 180),
        bodyPreview: item.bodyText.slice(0, 500),
        status: 'failed',
        errorMessage: (err instanceof Error ? err.message : 'فشل الإرسال').slice(0, 300),
        autoDispatchKey: item.autoDispatchKey.slice(0, 160),
      });
    }
  }

  if (logEntries.length > 0) {
    const CHUNK = 400;
    const stamp = Date.now();
    for (let i = 0; i < logEntries.length; i += CHUNK) {
      const chunk = logEntries.slice(i, i + CHUNK);
      const batch = writeBatch(db);
      const now = serverTimestamp();
      chunk.forEach((entry, idx) => {
        batch.set(doc(db, 'emailAlertLogs', `autolog_${stamp}_${i + idx}`), {
          ...entry,
          createdAt: now,
        });
      });
      await batch.commit();
    }
  }

  return { sentCount, failedCount, sentKeys };
}

export function getDefaultReportMonthKey(): string {
  return getLocalDateIso().slice(0, 7);
}
