import React, { useMemo, useState } from 'react';
import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import {
  BookOpen,
  Camera,
  CheckCircle2,
  Clock,
  FileDown,
  Layers,
  Printer,
  Sparkles,
  Users,
  XCircle,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { downloadCsv } from '../lib/csvExport';
import {
  mergeSchoolGrades,
  mergeSchoolSections,
  PERIOD_CATEGORY_PRESETS,
  SCHOOL_PERIODS,
  SCHOOL_SUBJECTS,
} from '../lib/grades';
import {
  CameraRegisterScannerModal,
  type ConfirmedAttendanceScanItem,
} from './CameraRegisterScannerModal';
import { PrintFooter, PrintHeader } from './PrintHeader';
import type { AttendanceRecord, AttendanceStatus, PeriodAttendanceRecord, Student } from '../types';

interface PeriodCategoriesTabProps {
  students: Student[];
  periodAttendance: PeriodAttendanceRecord[];
  selectedDate: string;
  onChangeDate: (date: string) => void;
  canMarkAttendance: boolean;
  userName: string;
  onAlertTriggered: (msg: string) => void;
  onTriggerAttendanceEmailWarning?: (record: AttendanceRecord) => void;
  onSelectStudent?: (studentId: string) => void;
}

const STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'حاضر',
  absent: 'غائب',
  late: 'متأخر',
  excused: 'مستأذن بعذر',
};

const DEFAULT_CATEGORY_BY_STATUS: Record<AttendanceStatus, string> = {
  present: 'منضبط',
  absent: 'غائب عن الحصة',
  late: 'متأخر عن الحصة',
  excused: 'مستأذن بعذر',
};

export const PeriodCategoriesTab: React.FC<PeriodCategoriesTabProps> = ({
  students,
  periodAttendance,
  selectedDate,
  onChangeDate,
  canMarkAttendance,
  userName,
  onAlertTriggered,
  onTriggerAttendanceEmailWarning,
  onSelectStudent,
}) => {
  const [selectedPeriodNumber, setSelectedPeriodNumber] = useState<number>(1);
  const [selectedSubject, setSelectedSubject] = useState<string>(SCHOOL_SUBJECTS[0]);
  const [gradeFilter, setGradeFilter] = useState<string>('all');
  const [sectionFilter, setSectionFilter] = useState<string>('all');
  const [bulkCategory, setBulkCategory] = useState<string>('منضبط');
  const [draftCategories, setDraftCategories] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showCameraAttendanceScan, setShowCameraAttendanceScan] = useState(false);

  const gradesList = useMemo(
    () => mergeSchoolGrades(students.map((s) => s.grade)),
    [students],
  );
  const sectionsList = useMemo(
    () => mergeSchoolSections(students.map((s) => s.section)),
    [students],
  );

  const activePeriod =
    SCHOOL_PERIODS.find((p) => p.number === selectedPeriodNumber) || SCHOOL_PERIODS[0];

  const filteredStudents = useMemo(
    () =>
      students.filter((s) => {
        const matchesGrade = gradeFilter === 'all' || s.grade === gradeFilter;
        const matchesSection = sectionFilter === 'all' || s.section === sectionFilter;
        return matchesGrade && matchesSection;
      }),
    [students, gradeFilter, sectionFilter],
  );

  const dayPeriodRecords = useMemo(
    () => periodAttendance.filter((rec) => rec.date === selectedDate),
    [periodAttendance, selectedDate],
  );

  const activePeriodRecords = useMemo(
    () => dayPeriodRecords.filter((rec) => rec.periodNumber === selectedPeriodNumber),
    [dayPeriodRecords, selectedPeriodNumber],
  );

  const getRecordForStudentPeriod = (studentId: string, periodNum = selectedPeriodNumber) =>
    dayPeriodRecords.find((r) => r.studentId === studentId && r.periodNumber === periodNum);

  const filteredPeriodRecords = useMemo(() => {
    const idSet = new Set(filteredStudents.map((s) => s.id));
    return activePeriodRecords.filter((r) => idSet.has(r.studentId));
  }, [activePeriodRecords, filteredStudents]);

  const presentPeriodCount = filteredPeriodRecords.filter((r) => r.status === 'present').length;
  const absentPeriodCount = filteredPeriodRecords.filter((r) => r.status === 'absent').length;
  const lateOrExcusedCount = filteredPeriodRecords.filter(
    (r) => r.status === 'late' || r.status === 'excused',
  ).length;

  // Group summary by Grade + Section + Period for today
  const classSectionSessionsSummary = useMemo(() => {
    const map = new Map<
      string,
      {
        grade: string;
        section: string;
        periodNumber: number;
        periodLabel: string;
        subject: string;
        present: number;
        absent: number;
        late: number;
        total: number;
      }
    >();

    for (const rec of dayPeriodRecords) {
      const key = `${rec.grade}__${rec.section}__${rec.periodNumber}`;
      const existing = map.get(key) || {
        grade: rec.grade,
        section: rec.section,
        periodNumber: rec.periodNumber,
        periodLabel: rec.periodLabel,
        subject: rec.subject,
        present: 0,
        absent: 0,
        late: 0,
        total: 0,
      };
      existing.total += 1;
      if (rec.status === 'present') existing.present += 1;
      else if (rec.status === 'absent') existing.absent += 1;
      else if (rec.status === 'late') existing.late += 1;
      map.set(key, existing);
    }

    return Array.from(map.values()).sort(
      (a, b) => a.periodNumber - b.periodNumber || a.grade.localeCompare(b.grade, 'ar'),
    );
  }, [dayPeriodRecords]);

  const handleRecordStudentPeriod = async (
    student: Student,
    status: AttendanceStatus,
    explicitCategory?: string,
  ) => {
    if (!canMarkAttendance) return;
    setBusyId(student.id);

    const recordId = `per_${selectedPeriodNumber}_${student.id}_${selectedDate}`;
    const existing = getRecordForStudentPeriod(student.id);
    const shouldNotifyParent = status === 'absent' || status === 'late';
    const resolvedCategory =
      explicitCategory ||
      (status === 'present'
        ? draftCategories[student.id] ||
          (existing?.status === 'present' ? existing.categoryLabel : bulkCategory)
        : DEFAULT_CATEGORY_BY_STATUS[status]);

    try {
      const batch = writeBatch(db);
      if (existing) {
        batch.update(doc(db, 'periodAttendance', recordId), {
          status,
          categoryLabel: resolvedCategory,
          subject: selectedSubject,
          recordedBy: userName || 'الكادر التعليمي',
          parentNotified: shouldNotifyParent ? true : existing.parentNotified,
          updatedAt: serverTimestamp(),
        });
      } else {
        batch.set(doc(db, 'periodAttendance', recordId), {
          studentId: student.id,
          studentName: student.fullName,
          grade: student.grade,
          section: student.section || 'أ',
          parentUid: student.parentUid,
          date: selectedDate,
          periodNumber: selectedPeriodNumber,
          periodLabel: activePeriod.label,
          subject: selectedSubject,
          status,
          categoryLabel: resolvedCategory,
          recordedBy: userName || 'الكادر التعليمي',
          parentNotified: shouldNotifyParent,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      const timeStr = new Date().toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
      });

      if (shouldNotifyParent) {
        const notifId = `notif_per_${selectedPeriodNumber}_${student.id}_${Date.now()}`;
        const title =
          status === 'absent'
            ? `إشعار غياب مبكر (${activePeriod.label}) — ${student.fullName}`
            : `تنبيه تأخر عن ${activePeriod.label} — ${student.fullName}`;
        const message =
          status === 'absent'
            ? `تنبيه لحظي الساعة ${timeStr}: تم تسجيل غياب الطالب ${student.fullName} (${student.grade} - الفئة ${student.section}) عن ${activePeriod.label} (${selectedSubject}) بتاريخ ${selectedDate}.`
            : `تأخر الطالب ${student.fullName} (${student.grade} - الفئة ${student.section}) عن ${activePeriod.label} (${selectedSubject}) بتاريخ ${selectedDate} الساعة ${timeStr}.`;

        batch.set(doc(db, 'notifications', notifId), {
          parentUid: student.parentUid,
          title: title.slice(0, 140),
          message: message.slice(0, 500),
          notifType: 'attendance',
          isRead: false,
          createdAt: serverTimestamp(),
        });
      }

      await batch.commit();
      setDraftCategories((prev) => ({ ...prev, [student.id]: resolvedCategory }));
      onAlertTriggered(
        status === 'absent'
          ? `إشعار غياب مبكر: تم إرسال تنبيه لحظي لولي أمر ${student.fullName} (${activePeriod.label})`
          : shouldNotifyParent
            ? `تم تسجيل (${STATUS_LABELS[status]} - ${resolvedCategory}) للطالب ${student.fullName} في ${activePeriod.label} وإشعار ولي الأمر.`
            : `تم تسجيل فئة الطالب ${student.fullName} (${resolvedCategory}) في ${activePeriod.label}.`,
      );
      if (status === 'absent' && onTriggerAttendanceEmailWarning) {
        onTriggerAttendanceEmailWarning({
          id: recordId,
          studentId: student.id,
          studentName: student.fullName,
          grade: student.grade,
          parentUid: student.parentUid,
          date: selectedDate,
          status: 'absent',
          checkInTime: timeStr,
          parentNotified: true,
          notes: `إشعار غياب مبكر (${activePeriod.label} — ${selectedSubject})`,
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `periodAttendance/${recordId}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleBulkRecordSectionPeriod = async () => {
    if (!canMarkAttendance) return;
    const unmarked = filteredStudents.filter((s) => !getRecordForStudentPeriod(s.id));
    if (unmarked.length === 0) {
      onAlertTriggered(
        `جميع طلاب الفئة المحددة مسجلون بالفعل في ${activePeriod.label} بتاريخ ${selectedDate}.`,
      );
      return;
    }

    setBusyId('bulk_period');
    try {
      const batch = writeBatch(db);
      for (const student of unmarked) {
        const recordId = `per_${selectedPeriodNumber}_${student.id}_${selectedDate}`;
        const category = draftCategories[student.id] || bulkCategory || 'منضبط';
        batch.set(doc(db, 'periodAttendance', recordId), {
          studentId: student.id,
          studentName: student.fullName,
          grade: student.grade,
          section: student.section || 'أ',
          parentUid: student.parentUid,
          date: selectedDate,
          periodNumber: selectedPeriodNumber,
          periodLabel: activePeriod.label,
          subject: selectedSubject,
          status: 'present',
          categoryLabel: category,
          recordedBy: userName || 'الكادر التعليمي',
          parentNotified: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
      onAlertTriggered(
        `تم تسجيل ${unmarked.length} طلاب ضمن فئة (${bulkCategory}) في ${activePeriod.label} — ${selectedSubject}.`,
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'periodAttendance/bulk');
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmScannedAttendance = async (items: ConfirmedAttendanceScanItem[]) => {
    if (!canMarkAttendance || items.length === 0) return;

    setBusyId('camera_period');
    const nowMs = Date.now();
    const absentRecordsForEmail: AttendanceRecord[] = [];
    let presentTotal = 0;
    let absentTotal = 0;
    let excusedTotal = 0;

    try {
      const batch = writeBatch(db);
      const nextDrafts: Record<string, string> = {};

      items.forEach((item, idx) => {
        const { student, status, categoryLabel } = item;
        const recordId = `per_${selectedPeriodNumber}_${student.id}_${selectedDate}`;
        const existing = getRecordForStudentPeriod(student.id);
        const shouldNotifyParent = status === 'absent';

        if (status === 'present') presentTotal += 1;
        else if (status === 'absent') absentTotal += 1;
        else if (status === 'excused') excusedTotal += 1;

        nextDrafts[student.id] = categoryLabel;

        if (existing) {
          batch.update(doc(db, 'periodAttendance', recordId), {
            status,
            categoryLabel,
            subject: selectedSubject,
            recordedBy: userName || 'الكادر التعليمي',
            parentNotified: shouldNotifyParent ? true : existing.parentNotified,
            updatedAt: serverTimestamp(),
          });
        } else {
          batch.set(doc(db, 'periodAttendance', recordId), {
            studentId: student.id,
            studentName: student.fullName,
            grade: student.grade,
            section: student.section || 'أ',
            parentUid: student.parentUid,
            date: selectedDate,
            periodNumber: selectedPeriodNumber,
            periodLabel: activePeriod.label,
            subject: selectedSubject,
            status,
            categoryLabel,
            recordedBy: userName || 'الكادر التعليمي',
            parentNotified: shouldNotifyParent,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        if (shouldNotifyParent) {
          const notifId = `notif_per_${selectedPeriodNumber}_${student.id}_${nowMs}_${idx}`;
          batch.set(doc(db, 'notifications', notifId), {
            parentUid: student.parentUid,
            title: `تنبيه غياب عن ${activePeriod.label} — ${student.fullName}`,
            message: `نحيطكم علماً بتسجيل غياب الطالب ${student.fullName} (${student.grade} - الفئة ${student.section}) عن ${activePeriod.label} (${selectedSubject}) بتاريخ ${selectedDate}.`,
            notifType: 'attendance',
            isRead: false,
            createdAt: serverTimestamp(),
          });

          absentRecordsForEmail.push({
            id: recordId,
            studentId: student.id,
            studentName: student.fullName,
            grade: student.grade,
            parentUid: student.parentUid,
            date: selectedDate,
            status: 'absent',
            checkInTime: '--:--',
            parentNotified: true,
            notes: `رصد غياب بالكاميرا في ${activePeriod.label} (${selectedSubject})`,
          });
        }
      });

      await batch.commit();
      setDraftCategories((prev) => ({ ...prev, ...nextDrafts }));
      onAlertTriggered(
        `تم حفظ سجل ${activePeriod.label} بالكاميرا (${presentTotal} حاضر · ${absentTotal} غائب · ${excusedTotal} مجاز بعذر).`,
      );
      if (onTriggerAttendanceEmailWarning && absentRecordsForEmail.length > 0) {
        onTriggerAttendanceEmailWarning(absentRecordsForEmail[0]);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'periodAttendance/camera_batch');
      throw error;
    } finally {
      setBusyId(null);
    }
  };

  const handleExportPeriodsCsv = () => {
    const rows = filteredStudents.map((student) => {
      const rec = getRecordForStudentPeriod(student.id);
      return [
        student.studentCode,
        student.fullName,
        student.grade,
        student.section,
        selectedDate,
        activePeriod.label,
        rec?.subject || selectedSubject,
        rec ? STATUS_LABELS[rec.status] : 'غير مسجل',
        rec?.categoryLabel || '—',
        rec?.recordedBy || '—',
      ];
    });
    downloadCsv(
      `period-attendance-${selectedDate}-p${selectedPeriodNumber}.csv`,
      [
        'الرقم الأكاديمي',
        'اسم الطالب',
        'الصف الدراسي',
        'الفئة / الشعبة',
        'التاريخ',
        'الحصة',
        'المادة',
        'حالة الحضور',
        'الفئة المسجلة في الحصة',
        'المسجل',
      ],
      rows,
    );
    onAlertTriggered(`تم تصدير سجل ${activePeriod.label} (${selectedDate}) إلى ملف CSV.`);
  };

  return (
    <div className="space-y-6">
      <PrintHeader
        title={`سجل الحضور والفئات — ${activePeriod.label}`}
        subtitle={`المادة: ${selectedSubject} (${activePeriod.timeRange})`}
        documentCode={`PER-P${selectedPeriodNumber}-${selectedDate}`}
        metadata={[
          { label: 'التاريخ', value: selectedDate },
          { label: 'الصف', value: gradeFilter === 'all' ? 'جميع الصفوف' : gradeFilter },
          { label: 'الفئة', value: sectionFilter === 'all' ? 'جميع الفئات' : `الفئة (${sectionFilter})` },
          { label: 'عدد الطلاب', value: filteredStudents.length },
        ]}
      />
      {/* Period & Section Selection Controls */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 no-print">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-bold font-display text-slate-900 flex items-center gap-2">
              <Layers className="w-4 h-4 text-teal-700 shrink-0" />
              <span>تسجيل الفئات والحضور حسب الحصص الدراسية</span>
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              اختر الحصة والصف والفئة/الشعبة لتسجيل حضور الطلاب وتصنيف مشاركتهم وانضباطهم داخل كل حصة
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {canMarkAttendance && (
              <>
                <button
                  type="button"
                  disabled={busyId === 'camera_period'}
                  onClick={() => setShowCameraAttendanceScan(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-teal-50 text-teal-800 border border-teal-200 text-xs font-semibold rounded-lg hover:bg-teal-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
                >
                  <Camera className="w-4 h-4" />
                  <span>مسح سجل الغيابات بالكاميرا</span>
                </button>
                <button
                  type="button"
                  disabled={busyId === 'bulk_period'}
                  onClick={handleBulkRecordSectionPeriod}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>تسجيل الفئة كاملة في الحصة</span>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={handleExportPeriodsCsv}
              className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-800 text-xs font-medium rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileDown className="w-4 h-4" />
              <span>تصدير سجل الحصة CSV</span>
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>طباعة سجل الحصص</span>
            </button>
          </div>
        </div>

        {/* Period Quick Strip (1 to 7) */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {SCHOOL_PERIODS.map((p) => {
            const countForPeriod = dayPeriodRecords.filter((r) => r.periodNumber === p.number).length;
            const isActive = selectedPeriodNumber === p.number;
            return (
              <button
                key={p.number}
                type="button"
                onClick={() => setSelectedPeriodNumber(p.number)}
                className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors border whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-2 ${
                  isActive
                    ? 'bg-teal-700 text-white border-teal-700'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <span>{p.label}</span>
                <span
                  className={`font-mono-num text-[11px] ${
                    isActive ? 'text-teal-100' : 'text-slate-400'
                  }`}
                >
                  ({countForPeriod})
                </span>
              </button>
            );
          })}
        </div>

        {/* Detailed Filter Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 pt-2 border-t border-slate-100">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">التاريخ</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => onChangeDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-num bg-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">الصف الدراسي</label>
            <select
              value={gradeFilter}
              onChange={(e) => setGradeFilter(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
            >
              <option value="all">جميع الصفوف</option>
              {gradesList.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">الفئة / الشعبة</label>
            <select
              value={sectionFilter}
              onChange={(e) => setSectionFilter(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
            >
              <option value="all">جميع الفئات</option>
              {sectionsList.map((sec) => (
                <option key={sec} value={sec}>
                  الفئة ({sec})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">المادة الدراسية</label>
            <select
              value={selectedSubject}
              onChange={(e) => setSelectedSubject(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
            >
              {SCHOOL_SUBJECTS.map((sub) => (
                <option key={sub} value={sub}>
                  {sub}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              تصنيف الفئة للتسجيل الجماعي
            </label>
            <select
              value={bulkCategory}
              onChange={(e) => setBulkCategory(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
            >
              {PERIOD_CATEGORY_PRESETS.slice(0, 4).map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Period KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 print-compact-grid print-avoid-break">
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500">الحصة والمادة النشطة</p>
            <p className="text-sm font-bold text-slate-900 mt-1">
              {activePeriod.label} · {selectedSubject}
            </p>
            <p className="text-xs text-slate-400 font-mono-num mt-0.5">{activePeriod.timeRange}</p>
          </div>
          <BookOpen className="w-5 h-5 text-teal-700 shrink-0" />
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500">حاضر في الحصة</p>
            <p className="text-xl font-bold font-mono-num text-emerald-700 mt-1">
              {presentPeriodCount}
              <span className="text-xs font-normal text-slate-400 mr-1">
                / {filteredStudents.length}
              </span>
            </p>
          </div>
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500">غائب عن الحصة</p>
            <p className="text-xl font-bold font-mono-num text-red-700 mt-1">
              {absentPeriodCount}
            </p>
          </div>
          <XCircle className="w-5 h-5 text-red-600 shrink-0" />
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500">متأخر / مستأذن</p>
            <p className="text-xl font-bold font-mono-num text-amber-700 mt-1">
              {lateOrExcusedCount}
            </p>
          </div>
          <Clock className="w-5 h-5 text-amber-600 shrink-0" />
        </div>
      </div>

      {/* Period Student Recording Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h4 className="text-sm font-bold font-display text-slate-900">
              قائمة الطلاب — {activePeriod.label} ({selectedDate})
            </h4>
            <p className="text-xs text-slate-500 mt-0.5">
              حدد فئة الأداء/الانضباط وسجل حضور الطالب في الحصة
            </p>
          </div>
          <span className="text-xs text-slate-500 font-mono-num">
            {filteredStudents.length} طلاب في النطاق المحدد
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
              <tr>
                <th className="py-3 px-4 font-semibold">الطالب</th>
                <th className="py-3 px-4 font-semibold">الصف والفئة</th>
                <th className="py-3 px-4 font-semibold">حالة الحصة</th>
                <th className="py-3 px-4 font-semibold">الفئة المسجلة في الحصة</th>
                {canMarkAttendance && <th className="py-3 px-4 font-semibold no-print">تسجيل في الحصة</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredStudents.map((student) => {
                const record = getRecordForStudentPeriod(student.id);
                const status = record?.status;
                const currentCategory =
                  draftCategories[student.id] || record?.categoryLabel || bulkCategory;

                return (
                  <tr key={student.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3.5 px-4">
                      {onSelectStudent ? (
                        <button
                          type="button"
                          onClick={() => onSelectStudent(student.id)}
                          className="font-semibold text-slate-900 hover:text-teal-700 hover:underline cursor-pointer text-right"
                        >
                          {student.fullName}
                        </button>
                      ) : (
                        <p className="font-semibold text-slate-900">{student.fullName}</p>
                      )}
                      <p className="text-xs text-slate-500 font-mono-num">
                        {student.studentCode} · ولي الأمر: {student.parentName}
                      </p>
                    </td>
                    <td className="py-3.5 px-4 text-slate-700">
                      {student.grade} — الفئة ({student.section})
                    </td>
                    <td className="py-3.5 px-4">
                      {status ? (
                        <span
                          className={`text-xs font-semibold ${
                            status === 'present'
                              ? 'text-emerald-700'
                              : status === 'absent'
                                ? 'text-red-700'
                                : status === 'late'
                                  ? 'text-amber-700'
                                  : 'text-slate-600'
                          }`}
                        >
                          {STATUS_LABELS[status]} · {record?.subject}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">غير مسجل بعد</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      {canMarkAttendance ? (
                        <>
                          <select
                            value={currentCategory}
                            onChange={(e) => {
                              const nextCat = e.target.value;
                              setDraftCategories((prev) => ({ ...prev, [student.id]: nextCat }));
                              if (record) {
                                void handleRecordStudentPeriod(student, record.status, nextCat);
                              }
                            }}
                            className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-800 no-print"
                          >
                            {PERIOD_CATEGORY_PRESETS.map((cat) => (
                              <option key={cat} value={cat}>
                                {cat}
                              </option>
                            ))}
                          </select>
                          <span className="print-only text-xs font-medium text-slate-800">
                            {record?.categoryLabel || '—'}
                          </span>
                        </>
                      ) : (
                        <span className="text-xs font-medium text-slate-700">
                          {record?.categoryLabel || '—'}
                        </span>
                      )}
                    </td>
                    {canMarkAttendance && (
                      <td className="py-3.5 px-4 no-print">
                        <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                          {(['present', 'absent', 'late', 'excused'] as AttendanceStatus[]).map(
                            (st) => (
                              <button
                                key={st}
                                type="button"
                                disabled={busyId === student.id}
                                onClick={() =>
                                  handleRecordStudentPeriod(
                                    student,
                                    st,
                                    st === 'present'
                                      ? currentCategory
                                      : DEFAULT_CATEGORY_BY_STATUS[st],
                                  )
                                }
                                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                                  status === st
                                    ? st === 'absent'
                                      ? 'bg-red-700 text-white'
                                      : st === 'late'
                                        ? 'bg-amber-600 text-white'
                                        : 'bg-teal-700 text-white'
                                    : 'text-slate-600 hover:text-slate-900 hover:bg-white'
                                }`}
                              >
                                {STATUS_LABELS[st]}
                              </button>
                            ),
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              {filteredStudents.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-sm text-slate-500">
                    لا توجد بيانات طلاب ضمن الصف والفئة المحددة.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Daily Period & Section Matrix (H1 - H7) */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h4 className="text-sm font-bold font-display text-slate-900">
              مصفوفة متابعة الحصص اليومية (الحصة 1 — الحصة 7)
            </h4>
            <p className="text-xs text-slate-500 mt-0.5">
              اضغط على أي حصة للانتقال إليها مباشرة ومراجعة الفئات المسجلة بتاريخ {selectedDate}
            </p>
          </div>
          <Users className="w-4 h-4 text-teal-700 shrink-0" />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="py-3 px-4 font-semibold">الطالب والفئة</th>
                {SCHOOL_PERIODS.map((p) => (
                  <th key={p.number} className="py-3 px-2.5 font-semibold text-center">
                    <button
                      type="button"
                      onClick={() => setSelectedPeriodNumber(p.number)}
                      className={`px-2 py-1 rounded-md transition-colors cursor-pointer ${
                        selectedPeriodNumber === p.number
                          ? 'bg-teal-700 text-white'
                          : 'hover:bg-slate-200 text-slate-700'
                      }`}
                    >
                      {p.shortLabel}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredStudents.map((stu) => (
                <tr key={stu.id} className="hover:bg-slate-50/70">
                  <td className="py-3 px-4">
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
                    <p className="text-[11px] text-slate-500">
                      {stu.grade} · الفئة ({stu.section})
                    </p>
                  </td>
                  {SCHOOL_PERIODS.map((p) => {
                    const rec = getRecordForStudentPeriod(stu.id, p.number);
                    return (
                      <td key={p.number} className="py-3 px-2 text-center">
                        <button
                          type="button"
                          onClick={() => setSelectedPeriodNumber(p.number)}
                          className={`px-2 py-1 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap ${
                            rec?.status === 'present'
                              ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                              : rec?.status === 'absent'
                                ? 'text-red-700 bg-red-50 hover:bg-red-100'
                                : rec?.status === 'late'
                                  ? 'text-amber-700 bg-amber-50 hover:bg-amber-100'
                                  : rec?.status === 'excused'
                                    ? 'text-slate-700 bg-slate-100 hover:bg-slate-200'
                                    : 'text-slate-400 hover:bg-slate-100'
                          }`}
                          title={rec ? `${rec.subject} — ${rec.categoryLabel}` : 'غير مسجل'}
                        >
                          {rec ? rec.categoryLabel : '—'}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Logged Class-Section Sessions Breakdown */}
      {classSectionSessionsSummary.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <h4 className="text-sm font-bold font-display text-slate-900">
              ملخص الفئات المسجلة في حصص اليوم ({selectedDate})
            </h4>
            <span className="text-xs text-slate-500 font-mono-num">
              {classSectionSessionsSummary.length} جلسات مسجلة
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-3 px-4 font-semibold">الحصة</th>
                  <th className="py-3 px-4 font-semibold">الصف والفئة</th>
                  <th className="py-3 px-4 font-semibold">المادة</th>
                  <th className="py-3 px-4 font-semibold">حاضر</th>
                  <th className="py-3 px-4 font-semibold">غائب</th>
                  <th className="py-3 px-4 font-semibold">متأخر</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {classSectionSessionsSummary.map((item) => (
                  <tr
                    key={`${item.grade}_${item.section}_${item.periodNumber}`}
                    className="hover:bg-slate-50/70"
                  >
                    <td className="py-3 px-4 font-semibold text-teal-800">{item.periodLabel}</td>
                    <td className="py-3 px-4 text-slate-800">
                      {item.grade} — الفئة ({item.section})
                    </td>
                    <td className="py-3 px-4 text-slate-600">{item.subject}</td>
                    <td className="py-3 px-4 font-mono-num font-semibold text-emerald-700">
                      {item.present}
                    </td>
                    <td className="py-3 px-4 font-mono-num font-semibold text-red-700">
                      {item.absent}
                    </td>
                    <td className="py-3 px-4 font-mono-num font-semibold text-amber-700">
                      {item.late}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <PrintFooter
        preparedBy={userName || 'الكادر التعليمي'}
        approverTitle="اعتماد إدارة المدرسة"
      />

      <CameraRegisterScannerModal
        isOpen={showCameraAttendanceScan}
        mode="attendance"
        students={filteredStudents.length > 0 ? filteredStudents : students}
        attendanceContext={{
          date: selectedDate,
          periodLabel: activePeriod.label,
          subject: selectedSubject,
          defaultCategory: bulkCategory || 'منضبط',
        }}
        onClose={() => setShowCameraAttendanceScan(false)}
        onConfirmAttendance={handleConfirmScannedAttendance}
      />
    </div>
  );
};
