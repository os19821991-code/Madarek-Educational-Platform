import { jsPDF } from 'jspdf';
import type {
  Activity,
  Announcement,
  AttendanceRecord,
  GradeRecord,
  Invoice,
  Student,
  TeacherEvaluation,
} from '../types';

export interface MonthlyStudentAttendanceRow {
  studentId: string;
  studentCode: string;
  fullName: string;
  grade: string;
  section: string;
  present: number;
  absent: number;
  late: number;
  excused: number;
  totalLogs: number;
  attendanceRate: number;
}

export interface MonthlyReportSummary {
  monthKey: string;
  monthLabel: string;
  gradeFilterLabel: string;
  totalStudents: number;
  totalRecords: number;
  presentCount: number;
  absentCount: number;
  lateCount: number;
  excusedCount: number;
  avgAttendancePct: number;
  rows: MonthlyStudentAttendanceRow[];
  incidentLogs: AttendanceRecord[];
}

const ARABIC_MONTHS: Record<string, string> = {
  '01': 'يناير',
  '02': 'فبراير',
  '03': 'مارس',
  '04': 'أبريل',
  '05': 'مايو',
  '06': 'يونيو',
  '07': 'يوليو',
  '08': 'أغسطس',
  '09': 'سبتمبر',
  '10': 'أكتوبر',
  '11': 'نوفمبر',
  '12': 'ديسمبر',
};

export function formatArabicMonth(monthKey: string): string {
  const [year, month] = monthKey.split('-');
  if (!year || !month) return monthKey;
  return `${ARABIC_MONTHS[month] || month} ${year}`;
}

export function buildMonthlyAttendanceSummary(
  monthKey: string,
  gradeFilter: string,
  students: Student[],
  attendance: AttendanceRecord[],
): MonthlyReportSummary {
  const scopedStudents =
    gradeFilter === 'all' ? students : students.filter((s) => s.grade === gradeFilter);

  const monthRecords = attendance.filter((rec) => {
    const inMonth = rec.date.startsWith(monthKey);
    const matchesGrade = gradeFilter === 'all' || rec.grade === gradeFilter;
    return inMonth && matchesGrade;
  });

  const rows: MonthlyStudentAttendanceRow[] = scopedStudents.map((stu) => {
    const stuRecs = monthRecords.filter((r) => r.studentId === stu.id);
    const present = stuRecs.filter((r) => r.status === 'present').length;
    const absent = stuRecs.filter((r) => r.status === 'absent').length;
    const late = stuRecs.filter((r) => r.status === 'late').length;
    const excused = stuRecs.filter((r) => r.status === 'excused').length;
    const totalLogs = stuRecs.length;
    const attendanceRate =
      totalLogs > 0 ? Math.round(((present + late + excused) / totalLogs) * 100) : stu.attendanceRate;

    return {
      studentId: stu.id,
      studentCode: stu.studentCode,
      fullName: stu.fullName,
      grade: stu.grade,
      section: stu.section,
      present,
      absent,
      late,
      excused,
      totalLogs,
      attendanceRate,
    };
  });

  const presentCount = monthRecords.filter((r) => r.status === 'present').length;
  const absentCount = monthRecords.filter((r) => r.status === 'absent').length;
  const lateCount = monthRecords.filter((r) => r.status === 'late').length;
  const excusedCount = monthRecords.filter((r) => r.status === 'excused').length;

  const avgAttendancePct =
    rows.length > 0
      ? Math.round(rows.reduce((sum, r) => sum + r.attendanceRate, 0) / rows.length)
      : 0;

  const incidentLogs = monthRecords
    .filter((r) => r.status === 'absent' || r.status === 'late' || r.status === 'excused')
    .sort((a, b) => b.date.localeCompare(a.date));

  return {
    monthKey,
    monthLabel: formatArabicMonth(monthKey),
    gradeFilterLabel: gradeFilter === 'all' ? 'جميع الصفوف الدراسية' : gradeFilter,
    totalStudents: scopedStudents.length,
    totalRecords: monthRecords.length,
    presentCount,
    absentCount,
    lateCount,
    excusedCount,
    avgAttendancePct,
    rows,
    incidentLogs,
  };
}

const PAGE_W = 1240;
const PAGE_H = 1754;
const MARGIN = 72;

function createPageCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('تعذر تهيئة محرك رسم التقرير PDF');
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  ctx.direction = 'rtl';
  ctx.textBaseline = 'middle';
  return { canvas, ctx };
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
  stroke?: string,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

export async function generateMonthlyAttendancePdf(
  summary: MonthlyReportSummary,
  generatedBy: string,
): Promise<string> {
  if (document.fonts && document.fonts.ready) {
    await document.fonts.ready;
  }

  const pages: HTMLCanvasElement[] = [];
  let { canvas, ctx } = createPageCanvas();
  pages.push(canvas);

  const drawFooter = (c: CanvasRenderingContext2D, pageNum: number) => {
    c.strokeStyle = '#e2e8f0';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(MARGIN, PAGE_H - 76);
    c.lineTo(PAGE_W - MARGIN, PAGE_H - 76);
    c.stroke();

    c.fillStyle = '#64748b';
    c.font = '400 18px "IBM Plex Sans Arabic", "Cairo", sans-serif';
    c.textAlign = 'right';
    c.fillText(
      `منصة مدارك المدرسية · تقرير شهري موثق لسجل الحضور والغياب (${summary.monthLabel})`,
      PAGE_W - MARGIN,
      PAGE_H - 46,
    );
    c.textAlign = 'left';
    c.fillText(`صفحة ${pageNum}`, MARGIN, PAGE_H - 46);
  };

  // Top Header Band
  drawRoundedRect(ctx, MARGIN, 64, PAGE_W - MARGIN * 2, 148, 14, '#0f766e');
  ctx.fillStyle = '#ccfbf1';
  ctx.font = '600 20px "IBM Plex Sans Arabic", "Cairo", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('منصة مدارك المدرسية · الشؤون الطلابية والانضباط', PAGE_W - MARGIN - 32, 104);

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 34px "Cairo", "IBM Plex Sans Arabic", sans-serif';
  ctx.fillText(`التقرير الشهري لسجل الحضور والغياب — ${summary.monthLabel}`, PAGE_W - MARGIN - 32, 152);

  ctx.fillStyle = '#e2e8f0';
  ctx.font = '400 18px "IBM Plex Sans Arabic", "Cairo", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`الفئة: ${summary.gradeFilterLabel}`, MARGIN + 32, 108);
  ctx.fillText(`إصدار: ${generatedBy}`, MARGIN + 32, 144);
  ctx.fillText(`التاريخ: ${new Date().toISOString().slice(0, 10)}`, MARGIN + 32, 178);

  // KPI Strip (4 boxes)
  const kpiY = 240;
  const kpiGap = 18;
  const kpiW = (PAGE_W - MARGIN * 2 - kpiGap * 3) / 4;
  const kpis = [
    { label: 'إجمالي الطلاب', value: `${summary.totalStudents}`, color: '#0f172a' },
    { label: 'سجلات الحضور', value: `${summary.presentCount}`, color: '#15803d' },
    { label: 'سجلات الغياب والتأخر', value: `${summary.absentCount + summary.lateCount}`, color: '#b91c1c' },
    { label: 'متوسط نسبة الانتظام', value: `${summary.avgAttendancePct}%`, color: '#0f766e' },
  ];

  kpis.forEach((k, idx) => {
    const x = PAGE_W - MARGIN - kpiW - idx * (kpiW + kpiGap);
    drawRoundedRect(ctx, x, kpiY, kpiW, 104, 12, '#f8fafc', '#e2e8f0');
    ctx.fillStyle = '#64748b';
    ctx.font = '500 18px "IBM Plex Sans Arabic", "Cairo", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(k.label, x + kpiW - 20, kpiY + 32);

    ctx.fillStyle = k.color;
    ctx.font = '700 32px "IBM Plex Mono", "Cairo", monospace';
    ctx.fillText(k.value, x + kpiW - 20, kpiY + 72);
  });

  // Section 1: Per-Student Summary Table
  let cursorY = 384;
  ctx.fillStyle = '#0f172a';
  ctx.font = '700 24px "Cairo", "IBM Plex Sans Arabic", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('1. ملخص الانضباط والحضور الشهري للطلاب', PAGE_W - MARGIN, cursorY);
  cursorY += 32;

  const colWidths = [280, 150, 150, 95, 95, 95, 95, 136]; // sum = 1096 (= PAGE_W - 144)
  const colHeaders = ['اسم الطالب', 'الرقم الأكاديمي', 'الصف', 'حاضر', 'غائب', 'متأخر', 'بعذر', 'الانتظام %'];

  const drawTableHeader = (targetCtx: CanvasRenderingContext2D, y: number) => {
    drawRoundedRect(targetCtx, MARGIN, y, PAGE_W - MARGIN * 2, 48, 8, '#f1f5f9', '#cbd5e1');
    targetCtx.fillStyle = '#334155';
    targetCtx.font = '700 18px "Cairo", "IBM Plex Sans Arabic", sans-serif';
    let xRight = PAGE_W - MARGIN;
    colHeaders.forEach((header, idx) => {
      const w = colWidths[idx];
      targetCtx.textAlign = idx === 0 ? 'right' : 'center';
      const textX = idx === 0 ? xRight - 16 : xRight - w / 2;
      targetCtx.fillText(header, textX, y + 25);
      xRight -= w;
    });
  };

  drawTableHeader(ctx, cursorY);
  cursorY += 54;

  const ensureSpace = (needed: number, redrawHeader = false) => {
    if (cursorY + needed > PAGE_H - 110) {
      drawFooter(ctx, pages.length);
      const next = createPageCanvas();
      canvas = next.canvas;
      ctx = next.ctx;
      pages.push(canvas);
      cursorY = 72;
      if (redrawHeader) {
        drawTableHeader(ctx, cursorY);
        cursorY += 54;
      }
    }
  };

  if (summary.rows.length === 0) {
    ctx.fillStyle = '#64748b';
    ctx.font = '400 20px "IBM Plex Sans Arabic", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('لا توجد بيانات طلاب ضمن الفئة المحددة لهذا الشهر.', PAGE_W / 2, cursorY + 34);
    cursorY += 72;
  } else {
    summary.rows.forEach((row, index) => {
      ensureSpace(52, true);
      if (index % 2 === 1) {
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(MARGIN, cursorY, PAGE_W - MARGIN * 2, 48);
      }
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(MARGIN, cursorY + 48);
      ctx.lineTo(PAGE_W - MARGIN, cursorY + 48);
      ctx.stroke();

      const cells = [
        row.fullName,
        row.studentCode,
        `${row.grade} (${row.section})`,
        `${row.present}`,
        `${row.absent}`,
        `${row.late}`,
        `${row.excused}`,
        `${row.attendanceRate}%`,
      ];

      let xRight = PAGE_W - MARGIN;
      cells.forEach((val, idx) => {
        const w = colWidths[idx];
        ctx.fillStyle =
          idx === 4 && row.absent > 0
            ? '#b91c1c'
            : idx === 7
              ? '#0f766e'
              : '#1e293b';
        ctx.font =
          idx >= 3 || idx === 1
            ? '600 18px "IBM Plex Mono", "IBM Plex Sans Arabic", monospace'
            : '500 18px "IBM Plex Sans Arabic", "Cairo", sans-serif';
        ctx.textAlign = idx === 0 ? 'right' : 'center';
        const textX = idx === 0 ? xRight - 16 : xRight - w / 2;
        ctx.fillText(val, textX, cursorY + 25);
        xRight -= w;
      });

      cursorY += 48;
    });
  }

  // Section 2: Detailed Absence & Lateness Incidents Log
  cursorY += 40;
  ensureSpace(120, false);
  ctx.fillStyle = '#0f172a';
  ctx.font = '700 24px "Cairo", "IBM Plex Sans Arabic", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('2. السجل التفصيلي لحالات الغياب والتأخر والاستئذان', PAGE_W - MARGIN, cursorY);
  cursorY += 32;

  if (summary.incidentLogs.length === 0) {
    drawRoundedRect(ctx, MARGIN, cursorY, PAGE_W - MARGIN * 2, 64, 10, '#f0fdf4', '#bbf7d0');
    ctx.fillStyle = '#15803d';
    ctx.font = '600 19px "IBM Plex Sans Arabic", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('لا توجد حالات غياب أو تأخر مسجلة خلال هذا الشهر.', PAGE_W / 2, cursorY + 32);
    cursorY += 80;
  } else {
    const statusMap: Record<string, string> = {
      absent: 'غائب',
      late: 'متأخر',
      excused: 'بعذر',
      present: 'حاضر',
    };

    summary.incidentLogs.forEach((log) => {
      ensureSpace(66, false);
      drawRoundedRect(ctx, MARGIN, cursorY, PAGE_W - MARGIN * 2, 56, 8, '#ffffff', '#e2e8f0');

      ctx.fillStyle = log.status === 'absent' ? '#b91c1c' : '#b45309';
      ctx.font = '700 18px "IBM Plex Sans Arabic", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(statusMap[log.status] || log.status, PAGE_W - MARGIN - 20, cursorY + 28);

      ctx.fillStyle = '#0f172a';
      ctx.font = '600 18px "IBM Plex Sans Arabic", sans-serif';
      ctx.fillText(`${log.studentName} (${log.grade})`, PAGE_W - MARGIN - 110, cursorY + 28);

      ctx.fillStyle = '#475569';
      ctx.font = '400 16px "IBM Plex Sans Arabic", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(
        `${log.date} · ${log.checkInTime || '--:--'} · ${log.parentNotified ? 'تم إشعار ولي الأمر' : 'بدون إشعار'}`,
        MARGIN + 20,
        cursorY + 28,
      );

      cursorY += 66;
    });
  }

  drawFooter(ctx, pages.length);

  // Assemble multi-page A4 PDF
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  pages.forEach((pageCanvas, idx) => {
    if (idx > 0) {
      pdf.addPage();
    }
    const imgData = pageCanvas.toDataURL('image/png', 0.96);
    pdf.addImage(imgData, 'PNG', 0, 0, 210, 297, undefined, 'FAST');
  });

  const fileName = `madarik-attendance-${summary.monthKey}.pdf`;
  pdf.save(fileName);
  return fileName;
}

export interface AnnualMonthlyAttendanceBreakdown {
  monthKey: string;
  monthLabel: string;
  present: number;
  absent: number;
  late: number;
  excused: number;
  total: number;
  rate: number;
}

export interface AnnualStudentReportSummary {
  academicYear: string;
  academicYearLabel: string;
  student: Student;
  studentGrades: GradeRecord[];
  cumulativeGpa: number;
  cumulativeRating: string;
  totalSubjects: number;
  highestScore: number | null;
  lowestScore: number | null;
  totalAttendanceLogs: number;
  presentCount: number;
  absentCount: number;
  lateCount: number;
  excusedCount: number;
  annualAttendanceRate: number;
  monthlyBreakdown: AnnualMonthlyAttendanceBreakdown[];
  attendanceLogs: AttendanceRecord[];
}

export function getAcademicRating(score: number): string {
  if (score >= 90) return 'ممتاز';
  if (score >= 80) return 'جيد جداً';
  if (score >= 70) return 'جيد';
  if (score >= 60) return 'مقبول';
  return 'يحتاج متابعة';
}

const STATUS_ARABIC: Record<string, string> = {
  present: 'حاضر',
  absent: 'غائب',
  late: 'متأخر',
  excused: 'مستأذن بعذر',
};

export function buildAnnualStudentSummary(
  academicYear: string,
  student: Student,
  grades: GradeRecord[],
  attendance: AttendanceRecord[],
): AnnualStudentReportSummary {
  const currentYear = String(new Date().getFullYear());

  const studentGrades = grades.filter((g) => {
    if (g.studentId !== student.id) return false;
    const termYearMatch = g.term?.match(/\b(20\d{2})\b/)?.[1];
    if (termYearMatch) {
      return termYearMatch === academicYear;
    }
    if (g.createdAt?.toDate) {
      return String(g.createdAt.toDate().getFullYear()) === academicYear;
    }
    return academicYear === currentYear;
  });

  const totalSubjects = studentGrades.length;
  const cumulativeGpa =
    totalSubjects > 0
      ? Number(
          (studentGrades.reduce((sum, g) => sum + g.totalScore, 0) / totalSubjects).toFixed(1),
        )
      : academicYear === currentYear
        ? student.gpa
        : 0;

  const scores = studentGrades.map((g) => g.totalScore);
  const highestScore = scores.length > 0 ? Math.max(...scores) : null;
  const lowestScore = scores.length > 0 ? Math.min(...scores) : null;

  const attendanceLogs = attendance
    .filter((a) => a.studentId === student.id && a.date.startsWith(`${academicYear}-`))
    .sort((a, b) => b.date.localeCompare(a.date));

  const presentCount = attendanceLogs.filter((a) => a.status === 'present').length;
  const absentCount = attendanceLogs.filter((a) => a.status === 'absent').length;
  const lateCount = attendanceLogs.filter((a) => a.status === 'late').length;
  const excusedCount = attendanceLogs.filter((a) => a.status === 'excused').length;
  const totalAttendanceLogs = attendanceLogs.length;

  const annualAttendanceRate =
    totalAttendanceLogs > 0
      ? Math.round(((presentCount + lateCount + excusedCount) / totalAttendanceLogs) * 100)
      : academicYear === currentYear
        ? student.attendanceRate
        : 0;

  const monthMap = new Map<string, AttendanceRecord[]>();
  for (const log of attendanceLogs) {
    const monthKey = log.date.slice(0, 7);
    const list = monthMap.get(monthKey) || [];
    list.push(log);
    monthMap.set(monthKey, list);
  }

  const monthlyBreakdown: AnnualMonthlyAttendanceBreakdown[] = Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monthKey, recs]) => {
      const present = recs.filter((r) => r.status === 'present').length;
      const absent = recs.filter((r) => r.status === 'absent').length;
      const late = recs.filter((r) => r.status === 'late').length;
      const excused = recs.filter((r) => r.status === 'excused').length;
      const total = recs.length;
      const rate = total > 0 ? Math.round(((present + late + excused) / total) * 100) : 0;
      return {
        monthKey,
        monthLabel: formatArabicMonth(monthKey),
        present,
        absent,
        late,
        excused,
        total,
        rate,
      };
    });

  return {
    academicYear,
    academicYearLabel: `العام الدراسي ${academicYear}`,
    student,
    studentGrades,
    cumulativeGpa,
    cumulativeRating: getAcademicRating(cumulativeGpa),
    totalSubjects,
    highestScore,
    lowestScore,
    totalAttendanceLogs,
    presentCount,
    absentCount,
    lateCount,
    excusedCount,
    annualAttendanceRate,
    monthlyBreakdown,
    attendanceLogs,
  };
}

function renderAnnualStudentPages(
  summary: AnnualStudentReportSummary,
  generatedBy: string,
): HTMLCanvasElement[] {
  const pages: HTMLCanvasElement[] = [];
  let { canvas, ctx } = createPageCanvas();
  pages.push(canvas);

  const drawFooter = (c: CanvasRenderingContext2D, pageNum: number) => {
    c.strokeStyle = '#e2e8f0';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(MARGIN, PAGE_H - 76);
    c.lineTo(PAGE_W - MARGIN, PAGE_H - 76);
    c.stroke();

    c.fillStyle = '#64748b';
    c.font = '400 17px "IBM Plex Sans Arabic", "Cairo", sans-serif';
    c.textAlign = 'right';
    c.fillText(
      `منصة مدارك المدرسية · التقرير السنوي لأداء الطالب: ${summary.student.fullName} (${summary.academicYear})`,
      PAGE_W - MARGIN,
      PAGE_H - 46,
    );
    c.textAlign = 'left';
    c.fillText(`صفحة ${pageNum}`, MARGIN, PAGE_H - 46);
  };

  const ensureSpace = (needed: number, onNewPage?: () => void) => {
    if (cursorY + needed > PAGE_H - 110) {
      drawFooter(ctx, pages.length);
      const next = createPageCanvas();
      canvas = next.canvas;
      ctx = next.ctx;
      pages.push(canvas);
      cursorY = 72;
      if (onNewPage) onNewPage();
    }
  };

  // Top Header Band
  drawRoundedRect(ctx, MARGIN, 56, PAGE_W - MARGIN * 2, 152, 14, '#0f766e');
  ctx.fillStyle = '#ccfbf1';
  ctx.font = '600 19px "IBM Plex Sans Arabic", "Cairo", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('منصة مدارك المدرسية · الشؤون الأكاديمية وسجل الانضباط السنوي', PAGE_W - MARGIN - 28, 96);

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 32px "Cairo", "IBM Plex Sans Arabic", sans-serif';
  ctx.fillText(
    `تقرير أداء الطالب السنوي — ${summary.academicYearLabel}`,
    PAGE_W - MARGIN - 28,
    144,
  );

  ctx.fillStyle = '#e2e8f0';
  ctx.font = '400 17px "IBM Plex Sans Arabic", "Cairo", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`الرقم الأكاديمي: ${summary.student.studentCode}`, MARGIN + 28, 96);
  ctx.fillText(`إصدار: ${generatedBy}`, MARGIN + 28, 134);
  ctx.fillText(`تاريخ الإصدار: ${new Date().toISOString().slice(0, 10)}`, MARGIN + 28, 172);

  // Student Profile Identity Bar
  drawRoundedRect(ctx, MARGIN, 228, PAGE_W - MARGIN * 2, 86, 12, '#f8fafc', '#cbd5e1');
  ctx.fillStyle = '#0f172a';
  ctx.font = '700 24px "Cairo", "IBM Plex Sans Arabic", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(summary.student.fullName, PAGE_W - MARGIN - 24, 258);

  ctx.fillStyle = '#475569';
  ctx.font = '500 18px "IBM Plex Sans Arabic", "Cairo", sans-serif';
  ctx.fillText(
    `${summary.student.grade} — الشعبة (${summary.student.section})   ·   ولي الأمر: ${summary.student.parentName} (${summary.student.parentPhone})`,
    PAGE_W - MARGIN - 24,
    292,
  );

  // 4-Card KPI Strip
  const kpiY = 336;
  const kpiGap = 16;
  const kpiW = (PAGE_W - MARGIN * 2 - kpiGap * 3) / 4;
  const kpis = [
    {
      label: `المعدل التراكمي (${summary.cumulativeRating})`,
      value: `${summary.cumulativeGpa}%`,
      color: '#0f766e',
    },
    {
      label: 'نسبة الحضور السنوية',
      value: `${summary.annualAttendanceRate}%`,
      color: summary.annualAttendanceRate >= 90 ? '#15803d' : '#b45309',
    },
    {
      label: 'المواد المقيمة',
      value: `${summary.totalSubjects}`,
      color: '#0f172a',
    },
    {
      label: 'أيام الغياب / التأخر',
      value: `${summary.absentCount} / ${summary.lateCount}`,
      color: summary.absentCount > 0 ? '#b91c1c' : '#334155',
    },
  ];

  kpis.forEach((k, idx) => {
    const x = PAGE_W - MARGIN - kpiW - idx * (kpiW + kpiGap);
    drawRoundedRect(ctx, x, kpiY, kpiW, 102, 12, '#ffffff', '#e2e8f0');
    ctx.fillStyle = '#64748b';
    ctx.font = '500 17px "IBM Plex Sans Arabic", "Cairo", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(k.label, x + kpiW - 18, kpiY + 32);

    ctx.fillStyle = k.color;
    ctx.font = '700 30px "IBM Plex Mono", "Cairo", monospace';
    ctx.fillText(k.value, x + kpiW - 18, kpiY + 72);
  });

  // Section 1: Cumulative Grades Table
  let cursorY = 472;
  ctx.fillStyle = '#0f172a';
  ctx.font = '700 23px "Cairo", "IBM Plex Sans Arabic", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('1. سجل الدرجات التراكمية والتحصيل الأكاديمي', PAGE_W - MARGIN, cursorY);
  cursorY += 32;

  const gradeColWidths = [256, 190, 110, 110, 110, 130, 190]; // sum = 1096
  const gradeColHeaders = [
    'المادة الدراسية',
    'الفصل الدراسي',
    'نصفي (30)',
    'أعمال (30)',
    'نهائي (40)',
    'المجموع (100)',
    'التقدير',
  ];

  const drawGradesHeader = () => {
    drawRoundedRect(ctx, MARGIN, cursorY, PAGE_W - MARGIN * 2, 46, 8, '#f1f5f9', '#cbd5e1');
    ctx.fillStyle = '#334155';
    ctx.font = '700 17px "Cairo", "IBM Plex Sans Arabic", sans-serif';
    let xRight = PAGE_W - MARGIN;
    gradeColHeaders.forEach((header, idx) => {
      const w = gradeColWidths[idx];
      ctx.textAlign = idx === 0 ? 'right' : 'center';
      const textX = idx === 0 ? xRight - 14 : xRight - w / 2;
      ctx.fillText(header, textX, cursorY + 24);
      xRight -= w;
    });
    cursorY += 52;
  };

  drawGradesHeader();

  if (summary.studentGrades.length === 0) {
    drawRoundedRect(ctx, MARGIN, cursorY, PAGE_W - MARGIN * 2, 60, 10, '#f8fafc', '#e2e8f0');
    ctx.fillStyle = '#64748b';
    ctx.font = '500 18px "IBM Plex Sans Arabic", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      `لا توجد درجات تفصيلية مرصودة للطالب في ${summary.academicYearLabel}.`,
      PAGE_W / 2,
      cursorY + 30,
    );
    cursorY += 76;
  } else {
    summary.studentGrades.forEach((g, index) => {
      ensureSpace(54, drawGradesHeader);
      if (index % 2 === 1) {
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(MARGIN, cursorY, PAGE_W - MARGIN * 2, 46);
      }
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(MARGIN, cursorY + 46);
      ctx.lineTo(PAGE_W - MARGIN, cursorY + 46);
      ctx.stroke();

      const rating = getAcademicRating(g.totalScore);
      const cells = [
        g.subject,
        g.term,
        `${g.midtermScore}`,
        `${g.courseworkScore}`,
        `${g.finalScore}`,
        `${g.totalScore}`,
        rating,
      ];

      let xRight = PAGE_W - MARGIN;
      cells.forEach((val, idx) => {
        const w = gradeColWidths[idx];
        ctx.fillStyle =
          idx === 5
            ? '#0f766e'
            : idx === 6
              ? g.totalScore >= 85
                ? '#15803d'
                : g.totalScore >= 70
                  ? '#b45309'
                  : '#b91c1c'
              : '#1e293b';
        ctx.font =
          idx >= 2 && idx <= 5
            ? '600 18px "IBM Plex Mono", "IBM Plex Sans Arabic", monospace'
            : '600 17px "IBM Plex Sans Arabic", "Cairo", sans-serif';
        ctx.textAlign = idx === 0 ? 'right' : 'center';
        const textX = idx === 0 ? xRight - 14 : xRight - w / 2;
        ctx.fillText(val, textX, cursorY + 24);
        xRight -= w;
      });
      cursorY += 46;
    });

    // Cumulative Summary Bar
    ensureSpace(64);
    cursorY += 8;
    drawRoundedRect(ctx, MARGIN, cursorY, PAGE_W - MARGIN * 2, 48, 8, '#f0fdfa', '#99f6e4');
    ctx.fillStyle = '#0f766e';
    ctx.font = '700 18px "IBM Plex Sans Arabic", "Cairo", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(
      `الملخص التراكمي: المعدل ${summary.cumulativeGpa}% (${summary.cumulativeRating})`,
      PAGE_W - MARGIN - 20,
      cursorY + 25,
    );
    ctx.textAlign = 'left';
    ctx.fillText(
      `أعلى درجة: ${summary.highestScore ?? '—'}   ·   أدنى درجة: ${summary.lowestScore ?? '—'}`,
      MARGIN + 20,
      cursorY + 25,
    );
    cursorY += 64;

    const gradesWithNotes = summary.studentGrades.filter((g) => g.teacherNote?.trim());
    if (gradesWithNotes.length > 0) {
      ensureSpace(90);
      ctx.fillStyle = '#334155';
      ctx.font = '700 19px "Cairo", "IBM Plex Sans Arabic", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('ملاحظات المعلمين الأكاديمية:', PAGE_W - MARGIN, cursorY + 12);
      cursorY += 32;

      gradesWithNotes.forEach((g) => {
        ensureSpace(48);
        drawRoundedRect(ctx, MARGIN, cursorY, PAGE_W - MARGIN * 2, 40, 6, '#ffffff', '#e2e8f0');
        ctx.fillStyle = '#0f766e';
        ctx.font = '700 16px "IBM Plex Sans Arabic", sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(`${g.subject}:`, PAGE_W - MARGIN - 16, cursorY + 21);

        ctx.fillStyle = '#475569';
        ctx.font = '400 16px "IBM Plex Sans Arabic", sans-serif';
        ctx.fillText(
          (g.teacherNote || '').slice(0, 95),
          PAGE_W - MARGIN - 180,
          cursorY + 21,
        );
        cursorY += 48;
      });
    }
  }

  // Section 2: Annual Monthly Attendance Breakdown
  cursorY += 24;
  ensureSpace(130);
  ctx.fillStyle = '#0f172a';
  ctx.font = '700 23px "Cairo", "IBM Plex Sans Arabic", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('2. ملخص الحضور والانضباط الشهري خلال العام', PAGE_W - MARGIN, cursorY);
  cursorY += 30;

  if (summary.monthlyBreakdown.length > 0) {
    const monthColWidths = [256, 130, 130, 130, 130, 140, 180]; // sum = 1096
    const monthHeaders = ['الشهر', 'حاضر', 'غائب', 'متأخر', 'بعذر', 'إجمالي الأيام', 'نسبة الانتظام %'];

    const drawMonthHeader = () => {
      drawRoundedRect(ctx, MARGIN, cursorY, PAGE_W - MARGIN * 2, 44, 8, '#f1f5f9', '#cbd5e1');
      ctx.fillStyle = '#334155';
      ctx.font = '700 17px "Cairo", "IBM Plex Sans Arabic", sans-serif';
      let xRight = PAGE_W - MARGIN;
      monthHeaders.forEach((header, idx) => {
        const w = monthColWidths[idx];
        ctx.textAlign = idx === 0 ? 'right' : 'center';
        const textX = idx === 0 ? xRight - 14 : xRight - w / 2;
        ctx.fillText(header, textX, cursorY + 23);
        xRight -= w;
      });
      cursorY += 50;
    };

    drawMonthHeader();

    summary.monthlyBreakdown.forEach((m, index) => {
      ensureSpace(48, drawMonthHeader);
      if (index % 2 === 1) {
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(MARGIN, cursorY, PAGE_W - MARGIN * 2, 42);
      }
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(MARGIN, cursorY + 42);
      ctx.lineTo(PAGE_W - MARGIN, cursorY + 42);
      ctx.stroke();

      const cells = [
        m.monthLabel,
        `${m.present}`,
        `${m.absent}`,
        `${m.late}`,
        `${m.excused}`,
        `${m.total}`,
        `${m.rate}%`,
      ];

      let xRight = PAGE_W - MARGIN;
      cells.forEach((val, idx) => {
        const w = monthColWidths[idx];
        ctx.fillStyle = idx === 2 && m.absent > 0 ? '#b91c1c' : idx === 6 ? '#0f766e' : '#1e293b';
        ctx.font =
          idx === 0
            ? '600 17px "IBM Plex Sans Arabic", "Cairo", sans-serif'
            : '600 17px "IBM Plex Mono", monospace';
        ctx.textAlign = idx === 0 ? 'right' : 'center';
        const textX = idx === 0 ? xRight - 14 : xRight - w / 2;
        ctx.fillText(val, textX, cursorY + 22);
        xRight -= w;
      });
      cursorY += 42;
    });
  } else {
    drawRoundedRect(ctx, MARGIN, cursorY, PAGE_W - MARGIN * 2, 56, 10, '#f8fafc', '#e2e8f0');
    ctx.fillStyle = '#475569';
    ctx.font = '500 17px "IBM Plex Sans Arabic", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      `معدل الانتظام المعتمد للطالب: ${summary.annualAttendanceRate}% (لا توجد سجلات يومية مفصلة لهذا العام)`,
      PAGE_W / 2,
      cursorY + 28,
    );
    cursorY += 68;
  }

  // Section 3: Detailed Attendance Logs Table
  cursorY += 28;
  ensureSpace(130);
  ctx.fillStyle = '#0f172a';
  ctx.font = '700 23px "Cairo", "IBM Plex Sans Arabic", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('3. سجل الحضور والغياب اليومي للطالب', PAGE_W - MARGIN, cursorY);
  cursorY += 30;

  if (summary.attendanceLogs.length === 0) {
    drawRoundedRect(ctx, MARGIN, cursorY, PAGE_W - MARGIN * 2, 56, 10, '#f8fafc', '#e2e8f0');
    ctx.fillStyle = '#64748b';
    ctx.font = '500 17px "IBM Plex Sans Arabic", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      `لا توجد سجلات حضور يومية مسجلة في عام ${summary.academicYear}.`,
      PAGE_W / 2,
      cursorY + 28,
    );
    cursorY += 68;
  } else {
    const logColWidths = [160, 150, 130, 180, 476]; // sum = 1096
    const logHeaders = ['التاريخ', 'الحالة', 'وقت التسجيل', 'إشعار ولي الأمر', 'ملاحظات المتابعة'];

    const drawLogsHeader = () => {
      drawRoundedRect(ctx, MARGIN, cursorY, PAGE_W - MARGIN * 2, 44, 8, '#f1f5f9', '#cbd5e1');
      ctx.fillStyle = '#334155';
      ctx.font = '700 17px "Cairo", "IBM Plex Sans Arabic", sans-serif';
      let xRight = PAGE_W - MARGIN;
      logHeaders.forEach((header, idx) => {
        const w = logColWidths[idx];
        ctx.textAlign = idx === 4 ? 'right' : 'center';
        const textX = idx === 4 ? xRight - 14 : xRight - w / 2;
        ctx.fillText(header, textX, cursorY + 23);
        xRight -= w;
      });
      cursorY += 50;
    };

    drawLogsHeader();

    summary.attendanceLogs.forEach((log, index) => {
      ensureSpace(48, drawLogsHeader);
      if (index % 2 === 1) {
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(MARGIN, cursorY, PAGE_W - MARGIN * 2, 42);
      }
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(MARGIN, cursorY + 42);
      ctx.lineTo(PAGE_W - MARGIN, cursorY + 42);
      ctx.stroke();

      const cells = [
        log.date,
        STATUS_ARABIC[log.status] || log.status,
        log.checkInTime || '--:--',
        log.parentNotified ? 'تم الإشعار' : 'لم يرسل',
        (log.notes || '—').slice(0, 56),
      ];

      let xRight = PAGE_W - MARGIN;
      cells.forEach((val, idx) => {
        const w = logColWidths[idx];
        ctx.fillStyle =
          idx === 1
            ? log.status === 'present'
              ? '#15803d'
              : log.status === 'absent'
                ? '#b91c1c'
                : log.status === 'late'
                  ? '#b45309'
                  : '#334155'
            : '#1e293b';
        ctx.font =
          idx === 0 || idx === 2
            ? '600 16px "IBM Plex Mono", monospace'
            : idx === 1
              ? '700 16px "IBM Plex Sans Arabic", sans-serif'
              : '400 15px "IBM Plex Sans Arabic", sans-serif';
        ctx.textAlign = idx === 4 ? 'right' : 'center';
        const textX = idx === 4 ? xRight - 14 : xRight - w / 2;
        ctx.fillText(val, textX, cursorY + 22);
        xRight -= w;
      });
      cursorY += 42;
    });
  }

  drawFooter(ctx, pages.length);
  return pages;
}

export async function generateAnnualStudentPdf(
  summary: AnnualStudentReportSummary,
  generatedBy: string,
): Promise<string> {
  if (document.fonts && document.fonts.ready) {
    await document.fonts.ready;
  }

  const pages = renderAnnualStudentPages(summary, generatedBy);
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  pages.forEach((pageCanvas, idx) => {
    if (idx > 0) pdf.addPage();
    const imgData = pageCanvas.toDataURL('image/png', 0.96);
    pdf.addImage(imgData, 'PNG', 0, 0, 210, 297, undefined, 'FAST');
  });

  const fileName = `madarik-annual-${summary.student.studentCode}-${summary.academicYear}.pdf`;
  pdf.save(fileName);
  return fileName;
}

export async function generateAllStudentsAnnualPdf(
  summaries: AnnualStudentReportSummary[],
  academicYear: string,
  generatedBy: string,
): Promise<string> {
  if (document.fonts && document.fonts.ready) {
    await document.fonts.ready;
  }

  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  let addedFirstPage = false;
  for (const summary of summaries) {
    const pages = renderAnnualStudentPages(summary, generatedBy);
    for (const pageCanvas of pages) {
      if (addedFirstPage) {
        pdf.addPage();
      }
      addedFirstPage = true;
      const imgData = pageCanvas.toDataURL('image/png', 0.96);
      pdf.addImage(imgData, 'PNG', 0, 0, 210, 297, undefined, 'FAST');
    }
  }

  const fileName = `madarik-annual-all-students-${academicYear}.pdf`;
  pdf.save(fileName);
  return fileName;
}

export interface DashboardSnapshotInput {
  generatedBy: string;
  activeAttendanceDate: string;
  currentMonthLabel: string;
  attendancePct: number;
  presentCount: number;
  totalStudentsForAttendance: number;
  currentPresentCount: number;
  currentLateCount: number;
  emergencyAbsentLogs: AttendanceRecord[];
  avgGpa: string;
  gradesCount: number;
  subjectAverages: Array<{ subject: string; avg: number }>;
  collectionPct: number;
  totalBilled: number;
  totalPaid: number;
  monthlyCollectedAmount: number;
  monthlyPaidCount: number;
  totalOutstanding: number;
  invoices: Invoice[];
  studentsCount: number;
  teachers: TeacherEvaluation[];
  announcements: Announcement[];
  activities: Activity[];
  homeworkCount: number;
  unreadAlertsCount: number;
}

export async function generateDashboardSnapshotPdf(
  input: DashboardSnapshotInput,
): Promise<string> {
  if (document.fonts && document.fonts.ready) {
    await document.fonts.ready;
  }

  const pages: HTMLCanvasElement[] = [];
  let { canvas, ctx } = createPageCanvas();
  pages.push(canvas);

  const nowIso = new Date().toISOString().slice(0, 10);
  const nowTime = new Date().toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const drawFooter = (c: CanvasRenderingContext2D, pageNum: number) => {
    c.strokeStyle = '#e2e8f0';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(MARGIN, PAGE_H - 76);
    c.lineTo(PAGE_W - MARGIN, PAGE_H - 76);
    c.stroke();

    c.fillStyle = '#64748b';
    c.font = '400 17px "IBM Plex Sans Arabic", "Cairo", sans-serif';
    c.textAlign = 'right';
    c.fillText(
      `منصة مدارك المدرسية · التقرير التنفيذي الشامل للوحة التحكم (${nowIso} — ${nowTime})`,
      PAGE_W - MARGIN,
      PAGE_H - 46,
    );
    c.textAlign = 'left';
    c.fillText(`صفحة ${pageNum}`, MARGIN, PAGE_H - 46);
  };

  let cursorY = 56;

  const ensureSpace = (needed: number) => {
    if (cursorY + needed > PAGE_H - 110) {
      drawFooter(ctx, pages.length);
      const next = createPageCanvas();
      canvas = next.canvas;
      ctx = next.ctx;
      pages.push(canvas);
      cursorY = 72;
    }
  };

  // Top Header Band
  drawRoundedRect(ctx, MARGIN, cursorY, PAGE_W - MARGIN * 2, 152, 14, '#0f766e');
  ctx.fillStyle = '#ccfbf1';
  ctx.font = '600 19px "IBM Plex Sans Arabic", "Cairo", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(
    'منصة مدارك المدرسية · نسخة المدراء — التقرير الشامل للوحة التحكم (Dashboard Snapshot)',
    PAGE_W - MARGIN - 28,
    cursorY + 38,
  );

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 32px "Cairo", "IBM Plex Sans Arabic", sans-serif';
  ctx.fillText(
    `الملخص التنفيذي الشامل — ${input.currentMonthLabel}`,
    PAGE_W - MARGIN - 28,
    cursorY + 86,
  );

  ctx.fillStyle = '#e2e8f0';
  ctx.font = '400 17px "IBM Plex Sans Arabic", "Cairo", sans-serif';
  ctx.fillText(
    `أُصدر بواسطة: ${input.generatedBy}  ·  تاريخ الرصد المرجعي: ${input.activeAttendanceDate}  ·  تاريخ الإصدار: ${nowIso} (${nowTime})`,
    PAGE_W - MARGIN - 28,
    cursorY + 124,
  );

  cursorY += 178;

  // KPI Strip (4 Executive Cards)
  const kpiGap = 16;
  const kpiW = (PAGE_W - MARGIN * 2 - kpiGap * 3) / 4;
  const kpis = [
    {
      label: 'نسبة الحضور الإجمالية',
      value: `${input.attendancePct}%`,
      sub: `${input.presentCount} حاضر من ${input.totalStudentsForAttendance}`,
      color: '#0f766e',
    },
    {
      label: 'تحصيل الرسوم المدرسية',
      value: `${input.collectionPct}%`,
      sub: `${input.totalPaid.toLocaleString('en-US')} / ${input.totalBilled.toLocaleString('en-US')} د.ع`,
      color: '#0f172a',
    },
    {
      label: 'حالات الغياب الطارئة',
      value: `${input.emergencyAbsentLogs.length}`,
      sub: `متأخر: ${input.currentLateCount} · تنبيهات غير مقروءة: ${input.unreadAlertsCount}`,
      color: input.emergencyAbsentLogs.length > 0 ? '#b91c1c' : '#15803d',
    },
    {
      label: 'متوسط التحصيل الأكاديمي',
      value: `${input.avgGpa}%`,
      sub: `${input.studentsCount} طالب · ${input.gradesCount} تقييم`,
      color: '#0f766e',
    },
  ];

  kpis.forEach((k, idx) => {
    const x = PAGE_W - MARGIN - kpiW - idx * (kpiW + kpiGap);
    drawRoundedRect(ctx, x, cursorY, kpiW, 118, 12, '#f8fafc', '#e2e8f0');
    ctx.fillStyle = '#64748b';
    ctx.font = '500 16px "IBM Plex Sans Arabic", "Cairo", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(k.label, x + kpiW - 18, cursorY + 28);

    ctx.fillStyle = k.color;
    ctx.font = '700 32px "IBM Plex Mono", "Cairo", monospace';
    ctx.fillText(k.value, x + kpiW - 18, cursorY + 66);

    ctx.fillStyle = '#475569';
    ctx.font = '400 14px "IBM Plex Sans Arabic", "Cairo", sans-serif';
    ctx.fillText(k.sub.slice(0, 34), x + kpiW - 18, cursorY + 98);
  });

  cursorY += 148;

  // Section 1: Attendance & Emergency Absences
  ensureSpace(180);
  ctx.fillStyle = '#0f172a';
  ctx.font = '700 22px "Cairo", "IBM Plex Sans Arabic", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('1. موقف الحضور اليومي وحالات الغياب الطارئة', PAGE_W - MARGIN, cursorY);
  cursorY += 28;

  drawRoundedRect(ctx, MARGIN, cursorY, PAGE_W - MARGIN * 2, 62, 10, '#ffffff', '#cbd5e1');
  ctx.fillStyle = '#1e293b';
  ctx.font = '600 17px "IBM Plex Sans Arabic", "Cairo", sans-serif';
  ctx.fillText(
    `تاريخ الرصد: ${input.activeAttendanceDate}   ·   الحضور الفعلي: ${input.currentPresentCount} / ${input.studentsCount} طالب   ·   المتأخرون: ${input.currentLateCount}   ·   الغياب الطارئ: ${input.emergencyAbsentLogs.length}`,
    PAGE_W - MARGIN - 20,
    cursorY + 31,
  );
  cursorY += 78;

  if (input.emergencyAbsentLogs.length === 0) {
    drawRoundedRect(ctx, MARGIN, cursorY, PAGE_W - MARGIN * 2, 54, 10, '#f0fdf4', '#bbf7d0');
    ctx.fillStyle = '#15803d';
    ctx.font = '600 18px "IBM Plex Sans Arabic", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('لا توجد حالات غياب طارئة مسجلة في تاريخ الرصد المرجعي.', PAGE_W / 2, cursorY + 27);
    cursorY += 74;
  } else {
    input.emergencyAbsentLogs.slice(0, 12).forEach((rec) => {
      ensureSpace(62);
      drawRoundedRect(ctx, MARGIN, cursorY, PAGE_W - MARGIN * 2, 52, 8, '#fef2f2', '#fecaca');
      ctx.fillStyle = '#b91c1c';
      ctx.font = '700 17px "IBM Plex Sans Arabic", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(
        `غائب: ${rec.studentName} (${rec.grade})`,
        PAGE_W - MARGIN - 18,
        cursorY + 26,
      );
      ctx.fillStyle = '#475569';
      ctx.font = '500 15px "IBM Plex Sans Arabic", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(
        `${rec.parentNotified ? 'تم إشعار ولي الأمر لحظياً' : 'بانتظار الإشعار'} · ${rec.date}`,
        MARGIN + 18,
        cursorY + 26,
      );
      cursorY += 60;
    });
    cursorY += 12;
  }

  // Section 2: Financial & Fees Summary
  ensureSpace(220);
  ctx.fillStyle = '#0f172a';
  ctx.font = '700 22px "Cairo", "IBM Plex Sans Arabic", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('2. ملخص الرسوم والفواتير المدرسية', PAGE_W - MARGIN, cursorY);
  cursorY += 28;

  const finGap = 16;
  const finW = (PAGE_W - MARGIN * 2 - finGap * 2) / 3;
  const finCards = [
    {
      label: `المحصل في ${input.currentMonthLabel}`,
      value: `${input.monthlyCollectedAmount.toLocaleString('en-US')} د.ع`,
      sub: `${input.monthlyPaidCount} فاتورة مسددة`,
      bg: '#f0fdfa',
      border: '#99f6e4',
      color: '#0f766e',
    },
    {
      label: 'إجمالي الرسوم المفوترة',
      value: `${input.totalBilled.toLocaleString('en-US')} د.ع`,
      sub: `المسدّد إجمالاً: ${input.totalPaid.toLocaleString('en-US')} د.ع (${input.collectionPct}%)`,
      bg: '#f8fafc',
      border: '#cbd5e1',
      color: '#0f172a',
    },
    {
      label: 'المستحقات المعلقة / المتأخرة',
      value: `${input.totalOutstanding.toLocaleString('en-US')} د.ع`,
      sub: `${input.invoices.filter((i) => i.status !== 'paid').length} فاتورة غير مسددة`,
      bg: input.totalOutstanding > 0 ? '#fffbeb' : '#f0fdf4',
      border: input.totalOutstanding > 0 ? '#fde68a' : '#bbf7d0',
      color: input.totalOutstanding > 0 ? '#b45309' : '#15803d',
    },
  ];

  finCards.forEach((c, idx) => {
    const x = PAGE_W - MARGIN - finW - idx * (finW + finGap);
    drawRoundedRect(ctx, x, cursorY, finW, 102, 10, c.bg, c.border);
    ctx.fillStyle = '#475569';
    ctx.font = '500 16px "IBM Plex Sans Arabic", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(c.label, x + finW - 16, cursorY + 26);

    ctx.fillStyle = c.color;
    ctx.font = '700 24px "IBM Plex Mono", "Cairo", monospace';
    ctx.fillText(c.value, x + finW - 16, cursorY + 60);

    ctx.fillStyle = '#64748b';
    ctx.font = '400 14px "IBM Plex Sans Arabic", sans-serif';
    ctx.fillText(c.sub, x + finW - 16, cursorY + 86);
  });

  cursorY += 120;

  const unpaidInvoices = input.invoices.filter((i) => i.status !== 'paid').slice(0, 6);
  if (unpaidInvoices.length > 0) {
    unpaidInvoices.forEach((inv) => {
      ensureSpace(54);
      drawRoundedRect(ctx, MARGIN, cursorY, PAGE_W - MARGIN * 2, 46, 8, '#ffffff', '#e2e8f0');
      ctx.fillStyle = '#0f172a';
      ctx.font = '600 16px "IBM Plex Sans Arabic", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(
        `${inv.studentName} — ${inv.title} (${inv.invoiceNumber})`,
        PAGE_W - MARGIN - 16,
        cursorY + 23,
      );
      ctx.fillStyle = inv.status === 'overdue' ? '#b91c1c' : '#b45309';
      ctx.font = '700 15px "IBM Plex Mono", "IBM Plex Sans Arabic", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(
        `${inv.amount.toLocaleString('en-US')} د.ع · ${inv.status === 'overdue' ? 'متأخرة' : 'مستحقة'} (${inv.dueDate})`,
        MARGIN + 16,
        cursorY + 23,
      );
      cursorY += 54;
    });
  }

  // Section 3: Academic Performance, Teachers & Announcements
  cursorY += 18;
  ensureSpace(200);
  ctx.fillStyle = '#0f172a';
  ctx.font = '700 22px "Cairo", "IBM Plex Sans Arabic", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(
    '3. التحصيل الأكاديمي وكفاءة الكادر التعليمي والتعاميم النشطة',
    PAGE_W - MARGIN,
    cursorY,
  );
  cursorY += 28;

  drawRoundedRect(ctx, MARGIN, cursorY, PAGE_W - MARGIN * 2, 58, 10, '#f8fafc', '#cbd5e1');
  ctx.fillStyle = '#1e293b';
  ctx.font = '500 17px "IBM Plex Sans Arabic", sans-serif';
  const avgTeacherScore =
    input.teachers.length > 0
      ? Math.round(
          input.teachers.reduce((sum, t) => sum + t.evaluationScore, 0) / input.teachers.length,
        )
      : 0;
  ctx.fillText(
    `الطلاب: ${input.studentsCount}  ·  المعلمون: ${input.teachers.length} (متوسط التقييم: ${avgTeacherScore}%)  ·  الواجبات المنشورة: ${input.homeworkCount}  ·  الفعاليات: ${input.activities.length}`,
    PAGE_W - MARGIN - 20,
    cursorY + 29,
  );
  cursorY += 74;

  if (input.subjectAverages.length > 0) {
    ensureSpace(120);
    ctx.fillStyle = '#334155';
    ctx.font = '700 18px "Cairo", "IBM Plex Sans Arabic", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('متوسط الدرجات حسب المواد:', PAGE_W - MARGIN, cursorY);
    cursorY += 26;

    input.subjectAverages.slice(0, 8).forEach((sub) => {
      ensureSpace(46);
      drawRoundedRect(ctx, MARGIN, cursorY, PAGE_W - MARGIN * 2, 38, 6, '#ffffff', '#e2e8f0');
      ctx.fillStyle = '#0f172a';
      ctx.font = '600 16px "IBM Plex Sans Arabic", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(sub.subject, PAGE_W - MARGIN - 16, cursorY + 19);
      ctx.fillStyle = '#0f766e';
      ctx.font = '700 16px "IBM Plex Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`${sub.avg}%`, MARGIN + 16, cursorY + 19);
      cursorY += 44;
    });
  }

  if (input.announcements.length > 0) {
    cursorY += 12;
    ensureSpace(110);
    ctx.fillStyle = '#334155';
    ctx.font = '700 18px "Cairo", "IBM Plex Sans Arabic", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('أحدث التعاميم المدرسية:', PAGE_W - MARGIN, cursorY);
    cursorY += 26;

    input.announcements.slice(0, 4).forEach((ann) => {
      ensureSpace(54);
      drawRoundedRect(ctx, MARGIN, cursorY, PAGE_W - MARGIN * 2, 44, 6, '#ffffff', '#e2e8f0');
      ctx.fillStyle = '#0f172a';
      ctx.font = '600 16px "IBM Plex Sans Arabic", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(
        `${ann.title.slice(0, 62)} — ${ann.authorName} (${ann.targetAudience})`,
        PAGE_W - MARGIN - 16,
        cursorY + 22,
      );
      cursorY += 50;
    });
  }

  drawFooter(ctx, pages.length);

  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  pages.forEach((pageCanvas, idx) => {
    if (idx > 0) pdf.addPage();
    const imgData = pageCanvas.toDataURL('image/png', 0.96);
    pdf.addImage(imgData, 'PNG', 0, 0, 210, 297, undefined, 'FAST');
  });

  const fileName = `madarik-dashboard-snapshot-${nowIso}.pdf`;
  pdf.save(fileName);
  return fileName;
}
