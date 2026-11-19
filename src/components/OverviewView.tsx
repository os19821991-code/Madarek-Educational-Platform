import React from 'react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  AlertTriangle,
  ArrowUpLeft,
  BellRing,
  CalendarCheck,
  CheckCircle2,
  CreditCard,
  FileDown,
  GraduationCap,
  Megaphone,
  Users,
} from 'lucide-react';
import { generateDashboardSnapshotPdf } from '../lib/pdfReportGenerator';
import { PrintFooter, PrintHeader } from './PrintHeader';
import type {
  Activity,
  Announcement,
  AttendanceRecord,
  GradeRecord,
  HomeworkItem,
  Invoice,
  NavSection,
  ParentNotification,
  Student,
  TeacherEvaluation,
} from '../types';

interface OverviewViewProps {
  students: Student[];
  attendance: AttendanceRecord[];
  grades: GradeRecord[];
  invoices: Invoice[];
  announcements: Announcement[];
  teachers: TeacherEvaluation[];
  homework: HomeworkItem[];
  activities: Activity[];
  notifications: ParentNotification[];
  userName?: string;
  canGenerateSnapshot?: boolean;
  onNavigate: (section: NavSection) => void;
  onOpenNotifications: () => void;
  onNotify?: (msg: string) => void;
  onSelectStudent?: (studentId: string) => void;
}

const WEEKLY_ATTENDANCE_DATA = [
  { day: 'الأحد', rate: 96.2, present: 242 },
  { day: 'الإثنين', rate: 97.4, present: 245 },
  { day: 'الثلاثاء', rate: 95.8, present: 241 },
  { day: 'الأربعاء', rate: 98.1, present: 247 },
  { day: 'الخميس', rate: 94.9, present: 238 },
];

export const OverviewView: React.FC<OverviewViewProps> = ({
  students,
  attendance,
  grades,
  invoices,
  announcements,
  teachers,
  homework,
  activities,
  notifications,
  userName = 'إدارة المدرسة',
  canGenerateSnapshot = true,
  onNavigate,
  onOpenNotifications,
  onNotify,
  onSelectStudent,
}) => {
  const [generatingSnapshot, setGeneratingSnapshot] = React.useState(false);
  const presentCount = attendance.filter((a) => a.status === 'present').length;
  const attendancePct =
    attendance.length > 0
      ? Math.round((presentCount / attendance.length) * 100)
      : students.length > 0
        ? Math.round(students.reduce((acc, s) => acc + s.attendanceRate, 0) / students.length)
        : 0;

  const avgGpa =
    grades.length > 0
      ? (grades.reduce((acc, g) => acc + g.totalScore, 0) / grades.length).toFixed(1)
      : students.length > 0
        ? (students.reduce((acc, s) => acc + s.gpa, 0) / students.length).toFixed(1)
        : '0.0';

  const totalBilled = invoices.reduce((acc, inv) => acc + inv.amount, 0);
  const totalPaid = invoices
    .filter((inv) => inv.status === 'paid')
    .reduce((acc, inv) => acc + inv.amount, 0);
  const collectionPct = totalBilled > 0 ? Math.round((totalPaid / totalBilled) * 100) : 0;

  const unreadAlerts = notifications.filter((n) => !n.isRead).length;

  const now = new Date();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
  const currentMonthKey = todayIso.slice(0, 7);
  const currentMonthLabel = new Intl.DateTimeFormat('ar-SA', {
    month: 'long',
    year: 'numeric',
  }).format(now);

  const activeAttendanceDate = React.useMemo(() => {
    if (attendance.some((a) => a.date === todayIso)) return todayIso;
    const sortedDates = attendance
      .map((a) => a.date)
      .filter(Boolean)
      .sort((a, b) => b.localeCompare(a));
    return sortedDates[0] || todayIso;
  }, [attendance, todayIso]);

  const currentDayLogs = React.useMemo(
    () => attendance.filter((a) => a.date === activeAttendanceDate),
    [attendance, activeAttendanceDate],
  );

  const currentPresentCount = currentDayLogs.filter((a) => a.status === 'present').length;
  const currentLateCount = currentDayLogs.filter((a) => a.status === 'late').length;
  const emergencyAbsentLogs = currentDayLogs.filter((a) => a.status === 'absent');
  const unnotifiedAbsencesCount = emergencyAbsentLogs.filter((a) => !a.parentNotified).length;

  const monthlyPaidInvoices = React.useMemo(
    () =>
      invoices.filter((inv) => {
        if (inv.status !== 'paid') return false;
        const paidMonth = inv.updatedAt?.toDate
          ? inv.updatedAt.toDate().toISOString().slice(0, 7)
          : '';
        return paidMonth === currentMonthKey || inv.dueDate.startsWith(currentMonthKey);
      }),
    [invoices, currentMonthKey],
  );

  const monthlyCollectedAmount = monthlyPaidInvoices.reduce((acc, inv) => acc + inv.amount, 0);
  const totalOutstanding = Math.max(0, totalBilled - totalPaid);

  const subjectAverages = React.useMemo(() => {
    const grouped: Record<string, { sum: number; count: number }> = {};
    for (const g of grades) {
      if (!grouped[g.subject]) {
        grouped[g.subject] = { sum: 0, count: 0 };
      }
      grouped[g.subject].sum += g.totalScore;
      grouped[g.subject].count += 1;
    }
    return Object.entries(grouped).map(([subject, val]) => ({
      subject: subject.length > 14 ? `${subject.slice(0, 14)}…` : subject,
      avg: Math.round(val.sum / val.count),
    }));
  }, [grades]);

  const handleGenerateSnapshotPdf = async () => {
    if (generatingSnapshot) return;
    setGeneratingSnapshot(true);
    try {
      const fileName = await generateDashboardSnapshotPdf({
        generatedBy: userName,
        activeAttendanceDate,
        currentMonthLabel,
        attendancePct,
        presentCount,
        totalStudentsForAttendance: attendance.length || students.length,
        currentPresentCount,
        currentLateCount,
        emergencyAbsentLogs,
        avgGpa,
        gradesCount: grades.length,
        subjectAverages,
        collectionPct,
        totalBilled,
        totalPaid,
        monthlyCollectedAmount,
        monthlyPaidCount: monthlyPaidInvoices.length,
        totalOutstanding,
        invoices,
        studentsCount: students.length,
        teachers,
        announcements,
        activities,
        homeworkCount: homework.length,
        unreadAlertsCount: unreadAlerts,
      });
      onNotify?.(`تم توليد وتحميل التقرير الشامل للوحة التحكم (${fileName}) بنجاح.`);
    } catch {
      onNotify?.('تعذر توليد ملف PDF للوحة التحكم. يرجى المحاولة مرة أخرى.');
    } finally {
      setGeneratingSnapshot(false);
    }
  };

  return (
    <div className="space-y-6">
      <PrintHeader
        title="التقرير الشامل للوحة التحكم التنفيذية (Dashboard Snapshot)"
        subtitle={`ملخص الحضور والرسوم والغياب الطارئ — ${currentMonthLabel}`}
        documentCode={`DASH-${activeAttendanceDate}`}
        metadata={[
          { label: 'نسبة الحضور', value: `${attendancePct}%` },
          { label: 'تحصيل الرسوم', value: `${collectionPct}%` },
          { label: 'الغياب الطارئ', value: emergencyAbsentLogs.length },
          { label: 'المعدّل العام', value: `${avgGpa}%` },
        ]}
      />
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      {/* Main Analytical Workspace */}
      <div className="xl:col-span-8 space-y-6 min-w-0">
        {/* Campus Hero Summary Banner */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="lg:col-span-7 p-6 lg:p-8 flex flex-col justify-between space-y-6">
          <div className="space-y-2">
            <p className="text-xs font-medium text-teal-700">
              العام الدراسي 2026–2027 · الفصل الدراسي الأول
            </p>
            <h1 className="text-2xl lg:text-3xl font-bold font-display text-slate-900 leading-snug">
              المركز الموحد لإدارة المدرسة والتواصل الأسري
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed max-w-2xl">
              متابعة فورية للحضور والغياب مع تنبيهات تلقائية لأولياء الأمور، إدارة الدرجات
              والتقارير الدورية، الفواتير الإلكترونية، المكتبة الرقمية، وتقييم الكادر التعليمي.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => onNavigate('attendance')}
              className="px-4 py-2.5 bg-teal-700 text-white text-sm font-medium rounded-lg hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              رصد الحضور اليومي
            </button>
            <button
              type="button"
              onClick={onOpenNotifications}
              className="px-4 py-2.5 bg-slate-100 text-slate-800 text-sm font-medium rounded-lg hover:bg-slate-200 transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <BellRing className="w-4 h-4 text-teal-700" />
              <span>إشعارات أولياء الأمور</span>
              <span className="font-mono-num text-xs font-semibold text-teal-800">
                ({unreadAlerts})
              </span>
            </button>
            {canGenerateSnapshot && (
              <button
                type="button"
                onClick={handleGenerateSnapshotPdf}
                disabled={generatingSnapshot}
                className="px-4 py-2.5 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60 no-print"
              >
                <FileDown className="w-4 h-4" />
                <span>
                  {generatingSnapshot ? 'جاري توليد التقرير...' : 'تصدير Dashboard Snapshot (PDF)'}
                </span>
              </button>
            )}
          </div>
        </div>

        <div className="lg:col-span-5 relative min-h-[220px] bg-slate-100">
          <img
            src="/src/assets/images/school_campus_hero_1795034380130.jpg"
            alt="الحرم المدرسي الحديث لمنصة مدارك"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-900/75 via-slate-900/20 to-transparent flex items-end p-5">
            <div className="text-white space-y-1">
              <p className="text-xs text-slate-200">جاهزية النظام المدرسي</p>
              <p className="text-sm font-semibold">
                {students.length} طلاب مسجلين · {teachers.length} معلمين نشطين · {activities.length} فعاليات قادمة
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 4-Column KPI Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-start justify-between">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-slate-500">نسبة الحضور اليومي</p>
            <p className="text-2xl font-bold font-mono-num text-slate-900">{attendancePct}%</p>
            <p className="text-xs text-emerald-700">
              {presentCount} حاضر من أصل {attendance.length || students.length}
            </p>
          </div>
          <CalendarCheck className="w-5 h-5 text-teal-700 shrink-0" />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-start justify-between">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-slate-500">متوسط التحصيل الأكاديمي</p>
            <p className="text-2xl font-bold font-mono-num text-slate-900">{avgGpa}%</p>
            <p className="text-xs text-slate-500">
              استناداً إلى {grades.length} تقييمات مسجلة
            </p>
          </div>
          <GraduationCap className="w-5 h-5 text-teal-700 shrink-0" />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-start justify-between">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-slate-500">تحصيل الرسوم المدرسية</p>
            <p className="text-2xl font-bold font-mono-num text-slate-900">{collectionPct}%</p>
            <p className="text-xs text-slate-500 font-mono-num">
              {totalPaid.toLocaleString('en-US')} / {totalBilled.toLocaleString('en-US')} د.ع
            </p>
          </div>
          <CreditCard className="w-5 h-5 text-teal-700 shrink-0" />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-start justify-between">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-slate-500">الطلاب والواجبات النشطة</p>
            <p className="text-2xl font-bold font-mono-num text-slate-900">{students.length}</p>
            <p className="text-xs text-slate-500">
              {homework.length} واجبات منشورة · {teachers.length} معلمين
            </p>
          </div>
          <Users className="w-5 h-5 text-teal-700 shrink-0" />
        </div>
      </section>

      {/* Analytical Charts Row (Req 10) */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold font-display text-slate-900">
                مؤشر الانضباط والحضور الأسبوعي
              </h2>
              <p className="text-xs text-slate-500">نسبة الحضور المئوية عبر أيام الأسبوع الدراسي</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('attendance')}
              className="text-xs font-medium text-teal-700 hover:text-teal-800 inline-flex items-center gap-1 cursor-pointer"
            >
              <span>التفاصيل</span>
              <ArrowUpLeft className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="h-64 w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={WEEKLY_ATTENDANCE_DATA}>
                <defs>
                  <linearGradient id="attendanceFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0f766e" stopOpacity={0.22} />
                    <stop offset="95%" stopColor="#0f766e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 12, fill: '#475569' }} />
                <YAxis domain={[85, 100]} tick={{ fontSize: 12, fill: '#475569' }} />
                <Tooltip
                  formatter={(value) => [`${value ?? 0}%`, 'نسبة الحضور']}
                  contentStyle={{
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                    fontSize: '12px',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="rate"
                  stroke="#0f766e"
                  strokeWidth={2.5}
                  fill="url(#attendanceFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold font-display text-slate-900">
                متوسط الدرجات حسب المواد الدراسية
              </h2>
              <p className="text-xs text-slate-500">تحليل نتائج الطلاب المباشر من سجل الدرجات</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('grades')}
              className="text-xs font-medium text-teal-700 hover:text-teal-800 inline-flex items-center gap-1 cursor-pointer"
            >
              <span>سجل الدرجات</span>
              <ArrowUpLeft className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="h-64 w-full" dir="ltr">
            {subjectAverages.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={subjectAverages}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="subject" tick={{ fontSize: 11, fill: '#475569' }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: '#475569' }} />
                  <Tooltip
                    formatter={(value) => [`${value ?? 0}%`, 'متوسط الدرجة']}
                    contentStyle={{
                      borderRadius: '8px',
                      border: '1px solid #e2e8f0',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="avg" fill="#0f766e" radius={[6, 6, 0, 0]} maxBarSize={44} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-slate-400">
                لا توجد درجات مسجلة بعد لعرض الرسم البياني
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Latest Announcements & Teacher Performance Snapshot */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <Megaphone className="w-4 h-4 text-teal-700" />
              <h2 className="text-base font-bold font-display text-slate-900">
                أحدث الإعلانات والتعاميم المدرسية
              </h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('communication')}
              className="text-xs font-medium text-teal-700 hover:text-teal-800 cursor-pointer"
            >
              إدارة التعاميم
            </button>
          </div>

          <div className="divide-y divide-slate-100">
            {announcements.slice(0, 3).map((ann) => (
              <div key={ann.id} className="py-3.5 first:pt-1 last:pb-1 space-y-1.5">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="font-medium text-teal-800">
                    {ann.category === 'urgent'
                      ? 'عاجل'
                      : ann.category === 'circular'
                        ? 'تعميم إداري'
                        : ann.category === 'event'
                          ? 'فعالية'
                          : 'أكاديمي'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{ann.targetAudience}</span>
                  <span aria-hidden="true">·</span>
                  <span>{ann.authorName}</span>
                </div>
                <h3 className="text-sm font-semibold text-slate-900">{ann.title}</h3>
                <p className="text-xs text-slate-600 leading-relaxed line-clamp-2">{ann.body}</p>
              </div>
            ))}
            {announcements.length === 0 && (
              <p className="py-6 text-sm text-slate-500 text-center">لا توجد تعاميم منشورة حالياً.</p>
            )}
          </div>
        </div>

        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-base font-bold font-display text-slate-900">
              مؤشر كفاءة الكادر التعليمي
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('teachers')}
              className="text-xs font-medium text-teal-700 hover:text-teal-800 cursor-pointer"
            >
              التقييم الكامل
            </button>
          </div>

          <div className="divide-y divide-slate-100">
            {teachers.slice(0, 4).map((t) => (
              <div key={t.id} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 truncate">{t.teacherName}</p>
                  <p className="text-xs text-slate-500">
                    {t.subject} · {t.lessonsDelivered} حصة
                  </p>
                </div>
                <div className="text-left shrink-0">
                  <p className="text-sm font-bold font-mono-num text-teal-700">
                    {t.evaluationScore}%
                  </p>
                  <p className="text-xs text-slate-400">تقييم دوري</p>
                </div>
              </div>
            ))}
            {teachers.length === 0 && (
              <p className="py-6 text-sm text-slate-500 text-center">لا توجد بيانات تقييم معلمين.</p>
            )}
          </div>
        </div>
      </section>
      </div>

      {/* Side Executive Decision Summary Panel */}
      <aside className="xl:col-span-4 xl:sticky xl:top-6 bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        <div className="p-5 space-y-1">
          <p className="text-xs font-medium text-teal-700">مؤشرات القرار الفوري للمدراء</p>
          <h2 className="text-base font-bold font-display text-slate-900">
            الملخص التشغيلي اليومي والشهري
          </h2>
          <p className="text-xs text-slate-500 font-mono-num">
            تاريخ الرصد: {activeAttendanceDate}
          </p>
        </div>

        {/* 1. Current Attendance Count */}
        <div className="p-5 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
              <CalendarCheck className="w-4 h-4 text-teal-700 shrink-0" />
              <span>عدد الحضور الحالي</span>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('attendance')}
              className="text-xs font-medium text-teal-700 hover:text-teal-800 inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>كشف الحضور</span>
              <ArrowUpLeft className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-2xl font-bold font-mono-num text-slate-900">
              {currentPresentCount}
              <span className="text-sm font-normal text-slate-500 mr-1.5">
                / {students.length} طالب
              </span>
            </p>
            <span className="text-xs font-medium text-emerald-700 font-mono-num">
              متأخر: {currentLateCount}
            </span>
          </div>
          <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-teal-700 transition-all"
              style={{
                width: `${
                  students.length > 0
                    ? Math.min(100, Math.round((currentPresentCount / students.length) * 100))
                    : 0
                }%`,
              }}
            />
          </div>
        </div>

        {/* 2. Emergency Absences */}
        <div className="p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
              {emergencyAbsentLogs.length > 0 ? (
                <AlertTriangle className="w-4 h-4 text-red-700 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
              )}
              <span>حالات الغياب الطارئة</span>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('attendance')}
              className="text-xs font-medium text-teal-700 hover:text-teal-800 inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>متابعة</span>
              <ArrowUpLeft className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-baseline justify-between gap-2">
            <p
              className={`text-2xl font-bold font-mono-num ${
                emergencyAbsentLogs.length > 0 ? 'text-red-700' : 'text-emerald-700'
              }`}
            >
              {emergencyAbsentLogs.length}
              <span className="text-sm font-normal text-slate-500 mr-1.5">حالات</span>
            </p>
            {unnotifiedAbsencesCount > 0 && (
              <span className="text-xs font-medium text-amber-700 font-mono-num">
                {unnotifiedAbsencesCount} بانتظار التنبيه
              </span>
            )}
          </div>

          {emergencyAbsentLogs.length > 0 ? (
            <ul className="space-y-2 pt-1 text-xs">
              {emergencyAbsentLogs.slice(0, 3).map((rec) => (
                <li
                  key={rec.id}
                  className="flex items-center justify-between gap-2 text-slate-700"
                >
                  <span className="truncate font-medium">
                    {onSelectStudent ? (
                      <button
                        type="button"
                        onClick={() => onSelectStudent(rec.studentId)}
                        className="text-slate-900 hover:text-teal-700 hover:underline font-semibold cursor-pointer text-right"
                      >
                        {rec.studentName}
                      </button>
                    ) : (
                      rec.studentName
                    )}{' '}
                    · {rec.grade}
                  </span>
                  <span
                    className={`shrink-0 ${
                      rec.parentNotified ? 'text-teal-700' : 'text-amber-700 font-medium'
                    }`}
                  >
                    {rec.parentNotified ? 'تم إشعار ولي الأمر' : 'غير مُشعر'}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-500">لا توجد حالات غياب طارئة مسجلة لهذا اليوم.</p>
          )}
        </div>

        {/* 3. Total Fees Collected This Month */}
        <div className="p-5 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
              <CreditCard className="w-4 h-4 text-teal-700 shrink-0" />
              <span>إجمالي الرسوم المحصلة هذا الشهر</span>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('billing')}
              className="text-xs font-medium text-teal-700 hover:text-teal-800 inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>الفواتير</span>
              <ArrowUpLeft className="w-3.5 h-3.5" />
            </button>
          </div>

          <p className="text-2xl font-bold font-mono-num text-slate-900">
            {monthlyCollectedAmount.toLocaleString('en-US')}{' '}
            <span className="text-sm font-normal text-slate-500">د.ع</span>
          </p>

          <p className="text-xs text-slate-500">
            <span className="font-mono-num font-semibold text-slate-700">
              {monthlyPaidInvoices.length}
            </span>{' '}
            فواتير محصلة في {currentMonthLabel} · مستحقات معلقة:{' '}
            <span className="font-mono-num font-semibold text-amber-700">
              {totalOutstanding.toLocaleString('en-US')} د.ع
            </span>
          </p>
        </div>

        {/* Quick Executive Actions */}
        <div className="p-5 flex flex-col gap-2 no-print">
          {canGenerateSnapshot && (
            <button
              type="button"
              onClick={handleGenerateSnapshotPdf}
              disabled={generatingSnapshot}
              className="w-full py-2.5 px-4 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800 transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer disabled:opacity-60"
            >
              <FileDown className="w-4 h-4" />
              <span>
                {generatingSnapshot ? 'جاري إنشاء ملف PDF...' : 'توليد تقرير لوحة التحكم الشامل (PDF)'}
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={() => onNavigate('attendance')}
            className="w-full py-2 px-4 bg-teal-700 text-white text-xs font-semibold rounded-lg hover:bg-teal-800 transition-colors whitespace-nowrap cursor-pointer"
          >
            اتخاذ إجراء في سجل الحضور
          </button>
          <button
            type="button"
            onClick={onOpenNotifications}
            className="w-full py-2 px-4 bg-slate-100 text-slate-800 text-xs font-medium rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap cursor-pointer"
          >
            مراجعة التنبيهات الفورية ({unreadAlerts})
          </button>
        </div>
      </aside>
      </div>
      <PrintFooter preparedBy={userName} approverTitle="اعتماد قائد المدرسة" />
    </div>
  );
};
