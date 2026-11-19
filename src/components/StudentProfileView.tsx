import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Award,
  BookOpen,
  CalendarCheck,
  CreditCard,
  FileDown,
  MessageSquare,
  Phone,
  Printer,
  ShieldAlert,
  User,
} from 'lucide-react';
import { formatIQD } from '../lib/currency';
import {
  buildAnnualStudentSummary,
  generateAnnualStudentPdf,
  getAcademicRating,
} from '../lib/pdfReportGenerator';
import { PrintFooter, PrintHeader } from './PrintHeader';
import type {
  AttendanceRecord,
  AttendanceStatus,
  BehaviorDeduction,
  GradeRecord,
  Invoice,
  PeriodAttendanceRecord,
  Student,
} from '../types';

interface StudentProfileViewProps {
  student: Student;
  allStudents: Student[];
  attendance: AttendanceRecord[];
  periodAttendance: PeriodAttendanceRecord[];
  grades: GradeRecord[];
  behaviorDeductions: BehaviorDeduction[];
  invoices: Invoice[];
  userName: string;
  onBack: () => void;
  onSelectStudent: (studentId: string) => void;
  onNotify: (msg: string) => void;
  onMessageParent?: (student: Student) => void;
}

type ProfileSectionTab = 'all' | 'attendance' | 'grades' | 'behavior';

const STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'حاضر',
  absent: 'غائب',
  late: 'متأخر',
  excused: 'مستأذن بعذر',
};

const ROLE_LABELS_AR: Record<'teacher' | 'admin' | 'supervisor', string> = {
  teacher: 'المدرس',
  admin: 'المدير',
  supervisor: 'المراقب',
};

export const StudentProfileView: React.FC<StudentProfileViewProps> = ({
  student,
  allStudents,
  attendance,
  periodAttendance,
  grades,
  behaviorDeductions,
  invoices,
  userName,
  onBack,
  onSelectStudent,
  onNotify,
  onMessageParent,
}) => {
  const [sectionTab, setSectionTab] = useState<ProfileSectionTab>('all');
  const [generatingPdf, setGeneratingPdf] = useState(false);

  const studentAttendance = useMemo(
    () =>
      attendance
        .filter((a) => a.studentId === student.id)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [attendance, student.id],
  );

  const studentPeriodLogs = useMemo(
    () =>
      periodAttendance
        .filter((p) => p.studentId === student.id)
        .sort(
          (a, b) =>
            b.date.localeCompare(a.date) || b.periodNumber - a.periodNumber,
        ),
    [periodAttendance, student.id],
  );

  const studentGrades = useMemo(
    () => grades.filter((g) => g.studentId === student.id),
    [grades, student.id],
  );

  const studentDeductions = useMemo(
    () =>
      behaviorDeductions
        .filter((d) => d.studentId === student.id)
        .sort((a, b) => {
          const ta = a.createdAt?.toMillis?.() ?? 0;
          const tb = b.createdAt?.toMillis?.() ?? 0;
          return tb - ta;
        }),
    [behaviorDeductions, student.id],
  );

  const studentInvoices = useMemo(
    () =>
      invoices
        .filter((inv) => inv.studentId === student.id)
        .sort((a, b) => b.dueDate.localeCompare(a.dueDate)),
    [invoices, student.id],
  );

  const presentCount = studentAttendance.filter((a) => a.status === 'present').length;
  const absentCount = studentAttendance.filter((a) => a.status === 'absent').length;
  const lateCount = studentAttendance.filter((a) => a.status === 'late').length;
  const excusedCount = studentAttendance.filter((a) => a.status === 'excused').length;

  const computedAttendanceRate =
    studentAttendance.length > 0
      ? Math.round(
          ((presentCount + lateCount + excusedCount) / studentAttendance.length) * 100,
        )
      : student.attendanceRate;

  const computedGpa =
    studentGrades.length > 0
      ? Number(
          (
            studentGrades.reduce((sum, g) => sum + g.totalScore, 0) /
            studentGrades.length
          ).toFixed(1),
        )
      : student.gpa;

  const behaviorScore =
    typeof student.behaviorScore === 'number' ? student.behaviorScore : 100;
  const totalDeductedPoints = studentDeductions.reduce(
    (sum, d) => sum + d.pointsDeducted,
    0,
  );

  const unpaidAmount = studentInvoices
    .filter((i) => i.status !== 'paid')
    .reduce((sum, i) => sum + i.amount, 0);
  const paidAmount = studentInvoices
    .filter((i) => i.status === 'paid')
    .reduce((sum, i) => sum + i.amount, 0);

  const currentYear = String(new Date().getFullYear());

  const handleDownloadAnnualPdf = async () => {
    if (generatingPdf) return;
    setGeneratingPdf(true);
    try {
      const summary = buildAnnualStudentSummary(
        currentYear,
        student,
        grades,
        attendance,
      );
      const fileName = await generateAnnualStudentPdf(summary, userName);
      onNotify(
        `تم توليد وتحميل التقرير السنوي (PDF) للطالب ${student.fullName} (${fileName}).`,
      );
    } catch {
      onNotify('تعذر توليد ملف PDF للطالب، يرجى المحاولة مجدداً.');
    } finally {
      setGeneratingPdf(false);
    }
  };

  return (
    <div className="space-y-6">
      <PrintHeader
        title={`الملف الشخصي الموحد للطالب — ${student.fullName}`}
        subtitle={`${student.grade} (الشعبة ${student.section}) · الرقم الأكاديمي: ${student.studentCode}`}
        documentCode={`STU-${student.studentCode}`}
        metadata={[
          { label: 'ولي الأمر', value: student.parentName },
          { label: 'الهاتف', value: student.parentPhone },
          { label: 'نسبة الحضور', value: `${computedAttendanceRate}%` },
          { label: 'رصيد السلوك', value: `${behaviorScore}/100` },
        ]}
      />

      {/* Top Controls Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 no-print">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 text-slate-800 text-xs font-semibold rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ArrowRight className="w-4 h-4" />
            <span>العودة</span>
          </button>

          <div className="flex items-center gap-2">
            <label htmlFor="student-profile-switcher" className="text-xs text-slate-500 whitespace-nowrap">
              تبديل الطالب:
            </label>
            <select
              id="student-profile-switcher"
              value={student.id}
              onChange={(e) => onSelectStudent(e.target.value)}
              className="px-3 py-2 text-xs font-medium border border-slate-300 rounded-lg bg-white text-slate-800"
            >
              {allStudents.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName} — {s.grade} ({s.section})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onMessageParent && (
            <button
              type="button"
              onClick={() => onMessageParent(student)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-teal-50 text-teal-800 border border-teal-200 text-xs font-semibold rounded-lg hover:bg-teal-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <MessageSquare className="w-4 h-4" />
              <span>مراسلة ولي الأمر</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleDownloadAnnualPdf}
            disabled={generatingPdf}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 text-slate-800 text-xs font-medium rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
          >
            <FileDown className="w-4 h-4" />
            <span>{generatingPdf ? 'جاري التوليد...' : 'تقرير الطالب (PDF)'}</span>
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>طباعة الملف الشخصي</span>
          </button>
        </div>
      </div>

      {/* Identity Header Card */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-6 print-avoid-break">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-center shrink-0">
            <User className="w-6 h-6 text-teal-700" />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-semibold text-teal-700">
              الملف الشخصي الشامل للطالب · الرقم الأكاديمي{' '}
              <span className="font-mono-num">{student.studentCode}</span>
            </p>
            <h2 className="text-2xl font-bold font-display text-slate-900">{student.fullName}</h2>
            <p className="text-xs text-slate-600 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>
                {student.grade} — الشعبة ({student.section})
              </span>
              <span aria-hidden="true">·</span>
              <span>ولي الأمر: {student.parentName}</span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 font-mono-num">
                <Phone className="w-3.5 h-3.5 text-slate-400" />
                <span>{student.parentPhone}</span>
              </span>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 no-print">
          {(
            [
              { id: 'all', label: 'الملف المتكامل (الكل)' },
              {
                id: 'attendance',
                label: `الغيابات والحضور (${studentAttendance.length + studentPeriodLogs.length})`,
              },
              { id: 'grades', label: `الدرجات (${studentGrades.length})` },
              { id: 'behavior', label: `الخصومات السلوكية (${studentDeductions.length})` },
            ] as Array<{ id: ProfileSectionTab; label: string }>
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSectionTab(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                sectionTab === tab.id
                  ? 'bg-teal-700 border-teal-700 text-white'
                  : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {/* 4-Column Summary KPI Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 print-compact-grid print-avoid-break">
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-start justify-between">
          <div>
            <p className="text-xs text-slate-500">نسبة الحضور العامة</p>
            <p className="text-2xl font-bold font-mono-num text-teal-700 mt-1">
              {computedAttendanceRate}%
            </p>
            <p className="text-xs text-slate-500 font-mono-num mt-1">
              حضور {presentCount} · غياب {absentCount} · تأخر {lateCount}
            </p>
          </div>
          <CalendarCheck className="w-5 h-5 text-teal-700 shrink-0" />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-start justify-between">
          <div>
            <p className="text-xs text-slate-500">المعدل الأكاديمي العام</p>
            <p className="text-2xl font-bold font-mono-num text-slate-900 mt-1">
              {computedGpa}%
            </p>
            <p className="text-xs text-emerald-700 font-medium mt-1">
              {getAcademicRating(computedGpa)} · {studentGrades.length} مواد مقيمة
            </p>
          </div>
          <Award className="w-5 h-5 text-teal-700 shrink-0" />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-start justify-between">
          <div>
            <p className="text-xs text-slate-500">رصيد السلوك والانضباط</p>
            <p
              className={`text-2xl font-bold font-mono-num mt-1 ${
                behaviorScore >= 90
                  ? 'text-emerald-700'
                  : behaviorScore >= 75
                    ? 'text-amber-700'
                    : 'text-red-700'
              }`}
            >
              {behaviorScore} / 100
            </p>
            <p className="text-xs text-slate-500 font-mono-num mt-1">
              {studentDeductions.length} خصومات ({totalDeductedPoints} نقطة مخصومة)
            </p>
          </div>
          <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0" />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-start justify-between">
          <div>
            <p className="text-xs text-slate-500">الموقف المالي والرسوم</p>
            <p
              className={`text-lg font-bold font-mono-num mt-1 ${
                unpaidAmount > 0 ? 'text-amber-700' : 'text-emerald-700'
              }`}
            >
              {unpaidAmount > 0 ? formatIQD(unpaidAmount) : 'مسددة بالكامل'}
            </p>
            <p className="text-xs text-slate-500 font-mono-num mt-1">
              مدفوع: {formatIQD(paidAmount)} ({studentInvoices.length} فواتير)
            </p>
          </div>
          <CreditCard className="w-5 h-5 text-teal-700 shrink-0" />
        </div>
      </section>

      {/* Section 1: Attendance & Absences (Daily + Periods) */}
      {(sectionTab === 'all' || sectionTab === 'attendance') && (
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden print-avoid-break">
          <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <CalendarCheck className="w-4 h-4 text-teal-700" />
              <h3 className="text-base font-bold font-display text-slate-900">
                سجل الحضور والغيابات (اليومي والحصص)
              </h3>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs font-mono-num">
              <span className="text-emerald-700 font-semibold">حاضر: {presentCount}</span>
              <span className="text-slate-300">·</span>
              <span className="text-red-700 font-semibold">غائب: {absentCount}</span>
              <span className="text-slate-300">·</span>
              <span className="text-amber-700 font-semibold">متأخر: {lateCount}</span>
              <span className="text-slate-300">·</span>
              <span className="text-slate-600 font-semibold">بعذر: {excusedCount}</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                <tr>
                  <th className="py-3 px-4 font-semibold">التاريخ</th>
                  <th className="py-3 px-4 font-semibold">وقت الرصد</th>
                  <th className="py-3 px-4 font-semibold">الحالة</th>
                  <th className="py-3 px-4 font-semibold">حالة الإشعار</th>
                  <th className="py-3 px-4 font-semibold">الملاحظات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {studentAttendance.map((rec) => (
                  <tr key={rec.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-mono-num font-medium text-slate-900">
                      {rec.date}
                    </td>
                    <td className="py-3 px-4 font-mono-num text-slate-600">
                      {rec.checkInTime || '--:--'}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`text-xs font-semibold ${
                          rec.status === 'present'
                            ? 'text-emerald-700'
                            : rec.status === 'absent'
                              ? 'text-red-700'
                              : rec.status === 'late'
                                ? 'text-amber-700'
                                : 'text-slate-600'
                        }`}
                      >
                        {STATUS_LABELS[rec.status]}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600">
                      {rec.parentNotified ? 'تم إشعار ولي الأمر' : 'غير مُشعر'}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600">{rec.notes || '—'}</td>
                  </tr>
                ))}
                {studentAttendance.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-xs text-slate-500">
                      لا توجد سجلات حضور يومي مسجلة لهذا الطالب حتى الآن.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {studentPeriodLogs.length > 0 && (
            <div className="border-t border-slate-200">
              <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-700">
                سجل الحضور والفئات في الحصص الدراسية ({studentPeriodLogs.length} سجل)
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-50/70 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="py-2.5 px-4 font-semibold">التاريخ</th>
                      <th className="py-2.5 px-4 font-semibold">الحصة والمادة</th>
                      <th className="py-2.5 px-4 font-semibold">الحالة</th>
                      <th className="py-2.5 px-4 font-semibold">الفئة / الملاحظة</th>
                      <th className="py-2.5 px-4 font-semibold">المسجّل</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {studentPeriodLogs.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50/60">
                        <td className="py-2.5 px-4 font-mono-num text-slate-800">{p.date}</td>
                        <td className="py-2.5 px-4 text-slate-800">
                          {p.periodLabel} · {p.subject}
                        </td>
                        <td className="py-2.5 px-4">
                          <span
                            className={`font-semibold ${
                              p.status === 'present'
                                ? 'text-emerald-700'
                                : p.status === 'absent'
                                  ? 'text-red-700'
                                  : p.status === 'late'
                                    ? 'text-amber-700'
                                    : 'text-slate-600'
                            }`}
                          >
                            {STATUS_LABELS[p.status]}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-slate-600">{p.categoryLabel}</td>
                        <td className="py-2.5 px-4 text-slate-500">{p.recordedBy}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Section 2: Academic Grades */}
      {(sectionTab === 'all' || sectionTab === 'grades') && (
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden print-avoid-break">
          <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-teal-700" />
              <h3 className="text-base font-bold font-display text-slate-900">
                سجل الدرجات الأكاديمية والتقييمات
              </h3>
            </div>
            <span className="text-xs font-mono-num text-teal-700 font-semibold">
              المعدل العام: {computedGpa}% ({getAcademicRating(computedGpa)})
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                <tr>
                  <th className="py-3 px-4 font-semibold">المادة الدراسية</th>
                  <th className="py-3 px-4 font-semibold">الفصل</th>
                  <th className="py-3 px-4 font-semibold">نصفي (30)</th>
                  <th className="py-3 px-4 font-semibold">أعمال (30)</th>
                  <th className="py-3 px-4 font-semibold">نهائي (40)</th>
                  <th className="py-3 px-4 font-semibold">المجموع (100)</th>
                  <th className="py-3 px-4 font-semibold">التقدير</th>
                  <th className="py-3 px-4 font-semibold">ملاحظة المعلم</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {studentGrades.map((g) => (
                  <tr key={g.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-semibold text-slate-900">{g.subject}</td>
                    <td className="py-3 px-4 text-xs text-slate-600">{g.term}</td>
                    <td className="py-3 px-4 font-mono-num text-slate-700">{g.midtermScore}</td>
                    <td className="py-3 px-4 font-mono-num text-slate-700">{g.courseworkScore}</td>
                    <td className="py-3 px-4 font-mono-num text-slate-700">{g.finalScore}</td>
                    <td className="py-3 px-4 font-mono-num font-bold text-teal-700">
                      {g.totalScore}
                    </td>
                    <td className="py-3 px-4 text-xs font-semibold text-slate-800">
                      {getAcademicRating(g.totalScore)}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600 max-w-xs">
                      {g.teacherNote || '—'}
                    </td>
                  </tr>
                ))}
                {studentGrades.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-xs text-slate-500">
                      لا توجد درجات تفصيلية مرصودة لهذا الطالب حتى الآن.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Section 3: Behavior Deductions Log */}
      {(sectionTab === 'all' || sectionTab === 'behavior') && (
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden print-avoid-break">
          <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-600" />
              <h3 className="text-base font-bold font-display text-slate-900">
                سجل الخصومات السلوكية والانضباط
              </h3>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs font-mono-num font-bold text-slate-800">
                الرصيد الحالي: {behaviorScore} / 100
              </span>
              <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full ${
                    behaviorScore >= 90
                      ? 'bg-emerald-600'
                      : behaviorScore >= 75
                        ? 'bg-amber-500'
                        : 'bg-red-600'
                  }`}
                  style={{ width: `${behaviorScore}%` }}
                />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                <tr>
                  <th className="py-3 px-4 font-semibold">النقاط المخصومة</th>
                  <th className="py-3 px-4 font-semibold">تغير الرصيد</th>
                  <th className="py-3 px-4 font-semibold">السبب / المخالفة</th>
                  <th className="py-3 px-4 font-semibold">تم بواسطة</th>
                  <th className="py-3 px-4 font-semibold">التاريخ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {studentDeductions.map((ded) => {
                  const dateText = ded.createdAt?.toDate
                    ? ded.createdAt.toDate().toISOString().slice(0, 10)
                    : 'مسجل';
                  return (
                    <tr key={ded.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-mono-num font-bold text-red-700">
                        -{ded.pointsDeducted}
                      </td>
                      <td className="py-3 px-4 font-mono-num text-slate-800">
                        {ded.previousScore} ← {ded.newScore} / 100
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-700 max-w-md">{ded.reason}</td>
                      <td className="py-3 px-4 text-xs text-slate-600">
                        {ded.deductedByName} ({ROLE_LABELS_AR[ded.deductedByRole]})
                      </td>
                      <td className="py-3 px-4 text-xs font-mono-num text-slate-500">
                        {dateText}
                      </td>
                    </tr>
                  );
                })}
                {studentDeductions.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-xs text-emerald-700 font-medium">
                      سجل سلوكي نظيف بالكامل (100/100) — لا توجد خصومات مسجلة.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Optional compact invoices summary when viewing All */}
      {sectionTab === 'all' && studentInvoices.length > 0 && (
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden print-avoid-break">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-teal-700" />
              <h3 className="text-base font-bold font-display text-slate-900">
                ملخص الفواتير والرسوم الدراسية
              </h3>
            </div>
            <span className="text-xs font-mono-num text-slate-500">
              {studentInvoices.length} فواتير
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-2.5 px-4 font-semibold">رقم الفاتورة</th>
                  <th className="py-2.5 px-4 font-semibold">البيان</th>
                  <th className="py-2.5 px-4 font-semibold">المبلغ</th>
                  <th className="py-2.5 px-4 font-semibold">تاريخ الاستحقاق</th>
                  <th className="py-2.5 px-4 font-semibold">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {studentInvoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-4 font-mono-num text-slate-700">
                      {inv.invoiceNumber}
                    </td>
                    <td className="py-2.5 px-4 font-medium text-slate-900">{inv.title}</td>
                    <td className="py-2.5 px-4 font-mono-num font-semibold text-slate-900">
                      {formatIQD(inv.amount)}
                    </td>
                    <td className="py-2.5 px-4 font-mono-num text-slate-600">{inv.dueDate}</td>
                    <td className="py-2.5 px-4 font-semibold">
                      <span
                        className={
                          inv.status === 'paid'
                            ? 'text-emerald-700'
                            : inv.status === 'overdue'
                              ? 'text-red-700'
                              : 'text-amber-700'
                        }
                      >
                        {inv.status === 'paid'
                          ? 'مسددة'
                          : inv.status === 'overdue'
                            ? 'متأخرة'
                            : 'مستحقة'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <PrintFooter
        preparedBy={userName || 'إدارة المدرسة'}
        approverTitle="اعتماد قائد المدرسة والمرشد الطلابي"
      />
    </div>
  );
};
