import React, { useEffect, useMemo, useState } from 'react';
import { doc, increment, serverTimestamp, writeBatch } from 'firebase/firestore';
import {
  CalendarDays,
  MapPin,
  Megaphone,
  MessageSquare,
  Plus,
  Send,
  Users,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { EmailAlertsTab, type EmailAlertDraft } from './EmailAlertsTab';
import { SchoolCalendarTab } from './SchoolCalendarTab';
import { SchoolPollsTab } from './SchoolPollsTab';
import type {
  Activity,
  ActivityType,
  Announcement,
  AnnouncementCategory,
  AttendanceRecord,
  BehaviorDeduction,
  EmailAlertLog,
  EmailAlertSubscription,
  GradeRecord,
  HomeworkItem,
  Invoice,
  MessageItem,
  PollVote,
  SchoolCalendarEvent,
  SchoolPoll,
  Student,
  TeacherEvaluation,
  UserProfile,
  UserRole,
} from '../types';

export type CommunicationSubTab =
  | 'chat'
  | 'calendar'
  | 'polls'
  | 'email'
  | 'announcements'
  | 'activities';

interface CommunicationViewProps {
  students: Student[];
  teachers: TeacherEvaluation[];
  messages: MessageItem[];
  announcements: Announcement[];
  activities: Activity[];
  calendarEvents: SchoolCalendarEvent[];
  polls: SchoolPoll[];
  pollVotes: PollVote[];
  emailSubscriptions: EmailAlertSubscription[];
  emailLogs: EmailAlertLog[];
  attendance: AttendanceRecord[];
  behaviorDeductions: BehaviorDeduction[];
  homework: HomeworkItem[];
  grades: GradeRecord[];
  invoices: Invoice[];
  usersList?: UserProfile[];
  isAdminAccount?: boolean;
  pendingAutoEmailsCount?: number;
  activeEdition: UserRole;
  canMessageStaff: boolean;
  canMessageParents: boolean;
  canViewAnnouncements: boolean;
  canManageAnnouncements: boolean;
  canPublishGrades?: boolean;
  currentUid: string;
  userName: string;
  userEmail: string;
  requestedSubTab?: CommunicationSubTab | null;
  onClearRequestedSubTab?: () => void;
  prefilledEmailDraft?: EmailAlertDraft | null;
  onClearPrefilledEmailDraft?: () => void;
  onNotify: (msg: string) => void;
}

const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  trip: 'رحلة علمية',
  workshop: 'ورشة تدريبية',
  competition: 'مسابقة طلابية',
  ceremony: 'حفل مدرسي',
};

const CATEGORY_LABELS: Record<AnnouncementCategory, string> = {
  circular: 'تعميم إداري',
  urgent: 'إعلان عاجل',
  academic: 'شأن أكاديمي',
  event: 'فعالية مدرسية',
};

const ADMIN_CHANNEL_NAME = 'إدارة المدرسة والمدراء';

export const CommunicationView: React.FC<CommunicationViewProps> = ({
  students,
  teachers,
  messages,
  announcements,
  activities,
  calendarEvents,
  polls,
  pollVotes,
  emailSubscriptions,
  emailLogs,
  attendance,
  behaviorDeductions,
  homework,
  grades,
  invoices,
  usersList = [],
  isAdminAccount = false,
  pendingAutoEmailsCount = 0,
  activeEdition,
  canMessageStaff,
  canMessageParents,
  canViewAnnouncements,
  canManageAnnouncements,
  canPublishGrades,
  currentUid,
  userName,
  userEmail,
  requestedSubTab,
  onClearRequestedSubTab,
  prefilledEmailDraft,
  onClearPrefilledEmailDraft,
  onNotify,
}) => {
  const canChat = canMessageStaff || canMessageParents;
  const canSeeAnnouncements = canViewAnnouncements || canManageAnnouncements;
  const canManageCalendar =
    activeEdition === 'admin' ||
    activeEdition === 'teacher' ||
    canManageAnnouncements ||
    Boolean(canPublishGrades);
  const canManagePolls = canManageCalendar;
  const canSendSchoolAlerts =
    activeEdition === 'admin' ||
    activeEdition === 'teacher' ||
    activeEdition === 'supervisor' ||
    canManageAnnouncements ||
    Boolean(canPublishGrades);

  const [subTab, setSubTab] = useState<CommunicationSubTab>(canChat ? 'chat' : 'calendar');
  const [showAddCalendarEvent, setShowAddCalendarEvent] = useState(false);
  const [showCreatePoll, setShowCreatePoll] = useState(false);

  useEffect(() => {
    if (requestedSubTab) {
      setSubTab(requestedSubTab);
      onClearRequestedSubTab?.();
    }
  }, [requestedSubTab, onClearRequestedSubTab]);

  const effectiveSubTab: CommunicationSubTab =
    subTab === 'chat' && !canChat
      ? 'calendar'
      : (subTab === 'announcements' || subTab === 'activities') && !canSeeAnnouncements
        ? canChat
          ? 'chat'
          : 'calendar'
        : subTab;

  const recipients = useMemo(
    () => [
      {
        id: 'admin_channel',
        name: ADMIN_CHANNEL_NAME,
        subtitle: 'الإدارة المدرسية والشؤون الطلابية',
      },
      ...teachers.map((t) => ({
        id: t.id,
        name: t.teacherName,
        subtitle: t.subject,
      })),
    ],
    [teachers],
  );

  // Direct Chat state
  const [selectedStudentId, setSelectedStudentId] = useState(students[0]?.id || '');
  const [selectedRecipientName, setSelectedRecipientName] = useState(
    recipients[0]?.name || ADMIN_CHANNEL_NAME,
  );
  const [messageText, setMessageText] = useState('');

  // Announcement Form
  const [showAddAnnouncement, setShowAddAnnouncement] = useState(false);
  const [annTitle, setAnnTitle] = useState('');
  const [annCategory, setAnnCategory] = useState<AnnouncementCategory>('circular');
  const [annAudience, setAnnAudience] = useState('جميع أولياء الأمور');
  const [annBody, setAnnBody] = useState('');

  // Activity Form
  const [showAddActivity, setShowAddActivity] = useState(false);
  const [actTitle, setActTitle] = useState('');
  const [actType, setActType] = useState<ActivityType>('trip');
  const [actDate, setActDate] = useState('2026-12-08');
  const [actLocation, setActLocation] = useState('');
  const [actCapacity, setActCapacity] = useState(40);
  const [actDesc, setActDesc] = useState('');
  const [registeredIds, setRegisteredIds] = useState<string[]>([]);

  const activeStudent = students.find((s) => s.id === selectedStudentId) || students[0] || null;

  const threadMessages = messages.filter(
    (m) =>
      (!activeStudent || m.studentId === activeStudent.id) &&
      m.teacherName === selectedRecipientName,
  );

  const isStaffPerspective =
    activeEdition === 'admin' ||
    activeEdition === 'teacher' ||
    (canMessageParents && !canMessageStaff);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageText.trim() || !activeStudent || !canChat) return;
    const msgId = `msg_${Date.now()}`;
    const senderRole: 'parent' | 'teacher' | 'admin' =
      activeEdition === 'admin'
        ? 'admin'
        : isStaffPerspective
          ? 'teacher'
          : 'parent';

    const senderName =
      senderRole === 'admin'
        ? userName || ADMIN_CHANNEL_NAME
        : senderRole === 'teacher'
          ? selectedRecipientName === ADMIN_CHANNEL_NAME
            ? userName || 'الكادر التعليمي'
            : selectedRecipientName
          : userName || activeStudent.parentName;

    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'messages', msgId), {
        parentUid: activeStudent.parentUid,
        studentId: activeStudent.id,
        studentName: activeStudent.fullName,
        teacherName: selectedRecipientName,
        senderRole,
        senderName,
        body: messageText.trim(),
        createdAt: serverTimestamp(),
      });
      await batch.commit();
      setMessageText('');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `messages/${msgId}`);
    }
  };

  const handlePublishAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!annTitle.trim() || !annBody.trim() || !canManageAnnouncements) return;
    const annId = `ann_${Date.now()}`;

    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'announcements', annId), {
        title: annTitle.trim(),
        body: annBody.trim(),
        category: annCategory,
        targetAudience: annAudience.trim(),
        authorName: userName || 'إدارة المدرسة',
        scope: 'school',
        createdAt: serverTimestamp(),
      });

      // Push instant notification to parents (Req 12)
      const uniqueParentUids = Array.from(
        new Set([currentUid, ...students.map((s) => s.parentUid)]),
      );
      for (const pUid of uniqueParentUids) {
        batch.set(doc(db, 'notifications', `notif_ann_${Date.now()}_${pUid.slice(0, 6)}`), {
          parentUid: pUid,
          title: `${CATEGORY_LABELS[annCategory]}: ${annTitle.trim()}`,
          message: annBody.trim().slice(0, 220),
          notifType: 'circular',
          isRead: false,
          createdAt: serverTimestamp(),
        });
      }

      await batch.commit();
      setAnnTitle('');
      setAnnBody('');
      setShowAddAnnouncement(false);
      onNotify('تم نشر التعميم المدرسي وإرسال إشعار فوري لجميع أولياء الأمور.');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `announcements/${annId}`);
    }
  };

  const handlePublishActivity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actTitle.trim() || !actLocation.trim() || !actDesc.trim() || !canManageAnnouncements) return;
    const actId = `act_${Date.now()}`;

    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'activities', actId), {
        title: actTitle.trim(),
        description: actDesc.trim(),
        activityType: actType,
        eventDate: actDate,
        location: actLocation.trim(),
        capacity: Math.max(1, Number(actCapacity)),
        registeredCount: 0,
        imageUrl: '/src/assets/images/activity_science_trip_1795034380174.jpg',
        scope: 'school',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      setActTitle('');
      setActLocation('');
      setActDesc('');
      setShowAddActivity(false);
      onNotify('تمت إضافة النشاط المدرسي بنجاح.');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `activities/${actId}`);
    }
  };

  const handleRegisterForActivity = async (activity: Activity) => {
    if (!activeStudent) {
      onNotify('يرجى إضافة طالب أولاً لإتمام التسجيل في النشاط.');
      return;
    }
    if (activity.registeredCount >= activity.capacity) {
      onNotify('اكتملت المقاعد المتاحة لهذا النشاط.');
      return;
    }

    const regId = `${activeStudent.id}_${Date.now()}`;
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'activities', activity.id, 'registrations', regId), {
        activityId: activity.id,
        studentId: activeStudent.id,
        studentName: activeStudent.fullName,
        parentUid: activeStudent.parentUid,
        createdAt: serverTimestamp(),
      });
      batch.update(doc(db, 'activities', activity.id), {
        registeredCount: increment(1),
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      setRegisteredIds((prev) => [...prev, activity.id]);
      onNotify(`تم تسجيل ${activeStudent.fullName} في "${activity.title}" بنجاح.`);
    } catch (error) {
      handleFirestoreError(
        error,
        OperationType.WRITE,
        `activities/${activity.id}/registrations/${regId}`,
      );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Tabs */}
      <div className="no-print flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white border border-slate-200 rounded-xl p-5">
        <div>
          <h2 className="text-lg font-bold font-display text-slate-900">
            {canSeeAnnouncements
              ? 'التواصل والتقويم والاستطلاعات والأنشطة'
              : 'التواصل المباشر والتقويم والاستطلاعات'}
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            {isStaffPerspective
              ? 'تواصل مباشر مع الطلاب وأولياء الأمور، وإدارة مواعيد التقويم واستطلاعات الرأي حول الرحلات والقرارات المدرسية'
              : 'مساحة تواصل مباشر لمراسلة المعلمين والإدارة والمشاركة في استطلاعات الرأي المدرسية'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto max-w-full">
            {canChat && (
              <button
                type="button"
                onClick={() => setSubTab('chat')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  effectiveSubTab === 'chat'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                التواصل المباشر
              </button>
            )}
            <button
              type="button"
              onClick={() => setSubTab('calendar')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                effectiveSubTab === 'calendar'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              التقويم المدرسي
            </button>
            <button
              type="button"
              onClick={() => setSubTab('polls')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                effectiveSubTab === 'polls'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              استطلاعات الرأي
            </button>
            <button
              type="button"
              onClick={() => setSubTab('email')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                effectiveSubTab === 'email'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>تنبيهات البريد</span>
              {canSendSchoolAlerts && pendingAutoEmailsCount > 0 && (
                <span className="font-mono-num font-bold text-teal-700 mr-1">
                  ({pendingAutoEmailsCount})
                </span>
              )}
            </button>
            {canSeeAnnouncements && (
              <>
                <button
                  type="button"
                  onClick={() => setSubTab('announcements')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    effectiveSubTab === 'announcements'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  الإعلانات والتعاميم
                </button>
                <button
                  type="button"
                  onClick={() => setSubTab('activities')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    effectiveSubTab === 'activities'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  الأنشطة والرحلات
                </button>
              </>
            )}
          </div>

          {canManageCalendar && effectiveSubTab === 'calendar' && (
            <button
              type="button"
              onClick={() => setShowAddCalendarEvent((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة موعد في التقويم</span>
            </button>
          )}

          {canManagePolls && effectiveSubTab === 'polls' && (
            <button
              type="button"
              onClick={() => setShowCreatePoll((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>إنشاء استطلاع رأي</span>
            </button>
          )}

          {canManageAnnouncements && effectiveSubTab === 'announcements' && (
            <button
              type="button"
              onClick={() => setShowAddAnnouncement((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>نشر تعميم فوري</span>
            </button>
          )}

          {canManageAnnouncements && effectiveSubTab === 'activities' && (
            <button
              type="button"
              onClick={() => setShowAddActivity((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة رحلة أو نشاط</span>
            </button>
          )}
        </div>
      </div>

      {/* Interactive School Calendar (Exams, Trips, Meetings) */}
      {effectiveSubTab === 'calendar' && (
        <SchoolCalendarTab
          calendarEvents={calendarEvents}
          students={students}
          canManageCalendar={canManageCalendar}
          activeEdition={activeEdition}
          currentUid={currentUid}
          userName={userName}
          showAddForm={showAddCalendarEvent}
          onToggleAddForm={setShowAddCalendarEvent}
          onNotify={onNotify}
        />
      )}

      {/* Digital Polls & Surveys (Trips & School Decisions) */}
      {effectiveSubTab === 'polls' && (
        <SchoolPollsTab
          polls={polls}
          pollVotes={pollVotes}
          students={students}
          canManagePolls={canManagePolls}
          activeEdition={activeEdition}
          currentUid={currentUid}
          userName={userName}
          showCreateForm={showCreatePoll}
          onToggleCreateForm={setShowCreatePoll}
          onNotify={onNotify}
        />
      )}

      {/* Email Alerts via Gmail */}
      {effectiveSubTab === 'email' && (
        <EmailAlertsTab
          subscriptions={emailSubscriptions}
          emailLogs={emailLogs}
          students={students}
          usersList={usersList}
          attendance={attendance}
          behaviorDeductions={behaviorDeductions}
          homework={homework}
          grades={grades}
          invoices={invoices}
          announcements={announcements}
          polls={polls}
          activeEdition={activeEdition}
          canSendSchoolAlerts={canSendSchoolAlerts}
          isAdminAccount={isAdminAccount}
          currentUid={currentUid}
          userName={userName}
          userEmail={userEmail}
          prefilledDraft={prefilledEmailDraft}
          onClearPrefilledDraft={onClearPrefilledEmailDraft}
          onNotify={onNotify}
        />
      )}

      {/* Direct Teacher/Admin-Parent/Student Chat (Req 4) */}
      {effectiveSubTab === 'chat' && canChat && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-bold font-display text-slate-900">اختيار المحادثة</h3>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">الطالب المعني</label>
                <select
                  value={activeStudent?.id || ''}
                  onChange={(e) => setSelectedStudentId(e.target.value)}
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
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  {isStaffPerspective ? 'قناة المراسلة (المعلم / الإدارة)' : 'المعلم أو إدارة المدرسة'}
                </label>
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                  {recipients.map((rec) => (
                    <button
                      key={rec.id}
                      type="button"
                      onClick={() => setSelectedRecipientName(rec.name)}
                      className={`w-full text-right p-3 transition-colors cursor-pointer ${
                        selectedRecipientName === rec.name
                          ? 'bg-teal-50 text-teal-900'
                          : 'bg-white hover:bg-slate-50 text-slate-800'
                      }`}
                    >
                      <p className="text-sm font-semibold">{rec.name}</p>
                      <p className="text-xs text-slate-500">{rec.subtitle}</p>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl flex flex-col min-h-[440px]">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <MessageSquare className="w-4 h-4 text-teal-700" />
                <div>
                  <h3 className="text-sm font-bold text-slate-900">{selectedRecipientName}</h3>
                  <p className="text-xs text-slate-500">
                    بخصوص الطالب: {activeStudent?.fullName || 'غير محدد'}
                  </p>
                </div>
              </div>
              <span className="text-xs text-slate-500">
                الإرسال بصفتك:{' '}
                {activeEdition === 'admin'
                  ? 'إدارة المدرسة'
                  : isStaffPerspective
                    ? 'المعلم'
                    : 'ولي الأمر / الطالب'}
              </span>
            </div>

            <div className="flex-1 p-6 space-y-4 overflow-y-auto max-h-[360px]">
              {threadMessages.map((msg) => {
                const isMine =
                  (isStaffPerspective && msg.senderRole !== 'parent') ||
                  (!isStaffPerspective && msg.senderRole === 'parent');

                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col max-w-lg ${
                      isMine ? 'mr-auto items-end' : 'ml-auto items-start'
                    }`}
                  >
                    <p className="text-xs text-slate-500 mb-1">
                      {msg.senderName} ·{' '}
                      {msg.senderRole === 'parent'
                        ? 'ولي الأمر / الطالب'
                        : msg.senderRole === 'admin'
                          ? 'إدارة المدرسة'
                          : 'المعلم'}
                    </p>
                    <div
                      className={`px-4 py-3 rounded-xl text-sm leading-relaxed ${
                        isMine
                          ? 'bg-teal-700 text-white'
                          : 'bg-slate-100 text-slate-800 border border-slate-200'
                      }`}
                    >
                      {msg.body}
                    </div>
                  </div>
                );
              })}
              {threadMessages.length === 0 && (
                <div className="h-48 flex items-center justify-center text-sm text-slate-400">
                  ابدأ المحادثة المباشرة مع {selectedRecipientName} حول المستوى الأكاديمي أو متابعة
                  الطالب.
                </div>
              )}
            </div>

            <form
              onSubmit={handleSendMessage}
              className="p-4 border-t border-slate-200 flex items-center gap-3"
            >
              <input
                type="text"
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                placeholder="اكتب رسالتك المباشرة هنا..."
                className="flex-1 px-4 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-teal-700"
              />
              <button
                type="submit"
                disabled={!activeStudent || !messageText.trim()}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-teal-700 text-white text-sm font-medium rounded-lg hover:bg-teal-800 disabled:opacity-50 cursor-pointer shrink-0"
              >
                <Send className="w-4 h-4" />
                <span>إرسال</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Announcements & Circulars (Req 12) */}
      {effectiveSubTab === 'announcements' && canSeeAnnouncements && (
        <div className="space-y-5">
          {showAddAnnouncement && canManageAnnouncements && (
            <form
              onSubmit={handlePublishAnnouncement}
              className="bg-white border border-slate-200 rounded-xl p-6 grid grid-cols-1 md:grid-cols-3 gap-4"
            >
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  عنوان التعميم أو الإعلان
                </label>
                <input
                  type="text"
                  required
                  value={annTitle}
                  onChange={(e) => setAnnTitle(e.target.value)}
                  placeholder="مثال: تعميم مواعيد الانصراف الشتوي"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">التصنيف</label>
                <select
                  value={annCategory}
                  onChange={(e) => setAnnCategory(e.target.value as AnnouncementCategory)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="circular">تعميم إداري</option>
                  <option value="urgent">إعلان عاجل</option>
                  <option value="academic">شأن أكاديمي</option>
                  <option value="event">فعالية مدرسية</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  الفئة المستهدفة
                </label>
                <input
                  type="text"
                  required
                  value={annAudience}
                  onChange={(e) => setAnnAudience(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="md:col-span-3">
                <label className="block text-xs font-medium text-slate-700 mb-1">نص التعميم</label>
                <textarea
                  rows={3}
                  required
                  value={annBody}
                  onChange={(e) => setAnnBody(e.target.value)}
                  placeholder="اكتب تفاصيل التعميم ليصل إشعاره فوراً لكافة أولياء الأمور..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="md:col-span-3 flex gap-2">
                <button
                  type="submit"
                  className="px-4 py-2 bg-teal-700 text-white text-sm font-medium rounded-lg hover:bg-teal-800 cursor-pointer"
                >
                  نشر وإرسال إشعار فوري للجميع
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddAnnouncement(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-700 text-sm font-medium rounded-lg cursor-pointer"
                >
                  إلغاء
                </button>
              </div>
            </form>
          )}

          <div className="space-y-4">
            {announcements.map((ann) => (
              <article
                key={ann.id}
                className="bg-white border border-slate-200 rounded-xl p-6 space-y-2"
              >
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Megaphone className="w-3.5 h-3.5 text-teal-700" />
                  <span
                    className={`font-semibold ${
                      ann.category === 'urgent' ? 'text-red-700' : 'text-teal-800'
                    }`}
                  >
                    {CATEGORY_LABELS[ann.category]}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{ann.targetAudience}</span>
                  <span aria-hidden="true">·</span>
                  <span>{ann.authorName}</span>
                </div>
                <h3 className="text-base font-bold font-display text-slate-900">{ann.title}</h3>
                <p className="text-sm text-slate-600 leading-relaxed">{ann.body}</p>
              </article>
            ))}
          </div>
        </div>
      )}

      {/* School Activities & Trips (Req 5) */}
      {effectiveSubTab === 'activities' && canSeeAnnouncements && (
        <div className="space-y-5">
          {showAddActivity && canManageAnnouncements && (
            <form
              onSubmit={handlePublishActivity}
              className="bg-white border border-slate-200 rounded-xl p-6 grid grid-cols-1 md:grid-cols-3 gap-4"
            >
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  اسم النشاط أو الرحلة
                </label>
                <input
                  type="text"
                  required
                  value={actTitle}
                  onChange={(e) => setActTitle(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">النوع</label>
                <select
                  value={actType}
                  onChange={(e) => setActType(e.target.value as ActivityType)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="trip">رحلة علمية</option>
                  <option value="workshop">ورشة تدريبية</option>
                  <option value="competition">مسابقة</option>
                  <option value="ceremony">حفل مدرسي</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">التاريخ</label>
                  <input
                    type="date"
                    required
                    value={actDate}
                    onChange={(e) => setActDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">السعة</label>
                  <input
                    type="number"
                    min={5}
                    max={500}
                    value={actCapacity}
                    onChange={(e) => setActCapacity(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">الموقع</label>
                <input
                  type="text"
                  required
                  value={actLocation}
                  onChange={(e) => setActLocation(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">الوصف</label>
                <input
                  type="text"
                  required
                  value={actDesc}
                  onChange={(e) => setActDesc(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="md:col-span-3 flex gap-2">
                <button
                  type="submit"
                  className="px-4 py-2 bg-teal-700 text-white text-sm font-medium rounded-lg hover:bg-teal-800 cursor-pointer"
                >
                  حفظ ونشر النشاط
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddActivity(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-700 text-sm font-medium rounded-lg cursor-pointer"
                >
                  إلغاء
                </button>
              </div>
            </form>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {activities.map((act) => {
              const pct = Math.min(100, Math.round((act.registeredCount / act.capacity) * 100));
              const alreadyRegistered = registeredIds.includes(act.id);

              return (
                <div
                  key={act.id}
                  className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col"
                >
                  <div className="h-48 bg-slate-100 relative overflow-hidden">
                    <img
                      src={act.imageUrl || '/src/assets/images/activity_science_trip_1795034380174.jpg'}
                      alt={act.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  </div>
                  <div className="p-6 flex-1 flex flex-col justify-between space-y-4">
                    <div className="space-y-2">
                      <p className="text-xs text-teal-700 font-medium">
                        {ACTIVITY_TYPE_LABELS[act.activityType]} ·{' '}
                        <span className="font-mono-num">{act.eventDate}</span>
                      </p>
                      <h3 className="text-base font-bold font-display text-slate-900">
                        {act.title}
                      </h3>
                      <p className="text-xs text-slate-600 leading-relaxed">{act.description}</p>
                      <div className="flex flex-wrap items-center gap-4 pt-1 text-xs text-slate-500">
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5" />
                          <span>{act.location}</span>
                        </span>
                        <span className="inline-flex items-center gap-1 font-mono-num">
                          <CalendarDays className="w-3.5 h-3.5" />
                          <span>{act.eventDate}</span>
                        </span>
                      </div>
                    </div>

                    <div className="space-y-3 pt-3 border-t border-slate-100">
                      <div className="flex items-center justify-between text-xs text-slate-600">
                        <span className="inline-flex items-center gap-1">
                          <Users className="w-3.5 h-3.5" />
                          <span>المقاعد المسجلة</span>
                        </span>
                        <span className="font-mono-num font-semibold">
                          {act.registeredCount} / {act.capacity}
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-teal-700 rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <button
                        type="button"
                        disabled={alreadyRegistered || act.registeredCount >= act.capacity}
                        onClick={() => handleRegisterForActivity(act)}
                        className="w-full py-2.5 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 disabled:bg-slate-200 disabled:text-slate-500 transition-colors cursor-pointer"
                      >
                        {alreadyRegistered
                          ? 'تم تسجيل الطالب في هذا النشاط'
                          : act.registeredCount >= act.capacity
                            ? 'اكتملت المقاعد'
                            : `تسجيل الطالب (${activeStudent?.fullName?.split(' ')[0] || 'المحدد'})`}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
