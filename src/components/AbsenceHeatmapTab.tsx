import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  CalendarCheck2,
  ExternalLink,
  FileDown,
  Flame,
  Printer,
  TrendingUp,
} from 'lucide-react';
import { downloadCsv } from '../lib/csvExport';
import { TODAY_ISO } from '../lib/seedData';
import { PrintFooter, PrintHeader } from './PrintHeader';
import type { AttendanceRecord, PeriodAttendanceRecord, Student } from '../types';

interface AbsenceHeatmapTabProps {
  students: Student[];
  attendance: AttendanceRecord[];
  periodAttendance: PeriodAttendanceRecord[];
  gradesList: string[];
  userName: string;
  onAlertTriggered: (msg: string) => void;
  onSelectDateForDaily?: (isoDate: string) => void;
  onSelectStudent?: (studentId: string) => void;
}

type HeatmapSource = 'daily' | 'periods' | 'combined';
type HeatmapMetric = 'absent' | 'absent_late';
type HeatmapRange = 'all' | '30d' | '7d';

interface SchoolWeekday {
  index: number;
  label: string;
}

const SCHOOL_WEEKDAYS: SchoolWeekday[] = [
  { index: 0, label: 'الأحد' },
  { index: 1, label: 'الإثنين' },
  { index: 2, label: 'الثلاثاء' },
  { index: 3, label: 'الأربعاء' },
  { index: 4, label: 'الخميس' },
];

interface NormalizedLogEntry {
  id: string;
  studentId: string;
  studentName: string;
  grade: string;
  date: string;
  status: 'present' | 'absent' | 'late' | 'excused';
  sourceLabel: string;
}

interface CellDateDetail {
  date: string;
  entries: Array<{
    id: string;
    studentId: string;
    studentName: string;
    status: 'absent' | 'late';
    sourceLabel: string;
  }>;
}

interface HeatmapCell {
  grade: string;
  weekdayIndex: number;
  weekdayLabel: string;
  flaggedCount: number;
  absentCount: number;
  lateCount: number;
  totalLogged: number;
  ratePct: number;
  dateDetails: CellDateDetail[];
}

function getIsoWeekdayIndex(dateStr: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const parsed = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.getDay(); // 0 = Sun ... 6 = Sat
}

function getDateDaysAgoIso(anchorIso: string, daysAgo: number): string {
  const safe = /^\d{4}-\d{2}-\d{2}$/.test(anchorIso) ? anchorIso : TODAY_ISO;
  const d = new Date(`${safe}T12:00:00`);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function getHeatLevel(
  flaggedCount: number,
  ratePct: number,
  maxCellCount: number,
): 0 | 1 | 2 | 3 | 4 {
  if (flaggedCount <= 0) return 0;
  const countRatio = maxCellCount > 0 ? flaggedCount / maxCellCount : 0;
  const rateRatio = Math.min(ratePct / 40, 1);
  const score = Math.max(countRatio * 0.6 + rateRatio * 0.4, countRatio, rateRatio);

  if (score >= 0.78) return 4;
  if (score >= 0.52) return 3;
  if (score >= 0.28) return 2;
  return 1;
}

function getHeatCellClasses(level: 0 | 1 | 2 | 3 | 4, isSelected: boolean): string {
  const baseByLevel: Record<0 | 1 | 2 | 3 | 4, string> = {
    0: 'bg-slate-50 text-slate-400 border-slate-200 hover:bg-slate-100',
    1: 'bg-amber-50 text-amber-900 border-amber-200 hover:bg-amber-100',
    2: 'bg-orange-100 text-orange-950 border-orange-300 hover:bg-orange-200',
    3: 'bg-red-200 text-red-950 border-red-300 hover:bg-red-300',
    4: 'bg-red-700 text-white border-red-800 hover:bg-red-800',
  };

  return `${baseByLevel[level]} ${
    isSelected ? 'ring-2 ring-slate-900 ring-offset-1' : ''
  }`;
}

export const AbsenceHeatmapTab: React.FC<AbsenceHeatmapTabProps> = ({
  students,
  attendance,
  periodAttendance,
  gradesList,
  userName,
  onAlertTriggered,
  onSelectDateForDaily,
  onSelectStudent,
}) => {
  const [source, setSource] = useState<HeatmapSource>('daily');
  const [metric, setMetric] = useState<HeatmapMetric>('absent');
  const [range, setRange] = useState<HeatmapRange>('all');
  const [selectedCellKey, setSelectedCellKey] = useState<string | null>(null);

  const normalizedLogs = useMemo<NormalizedLogEntry[]>(() => {
    const minDateIso =
      range === '7d'
        ? getDateDaysAgoIso(TODAY_ISO, 6)
        : range === '30d'
          ? getDateDaysAgoIso(TODAY_ISO, 29)
          : null;

    const studentGradeMap = new Map<string, string>();
    students.forEach((s) => {
      studentGradeMap.set(s.id, s.grade);
    });

    const items: NormalizedLogEntry[] = [];

    if (source === 'daily' || source === 'combined') {
      attendance.forEach((rec) => {
        if (minDateIso && rec.date < minDateIso) return;
        items.push({
          id: `daily_${rec.id}`,
          studentId: rec.studentId,
          studentName: rec.studentName,
          grade: rec.grade || studentGradeMap.get(rec.studentId) || 'غير محدد',
          date: rec.date,
          status: rec.status,
          sourceLabel: 'الرصد اليومي',
        });
      });
    }

    if (source === 'periods' || source === 'combined') {
      periodAttendance.forEach((rec) => {
        if (minDateIso && rec.date < minDateIso) return;
        items.push({
          id: `period_${rec.id}`,
          studentId: rec.studentId,
          studentName: rec.studentName,
          grade: rec.grade || studentGradeMap.get(rec.studentId) || 'غير محدد',
          date: rec.date,
          status: rec.status,
          sourceLabel: `${rec.periodLabel || `الحصة ${rec.periodNumber}`}${
            rec.subject ? ` — ${rec.subject}` : ''
          }`,
        });
      });
    }

    return items;
  }, [attendance, periodAttendance, students, source, range]);

  const heatmapStats = useMemo(() => {
    const activeGrades = [...gradesList];
    normalizedLogs.forEach((entry) => {
      if (entry.grade && !activeGrades.includes(entry.grade)) {
        activeGrades.push(entry.grade);
      }
    });

    const cellMap = new Map<string, HeatmapCell>();
    const cellDatesBuffer = new Map<string, Map<string, CellDateDetail['entries']>>();

    activeGrades.forEach((grade) => {
      SCHOOL_WEEKDAYS.forEach((day) => {
        const key = `${grade}__${day.index}`;
        cellMap.set(key, {
          grade,
          weekdayIndex: day.index,
          weekdayLabel: day.label,
          flaggedCount: 0,
          absentCount: 0,
          lateCount: 0,
          totalLogged: 0,
          ratePct: 0,
          dateDetails: [],
        });
        cellDatesBuffer.set(key, new Map());
      });
    });

    let weekendRecordsCount = 0;

    normalizedLogs.forEach((entry) => {
      const weekdayIdx = getIsoWeekdayIndex(entry.date);
      if (weekdayIdx === null) return;
      if (weekdayIdx > 4) {
        weekendRecordsCount += 1;
        return;
      }

      const key = `${entry.grade}__${weekdayIdx}`;
      const cell = cellMap.get(key);
      const datesBuf = cellDatesBuffer.get(key);
      if (!cell || !datesBuf) return;

      cell.totalLogged += 1;
      if (entry.status === 'absent') {
        cell.absentCount += 1;
      } else if (entry.status === 'late') {
        cell.lateCount += 1;
      }

      const isFlagged =
        entry.status === 'absent' || (metric === 'absent_late' && entry.status === 'late');

      if (isFlagged) {
        cell.flaggedCount += 1;
        const list = datesBuf.get(entry.date) || [];
        list.push({
          id: entry.id,
          studentId: entry.studentId,
          studentName: entry.studentName,
          status: entry.status === 'late' ? 'late' : 'absent',
          sourceLabel: entry.sourceLabel,
        });
        datesBuf.set(entry.date, list);
      }
    });

    let maxCellCount = 0;
    cellMap.forEach((cell, key) => {
      cell.ratePct =
        cell.totalLogged > 0 ? Math.round((cell.flaggedCount / cell.totalLogged) * 100) : 0;
      if (cell.flaggedCount > maxCellCount) {
        maxCellCount = cell.flaggedCount;
      }

      const datesBuf = cellDatesBuffer.get(key);
      if (datesBuf) {
        cell.dateDetails = Array.from(datesBuf.entries())
          .sort((a, b) => b[0].localeCompare(a[0]))
          .map(([date, entries]) => ({
            date,
            entries: [...entries].sort((x, y) => x.studentName.localeCompare(y.studentName, 'ar')),
          }));
      }
    });

    const gradeRows = activeGrades.map((grade) => {
      const cells = SCHOOL_WEEKDAYS.map(
        (day) => cellMap.get(`${grade}__${day.index}`)!,
      );
      const totalFlagged = cells.reduce((sum, c) => sum + c.flaggedCount, 0);
      const totalLogged = cells.reduce((sum, c) => sum + c.totalLogged, 0);
      const overallRatePct =
        totalLogged > 0 ? Math.round((totalFlagged / totalLogged) * 100) : 0;
      const enrolledCount = students.filter((s) => s.grade === grade).length;

      let peakCell: HeatmapCell | null = null;
      for (const c of cells) {
        if (c.flaggedCount === 0) continue;
        if (
          !peakCell ||
          c.flaggedCount > peakCell.flaggedCount ||
          (c.flaggedCount === peakCell.flaggedCount && c.ratePct > peakCell.ratePct)
        ) {
          peakCell = c;
        }
      }

      return {
        grade,
        enrolledCount,
        cells,
        totalFlagged,
        totalLogged,
        overallRatePct,
        peakCell,
      };
    });

    const weekdayTotals = SCHOOL_WEEKDAYS.map((day) => {
      const dayCells = activeGrades.map((grade) => cellMap.get(`${grade}__${day.index}`)!);
      const flaggedCount = dayCells.reduce((sum, c) => sum + c.flaggedCount, 0);
      const totalLogged = dayCells.reduce((sum, c) => sum + c.totalLogged, 0);
      const ratePct = totalLogged > 0 ? Math.round((flaggedCount / totalLogged) * 100) : 0;
      return {
        weekdayIndex: day.index,
        weekdayLabel: day.label,
        flaggedCount,
        totalLogged,
        ratePct,
      };
    });

    const grandTotalFlagged = weekdayTotals.reduce((sum, d) => sum + d.flaggedCount, 0);
    const grandTotalLogged = weekdayTotals.reduce((sum, d) => sum + d.totalLogged, 0);
    const overallCompliancePct =
      grandTotalLogged > 0
        ? Math.max(0, Math.round(((grandTotalLogged - grandTotalFlagged) / grandTotalLogged) * 100))
        : 100;

    const peakDay =
      [...weekdayTotals]
        .filter((d) => d.flaggedCount > 0)
        .sort((a, b) => b.flaggedCount - a.flaggedCount || b.ratePct - a.ratePct)[0] || null;

    const mostAffectedGrade =
      [...gradeRows]
        .filter((r) => r.totalFlagged > 0)
        .sort((a, b) => b.totalFlagged - a.totalFlagged || b.overallRatePct - a.overallRatePct)[0] ||
      null;

    const hotspots = Array.from(cellMap.values())
      .filter((c) => c.flaggedCount > 0)
      .sort((a, b) => b.flaggedCount - a.flaggedCount || b.ratePct - a.ratePct)
      .slice(0, 4);

    return {
      gradeRows,
      weekdayTotals,
      cellMap,
      maxCellCount,
      grandTotalFlagged,
      grandTotalLogged,
      overallCompliancePct,
      peakDay,
      mostAffectedGrade,
      hotspots,
      weekendRecordsCount,
    };
  }, [gradesList, normalizedLogs, metric, students]);

  const activeSelectedCell = useMemo(() => {
    if (selectedCellKey && heatmapStats.cellMap.has(selectedCellKey)) {
      return heatmapStats.cellMap.get(selectedCellKey) || null;
    }
    const topHotspot = heatmapStats.hotspots[0];
    return topHotspot || null;
  }, [selectedCellKey, heatmapStats]);

  const sourceLabel =
    source === 'daily'
      ? 'السجل اليومي'
      : source === 'periods'
        ? 'سجل الحصص'
        : 'السجل اليومي + الحصص';

  const rangeLabel =
    range === 'all' ? 'كامل السجل المتاح' : range === '30d' ? 'آخر 30 يوماً' : 'آخر 7 أيام';

  const metricLabel = metric === 'absent' ? 'حالات الغياب فقط' : 'حالات الغياب والتأخر';

  const handleExportCsv = () => {
    const rows = heatmapStats.gradeRows.map((row) => [
      row.grade,
      String(row.enrolledCount),
      ...row.cells.map((c) => `${c.flaggedCount} (${c.ratePct}%)`),
      row.peakCell ? `${row.peakCell.weekdayLabel} (${row.peakCell.flaggedCount})` : 'لا يوجد',
      `${row.totalFlagged} (${row.overallRatePct}%)`,
    ]);

    downloadCsv(
      `absence-heatmap-${source}-${range}.csv`,
      [
        'الصف الدراسي',
        'عدد الطلاب',
        ...SCHOOL_WEEKDAYS.map((d) => `${d.label} (العدد والنسبة)`),
        'اليوم الأكثر تكراراً',
        'الإجمالي في النطاق',
      ],
      rows,
    );
    onAlertTriggered('تم تصدير مصفوفة الخريطة الحرارية للغياب إلى ملف CSV.');
  };

  return (
    <div className="space-y-6">
      <PrintHeader
        title="الخريطة الحرارية لتكرار الغياب حسب أيام الأسبوع والصفوف"
        subtitle={`${sourceLabel} · ${metricLabel} · ${rangeLabel}`}
        documentCode={`HEATMAP-${TODAY_ISO}`}
        metadata={[
          { label: 'مصدر البيانات', value: sourceLabel },
          { label: 'المؤشر', value: metricLabel },
          { label: 'النطاق الزمني', value: rangeLabel },
          { label: 'إجمالي السجلات', value: heatmapStats.grandTotalLogged },
        ]}
      />

      {/* Filter & Action Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col xl:flex-row xl:items-center justify-between gap-4 no-print">
        <div>
          <div className="flex items-center gap-2">
            <Flame className="w-5 h-5 text-red-600 shrink-0" />
            <h3 className="text-base font-bold font-display text-slate-900">
              الخريطة الحرارية لأيام الغياب المتكررة (Heatmap)
            </h3>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            تحليل بصري فوري لتوزيع الغياب عبر أيام الأسبوع الدراسية لكل صف لتحديد الأيام التي تتطلب تعزيزاً للحضور
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <select
            aria-label="مصدر البيانات"
            value={source}
            onChange={(e) => setSource(e.target.value as HeatmapSource)}
            className="px-3 py-2 text-xs font-medium border border-slate-300 rounded-lg bg-white text-slate-800 focus:outline-none focus:border-teal-700"
          >
            <option value="daily">مصدر: السجل اليومي</option>
            <option value="periods">مصدر: سجل الحصص</option>
            <option value="combined">مصدر: اليومي + الحصص</option>
          </select>

          <select
            aria-label="نوع المؤشر"
            value={metric}
            onChange={(e) => setMetric(e.target.value as HeatmapMetric)}
            className="px-3 py-2 text-xs font-medium border border-slate-300 rounded-lg bg-white text-slate-800 focus:outline-none focus:border-teal-700"
          >
            <option value="absent">المؤشر: الغياب فقط</option>
            <option value="absent_late">المؤشر: الغياب + التأخر</option>
          </select>

          <select
            aria-label="النطاق الزمني"
            value={range}
            onChange={(e) => setRange(e.target.value as HeatmapRange)}
            className="px-3 py-2 text-xs font-medium border border-slate-300 rounded-lg bg-white text-slate-800 focus:outline-none focus:border-teal-700"
          >
            <option value="all">النطاق: كامل السجل</option>
            <option value="30d">النطاق: آخر 30 يوماً</option>
            <option value="7d">النطاق: آخر 7 أيام</option>
          </select>

          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 text-slate-800 text-xs font-medium rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <FileDown className="w-4 h-4" />
            <span>تصدير CSV</span>
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>طباعة التحليل</span>
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 print-compact-grid print-avoid-break">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>اليوم الأكثر تكراراً للغياب</span>
            <Calendar className="w-4 h-4 text-red-600" />
          </div>
          <p className="text-xl font-bold font-display text-slate-900 mt-2">
            {heatmapStats.peakDay ? heatmapStats.peakDay.weekdayLabel : 'لا يوجد غياب'}
          </p>
          <p className="text-xs text-slate-500 font-mono-num mt-1">
            {heatmapStats.peakDay
              ? `${heatmapStats.peakDay.flaggedCount} حالة · نسبة ${heatmapStats.peakDay.ratePct}%`
              : 'انتظام كامل في الأيام المرصودة'}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>الصف الأكثر تطلباً للمتابعة</span>
            <AlertTriangle className="w-4 h-4 text-amber-600" />
          </div>
          <p className="text-lg font-bold font-display text-slate-900 mt-2 truncate">
            {heatmapStats.mostAffectedGrade
              ? heatmapStats.mostAffectedGrade.grade
              : 'جميع الصفوف منتظمة'}
          </p>
          <p className="text-xs text-slate-500 font-mono-num mt-1">
            {heatmapStats.mostAffectedGrade
              ? `${heatmapStats.mostAffectedGrade.totalFlagged} حالة${
                  heatmapStats.mostAffectedGrade.peakCell
                    ? ` · الذروة: ${heatmapStats.mostAffectedGrade.peakCell.weekdayLabel}`
                    : ''
                }`
              : '0 حالات غياب مرصودة'}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>إجمالي الحالات المرصودة</span>
            <Flame className="w-4 h-4 text-orange-600" />
          </div>
          <p className="text-2xl font-bold font-mono-num text-red-700 mt-2">
            {heatmapStats.grandTotalFlagged}
          </p>
          <p className="text-xs text-slate-500 font-mono-num mt-1">
            من أصل {heatmapStats.grandTotalLogged} سجل حضور خلال أيام الدراسة
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>معدل الانتظام العام في النطاق</span>
            <CalendarCheck2 className="w-4 h-4 text-teal-700" />
          </div>
          <p className="text-2xl font-bold font-mono-num text-teal-700 mt-2">
            {heatmapStats.overallCompliancePct}%
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {sourceLabel} · {rangeLabel}
          </p>
        </div>
      </div>

      {/* Main Heatmap Matrix */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden print-avoid-break">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-bold text-slate-900">
              مصفوفة تكرار الغياب (الصف الدراسي × أيام الأسبوع)
            </h4>
            <p className="text-xs text-slate-500 mt-0.5">
              اضغط على أي خلية لعرض التواريخ وأسماء الطلاب المتغيبين في ذلك اليوم لهذا الصف
            </p>
          </div>

          {/* Thermal Scale Legend */}
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
            <span className="font-medium text-slate-700">مقياس الشدة:</span>
            <span className="inline-flex items-center gap-1">
              <span className="w-3.5 h-3.5 rounded border border-slate-200 bg-slate-50 inline-block" />
              <span>صفر</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-3.5 h-3.5 rounded border border-amber-200 bg-amber-50 inline-block" />
              <span>منخفض</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-3.5 h-3.5 rounded border border-orange-300 bg-orange-100 inline-block" />
              <span>متوسط</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-3.5 h-3.5 rounded border border-red-300 bg-red-200 inline-block" />
              <span>مرتفع</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-3.5 h-3.5 rounded border border-red-800 bg-red-700 inline-block" />
              <span>حرج</span>
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
              <tr>
                <th className="py-3.5 px-4 font-semibold min-w-[170px]">الصف الدراسي</th>
                {SCHOOL_WEEKDAYS.map((day) => (
                  <th key={day.index} className="py-3.5 px-2.5 font-semibold text-center min-w-[115px]">
                    {day.label}
                  </th>
                ))}
                <th className="py-3.5 px-4 font-semibold text-center min-w-[130px]">
                  اليوم الأكثر غياباً
                </th>
                <th className="py-3.5 px-4 font-semibold text-center min-w-[110px]">
                  إجمالي الصف
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {heatmapStats.gradeRows.map((row) => (
                <tr key={row.grade} className="hover:bg-slate-50/50 transition-colors">
                  <td className="py-3 px-4 align-middle">
                    <p className="font-semibold text-slate-900 text-sm">{row.grade}</p>
                    <p className="text-[11px] text-slate-500 font-mono-num">
                      {row.enrolledCount} طالب مسجل · {row.totalLogged} سجل
                    </p>
                  </td>

                  {row.cells.map((cell) => {
                    const key = `${cell.grade}__${cell.weekdayIndex}`;
                    const isSelected =
                      activeSelectedCell?.grade === cell.grade &&
                      activeSelectedCell?.weekdayIndex === cell.weekdayIndex;
                    const level = getHeatLevel(
                      cell.flaggedCount,
                      cell.ratePct,
                      heatmapStats.maxCellCount,
                    );
                    const isRowPeak =
                      row.peakCell &&
                      row.peakCell.weekdayIndex === cell.weekdayIndex &&
                      cell.flaggedCount > 0;

                    return (
                      <td key={key} className="p-2 align-middle text-center">
                        <button
                          type="button"
                          onClick={() => setSelectedCellKey(key)}
                          title={`${cell.grade} — ${cell.weekdayLabel}: ${cell.flaggedCount} حالة من ${cell.totalLogged} سجل (${cell.ratePct}%)`}
                          className={`w-full rounded-lg border px-2.5 py-2.5 transition-all cursor-pointer text-center ${getHeatCellClasses(
                            level,
                            Boolean(isSelected),
                          )}`}
                        >
                          <div className="flex items-baseline justify-center gap-1.5 font-mono-num">
                            <span className="text-base font-bold leading-none">
                              {cell.flaggedCount}
                            </span>
                            <span
                              className={`text-[11px] ${
                                level === 4 ? 'text-red-100' : 'opacity-80'
                              }`}
                            >
                              ({cell.ratePct}%)
                            </span>
                          </div>
                          <div
                            className={`text-[10px] mt-1 font-mono-num ${
                              level === 4 ? 'text-red-100' : 'opacity-75'
                            }`}
                          >
                            {cell.totalLogged > 0
                              ? isRowPeak
                                ? `ذروة الصف · ${cell.totalLogged} رصد`
                                : `${cell.totalLogged} سجل`
                              : 'بدون رصد'}
                          </div>
                        </button>
                      </td>
                    );
                  })}

                  <td className="py-3 px-4 text-center align-middle">
                    {row.peakCell ? (
                      <div>
                        <span className="text-xs font-bold text-red-700">
                          {row.peakCell.weekdayLabel}
                        </span>
                        <p className="text-[11px] text-slate-500 font-mono-num mt-0.5">
                          {row.peakCell.flaggedCount} حالة ({row.peakCell.ratePct}%)
                        </p>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">منتظم</span>
                    )}
                  </td>

                  <td className="py-3 px-4 text-center align-middle font-mono-num">
                    <span
                      className={`text-sm font-bold ${
                        row.totalFlagged > 0 ? 'text-slate-900' : 'text-slate-400'
                      }`}
                    >
                      {row.totalFlagged}
                    </span>
                    <p className="text-[11px] text-slate-500">{row.overallRatePct}%</p>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50 border-t-2 border-slate-200 text-xs">
              <tr>
                <td className="py-3.5 px-4 font-bold text-slate-900">
                  إجمالي المدرسة لكل يوم
                </td>
                {heatmapStats.weekdayTotals.map((dayTotal) => (
                  <td key={dayTotal.weekdayIndex} className="py-3.5 px-2.5 text-center font-mono-num">
                    <span
                      className={`text-sm font-bold ${
                        heatmapStats.peakDay?.weekdayIndex === dayTotal.weekdayIndex
                          ? 'text-red-700'
                          : 'text-slate-900'
                      }`}
                    >
                      {dayTotal.flaggedCount}
                    </span>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {dayTotal.ratePct}% من {dayTotal.totalLogged}
                    </p>
                  </td>
                ))}
                <td className="py-3.5 px-4 text-center font-bold text-red-700">
                  {heatmapStats.peakDay ? heatmapStats.peakDay.weekdayLabel : '—'}
                </td>
                <td className="py-3.5 px-4 text-center font-mono-num font-bold text-slate-900">
                  {heatmapStats.grandTotalFlagged}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {heatmapStats.weekendRecordsCount > 0 && (
          <div className="px-5 py-2.5 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-500 font-mono-num">
            ملاحظة: توجد {heatmapStats.weekendRecordsCount} سجلات بتاريخ عطلة نهاية الأسبوع (الجمعة/السبت) وتم استثناؤها من أعمدة أيام الدراسة الرسمية.
          </div>
        )}
      </div>

      {/* Recommendations + Cell Drill-Down Split */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 print-avoid-break">
        {/* Actionable Recommendations */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-teal-700 shrink-0" />
              <h4 className="text-sm font-bold text-slate-900">
                توصيات تعزيز الحضور حسب نقاط الذروة
              </h4>
            </div>
            <span className="text-[11px] text-slate-500 font-mono-num">
              أعلى {heatmapStats.hotspots.length} نقاط
            </span>
          </div>

          {heatmapStats.hotspots.length > 0 ? (
            <div className="space-y-2.5">
              {heatmapStats.hotspots.map((spot) => {
                const key = `${spot.grade}__${spot.weekdayIndex}`;
                const isSelected =
                  activeSelectedCell?.grade === spot.grade &&
                  activeSelectedCell?.weekdayIndex === spot.weekdayIndex;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedCellKey(key)}
                    className={`w-full text-right p-3.5 rounded-lg border transition-colors cursor-pointer ${
                      isSelected
                        ? 'border-slate-900 bg-slate-50'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-900">
                        {spot.grade} · يوم {spot.weekdayLabel}
                      </span>
                      <span className="text-xs font-bold font-mono-num text-red-700">
                        {spot.flaggedCount} حالة ({spot.ratePct}%)
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                      يوصى بإرسال تنبيه تحفيزي مبكر لأولياء الأمور مساء اليوم السابق وتفعيل متابعة الطابور الصباحي لهذا الصف يوم {spot.weekdayLabel}.
                    </p>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-slate-500">
              لا توجد بؤر غياب مرتفعة في النطاق الزمني المحدد. جميع الصفوف ضمن معدل الانتظام الآمن.
            </div>
          )}
        </div>

        {/* Selected Cell Details */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <h4 className="text-sm font-bold text-slate-900">
                {activeSelectedCell
                  ? `تفاصيل ${activeSelectedCell.grade} — يوم ${activeSelectedCell.weekdayLabel}`
                  : 'تفاصيل الخلية المحددة'}
              </h4>
              <p className="text-xs text-slate-500 font-mono-num mt-0.5">
                {activeSelectedCell
                  ? `${activeSelectedCell.flaggedCount} حالة مرصودة من أصل ${activeSelectedCell.totalLogged} سجل (${activeSelectedCell.ratePct}%)`
                  : 'اختر أي خلية من المصفوفة لعرض التواريخ وأسماء الطلاب'}
              </p>
            </div>
          </div>

          {activeSelectedCell && activeSelectedCell.dateDetails.length > 0 ? (
            <div className="space-y-3 max-h-[340px] overflow-y-auto pr-1">
              {activeSelectedCell.dateDetails.map((dayGroup) => (
                <div
                  key={dayGroup.date}
                  className="border border-slate-200 rounded-lg p-3 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold font-mono-num text-slate-900">
                      {dayGroup.date} · {dayGroup.entries.length} طالب
                    </span>
                    {onSelectDateForDaily && (
                      <button
                        type="button"
                        onClick={() => onSelectDateForDaily(dayGroup.date)}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal-700 hover:text-teal-800 whitespace-nowrap shrink-0 cursor-pointer no-print"
                      >
                        <span>فتح في الرصد اليومي</span>
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  <div className="divide-y divide-slate-100">
                    {dayGroup.entries.map((entry) => (
                      <div
                        key={entry.id}
                        className="py-1.5 flex items-center justify-between gap-2 text-xs"
                      >
                        {onSelectStudent ? (
                          <button
                            type="button"
                            onClick={() => onSelectStudent(entry.studentId)}
                            className="font-medium text-slate-900 hover:text-teal-700 hover:underline cursor-pointer text-right"
                          >
                            {entry.studentName}
                          </button>
                        ) : (
                          <span className="font-medium text-slate-800">{entry.studentName}</span>
                        )}
                        <span className="text-[11px] text-slate-500">
                          {entry.status === 'absent' ? (
                            <span className="text-red-700 font-semibold">غائب</span>
                          ) : (
                            <span className="text-amber-700 font-semibold">متأخر</span>
                          )}{' '}
                          · {entry.sourceLabel}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-10 text-center text-xs text-slate-500">
              {activeSelectedCell
                ? `لا توجد حالات غياب مسجلة لـ ${activeSelectedCell.grade} في يوم ${activeSelectedCell.weekdayLabel} ضمن النطاق المحدد.`
                : 'اضغط على أي خلية في الخريطة الحرارية لاستعراض تفاصيلها.'}
            </div>
          )}
        </div>
      </div>

      <PrintFooter
        preparedBy={userName || 'إدارة شؤون الطلبة'}
        approverTitle="اعتماد قائد المدرسة"
      />
    </div>
  );
};
