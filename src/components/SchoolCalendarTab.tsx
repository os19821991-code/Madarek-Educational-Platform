import React, { useMemo, useState } from 'react';
import {
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  BookOpenCheck,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Compass,
  Edit3,
  Filter,
  GraduationCap,
  MapPin,
  Plus,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { SCHOOL_GRADES } from '../lib/grades';
import type {
  CalendarEventType,
  SchoolCalendarEvent,
  Student,
  UserRole,
} from '../types';

interface SchoolCalendarTabProps {
  calendarEvents: SchoolCalendarEvent[];
  students: Student[];
  canManageCalendar: boolean;
  activeEdition: UserRole;
  currentUid: string;
  userName: string;
  showAddForm: boolean;
  onToggleAddForm: (open: boolean) => void;
  onNotify: (msg: string) => void;
}

const WEEKDAYS_AR = [
  'الأحد',
  'الإثنين',
  'الثلاثاء',
  'الأربعاء',
  'الخميس',
  'الجمعة',
  'السبت',
];

const MONTHS_AR = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];

const EVENT_TYPE_META: Record<
  CalendarEventType,
  {
    label: string;
    shortLabel: string;
    chipClass: string;
    badgeClass: string;
    dotClass: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  exam: {
    label: 'امتحان / اختبار',
    shortLabel: 'امتحان',
    chipClass: 'bg-red-50 text-red-800 border border-red-200 hover:bg-red-100',
    badgeClass: 'bg-red-50 text-red-800 border border-red-200',
    dotClass: 'bg-red-600',
    icon: BookOpenCheck,
  },
  trip: {
    label: 'رحلة مدرسية',
    shortLabel: 'رحلة',
    chipClass: 'bg-teal-50 text-teal-800 border border-teal-200 hover:bg-teal-100',
    badgeClass: 'bg-teal-50 text-teal-800 border border-teal-200',
    dotClass: 'bg-teal-700',
    icon: Compass,
  },
  meeting: {
    label: 'اجتماع',
    shortLabel: 'اجتماع',
    chipClass: 'bg-amber-50 text-amber-900 border border-amber-200 hover:bg-amber-100',
    badgeClass: 'bg-amber-50 text-amber-900 border border-amber-200',
    dotClass: 'bg-amber-600',
    icon: Users,
  },
};

function toIsoDate(year: number, monthIndex: number, day: number): string {
  const mm = String(monthIndex + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function getTodayIso(): string {
  const now = new Date();
  return toIsoDate(now.getFullYear(), now.getMonth(), now.getDate());
}

export const SchoolCalendarTab: React.FC<SchoolCalendarTabProps> = ({
  calendarEvents,
  students,
  canManageCalendar,
  activeEdition,
  currentUid,
  userName,
  showAddForm,
  onToggleAddForm,
  onNotify,
}) => {
  const todayIso = useMemo(() => getTodayIso(), []);
  const initialDate = useMemo(() => new Date(), []);

  const [viewYear, setViewYear] = useState(initialDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initialDate.getMonth());
  const [selectedDate, setSelectedDate] = useState(todayIso);

  const [typeFilter, setTypeFilter] = useState<'all' | CalendarEventType>('all');
  const [gradeFilter, setGradeFilter] = useState<string>('all');

  // Create / Edit Event Form State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [eventType, setEventType] = useState<CalendarEventType>('exam');
  const [eventDate, setEventDate] = useState(todayIso);
  const [startTime, setStartTime] = useState('08:30');
  const [targetGrade, setTargetGrade] = useState<string>('جميع الصفوف');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [sendNotification, setSendNotification] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const filteredEvents = useMemo(() => {
    return calendarEvents
      .filter((ev) => (typeFilter === 'all' ? true : ev.eventType === typeFilter))
      .filter((ev) => {
        if (gradeFilter === 'all') return true;
        return ev.targetGrade === 'جميع الصفوف' || ev.targetGrade === gradeFilter;
      })
      .sort((a, b) => {
        if (a.eventDate !== b.eventDate) return a.eventDate.localeCompare(b.eventDate);
        return (a.startTime || '').localeCompare(b.startTime || '');
      });
  }, [calendarEvents, typeFilter, gradeFilter]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, SchoolCalendarEvent[]>();
    for (const ev of filteredEvents) {
      const list = map.get(ev.eventDate) || [];
      list.push(ev);
      map.set(ev.eventDate, list);
    }
    return map;
  }, [filteredEvents]);

  const selectedDayEvents = useMemo(
    () => eventsByDate.get(selectedDate) || [],
    [eventsByDate, selectedDate],
  );

  const upcomingEvents = useMemo(() => {
    return filteredEvents.filter((ev) => ev.eventDate >= todayIso).slice(0, 8);
  }, [filteredEvents, todayIso]);

  const monthStats = useMemo(() => {
    const monthPrefix = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-`;
    const inMonth = filteredEvents.filter((ev) => ev.eventDate.startsWith(monthPrefix));
    return {
      total: inMonth.length,
      exams: inMonth.filter((ev) => ev.eventType === 'exam').length,
      trips: inMonth.filter((ev) => ev.eventType === 'trip').length,
      meetings: inMonth.filter((ev) => ev.eventType === 'meeting').length,
    };
  }, [filteredEvents, viewYear, viewMonth]);

  const calendarCells = useMemo(() => {
    const firstDayOfMonth = new Date(viewYear, viewMonth, 1).getDay(); // 0 = Sunday
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const cells: { dateIso: string | null; dayNumber: number | null }[] = [];

    for (let i = 0; i < firstDayOfMonth; i++) {
      cells.push({ dateIso: null, dayNumber: null });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      cells.push({
        dateIso: toIsoDate(viewYear, viewMonth, day),
        dayNumber: day,
      });
    }
    while (cells.length % 7 !== 0) {
      cells.push({ dateIso: null, dayNumber: null });
    }
    return cells;
  }, [viewYear, viewMonth]);

  const resetForm = (presetDate?: string) => {
    setEditingId(null);
    setTitle('');
    setEventType('exam');
    setEventDate(presetDate || selectedDate || todayIso);
    setStartTime('08:30');
    setTargetGrade('جميع الصفوف');
    setLocation('');
    setNotes('');
    setSendNotification(true);
  };

  const openCreateForDate = (dateIso: string) => {
    resetForm(dateIso);
    onToggleAddForm(true);
  };

  const startEditEvent = (ev: SchoolCalendarEvent) => {
    setEditingId(ev.id);
    setTitle(ev.title);
    setEventType(ev.eventType);
    setEventDate(ev.eventDate);
    setStartTime(ev.startTime || '');
    setTargetGrade(ev.targetGrade || 'جميع الصفوف');
    setLocation(ev.location || '');
    setNotes(ev.notes || '');
    setSendNotification(false);
    onToggleAddForm(true);
  };

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const handleJumpToday = () => {
    const now = new Date();
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth());
    setSelectedDate(todayIso);
  };

  const handleSaveEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageCalendar) return;

    const trimmedTitle = title.trim();
    if (trimmedTitle.length < 2) {
      onNotify('يرجى كتابة عنوان واضح للموعد (حرفان على الأقل).');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
      onNotify('يرجى اختيار تاريخ صحيح.');
      return;
    }

    setSaving(true);
    const trimmedTime = startTime.trim();
    const trimmedLocation = location.trim();
    const trimmedNotes = notes.trim();
    const safeCreatorName =
      userName && userName.trim().length >= 2 ? userName.trim().slice(0, 120) : 'إدارة المدرسة';
    const creatorRole: 'admin' | 'teacher' = activeEdition === 'admin' ? 'admin' : 'teacher';

    try {
      if (editingId) {
        await updateDoc(doc(db, 'calendarEvents', editingId), {
          title: trimmedTitle.slice(0, 160),
          eventType,
          eventDate,
          startTime: trimmedTime.slice(0, 20),
          targetGrade: targetGrade || 'جميع الصفوف',
          location: trimmedLocation.slice(0, 120),
          notes: trimmedNotes.slice(0, 500),
          updatedAt: serverTimestamp(),
        });
        setSelectedDate(eventDate);
        const [yStr, mStr] = eventDate.split('-');
        setViewYear(Number(yStr));
        setViewMonth(Number(mStr) - 1);
        resetForm(eventDate);
        onToggleAddForm(false);
        onNotify('تم تحديث موعد التقويم المدرسي بنجاح.');
      } else {
        const eventId = `cal_${Date.now()}`;
        const batch = writeBatch(db);
        const payload: Record<string, unknown> = {
          title: trimmedTitle.slice(0, 160),
          eventType,
          eventDate,
          targetGrade: targetGrade || 'جميع الصفوف',
          createdByName: safeCreatorName,
          createdByRole: creatorRole,
          scope: 'school',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        if (trimmedTime) payload.startTime = trimmedTime.slice(0, 20);
        if (trimmedLocation) payload.location = trimmedLocation.slice(0, 120);
        if (trimmedNotes) payload.notes = trimmedNotes.slice(0, 500);

        batch.set(doc(db, 'calendarEvents', eventId), payload);

        if (sendNotification) {
          const matchingStudents =
            targetGrade === 'جميع الصفوف'
              ? students
              : students.filter((s) => s.grade === targetGrade);
          const uniqueParentUids = Array.from(
            new Set(
              matchingStudents.length > 0
                ? matchingStudents.map((s) => s.parentUid)
                : [currentUid],
            ),
          );
          const typeLabel = EVENT_TYPE_META[eventType].shortLabel;
          const stamp = Date.now();
          uniqueParentUids.forEach((pUid, idx) => {
            const notifId = `notif_cal_${stamp}_${idx}`;
            batch.set(doc(db, 'notifications', notifId), {
              parentUid: pUid,
              title: `${typeLabel} في التقويم المدرسي: ${trimmedTitle}`.slice(0, 140),
              message: `التاريخ: ${eventDate}${trimmedTime ? ` · الساعة ${trimmedTime}` : ''} · الفئة: ${targetGrade}${trimmedLocation ? ` · الموقع: ${trimmedLocation}` : ''}`.slice(
                0,
                500,
              ),
              notifType: 'circular',
              isRead: false,
              createdAt: serverTimestamp(),
            });
          });
        }

        await batch.commit();
        setSelectedDate(eventDate);
        const [yStr, mStr] = eventDate.split('-');
        setViewYear(Number(yStr));
        setViewMonth(Number(mStr) - 1);
        resetForm(eventDate);
        onToggleAddForm(false);
        onNotify(
          sendNotification
            ? 'تمت إضافة الموعد إلى التقويم وإرسال تنبيه للطلاب وأولياء الأمور.'
            : 'تمت إضافة الموعد إلى التقويم المدرسي بنجاح.',
        );
      }
    } catch (error) {
      handleFirestoreError(
        error,
        editingId ? OperationType.UPDATE : OperationType.CREATE,
        editingId ? `calendarEvents/${editingId}` : 'calendarEvents',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteEvent = async (eventId: string) => {
    if (!canManageCalendar) return;
    try {
      await deleteDoc(doc(db, 'calendarEvents', eventId));
      setConfirmDeleteId(null);
      if (editingId === eventId) {
        resetForm();
        onToggleAddForm(false);
      }
      onNotify('تم حذف الموعد من التقويم المدرسي.');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `calendarEvents/${eventId}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Add / Edit Event Form */}
      {showAddForm && canManageCalendar && (
        <form
          onSubmit={handleSaveEvent}
          className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-sm font-bold font-display text-slate-900">
                {editingId ? 'تعديل موعد في التقويم المدرسي' : 'إضافة موعد جديد في التقويم المدرسي'}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                يظهر الموعد مباشرةً في تقويم الطلاب وأولياء الأمور وكافة الكادر المدرسي.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                resetForm();
                onToggleAddForm(false);
              }}
              className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              aria-label="إغلاق النموذج"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                عنوان الموعد (الامتحان / الرحلة / الاجتماع)
              </label>
              <input
                type="text"
                required
                minLength={2}
                maxLength={160}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="مثال: اختبار الرياضيات النصفي — أو رحلة القبة الفلكية"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-teal-700"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">نوع الموعد</label>
              <select
                value={eventType}
                onChange={(e) => setEventType(e.target.value as CalendarEventType)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="exam">امتحان / اختبار</option>
                <option value="trip">رحلة مدرسية</option>
                <option value="meeting">اجتماع</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">التاريخ</label>
              <input
                type="date"
                required
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                الوقت (اختياري)
              </label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                الصف المستهدف
              </label>
              <select
                value={targetGrade}
                onChange={(e) => setTargetGrade(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="جميع الصفوف">جميع الصفوف</option>
                {SCHOOL_GRADES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                المكان / القاعة (اختياري)
              </label>
              <input
                type="text"
                maxLength={120}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="مثال: القاعة الكبرى / مختبر الفيزياء"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                ملاحظات وتفاصيل إضافية (اختياري)
              </label>
              <input
                type="text"
                maxLength={500}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="مثال: إحضار الآلة الحاسبة، أو الالتزام بالزي المدرسي للرحلة"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-100">
            {!editingId ? (
              <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sendNotification}
                  onChange={(e) => setSendNotification(e.target.checked)}
                  className="rounded border-slate-300 text-teal-700 focus:ring-teal-700"
                />
                <span>إرسال إشعار فوري في التطبيق للطلاب وأولياء الأمور</span>
              </label>
            ) : (
              <span className="text-xs text-slate-500">تحديث تفاصيل الموعد المحدد</span>
            )}

            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {saving
                  ? 'جاري الحفظ...'
                  : editingId
                    ? 'حفظ التعديلات'
                    : 'إضافة الموعد إلى التقويم'}
              </button>
              <button
                type="button"
                onClick={() => {
                  resetForm();
                  onToggleAddForm(false);
                }}
                className="px-4 py-2 bg-slate-100 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
              >
                إلغاء
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Filter & Summary Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 ml-1">
            <Filter className="w-3.5 h-3.5 text-teal-700" />
            <span>تصفية التقويم:</span>
          </span>
          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(
              [
                { id: 'all', label: 'الكل' },
                { id: 'exam', label: 'الامتحانات' },
                { id: 'trip', label: 'الرحلات المدرسية' },
                { id: 'meeting', label: 'الاجتماعات' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setTypeFilter(opt.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  typeFilter === opt.id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <select
            value={gradeFilter}
            onChange={(e) => setGradeFilter(e.target.value)}
            aria-label="تصفية حسب الصف"
            className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-700"
          >
            <option value="all">جميع الصفوف</option>
            {SCHOOL_GRADES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm bg-red-600 inline-block" />
            <span>امتحانات:</span>
            <strong className="font-mono-num text-slate-900">{monthStats.exams}</strong>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm bg-teal-700 inline-block" />
            <span>رحلات:</span>
            <strong className="font-mono-num text-slate-900">{monthStats.trips}</strong>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm bg-amber-600 inline-block" />
            <span>اجتماعات:</span>
            <strong className="font-mono-num text-slate-900">{monthStats.meetings}</strong>
          </span>
        </div>
      </div>

      {/* Main 12-Col Calendar + Day/Upcoming Side Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Monthly Calendar Grid (8 cols) */}
        <section className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <CalendarDays className="w-4 h-4 text-teal-700" />
              <h3 className="text-base font-bold font-display text-slate-900">
                {MONTHS_AR[viewMonth]} <span className="font-mono-num">{viewYear}</span>
              </h3>
              <span className="text-xs text-slate-500 font-mono-num">
                ({monthStats.total} موعد)
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleJumpToday}
                className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                اليوم
              </button>
              <div className="inline-flex items-center border border-slate-200 rounded-lg overflow-hidden">
                <button
                  type="button"
                  onClick={handlePrevMonth}
                  aria-label="الشهر السابق"
                  className="p-1.5 text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={handleNextMonth}
                  aria-label="الشهر التالي"
                  className="p-1.5 text-slate-600 hover:bg-slate-50 border-r border-slate-200 cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Weekday Headers */}
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
            {WEEKDAYS_AR.map((dayName) => (
              <div
                key={dayName}
                className="py-2.5 px-1 text-center text-xs font-semibold text-slate-600"
              >
                {dayName}
              </div>
            ))}
          </div>

          {/* Calendar Cells */}
          <div className="grid grid-cols-7 divide-x divide-x-reverse divide-y divide-slate-100">
            {calendarCells.map((cell, idx) => {
              if (!cell.dateIso || cell.dayNumber === null) {
                return (
                  <div
                    key={`empty_${idx}`}
                    className="min-h-[86px] sm:min-h-[104px] bg-slate-50/60"
                  />
                );
              }

              const dateIso = cell.dateIso;
              const dayEvents = eventsByDate.get(dateIso) || [];
              const isSelected = selectedDate === dateIso;
              const isToday = todayIso === dateIso;

              return (
                <div
                  key={dateIso}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedDate(dateIso)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedDate(dateIso);
                    }
                  }}
                  className={`min-h-[86px] sm:min-h-[104px] p-1.5 sm:p-2 text-right transition-colors cursor-pointer flex flex-col justify-between ${
                    isSelected
                      ? 'bg-teal-50/70 ring-1 ring-inset ring-teal-700'
                      : 'bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span
                      className={`font-mono-num text-xs font-semibold w-6 h-6 inline-flex items-center justify-center rounded-md ${
                        isToday
                          ? 'bg-teal-700 text-white'
                          : isSelected
                            ? 'text-teal-900'
                            : 'text-slate-700'
                      }`}
                    >
                      {cell.dayNumber}
                    </span>
                    {dayEvents.length > 0 && (
                      <span className="font-mono-num text-[10px] text-slate-400 hidden sm:inline">
                        {dayEvents.length}
                      </span>
                    )}
                  </div>

                  <div className="mt-1 space-y-1">
                    {dayEvents.slice(0, 2).map((ev) => {
                      const meta = EVENT_TYPE_META[ev.eventType];
                      return (
                        <div
                          key={ev.id}
                          className={`px-1.5 py-0.5 rounded text-[11px] leading-tight truncate ${meta.chipClass}`}
                          title={`${meta.shortLabel}: ${ev.title}`}
                        >
                          {ev.title}
                        </div>
                      );
                    })}
                    {dayEvents.length > 2 && (
                      <div className="text-[10px] font-mono-num font-semibold text-teal-800 px-1">
                        +{dayEvents.length - 2} أخرى
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Selected Day Details & Upcoming Important Dates (4 cols) */}
        <aside className="lg:col-span-4 bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
          {/* Selected Day Header & Events */}
          <div className="p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs text-slate-500">مواعيد اليوم المحدد</p>
                <h4 className="text-base font-bold font-mono-num text-slate-900 mt-0.5">
                  {selectedDate}
                </h4>
              </div>
              {canManageCalendar && (
                <button
                  type="button"
                  onClick={() => openCreateForDate(selectedDate)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>إضافة في هذا اليوم</span>
                </button>
              )}
            </div>

            {selectedDayEvents.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-400">
                لا توجد امتحانات أو رحلات أو اجتماعات مسجلة في هذا التاريخ.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {selectedDayEvents.map((ev) => {
                  const meta = EVENT_TYPE_META[ev.eventType];
                  const Icon = meta.icon;
                  const isConfirming = confirmDeleteId === ev.id;

                  return (
                    <div key={ev.id} className="py-3.5 first:pt-1 last:pb-1 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1 min-w-0">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-md ${meta.badgeClass}`}
                          >
                            <Icon className="w-3 h-3 shrink-0" />
                            <span>{meta.label}</span>
                          </span>
                          <h5 className="text-sm font-bold text-slate-900 leading-snug">
                            {ev.title}
                          </h5>
                        </div>

                        {canManageCalendar && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => startEditEvent(ev)}
                              aria-label="تعديل الموعد"
                              className="p-1.5 text-slate-400 hover:text-teal-700 rounded-md hover:bg-slate-50 cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            {isConfirming ? (
                              <button
                                type="button"
                                onClick={() => handleDeleteEvent(ev.id)}
                                className="px-2 py-1 text-[11px] font-medium bg-red-700 text-white rounded-md hover:bg-red-800 cursor-pointer"
                              >
                                تأكيد الحذف
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(ev.id)}
                                aria-label="حذف الموعد"
                                className="p-1.5 text-slate-400 hover:text-red-700 rounded-md hover:bg-slate-50 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                        <span className="inline-flex items-center gap-1">
                          <GraduationCap className="w-3.5 h-3.5" />
                          <span>{ev.targetGrade}</span>
                        </span>
                        {ev.startTime && (
                          <span className="inline-flex items-center gap-1 font-mono-num">
                            <Clock className="w-3.5 h-3.5" />
                            <span>{ev.startTime}</span>
                          </span>
                        )}
                        {ev.location && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5" />
                            <span>{ev.location}</span>
                          </span>
                        )}
                      </div>

                      {ev.notes && (
                        <p className="text-xs text-slate-600 leading-relaxed">{ev.notes}</p>
                      )}

                      <p className="text-[11px] text-slate-400">
                        أضيف بواسطة: {ev.createdByName}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Upcoming Important Dates */}
          <div className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold font-display text-slate-900">
                التواريخ الهامة القادمة
              </h4>
              <span className="text-xs text-slate-500 font-mono-num">
                {upcomingEvents.length}
              </span>
            </div>

            {upcomingEvents.length === 0 ? (
              <p className="text-xs text-slate-400 py-3">
                لا توجد مواعيد قادمة مطابقة للتصفية الحالية.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {upcomingEvents.map((ev) => {
                  const meta = EVENT_TYPE_META[ev.eventType];
                  return (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={() => {
                        setSelectedDate(ev.eventDate);
                        const [yStr, mStr] = ev.eventDate.split('-');
                        setViewYear(Number(yStr));
                        setViewMonth(Number(mStr) - 1);
                      }}
                      className="w-full py-2.5 text-right hover:bg-slate-50 transition-colors flex items-start justify-between gap-3 cursor-pointer"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-sm shrink-0 ${meta.dotClass}`} />
                          <span className="text-xs font-semibold text-slate-900 truncate">
                            {ev.title}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 truncate">
                          {meta.shortLabel} · {ev.targetGrade}
                          {ev.location ? ` · ${ev.location}` : ''}
                        </p>
                      </div>
                      <span className="text-xs font-mono-num text-teal-800 font-medium shrink-0">
                        {ev.eventDate}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};
