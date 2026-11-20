import React, { useMemo, useState } from 'react';
import { deleteDoc, doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import {
  BellRing,
  Camera,
  CheckCircle2,
  Clock,
  FileDown,
  FileText,
  Flame,
  Mail,
  Printer,
  QrCode,
  Search,
  Shuffle,
  Sparkles,
  Trash2,
  UserPlus,
  XCircle,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { downloadCsv } from '../lib/csvExport';
import {
  buildMonthlyAttendanceSummary,
  generateMonthlyAttendancePdf,
} from '../lib/pdfReportGenerator';
import { mergeSchoolGrades, mergeSchoolSections, SCHOOL_GRADES } from '../lib/grades';
import { generateRandomAcademicCode } from '../lib/registerScanService';
import { TODAY_ISO } from '../lib/seedData';
import {
  CameraRegisterScannerModal,
  type ConfirmedStudentScanItem,
} from './CameraRegisterScannerModal';
import { AbsenceHeatmapTab } from './AbsenceHeatmapTab';
import { PeriodCategoriesTab } from './PeriodCategoriesTab';
import { PrintFooter, PrintHeader } from './PrintHeader';
import { QrAttendancePanel } from './QrAttendancePanel';
import type {
  AttendanceRecord,
  AttendanceReport,
  AttendanceStatus,
  PeriodAttendanceRecord,
  QrAttendanceSession,
  Student,
} from '../types';

interface AttendanceViewProps {
  students: Student[];
  attendance: AttendanceRecord[];
  periodAttendance: PeriodAttendanceRecord[];
  qrSessions: QrAttendanceSession[];
  attendanceReports: AttendanceReport[];
  canMarkAttendance: boolean;
  canManageStudents: boolean;
  currentUid: string;
  userName: string;
  earlyAbsenceInstantEnabled?: boolean;
  onToggleEarlyAbsenceInstant?: (enabled: boolean) => void;
  gmailConnected?: boolean;
  onAlertTriggered: (msg: string) => void;
  onTriggerAttendanceEmailWarning?: (record: AttendanceRecord) => void;
  onTriggerMonthlyGmailReports?: (monthKey: string) => void;
  onSelectStudent?: (studentId: string) => void;
}

const STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'حاضر',
  absent: 'غائب',
  late: 'متأخر',
  excused: 'مستأذن بعذر',
};

export const AttendanceView: React.FC<AttendanceViewProps> = ({
  students,
  attendance,
  periodAttendance,
  qrSessions,
  attendanceReports,
  canMarkAttendance,
  canManageStudents,
  currentUid,
  userName,
  earlyAbsenceInstantEnabled = true,
  onToggleEarlyAbsenceInstant,
  gmailConnected = false,
  onAlertTriggered,
  onTriggerAttendanceEmailWarning,
  onTriggerMonthlyGmailReports,
  onSelectStudent,
}) => {
  const [subTab, setSubTab] = useState<
    'daily' | 'periods' | 'qr' | 'heatmap' | 'weekly' | 'monthlyPdf'
  >('daily');
  const [selectedDate, setSelectedDate] = useState(TODAY_ISO);
  const [searchQuery, setSearchQuery] = useState('');
  const [gradeFilter, setGradeFilter] = useState('all');
  const [sectionFilter, setSectionFilter] = useState('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [showCameraStudentScan, setShowCameraStudentScan] = useState(false);

  // Weekly summary state
  const [weeklyAnchorDate, setWeeklyAnchorDate] = useState(TODAY_ISO);
  const [weeklyGradeFilter, setWeeklyGradeFilter] = useState('all');

  // Monthly PDF report state
  const [reportMonth, setReportMonth] = useState(TODAY_ISO.slice(0, 7));
  const [reportGradeFilter, setReportGradeFilter] = useState('all');
  const [generatingPdf, setGeneratingPdf] = useState(false);

  const [newStudentName, setNewStudentName] = useState('');
  const [newStudentCode, setNewStudentCode] = useState('');
  const [newStudentGrade, setNewStudentGrade] = useState<string>(SCHOOL_GRADES[0]);
  const [newStudentSection, setNewStudentSection] = useState('أ');
  const [newParentName, setNewParentName] = useState('');
  const [newParentPhone, setNewParentPhone] = useState('');

  const gradesList = mergeSchoolGrades(students.map((s) => s.grade));
  const sectionsList = mergeSchoolSections(students.map((s) => s.section));

  const filteredStudents = students.filter((s) => {
    const matchesSearch =
      s.fullName.includes(searchQuery.trim()) || s.studentCode.includes(searchQuery.trim());
    const matchesGrade = gradeFilter === 'all' || s.grade === gradeFilter;
    const matchesSection = sectionFilter === 'all' || s.section === sectionFilter;
    return matchesSearch && matchesGrade && matchesSection;
  });

  const getRecordForStudent = (studentId: string) =>
    attendance.find((a) => a.studentId === studentId && a.date === selectedDate);

  const handleMarkAttendance = async (student: Student, status: AttendanceStatus) => {
    if (!canMarkAttendance) return;
    setBusyId(student.id);
    const recordId = `att_${student.id}_${selectedDate}`;
    const existing = getRecordForStudent(student.id);
    const shouldNotifyParent = status === 'absent' || status === 'late';
    const timeStr = new Date().toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    });

    try {
      const batch = writeBatch(db);
      if (existing) {
        batch.update(doc(db, 'attendance', recordId), {
          status,
          checkInTime: status === 'absent' ? '--:--' : timeStr,
          parentNotified: shouldNotifyParent ? true : existing.parentNotified,
          notes:
            status === 'absent'
              ? `رصد غياب آلي وتنبيه ولي الأمر (${timeStr})`
              : status === 'late'
                ? `رصد تأخر صباحي وإشعار ولي الأمر (${timeStr})`
                : `تم تأكيد الحضور (${timeStr})`,
          updatedAt: serverTimestamp(),
        });
      } else {
        batch.set(doc(db, 'attendance', recordId), {
          studentId: student.id,
          studentName: student.fullName,
          grade: student.grade,
          parentUid: student.parentUid,
          date: selectedDate,
          status,
          checkInTime: status === 'absent' ? '--:--' : timeStr,
          parentNotified: shouldNotifyParent,
          notes: shouldNotifyParent
            ? `تنبيه فوري تلقائي لولي الأمر (${timeStr})`
            : `تسجيل حضور منتظم (${timeStr})`,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      // Automatic Early Absence / Late Instant Alert (Req: إشعار الغياب المبكر اللحظي)
      if (shouldNotifyParent) {
        const notifId = `notif_att_${student.id}_${Date.now()}`;
        const title =
          status === 'absent'
            ? `إشعار غياب مبكر — ${student.fullName}`
            : `تنبيه تأخر صباحي — ${student.fullName}`;
        const message =
          status === 'absent'
            ? `تنبيه لحظي الساعة ${timeStr} بواسطة ${userName}: تم رصد غياب الطالب ${student.fullName} (${student.grade}) بتاريخ ${selectedDate} فور تسجيله في نظام الحضور.`
            : `وصل الطالب ${student.fullName} (${student.grade}) متأخراً الساعة ${timeStr} بتاريخ ${selectedDate}.`;

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
      onAlertTriggered(
        status === 'absent'
          ? `إشعار الغياب المبكر: تم إرسال تنبيه لحظي فوري لولي أمر ${student.fullName} بمجرد رصد الغياب.`
          : shouldNotifyParent
            ? `تم تسجيل حالة (${STATUS_LABELS[status]}) وإرسال إشعار فوري لولي أمر ${student.fullName}`
            : `تم تسجيل حضور ${student.fullName} بنجاح`,
      );
      if (shouldNotifyParent && onTriggerAttendanceEmailWarning) {
        onTriggerAttendanceEmailWarning({
          id: recordId,
          studentId: student.id,
          studentName: student.fullName,
          grade: student.grade,
          parentUid: student.parentUid,
          date: selectedDate,
          status,
          checkInTime: status === 'absent' ? '--:--' : timeStr,
          parentNotified: true,
          notes:
            status === 'absent'
              ? `إشعار غياب مبكر لحظي (${timeStr})`
              : `رصد تأخر صباحي وإشعار ولي الأمر (${timeStr})`,
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `attendance/${recordId}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleAutomatedBulkCheckIn = async () => {
    if (!canMarkAttendance) return;
    const unmarked = filteredStudents.filter((s) => !getRecordForStudent(s.id));
    if (unmarked.length === 0) {
      onAlertTriggered('جميع طلاب القائمة الحالية تم رصد حضورهم لهذا اليوم بالفعل.');
      return;
    }

    setBusyId('bulk');
    try {
      const batch = writeBatch(db);
      const timeStr = new Date().toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
      });
      for (const student of unmarked) {
        const recordId = `att_${student.id}_${selectedDate}`;
        batch.set(doc(db, 'attendance', recordId), {
          studentId: student.id,
          studentName: student.fullName,
          grade: student.grade,
          parentUid: student.parentUid,
          date: selectedDate,
          status: 'present',
          checkInTime: timeStr,
          parentNotified: true,
          notes: 'تحضير آلي جماعي عبر البوابة الصباحية',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
      onAlertTriggered(`تم تسجيل الحضور الآلي لعدد ${unmarked.length} طلاب بنجاح.`);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'attendance/bulk');
    } finally {
      setBusyId(null);
    }
  };

  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStudentName.trim() || !newParentName.trim() || !newParentPhone.trim()) return;
    const cleanCode =
      newStudentCode.trim().replace(/[^a-zA-Z0-9_-]/g, '') || `MDR-${Date.now().toString().slice(-5)}`;
    const studentId = `stu_${Date.now()}`;

    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'students', studentId), {
        fullName: newStudentName.trim(),
        studentCode: cleanCode,
        grade: newStudentGrade,
        section: newStudentSection,
        parentUid: currentUid,
        parentName: newParentName.trim(),
        parentPhone: newParentPhone.trim(),
        gpa: 90,
        attendanceRate: 100,
        behaviorScore: 100,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      setNewStudentName('');
      setNewStudentCode('');
      setNewParentName('');
      setNewParentPhone('');
      setShowAddStudent(false);
      onAlertTriggered('تم تسجيل الطالب في قاعدة بيانات المدرسة بنجاح.');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `students/${studentId}`);
    }
  };

  const handleConfirmScannedStudents = async (items: ConfirmedStudentScanItem[]) => {
    if (!canManageStudents || items.length === 0) return;
    const baseTs = Date.now();
    try {
      const batch = writeBatch(db);
      items.forEach((item, idx) => {
        const studentId = `stu_${baseTs}_${idx}`;
        batch.set(doc(db, 'students', studentId), {
          fullName: item.fullName,
          studentCode: item.studentCode,
          grade: item.grade,
          section: item.section,
          parentUid: currentUid,
          parentName: item.parentName,
          parentPhone: item.parentPhone,
          gpa: 90,
          attendanceRate: 100,
          behaviorScore: 100,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
      setShowAddStudent(false);
      onAlertTriggered(
        `تمت قراءة وإضافة ${items.length} طلاب من سجل الطلاب بالكاميرا بأرقام أكاديمية عشوائية.`,
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'students/camera_batch');
      throw error;
    }
  };

  const dayRecords = attendance.filter((a) => a.date === selectedDate);
  const presentToday = dayRecords.filter((a) => a.status === 'present').length;
  const absentToday = dayRecords.filter((a) => a.status === 'absent').length;
  const lateToday = dayRecords.filter((a) => a.status === 'late').length;

  const monthlySummary = useMemo(
    () => buildMonthlyAttendanceSummary(reportMonth, reportGradeFilter, students, attendance),
    [reportMonth, reportGradeFilter, students, attendance],
  );

  const sortedReports = useMemo(
    () =>
      [...attendanceReports].sort((a, b) =>
        b.monthKey.localeCompare(a.monthKey) ||
        (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0),
      ),
    [attendanceReports],
  );

  const handleGenerateAndSaveMonthlyPdf = async () => {
    setGeneratingPdf(true);
    try {
      const fileName = await generateMonthlyAttendancePdf(
        monthlySummary,
        userName || 'إدارة المدرسة',
      );

      if (canMarkAttendance) {
        const reportId = `rep_${reportMonth.replace('-', '_')}_${Date.now()}`;
        const batch = writeBatch(db);
        batch.set(doc(db, 'attendanceReports', reportId), {
          monthKey: monthlySummary.monthKey,
          monthLabel: monthlySummary.monthLabel,
          gradeFilter: monthlySummary.gradeFilterLabel,
          totalStudents: monthlySummary.totalStudents,
          totalRecords: monthlySummary.totalRecords,
          presentCount: monthlySummary.presentCount,
          absentCount: monthlySummary.absentCount,
          lateCount: monthlySummary.lateCount,
          excusedCount: monthlySummary.excusedCount,
          avgAttendancePct: monthlySummary.avgAttendancePct,
          fileName,
          generatedBy: userName || 'إدارة المدرسة',
          scope: 'school',
          createdAt: serverTimestamp(),
        });
        await batch.commit();
        onAlertTriggered(
          `تم إنشاء وتحميل تقرير PDF (${monthlySummary.monthLabel}) وتسجيله في أرشيف المدرسة.`,
        );
      } else {
        onAlertTriggered(`تم إنشاء وتحميل تقرير PDF (${monthlySummary.monthLabel}) بنجاح.`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('Missing or insufficient permissions')) {
        handleFirestoreError(error, OperationType.CREATE, 'attendanceReports');
      }
      onAlertTriggered('تعذر إنشاء ملف PDF، يرجى المحاولة مرة أخرى.');
    } finally {
      setGeneratingPdf(false);
    }
  };

  const handleRedownloadArchivedPdf = async (report: AttendanceReport) => {
    setGeneratingPdf(true);
    try {
      const gradeKey =
        report.gradeFilter === 'جميع الصفوف الدراسية' ? 'all' : report.gradeFilter;
      const summary = buildMonthlyAttendanceSummary(
        report.monthKey,
        gradeKey,
        students,
        attendance,
      );
      await generateMonthlyAttendancePdf(summary, report.generatedBy);
      onAlertTriggered(`تمت إعادة تحميل تقرير ${report.monthLabel} بصيغة PDF.`);
    } finally {
      setGeneratingPdf(false);
    }
  };

  const handleDeleteArchivedReport = async (reportId: string) => {
    if (!canManageStudents) return;
    try {
      await deleteDoc(doc(db, 'attendanceReports', reportId));
      onAlertTriggered('تم حذف سجل التقرير من الأرشيف.');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `attendanceReports/${reportId}`);
    }
  };

  const handleExportDailyCsv = () => {
    const rows = filteredStudents.map((student) => {
      const record = getRecordForStudent(student.id);
      const statusLabel = record?.status ? STATUS_LABELS[record.status] : 'قيد الانتظار';
      const notifLabel = record?.parentNotified ? 'تم الإشعار' : 'لم يرسل';
      return [
        student.studentCode,
        student.fullName,
        student.grade,
        student.section,
        selectedDate,
        record?.checkInTime || '--:--',
        statusLabel,
        notifLabel,
        record?.notes || '',
      ];
    });
    downloadCsv(
      `attendance-daily-${selectedDate}.csv`,
      [
        'الرقم الأكاديمي',
        'اسم الطالب',
        'الصف الدراسي',
        'الشعبة',
        'التاريخ',
        'وقت التسجيل',
        'الحالة',
        'إشعار ولي الأمر',
        'ملاحظات',
      ],
      rows,
    );
    onAlertTriggered(`تم تصدير سجل الحضور اليومي (${selectedDate}) إلى ملف CSV.`);
  };

  const handleExportMonthlyCsv = () => {
    const rows = monthlySummary.rows.map((row) => [
      row.studentCode,
      row.fullName,
      row.grade,
      row.section,
      row.present,
      row.absent,
      row.late,
      row.excused,
      row.totalLogs,
      `${row.attendanceRate}%`,
    ]);
    downloadCsv(
      `attendance-monthly-${monthlySummary.monthKey}.csv`,
      [
        'الرقم الأكاديمي',
        'اسم الطالب',
        'الصف الدراسي',
        'الشعبة',
        'حاضر',
        'غائب',
        'متأخر',
        'بعذر',
        'إجمالي السجلات',
        'نسبة الانتظام',
      ],
      rows,
    );
    onAlertTriggered(`تم تصدير ملخص الحضور الشهري (${monthlySummary.monthLabel}) إلى ملف CSV.`);
  };

  const weekDays = useMemo(() => {
    const safeAnchor = /^\d{4}-\d{2}-\d{2}$/.test(weeklyAnchorDate)
      ? weeklyAnchorDate
      : TODAY_ISO;
    const anchor = new Date(`${safeAnchor}T12:00:00`);
    const dayOfWeek = anchor.getDay(); // 0 = Sunday ... 6 = Saturday
    const sunday = new Date(anchor);
    sunday.setDate(anchor.getDate() - dayOfWeek);
    const dayNames = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'];

    return dayNames.map((label, offset) => {
      const d = new Date(sunday);
      d.setDate(sunday.getDate() + offset);
      const iso = d.toISOString().slice(0, 10);
      return { label, iso, shortDate: iso.slice(5) };
    });
  }, [weeklyAnchorDate]);

  const weeklySummary = useMemo(() => {
    const scopedStudents =
      weeklyGradeFilter === 'all'
        ? students
        : students.filter((s) => s.grade === weeklyGradeFilter);

    const scopedStudentIds = new Set(scopedStudents.map((s) => s.id));
    const weekIsoSet = new Set(weekDays.map((d) => d.iso));
    const weekRecords = attendance.filter(
      (r) => weekIsoSet.has(r.date) && scopedStudentIds.has(r.studentId),
    );

    const rows = scopedStudents.map((student) => {
      const dayCells = weekDays.map((day) => {
        const rec = weekRecords.find(
          (r) => r.studentId === student.id && r.date === day.iso,
        );
        return {
          iso: day.iso,
          status: rec?.status || null,
        };
      });

      const loggedCells = dayCells.filter((c) => c.status !== null);
      const attendedCount = loggedCells.filter(
        (c) => c.status === 'present' || c.status === 'late' || c.status === 'excused',
      ).length;
      const absentCount = loggedCells.filter((c) => c.status === 'absent').length;
      const weeklyRate =
        loggedCells.length > 0
          ? Math.round((attendedCount / loggedCells.length) * 100)
          : student.attendanceRate;

      return {
        student,
        dayCells,
        loggedDays: loggedCells.length,
        attendedCount,
        absentCount,
        weeklyRate,
      };
    });

    const avgWeeklyRate =
      rows.length > 0
        ? Math.round(rows.reduce((sum, r) => sum + r.weeklyRate, 0) / rows.length)
        : 0;
    const totalPresentWeek = weekRecords.filter((r) => r.status === 'present').length;
    const totalAbsentWeek = weekRecords.filter((r) => r.status === 'absent').length;

    return {
      rows,
      avgWeeklyRate,
      totalPresentWeek,
      totalAbsentWeek,
      totalLoggedWeek: weekRecords.length,
    };
  }, [students, attendance, weekDays, weeklyGradeFilter]);

  const handleExportWeeklyCsv = () => {
    const rows = weeklySummary.rows.map((row) => [
      row.student.studentCode,
      row.student.fullName,
      row.student.grade,
      row.student.section,
      ...row.dayCells.map((c) => (c.status ? STATUS_LABELS[c.status] : 'غير مرصود')),
      `${row.weeklyRate}%`,
    ]);
    downloadCsv(
      `attendance-weekly-${weekDays[0]?.iso || weeklyAnchorDate}.csv`,
      [
        'الرقم الأكاديمي',
        'اسم الطالب',
        'الصف الدراسي',
        'الشعبة',
        ...weekDays.map((d) => `${d.label} (${d.iso})`),
        'نسبة الحضور الأسبوعية',
      ],
      rows,
    );
    onAlertTriggered('تم تصدير ملخص الحضور الأسبوعي إلى ملف CSV بنجاح.');
  };

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white border border-slate-200 rounded-xl p-5 no-print">
        <div>
          <h2 className="text-lg font-bold font-display text-slate-900">
            نظام المتابعة الآلية للحضور والغياب وتقارير PDF الشهرية
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            رصد فوري للحضور وإرسال تنبيهات تلقائية لأولياء الأمور مع إصدار وتسجيل تقارير PDF شهرية
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setSubTab('daily')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                subTab === 'daily'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              الرصد اليومي للحضور
            </button>
            <button
              type="button"
              onClick={() => setSubTab('periods')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                subTab === 'periods'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              تسجيل الفئات في الحصص
            </button>
            <button
              type="button"
              onClick={() => setSubTab('qr')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                subTab === 'qr'
                  ? 'bg-white text-teal-800 shadow-sm font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>حضور QR المتغير</span>
            </button>
            <button
              type="button"
              onClick={() => setSubTab('weekly')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                subTab === 'weekly'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              الملخص الأسبوعي
            </button>
            <button
              type="button"
              onClick={() => setSubTab('heatmap')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                subTab === 'heatmap'
                  ? 'bg-white text-red-700 shadow-sm font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Flame className="w-3.5 h-3.5" />
              <span>خريطة الغياب (Heatmap)</span>
            </button>
            <button
              type="button"
              onClick={() => setSubTab('monthlyPdf')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                subTab === 'monthlyPdf'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              تقارير PDF الشهرية
            </button>
          </div>

          {subTab === 'daily' && canMarkAttendance && (
            <button
              type="button"
              onClick={handleAutomatedBulkCheckIn}
              disabled={busyId === 'bulk'}
              className="inline-flex items-center gap-2 px-4 py-2 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
            >
              <Sparkles className="w-4 h-4" />
              <span>تحضير آلي للمتبقي</span>
            </button>
          )}
          {subTab === 'daily' && (
            <>
              <button
                type="button"
                onClick={handleExportDailyCsv}
                className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-800 text-xs font-medium rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FileDown className="w-4 h-4" />
                <span>تصدير CSV</span>
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>طباعة السجل</span>
              </button>
            </>
          )}
          {subTab === 'daily' && canManageStudents && (
            <>
              <button
                type="button"
                onClick={() => {
                  setShowAddStudent((v) => {
                    const next = !v;
                    if (next && !newStudentCode.trim()) {
                      setNewStudentCode(
                        generateRandomAcademicCode(students.map((s) => s.studentCode)),
                      );
                    }
                    return next;
                  });
                }}
                className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-800 text-xs font-medium rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <UserPlus className="w-4 h-4" />
                <span>إضافة طالب جديد</span>
              </button>
              <button
                type="button"
                onClick={() => setShowCameraStudentScan(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-teal-50 text-teal-800 border border-teal-200 text-xs font-semibold rounded-lg hover:bg-teal-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Camera className="w-4 h-4" />
                <span>إضافة بالكاميرا (سجل الطلاب)</span>
              </button>
            </>
          )}
        </div>
      </div>

      {subTab === 'daily' && (
        <>
          <PrintHeader
            title="سجل الحضور والغياب اليومي للطلاب"
            subtitle="كشف الرصد اليومي والانتظام المدرسي"
            documentCode={`ATT-${selectedDate}`}
            metadata={[
              { label: 'التاريخ', value: selectedDate },
              { label: 'الصف', value: gradeFilter === 'all' ? 'جميع الصفوف' : gradeFilter },
              { label: 'الفئة', value: sectionFilter === 'all' ? 'جميع الفئات' : `الفئة (${sectionFilter})` },
              { label: 'عدد الطلاب', value: filteredStudents.length },
            ]}
          />

      {/* Add Student Form */}
      {showAddStudent && (
        <form
          onSubmit={handleAddStudent}
          className="bg-white border border-slate-200 rounded-xl p-6 grid grid-cols-1 md:grid-cols-3 gap-4 no-print"
        >
          <div className="md:col-span-3 flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-bold text-slate-900">إضافة طالب جديد أو مسح سجل الطلاب بالكاميرا</h3>
              <p className="text-xs text-slate-500">
                يمكنك إدخال بيانات الطالب يدوياً أو تصوير قائمة أسماء الطلاب لتتم قراءتها وتوليد أرقام أكاديمية عشوائية تلقائياً
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowCameraStudentScan(true)}
              className="inline-flex items-center gap-2 px-3.5 py-2 bg-teal-700 text-white text-xs font-semibold rounded-lg hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Camera className="w-4 h-4" />
              <span>فتح الكاميرا لقراءة سجل الطلاب</span>
            </button>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">اسم الطالب الكامل</label>
            <input
              type="text"
              required
              value={newStudentName}
              onChange={(e) => setNewStudentName(e.target.value)}
              placeholder="مثال: سلمان بن محمد العلي"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-teal-700"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">الرقم الأكاديمي (أو توليد عشوائي)</label>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={newStudentCode}
                onChange={(e) => setNewStudentCode(e.target.value)}
                placeholder="MDR-26108"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num focus:outline-none focus:border-teal-700"
              />
              <button
                type="button"
                title="توليد رقم أكاديمي عشوائي"
                onClick={() =>
                  setNewStudentCode(generateRandomAcademicCode(students.map((s) => s.studentCode)))
                }
                className="inline-flex items-center gap-1 px-2.5 py-2 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Shuffle className="w-3.5 h-3.5" />
                <span>عشوائي</span>
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">الصف الدراسي</label>
              <select
                value={newStudentGrade}
                onChange={(e) => setNewStudentGrade(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                {SCHOOL_GRADES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">الشعبة</label>
              <input
                type="text"
                required
                value={newStudentSection}
                onChange={(e) => setNewStudentSection(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">اسم ولي الأمر</label>
            <input
              type="text"
              required
              value={newParentName}
              onChange={(e) => setNewParentName(e.target.value)}
              placeholder="محمد العلي"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">رقم جوال ولي الأمر</label>
            <input
              type="text"
              required
              value={newParentPhone}
              onChange={(e) => setNewParentPhone(e.target.value)}
              placeholder="0550001234"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num"
            />
          </div>
          <div className="flex items-end gap-2">
            <button
              type="submit"
              className="px-4 py-2 bg-teal-700 text-white text-sm font-medium rounded-lg hover:bg-teal-800 cursor-pointer"
            >
              حفظ الطالب
            </button>
            <button
              type="button"
              onClick={() => setShowAddStudent(false)}
              className="px-4 py-2 bg-slate-100 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-200 cursor-pointer"
            >
              إلغاء
            </button>
          </div>
        </form>
      )}

      {/* Early Absence Instant Alert Banner */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 no-print">
        <div className="flex items-start gap-3">
          <BellRing className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-bold text-slate-900">
              ميزة إشعار الغياب المبكر اللحظي مفعّلة
            </p>
            <p className="text-xs text-slate-600 mt-0.5">
              بمجرد تسجيل الطالب كغائب، يُرسل إشعار فوري لحظي إلى تطبيق ولي الأمر
              {gmailConnected
                ? ' والبريد الإلكتروني عبر Gmail تلقائياً'
                : ' (مع خيار الإرسال الفوري عبر Gmail عند الربط)'}{' '}
              دون انتظار التقارير اليومية.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <span className="text-xs font-mono-num text-slate-600">
            تنبيهات الغياب المبكر اليوم:{' '}
            <strong className="text-red-700">{absentToday}</strong>
          </span>
          {onToggleEarlyAbsenceInstant && (
            <button
              type="button"
              onClick={() => onToggleEarlyAbsenceInstant(!earlyAbsenceInstantEnabled)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                earlyAbsenceInstantEnabled
                  ? 'bg-teal-700 border-teal-700 text-white'
                  : 'bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {earlyAbsenceInstantEnabled
                ? 'إرسال Gmail التلقائي الفوري: مفعّل'
                : 'إرسال Gmail التلقائي الفوري: يدوي'}
            </button>
          )}
        </div>
      </div>

      {/* Daily Summary Metrics & Filter Bar */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 print-compact-grid print-avoid-break">
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500">حاضر اليوم</p>
            <p className="text-xl font-bold font-mono-num text-emerald-700">{presentToday}</p>
          </div>
          <CheckCircle2 className="w-5 h-5 text-emerald-600" />
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500">غائب (إشعار غياب مبكر)</p>
            <p className="text-xl font-bold font-mono-num text-red-700">{absentToday}</p>
          </div>
          <XCircle className="w-5 h-5 text-red-600" />
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500">متأخر</p>
            <p className="text-xl font-bold font-mono-num text-amber-700">{lateToday}</p>
          </div>
          <Clock className="w-5 h-5 text-amber-600" />
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500">إجمالي تنبيهات أولياء الأمور</p>
            <p className="text-xl font-bold font-mono-num text-slate-900">
              {dayRecords.filter((r) => r.parentNotified).length}
            </p>
          </div>
          <BellRing className="w-5 h-5 text-teal-700" />
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center gap-4 no-print">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ابحث باسم الطالب أو الرقم الأكاديمي..."
            className="w-full pr-9 pl-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-teal-700"
          />
        </div>
        <select
          value={gradeFilter}
          onChange={(e) => setGradeFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
        >
          <option value="all">جميع الصفوف</option>
          {gradesList.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <select
          value={sectionFilter}
          onChange={(e) => setSectionFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
        >
          <option value="all">جميع الفئات</option>
          {sectionsList.map((sec) => (
            <option key={sec} value={sec}>
              الفئة ({sec})
            </option>
          ))}
        </select>
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-num"
        />
      </div>

      {/* Attendance Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
              <tr>
                <th className="py-3 px-4 font-semibold">الطالب</th>
                <th className="py-3 px-4 font-semibold">الصف والشعبة</th>
                <th className="py-3 px-4 font-semibold">وقت التسجيل</th>
                <th className="py-3 px-4 font-semibold">الحالة اليومية</th>
                <th className="py-3 px-4 font-semibold">إشعار ولي الأمر</th>
                {canMarkAttendance && <th className="py-3 px-4 font-semibold no-print">إجراء الرصد التلقائي</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredStudents.map((student) => {
                const record = getRecordForStudent(student.id);
                const status = record?.status;

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
                      {student.grade} — {student.section}
                    </td>
                    <td className="py-3.5 px-4 font-mono-num text-slate-600">
                      {record?.checkInTime || '--:--'}
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
                          {STATUS_LABELS[status]}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">قيد الانتظار</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-600">
                      {record?.parentNotified
                        ? status === 'absent' || status === 'late'
                          ? 'تم إرسال تنبيه فوري للهاتف'
                          : 'سجل محفوظ لولي الأمر'
                        : 'لم يرسل تنبيه'}
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
                                onClick={() => handleMarkAttendance(student, st)}
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
                  <td colSpan={6} className="py-10 text-center text-sm text-slate-500">
                    لا توجد نتائج مطابقة للبحث الحالي.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
          <PrintFooter
            preparedBy={userName || 'مراقب الدوام المدرسي'}
            approverTitle="اعتماد إدارة المدرسة"
          />
        </>
      )}

      {subTab === 'monthlyPdf' && (
        <div className="space-y-6">
          {/* Monthly Report Filter & Generate Bar */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 no-print">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">الشهر المطلوب</label>
                <input
                  type="month"
                  value={reportMonth}
                  onChange={(e) => setReportMonth(e.target.value)}
                  className="px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">نطاق الصفوف</label>
                <select
                  value={reportGradeFilter}
                  onChange={(e) => setReportGradeFilter(e.target.value)}
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
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleExportMonthlyCsv}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-100 text-slate-800 text-xs font-medium rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FileDown className="w-4 h-4" />
                <span>تصدير CSV</span>
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-100 text-slate-800 text-xs font-medium rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>طباعة</span>
              </button>
              <button
                type="button"
                disabled={generatingPdf}
                onClick={handleGenerateAndSaveMonthlyPdf}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
              >
                <FileDown className="w-4 h-4" />
                <span>
                  {generatingPdf
                    ? 'جاري توليد ملف PDF...'
                    : canMarkAttendance
                      ? 'توليد وحفظ تقرير PDF الشهري'
                      : 'تحميل تقرير PDF الشهري'}
                </span>
              </button>
              {canMarkAttendance && onTriggerMonthlyGmailReports && (
                <button
                  type="button"
                  onClick={() => onTriggerMonthlyGmailReports(reportMonth)}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Mail className="w-4 h-4" />
                  <span>إرسال تقارير الشهر عبر Gmail</span>
                </button>
              )}
            </div>
          </div>

          {/* Printable Monthly Preview Card */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
            <PrintHeader
              title={`تقرير الحضور والغياب الشهري — ${monthlySummary.monthLabel}`}
              subtitle={`النطاق: ${monthlySummary.gradeFilterLabel}`}
              documentCode={`ATT-MON-${reportMonth}`}
              metadata={[
                { label: 'السجلات المرصودة', value: monthlySummary.totalRecords },
                { label: 'متوسط الانتظام', value: `${monthlySummary.avgAttendancePct}%` },
              ]}
            />
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4 print-avoid-break">
              <div>
                <p className="text-xs font-medium text-teal-700">
                  معاينة التقرير الشهري المعتمد · {monthlySummary.gradeFilterLabel}
                </p>
                <h3 className="text-lg font-bold font-display text-slate-900 mt-0.5">
                  سجل الحضور والغياب — {monthlySummary.monthLabel}
                </h3>
              </div>
              <div className="text-xs text-slate-500 font-mono-num">
                السجلات المرصودة: {monthlySummary.totalRecords} · متوسط الانتظام:{' '}
                <span className="font-bold text-teal-700">{monthlySummary.avgAttendancePct}%</span>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 print-compact-grid print-avoid-break">
              <div className="border border-slate-200 rounded-lg p-4">
                <p className="text-xs text-slate-500">أيام الحضور</p>
                <p className="text-xl font-bold font-mono-num text-emerald-700 mt-1">
                  {monthlySummary.presentCount}
                </p>
              </div>
              <div className="border border-slate-200 rounded-lg p-4">
                <p className="text-xs text-slate-500">حالات الغياب</p>
                <p className="text-xl font-bold font-mono-num text-red-700 mt-1">
                  {monthlySummary.absentCount}
                </p>
              </div>
              <div className="border border-slate-200 rounded-lg p-4">
                <p className="text-xs text-slate-500">حالات التأخر</p>
                <p className="text-xl font-bold font-mono-num text-amber-700 mt-1">
                  {monthlySummary.lateCount}
                </p>
              </div>
              <div className="border border-slate-200 rounded-lg p-4">
                <p className="text-xs text-slate-500">الاستئذان بعذر</p>
                <p className="text-xl font-bold font-mono-num text-slate-700 mt-1">
                  {monthlySummary.excusedCount}
                </p>
              </div>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-right text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                  <tr>
                    <th className="py-3 px-4 font-semibold">اسم الطالب</th>
                    <th className="py-3 px-4 font-semibold">الرقم الأكاديمي</th>
                    <th className="py-3 px-4 font-semibold">الصف</th>
                    <th className="py-3 px-4 font-semibold">حاضر</th>
                    <th className="py-3 px-4 font-semibold">غائب</th>
                    <th className="py-3 px-4 font-semibold">متأخر</th>
                    <th className="py-3 px-4 font-semibold">بعذر</th>
                    <th className="py-3 px-4 font-semibold">نسبة الانتظام</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {monthlySummary.rows.map((row) => (
                    <tr key={row.studentId} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-semibold text-slate-900">
                        {onSelectStudent ? (
                          <button
                            type="button"
                            onClick={() => onSelectStudent(row.studentId)}
                            className="font-semibold text-slate-900 hover:text-teal-700 hover:underline cursor-pointer text-right"
                          >
                            {row.fullName}
                          </button>
                        ) : (
                          row.fullName
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono-num text-slate-600">{row.studentCode}</td>
                      <td className="py-3 px-4 text-slate-700">
                        {row.grade} — {row.section}
                      </td>
                      <td className="py-3 px-4 font-mono-num text-emerald-700">{row.present}</td>
                      <td className="py-3 px-4 font-mono-num text-red-700 font-semibold">
                        {row.absent}
                      </td>
                      <td className="py-3 px-4 font-mono-num text-amber-700">{row.late}</td>
                      <td className="py-3 px-4 font-mono-num text-slate-600">{row.excused}</td>
                      <td className="py-3 px-4 font-mono-num font-bold text-teal-700">
                        {row.attendanceRate}%
                      </td>
                    </tr>
                  ))}
                  {monthlySummary.rows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-sm text-slate-500">
                        لا توجد بيانات طلاب ضمن الفئة المحددة.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <PrintFooter
              preparedBy={userName || 'إدارة شؤون الطلبة'}
              approverTitle="اعتماد مدير المدرسة"
            />
          </div>

          {/* Saved Monthly PDF Reports Archive in Firestore */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden no-print">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-teal-700" />
                <h3 className="text-base font-bold font-display text-slate-900">
                  أرشيف تقارير PDF الشهرية المسجلة
                </h3>
              </div>
              <span className="text-xs text-slate-500 font-mono-num">
                {sortedReports.length} تقارير محفوظة
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                  <tr>
                    <th className="py-3 px-4 font-semibold">الشهر</th>
                    <th className="py-3 px-4 font-semibold">النطاق</th>
                    <th className="py-3 px-4 font-semibold">الإحصاء (حاضر / غائب / متأخر)</th>
                    <th className="py-3 px-4 font-semibold">متوسط الانتظام</th>
                    <th className="py-3 px-4 font-semibold">اسم الملف والمسجل</th>
                    <th className="py-3 px-4 font-semibold">الإجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedReports.map((rep) => (
                    <tr key={rep.id} className="hover:bg-slate-50/70">
                      <td className="py-3.5 px-4 font-semibold text-slate-900">
                        {rep.monthLabel}
                        <span className="block text-xs text-slate-400 font-mono-num">
                          {rep.monthKey}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-700">{rep.gradeFilter}</td>
                      <td className="py-3.5 px-4 font-mono-num text-xs text-slate-700">
                        {rep.presentCount} حاضر · {rep.absentCount} غائب · {rep.lateCount} متأخر
                      </td>
                      <td className="py-3.5 px-4 font-mono-num font-bold text-teal-700">
                        {rep.avgAttendancePct}%
                      </td>
                      <td className="py-3.5 px-4">
                        <p className="text-xs font-mono-num text-slate-800">{rep.fileName}</p>
                        <p className="text-xs text-slate-500">{rep.generatedBy}</p>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={generatingPdf}
                            onClick={() => handleRedownloadArchivedPdf(rep)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                          >
                            <FileDown className="w-3.5 h-3.5" />
                            <span>تحميل PDF</span>
                          </button>
                          {canManageStudents && (
                            <button
                              type="button"
                              onClick={() => handleDeleteArchivedReport(rep.id)}
                              aria-label="حذف التقرير"
                              className="p-1.5 text-slate-400 hover:text-red-700 rounded-lg hover:bg-red-50 cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {sortedReports.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-sm text-slate-500">
                        لم يتم تسجيل أي تقارير PDF شهرية بعد. اضغط على «توليد وحفظ تقرير PDF الشهري»
                        لإصدار أول تقرير وتوثيقه في الأرشيف.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {subTab === 'weekly' && (
        <div className="space-y-6">
          {/* Weekly Controls */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 no-print">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  تاريخ ضمن الأسبوع
                </label>
                <input
                  type="date"
                  value={weeklyAnchorDate}
                  onChange={(e) => setWeeklyAnchorDate(e.target.value || TODAY_ISO)}
                  className="px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">نطاق الصفوف</label>
                <select
                  value={weeklyGradeFilter}
                  onChange={(e) => setWeeklyGradeFilter(e.target.value)}
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
              <div className="pt-5 text-xs text-slate-500 font-mono-num">
                من {weekDays[0]?.iso} إلى {weekDays[4]?.iso}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleExportWeeklyCsv}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-100 text-slate-800 text-xs font-medium rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FileDown className="w-4 h-4" />
                <span>تصدير CSV</span>
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>طباعة الملخص</span>
              </button>
            </div>
          </div>

          {/* Weekly KPI Strip */}
          <PrintHeader
            title="تقرير ملخص الحضور الأسبوعي للطلاب"
            subtitle={`الأسبوع الدراسي من ${weekDays[0]?.iso || ''} إلى ${weekDays[4]?.iso || ''}`}
            documentCode={`ATT-WK-${weekDays[0]?.iso || ''}`}
            metadata={[
              { label: 'الصف', value: weeklyGradeFilter === 'all' ? 'جميع الصفوف' : weeklyGradeFilter },
              { label: 'متوسط الحضور', value: `${weeklySummary.avgWeeklyRate}%` },
            ]}
          />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 print-compact-grid print-avoid-break">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">عدد الطلاب</p>
              <p className="text-xl font-bold font-mono-num text-slate-900 mt-1">
                {weeklySummary.rows.length}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">متوسط نسبة الحضور الأسبوعية</p>
              <p className="text-xl font-bold font-mono-num text-teal-700 mt-1">
                {weeklySummary.avgWeeklyRate}%
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">سجلات الحضور خلال الأسبوع</p>
              <p className="text-xl font-bold font-mono-num text-emerald-700 mt-1">
                {weeklySummary.totalPresentWeek}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">حالات الغياب خلال الأسبوع</p>
              <p className="text-xl font-bold font-mono-num text-red-700 mt-1">
                {weeklySummary.totalAbsentWeek}
              </p>
            </div>
          </div>

          {/* Simplified Weekly Student Attendance Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold font-display text-slate-900">
                  تقرير ملخص الحضور الأسبوعي للطلاب
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  متابعة يومية لحالة الطالب ونسبة انتظامه خلال أيام الأسبوع الدراسي (الأحد — الخميس)
                </p>
              </div>
              {canMarkAttendance && (
                <span className="text-xs text-slate-500 hidden sm:inline no-print">
                  اضغط على أي يوم للانتقال لرصد الحضور
                </span>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                  <tr>
                    <th className="py-3 px-4 font-semibold">الطالب</th>
                    {weekDays.map((day) => (
                      <th key={day.iso} className="py-3 px-3 font-semibold text-center">
                        <div>{day.label}</div>
                        <div className="font-mono-num text-[11px] font-normal text-slate-400">
                          {day.shortDate}
                        </div>
                      </th>
                    ))}
                    <th className="py-3 px-4 font-semibold">نسبة الحضور الأسبوعية</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {weeklySummary.rows.map((row) => (
                    <tr key={row.student.id} className="hover:bg-slate-50/70">
                      <td className="py-3.5 px-4">
                        {onSelectStudent ? (
                          <button
                            type="button"
                            onClick={() => onSelectStudent(row.student.id)}
                            className="font-semibold text-slate-900 hover:text-teal-700 hover:underline cursor-pointer text-right"
                          >
                            {row.student.fullName}
                          </button>
                        ) : (
                          <p className="font-semibold text-slate-900">{row.student.fullName}</p>
                        )}
                        <p className="text-xs text-slate-500 font-mono-num">
                          {row.student.studentCode} · {row.student.grade} ({row.student.section})
                        </p>
                      </td>
                      {row.dayCells.map((cell) => (
                        <td key={cell.iso} className="py-3.5 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedDate(cell.iso);
                              setSubTab('daily');
                            }}
                            className={`text-xs font-medium px-2 py-1 rounded-md transition-colors cursor-pointer ${
                              cell.status === 'present'
                                ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                                : cell.status === 'absent'
                                  ? 'text-red-700 bg-red-50 hover:bg-red-100'
                                  : cell.status === 'late'
                                    ? 'text-amber-700 bg-amber-50 hover:bg-amber-100'
                                    : cell.status === 'excused'
                                      ? 'text-slate-700 bg-slate-100 hover:bg-slate-200'
                                      : 'text-slate-400 hover:bg-slate-100'
                            }`}
                          >
                            {cell.status ? STATUS_LABELS[cell.status] : '—'}
                          </button>
                        </td>
                      ))}
                      <td className="py-3.5 px-4 min-w-[170px]">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span
                            className={`text-sm font-bold font-mono-num ${
                              row.weeklyRate >= 90
                                ? 'text-teal-700'
                                : row.weeklyRate >= 75
                                  ? 'text-amber-700'
                                  : 'text-red-700'
                            }`}
                          >
                            {row.weeklyRate}%
                          </span>
                          <span className="text-[11px] text-slate-500 font-mono-num">
                            {row.loggedDays > 0
                              ? `${row.attendedCount}/${row.loggedDays} أيام`
                              : 'معدل عام'}
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              row.weeklyRate >= 90
                                ? 'bg-teal-700'
                                : row.weeklyRate >= 75
                                  ? 'bg-amber-600'
                                  : 'bg-red-600'
                            }`}
                            style={{ width: `${row.weeklyRate}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                  {weeklySummary.rows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-sm text-slate-500">
                        لا توجد بيانات طلاب ضمن الفئة المحددة.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <PrintFooter
            preparedBy={userName || 'مراقب الدوام المدرسي'}
            approverTitle="اعتماد إدارة المدرسة"
          />
        </div>
      )}
      {subTab === 'periods' && (
        <PeriodCategoriesTab
          students={students}
          periodAttendance={periodAttendance}
          selectedDate={selectedDate}
          onChangeDate={setSelectedDate}
          canMarkAttendance={canMarkAttendance}
          userName={userName}
          onAlertTriggered={onAlertTriggered}
          onTriggerAttendanceEmailWarning={onTriggerAttendanceEmailWarning}
          onSelectStudent={onSelectStudent}
        />
      )}

      {subTab === 'qr' && (
        <QrAttendancePanel
          students={students}
          attendance={attendance}
          qrSessions={qrSessions}
          selectedDate={selectedDate}
          onChangeDate={setSelectedDate}
          canMarkAttendance={canMarkAttendance}
          currentUid={currentUid}
          userName={userName}
          onAlertTriggered={onAlertTriggered}
        />
      )}

      {subTab === 'heatmap' && (
        <AbsenceHeatmapTab
          students={students}
          attendance={attendance}
          periodAttendance={periodAttendance}
          gradesList={gradesList}
          userName={userName}
          onAlertTriggered={onAlertTriggered}
          onSelectDateForDaily={(isoDate) => {
            setSelectedDate(isoDate);
            setSubTab('daily');
          }}
          onSelectStudent={onSelectStudent}
        />
      )}

      <CameraRegisterScannerModal
        isOpen={showCameraStudentScan}
        mode="students"
        students={students}
        defaultGrade={newStudentGrade}
        defaultSection={newStudentSection}
        onClose={() => setShowCameraStudentScan(false)}
        onConfirmStudents={handleConfirmScannedStudents}
      />
    </div>
  );
};
