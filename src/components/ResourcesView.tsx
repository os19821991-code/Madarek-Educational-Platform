import React, { useMemo, useState } from 'react';
import { doc, increment, serverTimestamp, writeBatch } from 'firebase/firestore';
import { BellRing, BookOpen, Calendar, CheckCircle2, ClipboardList, Download, Plus, RefreshCw } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  buildReminderNotificationId,
  findDueTomorrowHomework,
  getTomorrowDateIso,
} from '../lib/homeworkReminderService';
import { SCHOOL_GRADES } from '../lib/grades';
import type { HomeworkItem, LibraryResource, ParentNotification, ResourceType } from '../types';

interface ResourcesViewProps {
  homework: HomeworkItem[];
  libraryResources: LibraryResource[];
  notifications: ParentNotification[];
  canPublishResources: boolean;
  currentUid: string;
  userName: string;
  onRunHomeworkReminders?: () => Promise<void>;
  onNotify: (msg: string) => void;
}

const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
  ebook: 'كتاب إلكتروني',
  handout: 'ملزمة دراسية',
  guide: 'دليل مراجعة',
  worksheet: 'ورقة عمل',
};

export const ResourcesView: React.FC<ResourcesViewProps> = ({
  homework,
  libraryResources,
  notifications,
  canPublishResources,
  currentUid,
  userName,
  onRunHomeworkReminders,
  onNotify,
}) => {
  const [subTab, setSubTab] = useState<'homework' | 'library'>('homework');
  const [showAddForm, setShowAddForm] = useState(false);
  const [runningReminderCheck, setRunningReminderCheck] = useState(false);

  const tomorrowIso = getTomorrowDateIso();
  const dueTomorrowHomework = useMemo(
    () => findDueTomorrowHomework(homework),
    [homework],
  );

  const reminderIdSet = useMemo(() => new Set(notifications.map((n) => n.id)), [notifications]);
  const hwReminderNotifs = useMemo(
    () => notifications.filter((n) => n.id.startsWith('hwrem_')),
    [notifications],
  );

  // Homework Form
  const [hwTitle, setHwTitle] = useState('');
  const [hwSubject, setHwSubject] = useState('الرياضيات المتقدمة');
  const [hwGrade, setHwGrade] = useState<string>(SCHOOL_GRADES[0]);
  const [hwDueDate, setHwDueDate] = useState(tomorrowIso);
  const [hwDesc, setHwDesc] = useState('');

  // Library Resource Form
  const [libTitle, setLibTitle] = useState('');
  const [libSubject, setLibSubject] = useState('العلوم والفيزياء');
  const [libGrade, setLibGrade] = useState<string>(SCHOOL_GRADES[0]);
  const [libType, setLibType] = useState<ResourceType>('handout');
  const [libSummary, setLibSummary] = useState('');
  const [libSize, setLibSize] = useState('3.4 MB');

  const handlePublishHomework = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hwTitle.trim() || !hwDesc.trim()) return;
    const hwId = `hw_${Date.now()}`;

    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'homework', hwId), {
        title: hwTitle.trim(),
        subject: hwSubject.trim(),
        grade: hwGrade,
        teacherName: userName || 'الكادر التعليمي',
        description: hwDesc.trim(),
        dueDate: hwDueDate,
        scope: 'school',
        createdAt: serverTimestamp(),
      });

      batch.set(doc(db, 'notifications', `notif_hw_${Date.now()}`), {
        parentUid: currentUid,
        title: `واجب منزلي جديد — ${hwSubject}`,
        message: `${hwTitle.trim()} (${hwGrade}) · آخر موعد للتسليم: ${hwDueDate}`,
        notifType: 'homework',
        isRead: false,
        createdAt: serverTimestamp(),
      });

      await batch.commit();
      setHwTitle('');
      setHwDesc('');
      setShowAddForm(false);
      onNotify('تم نشر الواجب المنزلي وإرسال إشعار موعد التسليم لتطبيق أولياء الأمور.');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `homework/${hwId}`);
    }
  };

  const handlePublishResource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!libTitle.trim() || !libSummary.trim()) return;
    const resId = `lib_${Date.now()}`;
    const coverUrl =
      libSubject.includes('رياض') || libSubject.includes('حاس')
        ? '/src/assets/images/book_cover_math_1795034379260.jpg'
        : '/src/assets/images/book_cover_science_1795034379446.jpg';

    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'libraryResources', resId), {
        title: libTitle.trim(),
        subject: libSubject.trim(),
        grade: libGrade,
        resourceType: libType,
        authorName: userName || 'لجنة المناهج الرقمية',
        summary: libSummary.trim(),
        fileSizeLabel: libSize.trim() || '2.5 MB',
        coverUrl,
        downloadCount: 0,
        scope: 'school',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      setLibTitle('');
      setLibSummary('');
      setShowAddForm(false);
      onNotify('تم نشر المورد الرقمي في المكتبة وإتاحته للتحميل المباشر.');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `libraryResources/${resId}`);
    }
  };

  const handleDownloadResource = async (resource: LibraryResource) => {
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'libraryResources', resource.id), {
        downloadCount: increment(1),
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `libraryResources/${resource.id}`);
    }

    const content = [
      `منصة مدارك — المكتبة الرقمية والملازم الإلكترونية`,
      `=================================================`,
      `العنوان: ${resource.title}`,
      `النوع: ${RESOURCE_TYPE_LABELS[resource.resourceType]}`,
      `المادة: ${resource.subject} | المرحلة: ${resource.grade}`,
      `المعد: ${resource.authorName}`,
      ``,
      `ملخص المحتوى التعليمي:`,
      resource.summary,
      ``,
      `تم تحميل هذا الملف للاستخدام الدراسي الشخصي من بوابة المدرسة.`,
    ].join('\n');

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${resource.id}.txt`;
    link.click();
    URL.revokeObjectURL(url);
    onNotify(`بدأ تحميل "${resource.title}" بنجاح.`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-slate-200 rounded-xl p-5">
        <div>
          <h2 className="text-lg font-bold font-display text-slate-900">
            الواجبات المنزلية والمكتبة الرقمية والكتب الإلكترونية
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            نشر الواجبات بمواعيد التسليم وإتاحة الكتب والملازم الإلكترونية للتحميل المباشر
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => {
                setSubTab('homework');
                setShowAddForm(false);
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                subTab === 'homework'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              الواجبات المنزلية
            </button>
            <button
              type="button"
              onClick={() => {
                setSubTab('library');
                setShowAddForm(false);
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                subTab === 'library'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              المكتبة والكتب والملازم
            </button>
          </div>

          {canPublishResources && (
            <button
              type="button"
              onClick={() => setShowAddForm((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>{subTab === 'homework' ? 'نشر واجب جديد' : 'رفع كتاب / ملزمة'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Homework Tab (Req 13) */}
      {subTab === 'homework' && (
        <div className="space-y-5">
          {/* Automated 1-Day-Before Homework Reminder Service Banner */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1">
              <h3 className="text-sm font-bold font-display text-slate-900 flex items-center gap-2">
                <BellRing className="w-4 h-4 text-teal-700 shrink-0" />
                <span>خدمة التذكير التلقائي للواجبات قبل موعد التسليم بيوم واحد</span>
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                يتم فحص الواجبات المسجلة تلقائياً وإرسال إشعار فوري في التطبيق للطلاب وأولياء الأمور
                عندما يكون موعد التسليم غداً (<span className="font-mono-num">{tomorrowIso}</span>).
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-4 shrink-0">
              <div className="flex items-center gap-4 text-xs">
                <div>
                  <span className="text-slate-500">واجبات مستحقة غداً: </span>
                  <span className="font-mono-num font-bold text-slate-900">
                    {dueTomorrowHomework.length}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">تذكيرات تلقائية مسجلة: </span>
                  <span className="font-mono-num font-bold text-teal-700">
                    {hwReminderNotifs.length}
                  </span>
                </div>
              </div>

              {onRunHomeworkReminders && (
                <button
                  type="button"
                  disabled={runningReminderCheck}
                  onClick={async () => {
                    setRunningReminderCheck(true);
                    try {
                      await onRunHomeworkReminders();
                    } finally {
                      setRunningReminderCheck(false);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 text-slate-800 text-xs font-medium rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${runningReminderCheck ? 'animate-spin' : ''}`} />
                  <span>{runningReminderCheck ? 'جاري الفحص...' : 'فحص التذكيرات الآن'}</span>
                </button>
              )}
            </div>
          </div>

          {showAddForm && canPublishResources && (
            <form
              onSubmit={handlePublishHomework}
              className="bg-white border border-slate-200 rounded-xl p-6 grid grid-cols-1 md:grid-cols-2 gap-4"
            >
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">عنوان الواجب</label>
                <input
                  type="text"
                  required
                  value={hwTitle}
                  onChange={(e) => setHwTitle(e.target.value)}
                  placeholder="مثال: تمارين المعادلات الخطية"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">المادة</label>
                  <input
                    type="text"
                    required
                    value={hwSubject}
                    onChange={(e) => setHwSubject(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">الصف</label>
                  <select
                    value={hwGrade}
                    onChange={(e) => setHwGrade(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    {SCHOOL_GRADES.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  آخر موعد للتسليم
                </label>
                <input
                  type="date"
                  required
                  value={hwDueDate}
                  onChange={(e) => setHwDueDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">تفاصيل الواجب</label>
                <input
                  type="text"
                  required
                  value={hwDesc}
                  onChange={(e) => setHwDesc(e.target.value)}
                  placeholder="وصف الصفحات المطلوبة وتعليمات الحل..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="md:col-span-2 flex gap-2">
                <button
                  type="submit"
                  className="px-4 py-2 bg-teal-700 text-white text-sm font-medium rounded-lg hover:bg-teal-800 cursor-pointer"
                >
                  نشر الواجب وإشعار الطلاب
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-700 text-sm font-medium rounded-lg cursor-pointer"
                >
                  إلغاء
                </button>
              </div>
            </form>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {homework.map((item) => {
              const isDueTomorrow = item.dueDate === tomorrowIso;
              const reminderAlreadySent =
                reminderIdSet.has(buildReminderNotificationId(item.id, currentUid)) ||
                hwReminderNotifs.some((n) => n.id.startsWith(`hwrem_${item.id}_`));

              return (
                <div
                  key={item.id}
                  className={`bg-white border rounded-xl p-6 space-y-3 ${
                    isDueTomorrow ? 'border-amber-300' : 'border-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                    <span>
                      {item.subject} · {item.grade} · {item.teacherName}
                    </span>
                    <span className="inline-flex items-center gap-1 font-mono-num text-amber-700 font-medium shrink-0">
                      <Calendar className="w-3.5 h-3.5" />
                      <span>التسليم: {item.dueDate}</span>
                    </span>
                  </div>
                  <h3 className="text-base font-bold font-display text-slate-900 flex items-center gap-2">
                    <ClipboardList className="w-4 h-4 text-teal-700 shrink-0" />
                    <span>{item.title}</span>
                  </h3>
                  <p className="text-sm text-slate-600 leading-relaxed">{item.description}</p>
                  {isDueTomorrow && (
                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                      <span className="text-amber-700 font-medium">
                        موعد التسليم غداً (تنبيه قبل 24 ساعة)
                      </span>
                      <span className="inline-flex items-center gap-1 text-teal-700 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>
                          {reminderAlreadySent
                            ? 'تم إرسال التذكير التلقائي'
                            : 'مجدول للإرسال التلقائي'}
                        </span>
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
            {homework.length === 0 && (
              <div className="md:col-span-2 bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">
                لا توجد واجبات منزلية منشورة حالياً.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Digital Library & E-Books Tab (Req 8, 14) */}
      {subTab === 'library' && (
        <div className="space-y-5">
          {showAddForm && canPublishResources && (
            <form
              onSubmit={handlePublishResource}
              className="bg-white border border-slate-200 rounded-xl p-6 grid grid-cols-1 md:grid-cols-3 gap-4"
            >
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  عنوان الكتاب أو الملزمة
                </label>
                <input
                  type="text"
                  required
                  value={libTitle}
                  onChange={(e) => setLibTitle(e.target.value)}
                  placeholder="مثال: ملزمة المراجعة النهائية في الفيزياء"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">المادة</label>
                <input
                  type="text"
                  required
                  value={libSubject}
                  onChange={(e) => setLibSubject(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">النوع</label>
                  <select
                    value={libType}
                    onChange={(e) => setLibType(e.target.value as ResourceType)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="ebook">كتاب إلكتروني</option>
                    <option value="handout">ملزمة دراسية</option>
                    <option value="guide">دليل مراجعة</option>
                    <option value="worksheet">ورقة عمل</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">الصف</label>
                  <select
                    value={libGrade}
                    onChange={(e) => setLibGrade(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    {SCHOOL_GRADES.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">وصف المحتوى</label>
                <input
                  type="text"
                  required
                  value={libSummary}
                  onChange={(e) => setLibSummary(e.target.value)}
                  placeholder="ملخص الفصول والتدريبات المرفقة..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">حجم الملف</label>
                <input
                  type="text"
                  value={libSize}
                  onChange={(e) => setLibSize(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num"
                />
              </div>
              <div className="md:col-span-3 flex gap-2">
                <button
                  type="submit"
                  className="px-4 py-2 bg-teal-700 text-white text-sm font-medium rounded-lg hover:bg-teal-800 cursor-pointer"
                >
                  نشر في المكتبة الرقمية
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-700 text-sm font-medium rounded-lg cursor-pointer"
                >
                  إلغاء
                </button>
              </div>
            </form>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {libraryResources.map((res) => (
              <div
                key={res.id}
                className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col sm:flex-row"
              >
                <div className="sm:w-40 h-48 sm:h-auto bg-slate-100 shrink-0 relative flex items-center justify-center">
                  {res.coverUrl ? (
                    <img
                      src={res.coverUrl}
                      alt={res.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : (
                    <BookOpen className="w-10 h-10 text-teal-700" />
                  )}
                </div>

                <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                  <div className="space-y-1.5">
                    <p className="text-xs text-slate-500">
                      {RESOURCE_TYPE_LABELS[res.resourceType]} · {res.subject} · {res.grade}
                    </p>
                    <h3 className="text-base font-bold font-display text-slate-900">{res.title}</h3>
                    <p className="text-xs text-slate-600 leading-relaxed">{res.summary}</p>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                    <span className="text-xs text-slate-500 font-mono-num">
                      {res.fileSizeLabel} · {res.downloadCount} تحميل
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDownloadResource(res)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>تحميل فوري</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {libraryResources.length === 0 && (
              <div className="md:col-span-2 bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">
                المكتبة الرقمية فارغة حالياً.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
