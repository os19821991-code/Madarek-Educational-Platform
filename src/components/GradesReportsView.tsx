import React, { useMemo, useState } from 'react';
import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { Download, FileDown, FileText, Mail, MinusCircle, Plus, Printer, ShieldAlert } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { downloadCsv } from '../lib/csvExport';
import {
  buildAnnualStudentSummary,
  generateAllStudentsAnnualPdf,
  generateAnnualStudentPdf,
  getAcademicRating,
} from '../lib/pdfReportGenerator';
import { mergeSchoolGrades } from '../lib/grades';
import { PrintFooter, PrintHeader } from './PrintHeader';
import type {
  AttendanceRecord,
  AttendanceStatus,
  BehaviorDeduction,
  GradeRecord,
  Student,
  UserRole,
} from '../types';

interface GradesReportsViewProps {
  students: Student[];
  grades: GradeRecord[];
  attendance: AttendanceRecord[];
  behaviorDeductions: BehaviorDeduction[];
  canViewAcademicGrades: boolean;
  canPublishGrades: boolean;
  canDeductBehavior: boolean;
  activeEdition: UserRole;
  userName?: string;
  onNotify: (msg: string) => void;
  onTriggerBehaviorEmailWarning?: (deduction: BehaviorDeduction) => void;
  onTriggerMonthlyGmailReports?: () => void;
  onSelectStudent?: (studentId: string) => void;
}

const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
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

const BEHAVIOR_REASON_PRESETS = [
  'عدم الالتزام بالنظام الصفي أثناء الحصة',
  'التأخر المتكرر عن الطابور الصباحي',
  'عدم إحضار الأدوات والكتب الدراسية',
  'مخالفة لائحة السلوك والانضباط المدرسي',
];

export const GradesReportsView: React.FC<GradesReportsViewProps> = ({
  students,
  grades,
  attendance,
  behaviorDeductions,
  canViewAcademicGrades,
  canPublishGrades,
  canDeductBehavior,
  activeEdition,
  userName = 'إدارة المدرسة',
  onNotify,
  onTriggerBehaviorEmailWarning,
  onTriggerMonthlyGmailReports,
  onSelectStudent,
}) => {
  const currentYear = String(new Date().getFullYear());
  const [subTab, setSubTab] = useState<'gradebook' | 'behavior' | 'reports' | 'annual'>(
    canViewAcademicGrades ? 'gradebook' : 'behavior',
  );
  const [selectedStudentId, setSelectedStudentId] = useState<string>(students[0]?.id || '');
  const [showAddGrade, setShowAddGrade] = useState(false);

  // Behavior Deduction Form State (strictly decrease-only by teachers, admins, supervisors)
  const [behaviorStudentId, setBehaviorStudentId] = useState<string>(students[0]?.id || '');
  const [behaviorPoints, setBehaviorPoints] = useState<number>(2);
  const [behaviorReason, setBehaviorReason] = useState<string>('');
  const [deductingBehavior, setDeductingBehavior] = useState(false);

  // Annual PDF Report State
  const [annualYear, setAnnualYear] = useState<string>(currentYear);
  const [annualGradeFilter, setAnnualGradeFilter] = useState<string>('all');
  const [generatingPdfId, setGeneratingPdfId] = useState<string | null>(null);

  const [formStudentId, setFormStudentId] = useState(students[0]?.id || '');
  const [subject, setSubject] = useState('الرياضيات المتقدمة');
  const [term, setTerm] = useState('الفصل الدراسي الأول');
  const [midtermScore, setMidtermScore] = useState(26);
  const [courseworkScore, setCourseworkScore] = useState(28);
  const [finalScore, setFinalScore] = useState(36);
  const [teacherNote, setTeacherNote] = useState('');

  const effectiveSubTab =
    !canViewAcademicGrades && subTab !== 'behavior' ? 'behavior' : subTab;
  const staffCanDeduct =
    canDeductBehavior &&
    (activeEdition === 'teacher' || activeEdition === 'admin' || activeEdition === 'supervisor');

  const availableYears = useMemo(() => {
    const yearSet = new Set<string>([
      currentYear,
      String(Number(currentYear) - 1),
      String(Number(currentYear) + 1),
    ]);
    for (const rec of attendance) {
      const y = rec.date?.slice(0, 4);
      if (y && /^\d{4}$/.test(y)) yearSet.add(y);
    }
    return Array.from(yearSet).sort((a, b) => b.localeCompare(a));
  }, [attendance, currentYear]);

  const gradesList = useMemo(
    () => mergeSchoolGrades(students.map((s) => s.grade)),
    [students],
  );

  const annualFilteredStudents = useMemo(
    () =>
      annualGradeFilter === 'all'
        ? students
        : students.filter((s) => s.grade === annualGradeFilter),
    [students, annualGradeFilter],
  );

  const annualSummaries = useMemo(
    () =>
      annualFilteredStudents.map((stu) =>
        buildAnnualStudentSummary(annualYear, stu, grades, attendance),
      ),
    [annualFilteredStudents, annualYear, grades, attendance],
  );

  const activeReportStudent =
    students.find((s) => s.id === selectedStudentId) || students[0] || null;

  const activeAnnualStudent =
    annualFilteredStudents.find((s) => s.id === selectedStudentId) ||
    annualFilteredStudents[0] ||
    null;

  const activeAnnualSummary = useMemo(() => {
    if (!activeAnnualStudent) return null;
    return buildAnnualStudentSummary(annualYear, activeAnnualStudent, grades, attendance);
  }, [annualYear, activeAnnualStudent, grades, attendance]);

  const studentGrades = activeReportStudent
    ? grades.filter((g) => g.studentId === activeReportStudent.id)
    : [];

  const studentAttendance = activeReportStudent
    ? attendance.filter((a) => a.studentId === activeReportStudent.id)
    : [];

  const handleCreateGrade = async (e: React.FormEvent) => {
    e.preventDefault();
    const stu = students.find((s) => s.id === formStudentId) || students[0];
    if (!stu) return;

    const mid = Math.min(30, Math.max(0, Number(midtermScore)));
    const cw = Math.min(30, Math.max(0, Number(courseworkScore)));
    const fin = Math.min(40, Math.max(0, Number(finalScore)));
    const total = mid + cw + fin;
    const gradeId = `grd_${stu.id}_${Date.now()}`;

    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'grades', gradeId), {
        studentId: stu.id,
        studentName: stu.fullName,
        grade: stu.grade,
        parentUid: stu.parentUid,
        subject: subject.trim(),
        term,
        midtermScore: mid,
        courseworkScore: cw,
        finalScore: fin,
        totalScore: total,
        teacherNote: teacherNote.trim() || 'تقييم دوري مسجل في لوحة الدرجات.',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      batch.set(doc(db, 'notifications', `notif_grd_${Date.now()}`), {
        parentUid: stu.parentUid,
        title: `تحديث درجة أكاديمية — ${stu.fullName}`,
        message: `تم رصد درجة مادة ${subject} (${total}/100 - ${getAcademicRating(total)}) في ${term}.`,
        notifType: 'grade',
        isRead: false,
        createdAt: serverTimestamp(),
      });

      await batch.commit();
      setShowAddGrade(false);
      setTeacherNote('');
      onNotify(`تم حفظ تقييم مادة ${subject} وإرسال إشعار لولي الأمر.`);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `grades/${gradeId}`);
    }
  };

  const activeBehaviorStudent =
    students.find((s) => s.id === behaviorStudentId) || students[0] || null;
  const activeBehaviorCurrentScore =
    typeof activeBehaviorStudent?.behaviorScore === 'number'
      ? activeBehaviorStudent.behaviorScore
      : 100;

  const avgBehaviorScore = useMemo(() => {
    if (students.length === 0) return 100;
    const sum = students.reduce(
      (acc, s) => acc + (typeof s.behaviorScore === 'number' ? s.behaviorScore : 100),
      0,
    );
    return Math.round(sum / students.length);
  }, [students]);

  const sortedDeductions = useMemo(
    () =>
      [...behaviorDeductions].sort((a, b) => {
        const ta = a.createdAt?.toMillis?.() ?? 0;
        const tb = b.createdAt?.toMillis?.() ?? 0;
        return tb - ta;
      }),
    [behaviorDeductions],
  );

  const handleDeductBehavior = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staffCanDeduct || !activeBehaviorStudent) return;

    const currentScore =
      typeof activeBehaviorStudent.behaviorScore === 'number'
        ? activeBehaviorStudent.behaviorScore
        : 100;
    if (currentScore <= 0) {
      onNotify('وصلت درجة سلوك هذا الطالب إلى الحد الأدنى (0)، ولا يمكن التنقيص أكثر.');
      return;
    }

    const points = Math.floor(Number(behaviorPoints));
    if (!Number.isFinite(points) || points < 1) {
      onNotify('درجة السلوك تنقص فقط؛ يجب إدخال قيمة خصم لا تقل عن درجة واحدة.');
      return;
    }

    const clampedPoints = Math.min(points, currentScore);
    const newScore = currentScore - clampedPoints;
    const cleanReason = behaviorReason.trim();
    if (cleanReason.length < 2) {
      onNotify('يرجى كتابة سبب التنقيص من درجة السلوك.');
      return;
    }

    const staffRole: 'teacher' | 'admin' | 'supervisor' =
      activeEdition === 'teacher' || activeEdition === 'supervisor' ? activeEdition : 'admin';

    const dedId = `beh_${activeBehaviorStudent.id}_${Date.now()}`;
    const notifId = `notif_beh_${Date.now()}`;

    setDeductingBehavior(true);
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'students', activeBehaviorStudent.id), {
        behaviorScore: newScore,
        updatedAt: serverTimestamp(),
      });

      batch.set(doc(db, 'behaviorDeductions', dedId), {
        studentId: activeBehaviorStudent.id,
        studentName: activeBehaviorStudent.fullName,
        grade: activeBehaviorStudent.grade,
        parentUid: activeBehaviorStudent.parentUid,
        pointsDeducted: clampedPoints,
        previousScore: currentScore,
        newScore,
        reason: cleanReason.slice(0, 300),
        deductedByName: (userName || 'الكادر التعليمي').slice(0, 120),
        deductedByRole: staffRole,
        createdAt: serverTimestamp(),
      });

      batch.set(doc(db, 'notifications', notifId), {
        parentUid: activeBehaviorStudent.parentUid,
        title: `تنبيه خصم من درجة السلوك — ${activeBehaviorStudent.fullName}`.slice(0, 140),
        message: `تم تنقيص ${clampedPoints} درجات من درجة السلوك (${currentScore} ← ${newScore}/100) بسبب: ${cleanReason} (بواسطة ${ROLE_LABELS_AR[staffRole]}).`.slice(
          0,
          500,
        ),
        notifType: 'behavior',
        isRead: false,
        createdAt: serverTimestamp(),
      });

      await batch.commit();
      setBehaviorReason('');
      setBehaviorPoints(2);
      onNotify(
        `تم تنقيص ${clampedPoints} درجات من سلوك ${activeBehaviorStudent.fullName} (${newScore}/100) وإرسال إشعار فوري لولي الأمر.`,
      );
      if (onTriggerBehaviorEmailWarning) {
        onTriggerBehaviorEmailWarning({
          id: dedId,
          studentId: activeBehaviorStudent.id,
          studentName: activeBehaviorStudent.fullName,
          grade: activeBehaviorStudent.grade,
          parentUid: activeBehaviorStudent.parentUid,
          pointsDeducted: clampedPoints,
          previousScore: currentScore,
          newScore,
          reason: cleanReason.slice(0, 300),
          deductedByName: (userName || 'الكادر التعليمي').slice(0, 120),
          deductedByRole: staffRole,
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `behaviorDeductions/${dedId}`);
    } finally {
      setDeductingBehavior(false);
    }
  };

  const handleExportReportText = () => {
    if (!activeReportStudent) return;
    const lines = [
      `التقرير الأكاديمي الدوري الشامل — منصة مدارك`,
      `الطالب: ${activeReportStudent.fullName} (${activeReportStudent.studentCode})`,
      `الصف: ${activeReportStudent.grade} — الشعبة ${activeReportStudent.section}`,
      `ولي الأمر: ${activeReportStudent.parentName}`,
      `نسبة الحضور: ${activeReportStudent.attendanceRate}%`,
      `----------------------------------------`,
      `المواد والدرجات:`,
      ...studentGrades.map(
        (g) =>
          `- ${g.subject}: المجموع ${g.totalScore}/100 (${getAcademicRating(g.totalScore)}) | نصفي: ${g.midtermScore} | أعمال: ${g.courseworkScore} | نهائي: ${g.finalScore}`,
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `report-${activeReportStudent.studentCode}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExportGradesCsv = () => {
    const rows = grades.map((g) => [
      g.studentName,
      g.grade,
      g.term,
      g.subject,
      g.midtermScore,
      g.courseworkScore,
      g.finalScore,
      g.totalScore,
      getAcademicRating(g.totalScore),
      g.teacherNote || '',
    ]);
    downloadCsv(
      `grades-sheet-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        'اسم الطالب',
        'الصف الدراسي',
        'الفصل',
        'المادة الدراسية',
        'اختبار نصفي (30)',
        'أعمال السنة (30)',
        'الاختبار النهائي (40)',
        'المجموع (100)',
        'التقدير',
        'تقييم المعلم',
      ],
      rows,
    );
    onNotify('تم تصدير كشف الدرجات إلى ملف CSV بنجاح.');
  };

  const handleDownloadStudentAnnualPdf = async (student: Student, year = annualYear) => {
    setGeneratingPdfId(student.id);
    try {
      const summary = buildAnnualStudentSummary(year, student, grades, attendance);
      await generateAnnualStudentPdf(summary, userName);
      onNotify(
        `تم توليد وتحميل التقرير السنوي (PDF) للطالب ${student.fullName} لعام ${year}.`,
      );
    } catch {
      onNotify('تعذر إنشاء ملف PDF السنوي، يرجى المحاولة مرة أخرى.');
    } finally {
      setGeneratingPdfId(null);
    }
  };

  const handleDownloadAllAnnualPdf = async () => {
    if (annualSummaries.length === 0) return;
    setGeneratingPdfId('all');
    try {
      await generateAllStudentsAnnualPdf(annualSummaries, annualYear, userName);
      onNotify(
        `تم توليد وتحميل ملف PDF السنوي المجمّع لعدد ${annualSummaries.length} طلاب (عام ${annualYear}).`,
      );
    } catch {
      onNotify('تعذر إنشاء ملف PDF المجمّع، يرجى المحاولة مرة أخرى.');
    } finally {
      setGeneratingPdfId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Sub-navigation */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white border border-slate-200 rounded-xl p-5 no-print">
        <div>
          <h2 className="text-lg font-bold font-display text-slate-900">
            إدارة الدرجات والتقارير الأكاديمية الدورية والسنوية
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            لوحة تفصيلية لرصد التقييمات وإصدار تقارير الأداء الشاملة والسنوية بصيغة PDF لكل طالب
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {canViewAcademicGrades && (
              <button
                type="button"
                onClick={() => setSubTab('gradebook')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  effectiveSubTab === 'gradebook'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                سجل الدرجات التفصيلي
              </button>
            )}
            <button
              type="button"
              onClick={() => setSubTab('behavior')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                effectiveSubTab === 'behavior'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              درجة السلوك
            </button>
            {canViewAcademicGrades && (
              <>
                <button
                  type="button"
                  onClick={() => setSubTab('reports')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    effectiveSubTab === 'reports'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  التقارير الدورية الشاملة
                </button>
                <button
                  type="button"
                  onClick={() => setSubTab('annual')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    effectiveSubTab === 'annual'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  التقارير السنوية (PDF)
                </button>
              </>
            )}
          </div>

          {effectiveSubTab === 'gradebook' && canViewAcademicGrades && (
            <>
              <button
                type="button"
                onClick={handleExportGradesCsv}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 text-slate-800 text-xs font-medium rounded-lg hover:bg-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>تصدير CSV</span>
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>طباعة الكشف</span>
              </button>
            </>
          )}

          {effectiveSubTab === 'behavior' && (
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>طباعة سجل السلوك</span>
            </button>
          )}

          {canPublishGrades && effectiveSubTab === 'gradebook' && canViewAcademicGrades && (
            <button
              type="button"
              onClick={() => setShowAddGrade((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>رصد درجة جديدة</span>
            </button>
          )}
        </div>
      </div>

      {effectiveSubTab === 'gradebook' && canViewAcademicGrades && (
        <>
          <PrintHeader
            title="كشف الدرجات والتقييمات الدراسية"
            subtitle="السجل الرسمي للدرجات التفصيلية (الاختبار النصفي، أعمال السنة، الاختبار النهائي)"
            documentCode="GRD-BOOK-2026"
            metadata={[
              { label: 'إجمالي التقييمات', value: grades.length },
              { label: 'عدد الطلاب', value: students.length },
              { label: 'المُعد', value: userName || 'الكادر التعليمي' },
            ]}
          />
          {showAddGrade && canPublishGrades && (
            <form
              onSubmit={handleCreateGrade}
              className="bg-white border border-slate-200 rounded-xl p-6 grid grid-cols-1 md:grid-cols-3 gap-4 no-print"
            >
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">الطالب</label>
                <select
                  value={formStudentId || students[0]?.id}
                  onChange={(e) => setFormStudentId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.fullName} ({s.grade})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">المادة الدراسية</label>
                <input
                  type="text"
                  required
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">الفترة / الفصل</label>
                <input
                  type="text"
                  required
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  اختبار نصفي (من 30)
                </label>
                <input
                  type="number"
                  min={0}
                  max={30}
                  value={midtermScore}
                  onChange={(e) => setMidtermScore(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  أعمال السنة والمشاركة (من 30)
                </label>
                <input
                  type="number"
                  min={0}
                  max={30}
                  value={courseworkScore}
                  onChange={(e) => setCourseworkScore(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  الاختبار النهائي (من 40)
                </label>
                <input
                  type="number"
                  min={0}
                  max={40}
                  value={finalScore}
                  onChange={(e) => setFinalScore(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">ملاحظة المعلم</label>
                <input
                  type="text"
                  value={teacherNote}
                  onChange={(e) => setTeacherNote(e.target.value)}
                  placeholder="توجيه أكاديمي أو إشادة بمستوى الطالب..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex items-end gap-2">
                <button
                  type="submit"
                  className="px-4 py-2 bg-teal-700 text-white text-sm font-medium rounded-lg hover:bg-teal-800 cursor-pointer"
                >
                  اعتماد الدرجة
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddGrade(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-200 cursor-pointer"
                >
                  إلغاء
                </button>
              </div>
            </form>
          )}

          {/* Detailed Grades Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                  <tr>
                    <th className="py-3 px-4 font-semibold">الطالب</th>
                    <th className="py-3 px-4 font-semibold">المادة</th>
                    <th className="py-3 px-4 font-semibold">نصفي (30)</th>
                    <th className="py-3 px-4 font-semibold">أعمال السنة (30)</th>
                    <th className="py-3 px-4 font-semibold">نهائي (40)</th>
                    <th className="py-3 px-4 font-semibold">المجموع (100)</th>
                    <th className="py-3 px-4 font-semibold">التقدير</th>
                    <th className="py-3 px-4 font-semibold">تقييم المعلم</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {grades.map((g) => (
                    <tr key={g.id} className="hover:bg-slate-50/70">
                      <td className="py-3.5 px-4">
                        {onSelectStudent ? (
                          <button
                            type="button"
                            onClick={() => onSelectStudent(g.studentId)}
                            className="font-semibold text-slate-900 hover:text-teal-700 hover:underline cursor-pointer text-right"
                          >
                            {g.studentName}
                          </button>
                        ) : (
                          <p className="font-semibold text-slate-900">{g.studentName}</p>
                        )}
                        <p className="text-xs text-slate-500">
                          {g.grade} · {g.term}
                        </p>
                      </td>
                      <td className="py-3.5 px-4 font-medium text-slate-800">{g.subject}</td>
                      <td className="py-3.5 px-4 font-mono-num text-slate-700">{g.midtermScore}</td>
                      <td className="py-3.5 px-4 font-mono-num text-slate-700">
                        {g.courseworkScore}
                      </td>
                      <td className="py-3.5 px-4 font-mono-num text-slate-700">{g.finalScore}</td>
                      <td className="py-3.5 px-4 font-mono-num font-bold text-slate-900">
                        {g.totalScore}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`text-xs font-semibold ${
                            g.totalScore >= 85
                              ? 'text-emerald-700'
                              : g.totalScore >= 70
                                ? 'text-amber-700'
                                : 'text-red-700'
                          }`}
                        >
                          {getAcademicRating(g.totalScore)}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-xs text-slate-600 max-w-xs">
                        {g.teacherNote || '—'}
                      </td>
                    </tr>
                  ))}
                  {grades.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-10 text-center text-sm text-slate-500">
                        لا توجد تقييمات مسجلة حالياً.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <PrintFooter
            preparedBy={userName || 'الكادر التعليمي'}
            approverTitle="اعتماد قسم الشؤون الأكاديمية"
          />
        </>
      )}

      {/* Behavior Score Tab (Decrease-Only by Teachers, Admins, Supervisors + Instant Parent Alert) */}
      {effectiveSubTab === 'behavior' && (
        <div className="space-y-6">
          <PrintHeader
            title="سجل درجات السلوك والانضباط المدرسي"
            subtitle="تقرير رسمي بدرجات السلوك (من 100 نقطة) وسجل التنقيصات المسجلة"
            documentCode="BHV-LOG-2026"
            metadata={[
              { label: 'عدد الطلاب', value: students.length },
              { label: 'متوسط السلوك', value: `${avgBehaviorScore} / 100` },
              { label: 'حالات التنقيص', value: sortedDeductions.length },
            ]}
          />
          {/* Policy & KPI Strip */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 print-compact-grid print-avoid-break">
            <div className="md:col-span-2 bg-white border border-slate-200 rounded-xl p-5 space-y-1.5">
              <h3 className="text-sm font-bold font-display text-slate-900 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0" />
                <span>ضوابط درجة السلوك والانضباط</span>
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                تبدأ درجة السلوك من <span className="font-mono-num font-bold">100</span> نقطة، وهي{' '}
                <span className="font-semibold text-slate-900">تنقص فقط ولا تزداد</span>. يقتصر حق
                التنقيص على المدرسين والمدراء والمراقبين فقط، ويُرسل إشعار فوري لولي الأمر عند كل
                عملية تنقيص.
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs text-slate-500">متوسط درجة السلوك</p>
              <p className="text-2xl font-bold font-mono-num text-teal-700 mt-1">
                {avgBehaviorScore} / 100
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs text-slate-500">إجمالي حالات التنقيص المسجلة</p>
              <p className="text-2xl font-bold font-mono-num text-amber-700 mt-1">
                {sortedDeductions.length}
              </p>
            </div>
          </div>

          {/* Deduction Form (Strictly Teachers, Admins, Supervisors only) */}
          {staffCanDeduct && activeBehaviorStudent && (
            <form
              onSubmit={handleDeductBehavior}
              className="bg-white border border-slate-200 rounded-xl p-6 space-y-5 no-print"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-4">
                <div>
                  <h3 className="text-base font-bold font-display text-slate-900">
                    تنقيص من درجة السلوك (خصم نقاط)
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    يتم خصم الدرجات بشكل فوري مع توثيق السبب وإشعار ولي الأمر عبر التطبيق
                  </p>
                </div>
                <div className="text-xs text-slate-600 font-mono-num">
                  الدرجة الحالية: <span className="font-bold text-slate-900">{activeBehaviorCurrentScore}</span>{' '}
                  ← بعد التنقيص:{' '}
                  <span className="font-bold text-red-700">
                    {Math.max(
                      0,
                      activeBehaviorCurrentScore - Math.max(0, Math.floor(Number(behaviorPoints) || 0)),
                    )}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">الطالب</label>
                  <select
                    value={activeBehaviorStudent.id}
                    onChange={(e) => setBehaviorStudentId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    {students.map((s) => {
                      const sc = typeof s.behaviorScore === 'number' ? s.behaviorScore : 100;
                      return (
                        <option key={s.id} value={s.id}>
                          {s.fullName} — سلوك: {sc}/100
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    عدد الدرجات المراد تنقيصها (تنقص فقط)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={Math.max(1, activeBehaviorCurrentScore)}
                      required
                      disabled={activeBehaviorCurrentScore <= 0}
                      value={behaviorPoints}
                      onChange={(e) => setBehaviorPoints(Math.max(1, Number(e.target.value)))}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num"
                    />
                    {[2, 5, 10].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        disabled={activeBehaviorCurrentScore < preset}
                        onClick={() => setBehaviorPoints(preset)}
                        className={`px-2.5 py-2 text-xs font-mono-num font-semibold rounded-lg border whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40 ${
                          behaviorPoints === preset
                            ? 'bg-amber-700 border-amber-700 text-white'
                            : 'bg-slate-50 border-slate-300 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        -{preset}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    سبب التنقيص (يظهر في إشعار ولي الأمر)
                  </label>
                  <input
                    type="text"
                    required
                    minLength={2}
                    maxLength={300}
                    value={behaviorReason}
                    onChange={(e) => setBehaviorReason(e.target.value)}
                    placeholder="اذكر المخالفة السلوكية أو الملاحظة..."
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-500">أسباب سريعة:</span>
                  {BEHAVIOR_REASON_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setBehaviorReason(preset)}
                      className="px-2.5 py-1 text-xs bg-slate-100 text-slate-700 rounded-md hover:bg-slate-200 cursor-pointer"
                    >
                      {preset}
                    </button>
                  ))}
                </div>

                <button
                  type="submit"
                  disabled={deductingBehavior || activeBehaviorCurrentScore <= 0}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-red-700 text-white text-xs font-semibold rounded-lg hover:bg-red-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                >
                  <MinusCircle className="w-4 h-4" />
                  <span>
                    {deductingBehavior
                      ? 'جاري التنقيص وإرسال الإشعار...'
                      : 'تأكيد التنقيص وإشعار ولي الأمر'}
                  </span>
                </button>
              </div>
            </form>
          )}

          {/* Students Current Behavior Scores Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-bold font-display text-slate-900">
                سجل درجات السلوك الحالية للطلاب
              </h3>
              <span className="text-xs text-slate-500 font-mono-num">{students.length} طلاب</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                  <tr>
                    <th className="py-3 px-4 font-semibold">الطالب</th>
                    <th className="py-3 px-4 font-semibold">الصف والشعبة</th>
                    <th className="py-3 px-4 font-semibold">درجة السلوك (من 100)</th>
                    <th className="py-3 px-4 font-semibold">عدد الخصومات</th>
                    <th className="py-3 px-4 font-semibold">التقييم السلوكي</th>
                    {staffCanDeduct && <th className="py-3 px-4 font-semibold no-print">إجراء سريع</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {students.map((stu) => {
                    const score = typeof stu.behaviorScore === 'number' ? stu.behaviorScore : 100;
                    const stuDeductionCount = sortedDeductions.filter(
                      (d) => d.studentId === stu.id,
                    ).length;
                    return (
                      <tr key={stu.id} className="hover:bg-slate-50/70">
                        <td className="py-3.5 px-4">
                          {onSelectStudent ? (
                            <button
                              type="button"
                              onClick={() => onSelectStudent(stu.id)}
                              className="font-semibold text-slate-900 hover:text-teal-700 hover:underline cursor-pointer text-right"
                            >
                              {stu.fullName}
                            </button>
                          ) : (
                            <p className="font-semibold text-slate-900">{stu.fullName}</p>
                          )}
                          <p className="text-xs text-slate-500 font-mono-num">{stu.studentCode}</p>
                        </td>
                        <td className="py-3.5 px-4 text-slate-700">
                          {stu.grade} — {stu.section}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-3">
                            <span
                              className={`font-mono-num font-bold text-base ${
                                score >= 90
                                  ? 'text-emerald-700'
                                  : score >= 75
                                    ? 'text-amber-700'
                                    : 'text-red-700'
                              }`}
                            >
                              {score} / 100
                            </span>
                            <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden hidden sm:block">
                              <div
                                className={`h-full ${
                                  score >= 90
                                    ? 'bg-emerald-600'
                                    : score >= 75
                                      ? 'bg-amber-500'
                                      : 'bg-red-600'
                                }`}
                                style={{ width: `${score}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 font-mono-num text-slate-700">
                          {stuDeductionCount}
                        </td>
                        <td className="py-3.5 px-4 text-xs font-semibold">
                          <span
                            className={
                              score >= 90
                                ? 'text-emerald-700'
                                : score >= 75
                                  ? 'text-amber-700'
                                  : 'text-red-700'
                            }
                          >
                            {score >= 90 ? 'سلوك متميز' : score >= 75 ? 'يحتاج متابعة' : 'إنذار سلوكي'}
                          </span>
                        </td>
                        {staffCanDeduct && (
                          <td className="py-3.5 px-4 no-print">
                            <button
                              type="button"
                              disabled={score <= 0}
                              onClick={() => {
                                setBehaviorStudentId(stu.id);
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                              }}
                              className="px-3 py-1.5 text-xs font-medium bg-slate-100 text-slate-800 rounded-lg hover:bg-slate-200 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40"
                            >
                              تنقيص درجة
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Behavior Deductions Audit Log */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-bold font-display text-slate-900">
                سجل عمليات التنقيص من درجة السلوك
              </h3>
              <span className="text-xs text-slate-500 font-mono-num">
                {sortedDeductions.length} سجلات
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                  <tr>
                    <th className="py-3 px-4 font-semibold">الطالب</th>
                    <th className="py-3 px-4 font-semibold">الدرجات المنقوصة</th>
                    <th className="py-3 px-4 font-semibold">التغير في الدرجة</th>
                    <th className="py-3 px-4 font-semibold">السبب</th>
                    <th className="py-3 px-4 font-semibold">تم التنقيص بواسطة</th>
                    <th className="py-3 px-4 font-semibold">إشعار ولي الأمر</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedDeductions.map((ded) => (
                    <tr key={ded.id} className="hover:bg-slate-50/70">
                      <td className="py-3.5 px-4">
                        {onSelectStudent ? (
                          <button
                            type="button"
                            onClick={() => onSelectStudent(ded.studentId)}
                            className="font-semibold text-slate-900 hover:text-teal-700 hover:underline cursor-pointer text-right"
                          >
                            {ded.studentName}
                          </button>
                        ) : (
                          <p className="font-semibold text-slate-900">{ded.studentName}</p>
                        )}
                        <p className="text-xs text-slate-500">{ded.grade}</p>
                      </td>
                      <td className="py-3.5 px-4 font-mono-num font-bold text-red-700">
                        -{ded.pointsDeducted}
                      </td>
                      <td className="py-3.5 px-4 font-mono-num text-slate-800">
                        {ded.previousScore} ← {ded.newScore} / 100
                      </td>
                      <td className="py-3.5 px-4 text-xs text-slate-700 max-w-xs">{ded.reason}</td>
                      <td className="py-3.5 px-4 text-xs text-slate-700">
                        {ded.deductedByName} ({ROLE_LABELS_AR[ded.deductedByRole]})
                      </td>
                      <td className="py-3.5 px-4 text-xs font-medium text-teal-700">
                        تم إرسال الإشعار
                      </td>
                    </tr>
                  ))}
                  {sortedDeductions.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-sm text-slate-500">
                        لم يتم تسجيل أي خصومات سلوكية؛ جميع الطلاب بدرجة السلوك الكاملة (100/100).
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <PrintFooter
            preparedBy={userName || 'لجنة الانضباط المدرسي'}
            approverTitle="اعتماد المرشد التربوي والإدارة"
          />
        </div>
      )}

      {/* Comprehensive Periodic Report View (Req 7) */}
      {effectiveSubTab === 'reports' && canViewAcademicGrades && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4 no-print">
            <div className="flex items-center gap-3">
              <FileText className="w-5 h-5 text-teal-700" />
              <select
                value={activeReportStudent?.id || ''}
                onChange={(e) => setSelectedStudentId(e.target.value)}
                className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.fullName} — {s.grade}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleExportReportText}
                disabled={!activeReportStudent}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 text-slate-800 text-xs font-medium rounded-lg hover:bg-slate-200 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                <span>تصدير التقرير</span>
              </button>
              <button
                type="button"
                onClick={() => activeReportStudent && handleDownloadStudentAnnualPdf(activeReportStudent)}
                disabled={!activeReportStudent || generatingPdfId !== null}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                <FileDown className="w-4 h-4" />
                <span>
                  {generatingPdfId === activeReportStudent?.id
                    ? 'جاري توليد PDF...'
                    : 'تحميل PDF السنوي'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                disabled={!activeReportStudent}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                <Printer className="w-4 h-4" />
                <span>طباعة التقرير الدوري</span>
              </button>
              {activeEdition !== 'parent' && onTriggerMonthlyGmailReports && (
                <button
                  type="button"
                  onClick={onTriggerMonthlyGmailReports}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-800 text-white text-xs font-medium rounded-lg hover:bg-slate-900 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Mail className="w-4 h-4" />
                  <span>إرسال التقارير الشهرية عبر Gmail</span>
                </button>
              )}
            </div>
          </div>

          {activeReportStudent ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 space-y-6">
              <PrintHeader
                title="التقرير الأكاديمي الدوري الشامل للطالب"
                subtitle={`${activeReportStudent.grade} (الشعبة ${activeReportStudent.section}) — ولي الأمر: ${activeReportStudent.parentName}`}
                documentCode={activeReportStudent.studentCode}
              />
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-6 print-avoid-break">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-teal-700">
                    منصة مدارك · الشؤون الأكاديمية والتقارير الدورية
                  </p>
                  <h3 className="text-xl font-bold font-display text-slate-900">
                    {activeReportStudent.fullName}
                  </h3>
                  <p className="text-xs text-slate-500">
                    الرقم الأكاديمي:{' '}
                    <span className="font-mono-num">{activeReportStudent.studentCode}</span> ·{' '}
                    {activeReportStudent.grade} (الشعبة {activeReportStudent.section}) · ولي الأمر:{' '}
                    {activeReportStudent.parentName}
                  </p>
                </div>

                <div className="flex items-center gap-6">
                  <div>
                    <p className="text-xs text-slate-500">المعدل العام</p>
                    <p className="text-2xl font-bold font-mono-num text-teal-700">
                      {studentGrades.length > 0
                        ? (
                            studentGrades.reduce((a, b) => a + b.totalScore, 0) /
                            studentGrades.length
                          ).toFixed(1)
                        : activeReportStudent.gpa}
                      %
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">الانتظام والحضور</p>
                    <p className="text-2xl font-bold font-mono-num text-slate-900">
                      {activeReportStudent.attendanceRate}%
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">درجة السلوك</p>
                    <p className="text-2xl font-bold font-mono-num text-amber-700">
                      {activeReportStudent.behaviorScore ?? 100}/100
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-sm font-bold font-display text-slate-900">
                  ملخص التحصيل الدراسي والإنجازات حسب المادة
                </h4>
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                  {studentGrades.map((g) => (
                    <div
                      key={g.id}
                      className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-slate-900">{g.subject}</p>
                        <p className="text-xs text-slate-600">{g.teacherNote || 'أداء منتظم'}</p>
                      </div>
                      <div className="flex items-center gap-6 shrink-0">
                        <div className="text-xs text-slate-500 font-mono-num">
                          نصفي {g.midtermScore} · أعمال {g.courseworkScore} · نهائي {g.finalScore}
                        </div>
                        <div className="text-left">
                          <span className="text-base font-bold font-mono-num text-slate-900">
                            {g.totalScore}/100
                          </span>
                          <span className="block text-xs font-medium text-teal-700">
                            {getAcademicRating(g.totalScore)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                  {studentGrades.length === 0 && (
                    <p className="p-6 text-sm text-slate-500 text-center">
                      لا توجد درجات مرصودة لهذا الطالب حتى الآن.
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-bold font-display text-slate-900">سجل الانضباط الأخير</h4>
                <p className="text-xs text-slate-600">
                  إجمالي السجلات المرصودة: {studentAttendance.length} · أيام الحضور:{' '}
                  {studentAttendance.filter((a) => a.status === 'present').length} · أيام الغياب:{' '}
                  {studentAttendance.filter((a) => a.status === 'absent').length}
                </p>
              </div>

              <PrintFooter
                preparedBy={userName || 'الشؤون الأكاديمية'}
                approverTitle="اعتماد مدير المدرسة"
              />
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">
              يرجى إضافة طالب أولاً لعرض التقرير الأكاديمي الشامل.
            </div>
          )}
        </div>
      )}

      {/* Annual Student Performance PDF Reports (Grades + Attendance Logs) */}
      {effectiveSubTab === 'annual' && canViewAcademicGrades && (
        <div className="space-y-6">
          {/* Controls & Actions Bar */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col lg:flex-row lg:items-end justify-between gap-4 no-print">
            <div className="flex flex-wrap items-center gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  السنة الأكاديمية
                </label>
                <select
                  value={annualYear}
                  onChange={(e) => setAnnualYear(e.target.value)}
                  className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white font-mono-num"
                >
                  {availableYears.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">الصف الدراسي</label>
                <select
                  value={annualGradeFilter}
                  onChange={(e) => setAnnualGradeFilter(e.target.value)}
                  className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="all">جميع الصفوف الدراسية</option>
                  {gradesList.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  معاينة تقرير الطالب
                </label>
                <select
                  value={activeAnnualStudent?.id || ''}
                  onChange={(e) => setSelectedStudentId(e.target.value)}
                  className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white min-w-[220px]"
                >
                  {annualFilteredStudents.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.fullName} — {s.grade}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {annualSummaries.length > 1 && (
                <button
                  type="button"
                  disabled={generatingPdfId !== null}
                  onClick={handleDownloadAllAnnualPdf}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-100 text-slate-800 text-xs font-medium rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
                >
                  <FileDown className="w-4 h-4" />
                  <span>
                    {generatingPdfId === 'all'
                      ? 'جاري تجهيز الملف الشامل...'
                      : `تحميل PDF مجمّع (${annualSummaries.length} طلاب)`}
                  </span>
                </button>
              )}

              <button
                type="button"
                disabled={!activeAnnualStudent || generatingPdfId !== null}
                onClick={() =>
                  activeAnnualStudent && handleDownloadStudentAnnualPdf(activeAnnualStudent)
                }
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
              >
                <FileDown className="w-4 h-4" />
                <span>
                  {generatingPdfId === activeAnnualStudent?.id
                    ? 'جاري توليد ملف PDF...'
                    : 'تحميل تقرير PDF السنوي للطالب'}
                </span>
              </button>
            </div>
          </div>

          {/* All Students Annual Roster Table with Per-Student PDF Action */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden no-print">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold font-display text-slate-900">
                  كشف التقارير السنوية للطلاب — العام الدراسي{' '}
                  <span className="font-mono-num">{annualYear}</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  اختر طالباً للمعاينة أو حمّل تقريره السنوي المتكامل (الدرجات التراكمية وسجل الحضور)
                  مباشرة بصيغة PDF
                </p>
              </div>
              <span className="text-xs text-slate-500 font-mono-num">
                {annualSummaries.length} طلاب
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                  <tr>
                    <th className="py-3 px-4 font-semibold">الطالب</th>
                    <th className="py-3 px-4 font-semibold">الصف والشعبة</th>
                    <th className="py-3 px-4 font-semibold">المواد المقيمة</th>
                    <th className="py-3 px-4 font-semibold">المعدل التراكمي</th>
                    <th className="py-3 px-4 font-semibold">الحضور السنوي</th>
                    <th className="py-3 px-4 font-semibold">إجراء PDF</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {annualSummaries.map((item) => {
                    const isSelected = activeAnnualStudent?.id === item.student.id;
                    return (
                      <tr
                        key={item.student.id}
                        className={`transition-colors ${
                          isSelected ? 'bg-teal-50/40' : 'hover:bg-slate-50/70'
                        }`}
                      >
                        <td className="py-3.5 px-4">
                          <button
                            type="button"
                            onClick={() => {
                              if (onSelectStudent) {
                                onSelectStudent(item.student.id);
                              } else {
                                setSelectedStudentId(item.student.id);
                              }
                            }}
                            className="text-right cursor-pointer group"
                          >
                            <p className="font-semibold text-slate-900 group-hover:text-teal-700 group-hover:underline">
                              {item.student.fullName}
                            </p>
                            <p className="text-xs text-slate-500 font-mono-num">
                              {item.student.studentCode}
                            </p>
                          </button>
                        </td>
                        <td className="py-3.5 px-4 text-slate-700">
                          {item.student.grade} — {item.student.section}
                        </td>
                        <td className="py-3.5 px-4 font-mono-num text-slate-700">
                          {item.totalSubjects}
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="font-mono-num font-bold text-teal-700">
                            {item.cumulativeGpa}%
                          </span>
                          <span className="text-xs text-slate-500 mr-2">
                            ({item.cumulativeRating})
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`font-mono-num font-bold ${
                              item.annualAttendanceRate >= 90
                                ? 'text-emerald-700'
                                : item.annualAttendanceRate >= 75
                                  ? 'text-amber-700'
                                  : 'text-red-700'
                            }`}
                          >
                            {item.annualAttendanceRate}%
                          </span>
                          <span className="text-xs text-slate-500 font-mono-num mr-2">
                            ({item.presentCount} حضور · {item.absentCount} غياب)
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setSelectedStudentId(item.student.id)}
                              className={`px-2.5 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 cursor-pointer ${
                                isSelected
                                  ? 'bg-slate-900 text-white'
                                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                              }`}
                            >
                              معاينة
                            </button>
                            <button
                              type="button"
                              disabled={generatingPdfId !== null}
                              onClick={() => handleDownloadStudentAnnualPdf(item.student)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                            >
                              <FileDown className="w-3.5 h-3.5" />
                              <span>
                                {generatingPdfId === item.student.id
                                  ? 'جاري التوليد...'
                                  : 'تحميل PDF'}
                              </span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {annualSummaries.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-sm text-slate-500">
                        لا توجد بيانات طلاب ضمن الفئة المحددة.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Live Printable Preview of Selected Student's Annual Report */}
          {activeAnnualSummary && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 lg:p-8 space-y-6">
              <PrintHeader
                title={`التقرير الأكاديمي السنوي الشامل — ${activeAnnualSummary.academicYearLabel}`}
                subtitle={`${activeAnnualSummary.student.fullName} — ${activeAnnualSummary.student.grade} (${activeAnnualSummary.student.section})`}
                documentCode={activeAnnualSummary.student.studentCode}
              />
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5 print-avoid-break">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-teal-700">
                    معاينة التقرير السنوي الرسمي · {activeAnnualSummary.academicYearLabel}
                  </p>
                  <h3 className="text-xl font-bold font-display text-slate-900">
                    {activeAnnualSummary.student.fullName}
                  </h3>
                  <p className="text-xs text-slate-500">
                    الرقم الأكاديمي:{' '}
                    <span className="font-mono-num">{activeAnnualSummary.student.studentCode}</span>{' '}
                    · {activeAnnualSummary.student.grade} (الشعبة{' '}
                    {activeAnnualSummary.student.section}) · ولي الأمر:{' '}
                    {activeAnnualSummary.student.parentName}
                  </p>
                </div>

                <div className="flex items-center gap-2 no-print">
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 text-slate-800 text-xs font-medium rounded-lg hover:bg-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Printer className="w-4 h-4" />
                    <span>طباعة المعاينة</span>
                  </button>
                </div>
              </div>

              {/* 4 KPI Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 print-compact-grid print-avoid-break">
                <div className="border border-slate-200 rounded-lg p-4">
                  <p className="text-xs text-slate-500">المعدل التراكمي</p>
                  <p className="text-2xl font-bold font-mono-num text-teal-700 mt-1">
                    {activeAnnualSummary.cumulativeGpa}%
                  </p>
                  <p className="text-xs font-medium text-slate-600 mt-0.5">
                    التقدير: {activeAnnualSummary.cumulativeRating}
                  </p>
                </div>
                <div className="border border-slate-200 rounded-lg p-4">
                  <p className="text-xs text-slate-500">نسبة الحضور السنوية</p>
                  <p className="text-2xl font-bold font-mono-num text-emerald-700 mt-1">
                    {activeAnnualSummary.annualAttendanceRate}%
                  </p>
                  <p className="text-xs text-slate-500 font-mono-num mt-0.5">
                    {activeAnnualSummary.totalAttendanceLogs} سجل يومي
                  </p>
                </div>
                <div className="border border-slate-200 rounded-lg p-4">
                  <p className="text-xs text-slate-500">المواد المقيمة</p>
                  <p className="text-2xl font-bold font-mono-num text-slate-900 mt-1">
                    {activeAnnualSummary.totalSubjects}
                  </p>
                  <p className="text-xs text-slate-500 font-mono-num mt-0.5">
                    أعلى درجة: {activeAnnualSummary.highestScore ?? '—'}
                  </p>
                </div>
                <div className="border border-slate-200 rounded-lg p-4">
                  <p className="text-xs text-slate-500">حالات الغياب والتأخر</p>
                  <p className="text-2xl font-bold font-mono-num text-red-700 mt-1">
                    {activeAnnualSummary.absentCount} / {activeAnnualSummary.lateCount}
                  </p>
                  <p className="text-xs text-slate-500 font-mono-num mt-0.5">
                    بعذر: {activeAnnualSummary.excusedCount}
                  </p>
                </div>
              </div>

              {/* Section 1: Cumulative Grades */}
              <div className="space-y-3">
                <h4 className="text-sm font-bold font-display text-slate-900">
                  1. الدرجات التراكمية حسب المادة الدراسية
                </h4>
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
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
                      {activeAnnualSummary.studentGrades.map((g) => (
                        <tr key={g.id} className="hover:bg-slate-50/70">
                          <td className="py-3 px-4 font-semibold text-slate-900">{g.subject}</td>
                          <td className="py-3 px-4 text-slate-600 text-xs">{g.term}</td>
                          <td className="py-3 px-4 font-mono-num text-slate-700">
                            {g.midtermScore}
                          </td>
                          <td className="py-3 px-4 font-mono-num text-slate-700">
                            {g.courseworkScore}
                          </td>
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
                      {activeAnnualSummary.studentGrades.length === 0 && (
                        <tr>
                          <td colSpan={8} className="py-8 text-center text-sm text-slate-500">
                            لا توجد درجات تفصيلية مرصودة للطالب خلال {activeAnnualSummary.academicYearLabel}.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Section 2: Annual Attendance Records */}
              <div className="space-y-3">
                <h4 className="text-sm font-bold font-display text-slate-900">
                  2. سجلات الحضور والغياب لعام{' '}
                  <span className="font-mono-num">{activeAnnualSummary.academicYear}</span>
                </h4>
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-right text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                      <tr>
                        <th className="py-3 px-4 font-semibold">التاريخ</th>
                        <th className="py-3 px-4 font-semibold">الحالة</th>
                        <th className="py-3 px-4 font-semibold">وقت التسجيل</th>
                        <th className="py-3 px-4 font-semibold">إشعار ولي الأمر</th>
                        <th className="py-3 px-4 font-semibold">الملاحظات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {activeAnnualSummary.attendanceLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-slate-50/70">
                          <td className="py-3 px-4 font-mono-num text-slate-800">{log.date}</td>
                          <td className="py-3 px-4">
                            <span
                              className={`text-xs font-semibold ${
                                log.status === 'present'
                                  ? 'text-emerald-700'
                                  : log.status === 'absent'
                                    ? 'text-red-700'
                                    : log.status === 'late'
                                      ? 'text-amber-700'
                                      : 'text-slate-600'
                              }`}
                            >
                              {ATTENDANCE_STATUS_LABELS[log.status]}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-mono-num text-slate-600">
                            {log.checkInTime || '--:--'}
                          </td>
                          <td className="py-3 px-4 text-xs text-slate-600">
                            {log.parentNotified ? 'تم إشعار ولي الأمر' : 'بدون إشعار'}
                          </td>
                          <td className="py-3 px-4 text-xs text-slate-600">{log.notes || '—'}</td>
                        </tr>
                      ))}
                      {activeAnnualSummary.attendanceLogs.length === 0 && (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-sm text-slate-500">
                            لا توجد سجلات حضور يومية مرصودة لهذا الطالب خلال عام{' '}
                            {activeAnnualSummary.academicYear}.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <PrintFooter
                preparedBy={userName || 'إدارة الشؤون الأكاديمية'}
                approverTitle="اعتماد مدير المدرسة"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};
