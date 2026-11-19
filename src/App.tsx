/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  AlertTriangle,
  Award,
  BarChart3,
  BellRing,
  BookOpen,
  CalendarCheck,
  CreditCard,
  GraduationCap,
  HeartHandshake,
  LogOut,
  Menu,
  MessageSquare,
  Shield,
  X,
} from 'lucide-react';
import {
  ADMIN_EMAIL,
  auth,
  clearGmailAccessToken,
  connectGmailAccess,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
  setGmailAccessToken,
  subscribeGmailToken,
} from './firebase';
import {
  canAccessNavSection,
  DEFAULT_ROLE_PERMISSIONS,
  EDITION_METADATA,
  EDITION_ORDER,
  getDefaultNavSection,
} from './lib/permissions';
import {
  buildMonthlyPerformanceReportEmails,
  buildSingleAttendanceWarningEmail,
  buildSingleBehaviorWarningEmail,
  collectAutomatedSchoolWarnings,
  dispatchAutomatedEmailsViaGmail,
  getDefaultReportMonthKey,
  type AutomatedEmailItem,
} from './lib/emailAutomationService';
import { dispatchDueTomorrowHomeworkReminders } from './lib/homeworkReminderService';
import { normalizeGradeName } from './lib/grades';
import { formatArabicMonth } from './lib/pdfReportGenerator';
import {
  migrateLegacyGradesIfNeeded,
  seedDefaultCalendarEvents,
  seedDefaultDonationCampaigns,
  seedDefaultPolls,
  seedDefaultRolePermissions,
  seedSchoolWorkspace,
} from './lib/seedData';
import { ErrorBoundary } from './components/ErrorBoundary';
import { OverviewView } from './components/OverviewView';
import { AttendanceView } from './components/AttendanceView';
import { GradesReportsView } from './components/GradesReportsView';
import { ResourcesView } from './components/ResourcesView';
import { CommunicationView, type CommunicationSubTab } from './components/CommunicationView';
import type { EmailAlertDraft } from './components/EmailAlertsTab';
import { GmailDispatchConfirmModal } from './components/GmailDispatchConfirmModal';
import { BillingView } from './components/BillingView';
import { DonationsView } from './components/DonationsView';
import { TeachersEvalView } from './components/TeachersEvalView';
import { PermissionsAdminView } from './components/PermissionsAdminView';
import { StudentProfileView } from './components/StudentProfileView';
import { MobileNotificationsDrawer } from './components/MobileNotificationsDrawer';
import type {
  Activity,
  Announcement,
  AttendanceRecord,
  AttendanceReport,
  BehaviorDeduction,
  DonationCampaign,
  DonationRecord,
  EmailAlertCategory,
  EmailAlertLog,
  EmailAlertSubscription,
  GradeRecord,
  HomeworkItem,
  Invoice,
  LibraryResource,
  MessageItem,
  NavSection,
  ParentNotification,
  PeriodAttendanceRecord,
  PermissionKey,
  PollVote,
  QrAttendanceSession,
  RolePermissionDoc,
  RolePermissionFlags,
  SchoolCalendarEvent,
  SchoolPoll,
  Student,
  TeacherEvaluation,
  UserProfile,
  UserRole,
} from './types';

const NAV_ITEMS: { id: NavSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'overview', label: 'لوحة الإحصائيات', icon: BarChart3 },
  { id: 'attendance', label: 'الحضور والغياب الآلي', icon: CalendarCheck },
  { id: 'grades', label: 'الدرجات والسلوك والتقارير', icon: GraduationCap },
  { id: 'resources', label: 'الواجبات والمكتبة الرقمية', icon: BookOpen },
  { id: 'communication', label: 'التواصل والتقويم والبريد', icon: MessageSquare },
  { id: 'billing', label: 'الرسوم والفواتير', icon: CreditCard },
  { id: 'donations', label: 'صندوق التبرعات', icon: HeartHandshake },
  { id: 'teachers', label: 'تقييم الكادر التعليمي', icon: Award },
  { id: 'permissions', label: 'إدارة النسخ والصلاحيات', icon: Shield },
];

function SchoolPlatform() {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [activeSection, setActiveSection] = useState<NavSection>('overview');
  const [activeEdition, setActiveEdition] = useState<UserRole>('admin');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [requestedCommSubTab, setRequestedCommSubTab] = useState<CommunicationSubTab | null>(null);
  const [prefilledEmailDraft, setPrefilledEmailDraft] = useState<EmailAlertDraft | null>(null);
  const [selectedProfileStudentId, setSelectedProfileStudentId] = useState<string | null>(null);
  const [earlyAbsenceInstantEmail, setEarlyAbsenceInstantEmail] = useState(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  // Live Firestore Data State
  const [students, setStudents] = useState<Student[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [periodAttendance, setPeriodAttendance] = useState<PeriodAttendanceRecord[]>([]);
  const [qrSessions, setQrSessions] = useState<QrAttendanceSession[]>([]);
  const [attendanceReports, setAttendanceReports] = useState<AttendanceReport[]>([]);
  const [grades, setGrades] = useState<GradeRecord[]>([]);
  const [behaviorDeductions, setBehaviorDeductions] = useState<BehaviorDeduction[]>([]);
  const [teachers, setTeachers] = useState<TeacherEvaluation[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<SchoolCalendarEvent[]>([]);
  const [polls, setPolls] = useState<SchoolPoll[]>([]);
  const [pollVotes, setPollVotes] = useState<PollVote[]>([]);
  const [emailSubscriptions, setEmailSubscriptions] = useState<EmailAlertSubscription[]>([]);
  const [emailLogs, setEmailLogs] = useState<EmailAlertLog[]>([]);
  const [homework, setHomework] = useState<HomeworkItem[]>([]);
  const [libraryResources, setLibraryResources] = useState<LibraryResource[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [donationCampaigns, setDonationCampaigns] = useState<DonationCampaign[]>([]);
  const [donations, setDonations] = useState<DonationRecord[]>([]);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [notifications, setNotifications] = useState<ParentNotification[]>([]);
  const [rolePermDocs, setRolePermDocs] = useState<RolePermissionDoc[]>([]);
  const [usersList, setUsersList] = useState<UserProfile[]>([]);
  const [studentsLoaded, setStudentsLoaded] = useState(false);
  const [homeworkLoaded, setHomeworkLoaded] = useState(false);
  const [notificationsLoaded, setNotificationsLoaded] = useState(false);
  const [gmailToken, setGmailToken] = useState<string | null>(null);
  const [globalGmailConfirm, setGlobalGmailConfirm] = useState<{
    open: boolean;
    title: string;
    subtitle: string;
    items: AutomatedEmailItem[];
  }>({
    open: false,
    title: '',
    subtitle: '',
    items: [],
  });
  const [sendingGlobalGmail, setSendingGlobalGmail] = useState(false);
  const reminderInFlightRef = useRef<Set<string>>(new Set());

  const isPrincipalAccount = Boolean(user?.email === ADMIN_EMAIL && user?.emailVerified);
  const isAdminAccount = Boolean(isPrincipalAccount || userProfile?.role === 'admin');
  const effectiveEdition: UserRole = isAdminAccount
    ? activeEdition
    : userProfile?.role || 'parent';

  const rolePermissions = useMemo<Record<UserRole, RolePermissionFlags>>(() => {
    const merged: Record<UserRole, RolePermissionFlags> = {
      parent: { ...DEFAULT_ROLE_PERMISSIONS.parent },
      teacher: { ...DEFAULT_ROLE_PERMISSIONS.teacher },
      admin: { ...DEFAULT_ROLE_PERMISSIONS.admin },
      supervisor: { ...DEFAULT_ROLE_PERMISSIONS.supervisor },
    };

    for (const docItem of rolePermDocs) {
      const roleKey = (docItem.role || docItem.id) as UserRole;
      if (roleKey in merged) {
        const base = DEFAULT_ROLE_PERMISSIONS[roleKey];
        const nextFlags: RolePermissionFlags = { ...base };
        (Object.keys(base) as PermissionKey[]).forEach((permKey) => {
          if (typeof docItem[permKey] === 'boolean') {
            nextFlags[permKey] = docItem[permKey];
          }
        });
        merged[roleKey] = nextFlags;
      }
    }

    return merged;
  }, [rolePermDocs]);

  const activePermissions = rolePermissions[effectiveEdition];

  const visibleNavItems = useMemo(
    () => NAV_ITEMS.filter((item) => canAccessNavSection(item.id, activePermissions)),
    [activePermissions],
  );

  const effectiveSection: NavSection = canAccessNavSection(activeSection, activePermissions)
    ? activeSection
    : getDefaultNavSection(activePermissions);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 4500);
  };

  useEffect(() => {
    return subscribeGmailToken(setGmailToken);
  }, []);

  const pendingAutoEmailsCount = useMemo(() => {
    if (!user || effectiveEdition === 'parent') return 0;
    const senderName = user.displayName || 'إدارة المدرسة';
    const monthly = buildMonthlyPerformanceReportEmails({
      monthKey: getDefaultReportMonthKey(),
      subscriptions: emailSubscriptions,
      students,
      attendance,
      grades,
      behaviorDeductions,
      invoices,
      emailLogs,
      senderName,
    }).filter((item) => !item.alreadySent);

    const warnings = collectAutomatedSchoolWarnings({
      subscriptions: emailSubscriptions,
      attendance,
      behaviorDeductions,
      invoices,
      homework,
      emailLogs,
      senderName,
    }).filter((item) => !item.alreadySent);

    return monthly.length + warnings.length;
  }, [
    user,
    effectiveEdition,
    emailSubscriptions,
    students,
    attendance,
    grades,
    behaviorDeductions,
    invoices,
    homework,
    emailLogs,
  ]);

  const canOpenStudentProfile = effectiveEdition === 'admin' || effectiveEdition === 'teacher';

  const activeProfileStudent = useMemo(
    () =>
      canOpenStudentProfile && selectedProfileStudentId
        ? students.find((s) => s.id === selectedProfileStudentId) || null
        : null,
    [canOpenStudentProfile, selectedProfileStudentId, students],
  );

  const handleSelectStudentProfile = (studentId: string) => {
    if (!canOpenStudentProfile) return;
    setSelectedProfileStudentId(studentId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSwitchEdition = (role: UserRole) => {
    setActiveEdition(role);
    if (role !== 'admin' && role !== 'teacher') {
      setSelectedProfileStudentId(null);
    }
    const nextPerms = rolePermissions[role];
    if (!canAccessNavSection(activeSection, nextPerms)) {
      setActiveSection(getDefaultNavSection(nextPerms));
    }
    showToast(`تم التبديل إلى ${EDITION_METADATA[role].title}`);
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setAuthReady(true);

      if (!firebaseUser) {
        clearGmailAccessToken();
        setUserProfile(null);
        setActiveEdition('admin');
        reminderInFlightRef.current.clear();
        return;
      }

      try {
        const userRef = doc(db, 'users', firebaseUser.uid);
        const snap = await getDoc(userRef);
        const isPrincipal = firebaseUser.email === ADMIN_EMAIL && firebaseUser.emailVerified;
        let resolvedUserRole: UserRole = isPrincipal ? 'admin' : 'parent';

        if (!snap.exists()) {
          const initialRole: UserRole = isPrincipal ? 'admin' : 'parent';
          const safeName =
            firebaseUser.displayName && firebaseUser.displayName.trim().length >= 2
              ? firebaseUser.displayName.trim().slice(0, 120)
              : 'مستخدم النظام';
          const initialProfile: UserProfile = {
            uid: firebaseUser.uid,
            displayName: safeName,
            email: firebaseUser.email || '',
            role: initialRole,
          };
          await setDoc(userRef, {
            ...initialProfile,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          setUserProfile(initialProfile);
          setActiveEdition(initialRole);
        } else {
          const data = snap.data() as UserProfile;
          resolvedUserRole = isPrincipal ? 'admin' : data.role || 'parent';
          setUserProfile({ ...data, role: resolvedUserRole });
          setActiveEdition(resolvedUserRole);
        }

        if (firebaseUser.email && firebaseUser.email.length >= 3) {
          const emailSubRef = doc(db, 'emailAlertSubscriptions', firebaseUser.uid);
          const emailSubSnap = await getDoc(emailSubRef);
          if (!emailSubSnap.exists()) {
            const safeDisplay =
              firebaseUser.displayName && firebaseUser.displayName.trim().length >= 2
                ? firebaseUser.displayName.trim().slice(0, 120)
                : 'مستخدم المنصة';
            await setDoc(emailSubRef, {
              uid: firebaseUser.uid,
              displayName: safeDisplay,
              email: firebaseUser.email.slice(0, 160),
              role: resolvedUserRole,
              enabled: true,
              alertAttendance: true,
              alertBehavior: true,
              alertHomework: true,
              alertGrades: true,
              alertPayments: true,
              alertCirculars: true,
              gradeLabel: 'جميع الصفوف',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        }

        if (isPrincipal) {
          const existingStudents = await getDocs(query(collection(db, 'students'), limit(1)));
          if (existingStudents.empty) {
            setSeeding(true);
            await seedSchoolWorkspace(
              firebaseUser.uid,
              firebaseUser.displayName || 'إدارة المدرسة',
            );
            setSeeding(false);
          } else {
            const existingPerms = await getDocs(
              query(
                collection(db, 'rolePermissions'),
                where('scope', '==', 'school'),
                limit(1),
              ),
            );
            if (existingPerms.empty) {
              await seedDefaultRolePermissions(firebaseUser.displayName || 'إدارة المدرسة');
            }
            const existingCalendar = await getDocs(
              query(
                collection(db, 'calendarEvents'),
                where('scope', '==', 'school'),
                limit(1),
              ),
            );
            if (existingCalendar.empty) {
              await seedDefaultCalendarEvents(firebaseUser.displayName || 'إدارة المدرسة');
            }
            const existingDonations = await getDocs(
              query(
                collection(db, 'donationCampaigns'),
                where('scope', '==', 'school'),
                limit(1),
              ),
            );
            if (existingDonations.empty) {
              await seedDefaultDonationCampaigns(firebaseUser.displayName || 'إدارة المدرسة');
            }
            const existingPolls = await getDocs(
              query(
                collection(db, 'polls'),
                where('scope', '==', 'school'),
                limit(1),
              ),
            );
            if (existingPolls.empty) {
              await seedDefaultPolls(firebaseUser.displayName || 'إدارة المدرسة');
            }
            await migrateLegacyGradesIfNeeded();
          }
        }
      } catch (err) {
        setSeeding(false);
        console.error('Initialization warning:', err);
      }
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authReady || !user) return;

    const isPrincipal = user.email === ADMIN_EMAIL && user.emailVerified;
    const unsubscribers: (() => void)[] = [];

    // Listen to current user profile for live role updates
    unsubscribers.push(
      onSnapshot(
        doc(db, 'users', user.uid),
        (snapshot) => {
          if (snapshot.exists()) {
            const data = snapshot.data() as UserProfile;
            setUserProfile({
              ...data,
              role: isPrincipal ? 'admin' : data.role || 'parent',
            });
          }
        },
        (error) => {
          handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
        },
      ),
    );

    // If principal, listen to all user accounts for role assignment
    if (isPrincipal) {
      unsubscribers.push(
        onSnapshot(
          query(collection(db, 'users')),
          (snapshot) => {
            const items = snapshot.docs.map((d) => d.data() as UserProfile);
            setUsersList(items);
          },
          (error) => {
            handleFirestoreError(error, OperationType.LIST, 'users');
          },
        ),
      );
    }

    const listenPrivate = <T extends { id: string }>(
      colName: string,
      setter: React.Dispatch<React.SetStateAction<T[]>>,
      onLoaded?: () => void,
    ) => {
      const q = isPrincipal
        ? query(collection(db, colName))
        : query(collection(db, colName), where('parentUid', '==', user.uid));

      unsubscribers.push(
        onSnapshot(
          q,
          (snapshot) => {
            const items = snapshot.docs.map((d) => {
              const raw = d.data() as Omit<T, 'id'> & { grade?: string };
              return {
                id: d.id,
                ...raw,
                ...(typeof raw.grade === 'string' ? { grade: normalizeGradeName(raw.grade) } : {}),
              } as T;
            });
            setter(items);
            onLoaded?.();
          },
          (error) => {
            handleFirestoreError(error, OperationType.LIST, colName);
          },
        ),
      );
    };

    const listenSchool = <T extends { id: string }>(
      colName: string,
      setter: React.Dispatch<React.SetStateAction<T[]>>,
      onLoaded?: () => void,
    ) => {
      const q = query(collection(db, colName), where('scope', '==', 'school'));
      unsubscribers.push(
        onSnapshot(
          q,
          (snapshot) => {
            const items = snapshot.docs.map((d) => {
              const raw = d.data() as Omit<T, 'id'> & { grade?: string };
              return {
                id: d.id,
                ...raw,
                ...(typeof raw.grade === 'string' ? { grade: normalizeGradeName(raw.grade) } : {}),
              } as T;
            });
            setter(items);
            onLoaded?.();
          },
          (error) => {
            handleFirestoreError(error, OperationType.LIST, colName);
          },
        ),
      );
    };

    listenPrivate<Student>('students', setStudents, () => setStudentsLoaded(true));
    listenPrivate<AttendanceRecord>('attendance', setAttendance);
    listenPrivate<PeriodAttendanceRecord>('periodAttendance', setPeriodAttendance);
    listenPrivate<GradeRecord>('grades', setGrades);
    listenPrivate<BehaviorDeduction>('behaviorDeductions', setBehaviorDeductions);
    listenPrivate<Invoice>('invoices', setInvoices);
    listenPrivate<MessageItem>('messages', setMessages);
    listenPrivate<ParentNotification>('notifications', setNotifications, () =>
      setNotificationsLoaded(true),
    );

    listenSchool<RolePermissionDoc>('rolePermissions', setRolePermDocs);
    listenSchool<TeacherEvaluation>('teachers', setTeachers);
    listenSchool<Announcement>('announcements', setAnnouncements);
    listenSchool<Activity>('activities', setActivities);
    listenSchool<SchoolCalendarEvent>('calendarEvents', setCalendarEvents);
    listenSchool<HomeworkItem>('homework', setHomework, () => setHomeworkLoaded(true));
    listenSchool<LibraryResource>('libraryResources', setLibraryResources);
    listenSchool<AttendanceReport>('attendanceReports', setAttendanceReports);
    listenSchool<DonationCampaign>('donationCampaigns', setDonationCampaigns);
    listenSchool<SchoolPoll>('polls', setPolls);
    listenSchool<QrAttendanceSession>('qrAttendanceSessions', setQrSessions);

    const donationsQuery = isPrincipal
      ? query(collection(db, 'donations'))
      : query(collection(db, 'donations'), where('donorUid', '==', user.uid));
    unsubscribers.push(
      onSnapshot(
        donationsQuery,
        (snapshot) => {
          const items = snapshot.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<DonationRecord, 'id'>),
          }));
          setDonations(items);
        },
        (error) => {
          handleFirestoreError(error, OperationType.LIST, 'donations');
        },
      ),
    );

    const emailSubQuery = isPrincipal
      ? query(collection(db, 'emailAlertSubscriptions'))
      : query(collection(db, 'emailAlertSubscriptions'), where('uid', '==', user.uid));
    unsubscribers.push(
      onSnapshot(
        emailSubQuery,
        (snapshot) => {
          const items = snapshot.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<EmailAlertSubscription, 'id'>),
          }));
          setEmailSubscriptions(items);
        },
        (error) => {
          handleFirestoreError(error, OperationType.LIST, 'emailAlertSubscriptions');
        },
      ),
    );

    if (isPrincipal) {
      unsubscribers.push(
        onSnapshot(
          query(collection(db, 'emailAlertLogs')),
          (snapshot) => {
            const items = snapshot.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<EmailAlertLog, 'id'>),
            }));
            setEmailLogs(items);
          },
          (error) => {
            handleFirestoreError(error, OperationType.LIST, 'emailAlertLogs');
          },
        ),
      );
    } else {
      let sentByMe: EmailAlertLog[] = [];
      let receivedByMe: EmailAlertLog[] = [];
      const syncMergedEmailLogs = () => {
        const merged = new Map<string, EmailAlertLog>();
        for (const item of [...sentByMe, ...receivedByMe]) {
          merged.set(item.id, item);
        }
        setEmailLogs(Array.from(merged.values()));
      };

      unsubscribers.push(
        onSnapshot(
          query(collection(db, 'emailAlertLogs'), where('senderUid', '==', user.uid)),
          (snapshot) => {
            sentByMe = snapshot.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<EmailAlertLog, 'id'>),
            }));
            syncMergedEmailLogs();
          },
          (error) => {
            handleFirestoreError(error, OperationType.LIST, 'emailAlertLogs');
          },
        ),
      );

      unsubscribers.push(
        onSnapshot(
          query(collection(db, 'emailAlertLogs'), where('recipientUid', '==', user.uid)),
          (snapshot) => {
            receivedByMe = snapshot.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<EmailAlertLog, 'id'>),
            }));
            syncMergedEmailLogs();
          },
          (error) => {
            handleFirestoreError(error, OperationType.LIST, 'emailAlertLogs');
          },
        ),
      );
    }

    return () => {
      setStudentsLoaded(false);
      setHomeworkLoaded(false);
      setNotificationsLoaded(false);
      unsubscribers.forEach((u) => u());
    };
  }, [authReady, user]);

  useEffect(() => {
    if (!authReady || !user) {
      setPollVotes([]);
      return;
    }

    const isPrincipal = user.email === ADMIN_EMAIL && user.emailVerified;
    if (!isPrincipal && !userProfile) return;

    const canListAllPollVotes =
      isPrincipal || userProfile?.role === 'admin' || userProfile?.role === 'teacher';

    const pollVotesQuery = canListAllPollVotes
      ? query(collection(db, 'pollVotes'))
      : query(collection(db, 'pollVotes'), where('voterUid', '==', user.uid));

    const unsub = onSnapshot(
      pollVotesQuery,
      (snapshot) => {
        const items = snapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<PollVote, 'id'>),
        }));
        setPollVotes(items);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'pollVotes');
      },
    );

    return () => unsub();
  }, [authReady, user, userProfile]);

  const runHomeworkReminderService = useCallback(
    async (manualTrigger = false) => {
      if (!authReady || !user || !homeworkLoaded || !notificationsLoaded || !studentsLoaded) {
        return;
      }

      const result = await dispatchDueTomorrowHomeworkReminders({
        homework,
        students,
        existingNotifications: notifications,
        currentUid: user.uid,
        isPrincipal: isPrincipalAccount,
        inFlightIds: reminderInFlightRef.current,
      });

      if (result.sentCount > 0) {
        showToast(
          `تم إرسال ${result.sentCount} تذكير تلقائي للطلاب وأولياء الأمور للواجبات المستحقة غداً (${result.tomorrowIso}).`,
        );
      } else if (manualTrigger) {
        if (result.dueTomorrowCount === 0) {
          showToast(`لا توجد واجبات منزلية مستحقة غداً (${result.tomorrowIso}) حالياً.`);
        } else {
          showToast(
            `جميع تذكيرات الواجبات المستحقة غداً (${result.dueTomorrowCount}) مرسلة مسبقاً عبر التطبيق.`,
          );
        }
      }
    },
    [
      authReady,
      user,
      homeworkLoaded,
      notificationsLoaded,
      studentsLoaded,
      homework,
      students,
      notifications,
      isPrincipalAccount,
    ],
  );

  useEffect(() => {
    void runHomeworkReminderService(false);
  }, [runHomeworkReminderService]);

  useEffect(() => {
    if (!authReady || !user) return;
    const intervalId = window.setInterval(() => {
      void runHomeworkReminderService(false);
    }, 60 * 60 * 1000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void runHomeworkReminderService(false);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [authReady, user, runHomeworkReminderService]);

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        setGmailAccessToken(credential.accessToken);
      }
    } catch (error) {
      setAuthError(
        error instanceof Error ? error.message : 'تعذر تسجيل الدخول عبر Google. يرجى المحاولة مجدداً.',
      );
    }
  };

  const handleSignOut = async () => {
    clearGmailAccessToken();
    await signOut(auth);
  };

  const handleTriggerAttendanceEmailWarning = async (record: AttendanceRecord) => {
    if (!user) return;
    const matchingSubs = emailSubscriptions.filter(
      (sub) => sub.enabled && sub.alertAttendance && sub.uid === record.parentUid,
    );
    if (matchingSubs.length === 0) return;
    const senderName = user.displayName || 'مراقب الدوام المدرسي';
    const items = matchingSubs.map((sub) =>
      buildSingleAttendanceWarningEmail({
        record,
        subscriber: sub,
        senderName,
      }),
    );

    if (record.status === 'absent' && earlyAbsenceInstantEmail && gmailToken) {
      try {
        const result = await dispatchAutomatedEmailsViaGmail({
          accessToken: gmailToken,
          items,
          senderUid: user.uid,
          senderName,
          senderEmail: user.email || 'school@madarek.edu',
        });
        if (result.sentCount > 0) {
          showToast(
            `إشعار الغياب المبكر: تم إرسال تنبيه لحظي لولي أمر ${record.studentName} عبر التطبيق وGmail.`,
          );
          return;
        }
      } catch {
        // Fallback to manual modal prompt if Gmail token expired
      }
    }

    setGlobalGmailConfirm({
      open: true,
      title:
        record.status === 'absent'
          ? `إشعار الغياب المبكر عبر Gmail — ${record.studentName}`
          : `إرسال إنذار بريدي تلقائي — ${record.studentName}`,
      subtitle:
        'تم إرسال تنبيه التطبيق الفوري لحظياً لولي الأمر؛ هل ترغب بإرسال نسخة فورية عبر Gmail إلى بريده المسجل؟',
      items,
    });
  };

  const handleTriggerBehaviorEmailWarning = (deduction: BehaviorDeduction) => {
    if (!user) return;
    const matchingSubs = emailSubscriptions.filter(
      (sub) => sub.enabled && sub.alertBehavior && sub.uid === deduction.parentUid,
    );
    if (matchingSubs.length === 0) return;
    const senderName = user.displayName || 'لجنة الانضباط المدرسي';
    const items = matchingSubs.map((sub) =>
      buildSingleBehaviorWarningEmail({
        deduction,
        subscriber: sub,
        senderName,
      }),
    );
    setGlobalGmailConfirm({
      open: true,
      title: `إرسال إنذار سلوكي عبر Gmail — ${deduction.studentName}`,
      subtitle:
        'هل ترغب بإرسال إشعار الخصم السلوكي وتحديث الدرجة فوراً إلى البريد المسجل لولي الأمر؟',
      items,
    });
  };

  const handleTriggerMonthlyGmailReports = (monthKey = getDefaultReportMonthKey()) => {
    if (!user) return;
    const senderName = user.displayName || 'إدارة المدرسة';
    const reports = buildMonthlyPerformanceReportEmails({
      monthKey,
      subscriptions: emailSubscriptions,
      students,
      attendance,
      grades,
      behaviorDeductions,
      invoices,
      emailLogs,
      senderName,
    });
    const pending = reports.filter((r) => !r.alreadySent);
    if (pending.length > 0) {
      setGlobalGmailConfirm({
        open: true,
        title: `إرسال تقارير الأداء الشهرية — ${formatArabicMonth(monthKey)}`,
        subtitle: `تم تجهيز ${pending.length} تقرير أداء شهري جاهز للإرسال التلقائي عبر Gmail للمسجلين.`,
        items: pending,
      });
      return;
    }

    setActiveSection('communication');
    setRequestedCommSubTab('email');
    showToast(
      reports.length > 0
        ? `تم إرسال تقارير شهر ${formatArabicMonth(monthKey)} مسبقاً؛ يمكنك معاينتها أو إعادة الإرسال من هنا.`
        : 'يرجى مراجعة قائمة المسجلين في تبويب تنبيهات البريد لتفعيل إرسال التقارير الشهرية.',
    );
  };

  const handleConfirmGlobalGmailBatch = async () => {
    if (!user || globalGmailConfirm.items.length === 0) return;
    setSendingGlobalGmail(true);
    let activeToken = gmailToken;

    try {
      if (!activeToken) {
        activeToken = await connectGmailAccess();
      }
      const result = await dispatchAutomatedEmailsViaGmail({
        accessToken: activeToken,
        items: globalGmailConfirm.items,
        senderUid: user.uid,
        senderName: user.displayName || 'إدارة المدرسة',
        senderEmail: user.email || 'school@madarek.edu',
      });
      setGlobalGmailConfirm((prev) => ({ ...prev, open: false, items: [] }));
      if (result.failedCount === 0) {
        showToast(`تم إرسال ${result.sentCount} رسالة/تقرير عبر Gmail بنجاح للمسجلين.`);
      } else {
        showToast(
          `تم إرسال ${result.sentCount} رسالة وتعذر إرسال ${result.failedCount}. راجع سجل البريد.`,
        );
      }
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : 'تعذر الإرسال عبر Gmail. يرجى التحقق من ربط حساب Google.',
      );
    } finally {
      setSendingGlobalGmail(false);
    }
  };

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-xl px-8 py-6 text-sm text-slate-600">
          جاري التحقق من الجلسة والاتصال بقاعدة البيانات...
        </div>
      </div>
    );
  }

  // Sign-In Screen
  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <header className="bg-white border-b border-slate-200 px-6 lg:px-10 py-4 flex items-center justify-between gap-8">
          <span className="text-xl font-bold font-display text-slate-900 whitespace-nowrap shrink-0">
            منصة مدارك المدرسية
          </span>
          <span className="text-xs text-slate-500 hidden sm:inline whitespace-nowrap shrink-0">
            أربع نسخ مخصصة بصلاحيات مرنة قابلة للتعديل من الإدارة
          </span>
          <button
            type="button"
            onClick={handleGoogleSignIn}
            className="px-4 py-2 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            تسجيل الدخول
          </button>
        </header>

        <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-12 flex items-center">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch w-full bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="lg:col-span-6 p-8 lg:p-10 flex flex-col justify-between space-y-8">
              <div className="space-y-4">
                <p className="text-xs font-semibold text-teal-700">
                  نظام إدارة المدارس الذكي · أربع نسخ تشغيلية متكاملة
                </p>
                <h1 className="text-3xl font-bold font-display text-slate-900 leading-snug">
                  إدارة مدرسية ذكية بأربع نسخ مخصصة لولي الأمر، المدرس، المدير، والمراقب
                </h1>
                <p className="text-sm text-slate-600 leading-relaxed">
                  منصة موحدة تمنح كل فئة واجهة وصلاحيات دقيقة: متابعة الدرجات ومراسلة الطاقم لولي
                  الأمر والطالب، نشر الدرجات والملازم للمدرسين، تسجيل الحضور للمراقبين، وتحكم
                  المدراء الكامل بتعديل مصفوفة الصلاحيات.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4 border-t border-slate-100 pt-6 text-xs text-slate-700">
                <div>• نسخة ولي الأمر والطالب (الدرجات والمراسلة)</div>
                <div>• نسخة المدرسين (الدرجات والملازم والتواصل)</div>
                <div>• نسخة المدراء (كافة الصلاحيات والتحكم)</div>
                <div>• نسخة المراقبين (تسجيل الحضور والغياب)</div>
                <div>• مصفوفة صلاحيات مرنة يعدّلها المدراء</div>
                <div>• تنبيهات فورية عبر التطبيق وGmail</div>
              </div>

              <div className="space-y-3">
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  className="inline-flex items-center justify-center gap-3 w-full sm:w-auto px-6 py-3 bg-white border border-slate-300 text-slate-800 text-sm font-semibold rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <svg viewBox="0 0 48 48" className="w-5 h-5 shrink-0" aria-hidden="true">
                    <path
                      fill="#EA4335"
                      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                    />
                    <path
                      fill="#4285F4"
                      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                    />
                    <path
                      fill="#34A853"
                      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                    />
                  </svg>
                  <span>تسجيل الدخول بحساب Google للمتابعة</span>
                </button>
                {authError && <p className="text-xs text-red-700">{authError}</p>}
              </div>
            </div>

            <div className="lg:col-span-6 relative min-h-[300px] bg-slate-100">
              <img
                src="/src/assets/images/school_campus_hero_1795034380130.jpg"
                alt="مبنى المدرسة الذكية"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        </main>
      </div>
    );
  }

  const activeNavMeta =
    visibleNavItems.find((item) => item.id === effectiveSection) ||
    visibleNavItems[0] ||
    NAV_ITEMS[0];

  const activeEditionMeta = EDITION_METADATA[effectiveEdition];

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col bg-white border-l border-slate-200 shrink-0 no-print">
        <div className="px-6 py-5 border-b border-slate-200">
          <h1 className="text-lg font-bold font-display text-slate-900">منصة مدارك</h1>
          <p className="text-xs text-teal-700 font-medium mt-0.5">{activeEditionMeta.title}</p>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = effectiveSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setSelectedProfileStudentId(null);
                  setActiveSection(item.id);
                }}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                  active && !activeProfileStudent
                    ? 'bg-teal-700 text-white'
                    : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 space-y-3">
          <div className="text-xs">
            <p className="font-semibold text-slate-900 truncate">
              {user.displayName || user.email}
            </p>
            <p className="text-slate-500 mt-0.5">
              النسخة: {activeEditionMeta.shortTitle}
            </p>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-slate-100 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-200 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>تسجيل الخروج</span>
          </button>
        </div>
      </aside>

      {/* Mobile Sidebar Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden bg-slate-900/40 flex no-print">
          <aside className="w-72 bg-white h-full border-l border-slate-200 flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <span className="text-base font-bold font-display text-slate-900 block">
                  منصة مدارك
                </span>
                <span className="text-xs text-teal-700 font-medium">{activeEditionMeta.title}</span>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {isAdminAccount && (
              <div className="p-4 border-b border-slate-200 space-y-2">
                <p className="text-xs font-semibold text-slate-500">تبديل النسخة (معاينة الإدارة)</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {EDITION_ORDER.map((role) => (
                    <button
                      key={role}
                      type="button"
                      onClick={() => {
                        handleSwitchEdition(role);
                        setMobileMenuOpen(false);
                      }}
                      className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border text-center whitespace-nowrap cursor-pointer ${
                        effectiveEdition === role
                          ? 'bg-teal-700 border-teal-700 text-white'
                          : 'bg-slate-50 border-slate-200 text-slate-700'
                      }`}
                    >
                      {EDITION_METADATA[role].shortTitle}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
              {visibleNavItems.map((item) => {
                const Icon = item.icon;
                const active = effectiveSection === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setSelectedProfileStudentId(null);
                      setActiveSection(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-sm font-medium rounded-lg cursor-pointer ${
                      active && !activeProfileStudent ? 'bg-teal-700 text-white' : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>

            <div className="p-4 border-t border-slate-200">
              <button
                type="button"
                onClick={handleSignOut}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-slate-100 text-slate-700 text-xs font-medium rounded-lg cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>تسجيل الخروج</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Workspace */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar Contract: 3 clean zones */}
        <header className="bg-white border-b border-slate-200 px-5 lg:px-8 py-3.5 flex items-center justify-between gap-6 no-print">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="فتح القائمة"
              className="lg:hidden p-2 text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm truncate">
              <span className="text-slate-400 hidden sm:inline">
                {activeEditionMeta.shortTitle}
              </span>
              <span className="text-slate-300 hidden sm:inline">/</span>
              <span className="font-bold font-display text-slate-900 truncate">
                {activeProfileStudent
                  ? `الملف الشخصي للطالب: ${activeProfileStudent.fullName}`
                  : activeNavMeta.label}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {isAdminAccount && (
              <div className="hidden md:inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                {EDITION_ORDER.map((role) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => handleSwitchEdition(role)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      effectiveEdition === role
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {EDITION_METADATA[role].shortTitle}
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => setNotificationsOpen(true)}
              className="inline-flex items-center gap-2 px-3.5 py-2 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <BellRing className="w-4 h-4" />
              <span>التنبيهات</span>
              <span className="font-mono-num font-bold">({unreadCount})</span>
            </button>
          </div>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 p-5 lg:p-8 max-w-7xl w-full mx-auto space-y-6 print-main">
          {seeding && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 text-sm text-teal-800 flex items-center gap-2 no-print">
              <Shield className="w-4 h-4" />
              <span>جاري تجهيز السجلات المدرسية الأولية في قاعدة البيانات...</span>
            </div>
          )}

          {/* Live Unread Early-Absence Parent Alert Strip */}
          {(() => {
            const unreadEarlyAbsences = notifications.filter(
              (n) =>
                !n.isRead &&
                n.notifType === 'attendance' &&
                n.title.includes('غياب'),
            );
            if (unreadEarlyAbsences.length === 0 || (effectiveEdition !== 'parent' && !isAdminAccount)) {
              return null;
            }
            const latestAlert = unreadEarlyAbsences[0];
            if (effectiveEdition !== 'parent') return null;
            return (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 no-print">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold text-red-800">{latestAlert.title}</p>
                    <p className="text-xs text-red-700 mt-0.5 leading-relaxed">
                      {latestAlert.message}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const batch = writeBatch(db);
                        unreadEarlyAbsences.forEach((n) => {
                          batch.update(doc(db, 'notifications', n.id), { isRead: true });
                        });
                        await batch.commit();
                      } catch (error) {
                        handleFirestoreError(error, OperationType.UPDATE, 'notifications/ackEarly');
                      }
                    }}
                    className="px-3 py-1.5 bg-red-700 text-white text-xs font-semibold rounded-lg hover:bg-red-800 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    تم الاطلاع
                  </button>
                  <button
                    type="button"
                    onClick={() => setNotificationsOpen(true)}
                    className="px-3 py-1.5 bg-white border border-red-200 text-red-800 text-xs font-medium rounded-lg hover:bg-red-100 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    كافة التنبيهات ({unreadEarlyAbsences.length})
                  </button>
                </div>
              </div>
            );
          })()}

          {activeProfileStudent ? (
            <StudentProfileView
              student={activeProfileStudent}
              allStudents={students}
              attendance={attendance}
              periodAttendance={periodAttendance}
              grades={grades}
              behaviorDeductions={behaviorDeductions}
              invoices={invoices}
              userName={user.displayName || 'إدارة المدرسة'}
              onBack={() => setSelectedProfileStudentId(null)}
              onSelectStudent={(id) => setSelectedProfileStudentId(id)}
              onNotify={showToast}
              onMessageParent={
                canAccessNavSection('communication', activePermissions)
                  ? () => {
                      setSelectedProfileStudentId(null);
                      setActiveSection('communication');
                    }
                  : undefined
              }
            />
          ) : (
            <>
          {effectiveSection === 'overview' && activePermissions.viewOverview && (
            <OverviewView
              students={students}
              attendance={attendance}
              grades={grades}
              invoices={invoices}
              announcements={announcements}
              teachers={teachers}
              homework={homework}
              activities={activities}
              notifications={notifications}
              userName={user.displayName || 'إدارة المدرسة'}
              canGenerateSnapshot={effectiveEdition === 'admin'}
              onNavigate={(sec) => {
                if (canAccessNavSection(sec, activePermissions)) {
                  setActiveSection(sec);
                } else {
                  showToast('هذه الشاشة غير مفعّلة ضمن صلاحيات النسخة الحالية.');
                }
              }}
              onOpenNotifications={() => setNotificationsOpen(true)}
              onNotify={showToast}
              onSelectStudent={canOpenStudentProfile ? handleSelectStudentProfile : undefined}
            />
          )}

          {effectiveSection === 'attendance' &&
            (activePermissions.viewAttendance || activePermissions.markAttendance) && (
              <AttendanceView
                students={students}
                attendance={attendance}
                periodAttendance={periodAttendance}
                qrSessions={qrSessions}
                attendanceReports={attendanceReports}
                canMarkAttendance={activePermissions.markAttendance}
                canManageStudents={effectiveEdition === 'admin' && activePermissions.markAttendance}
                currentUid={user.uid}
                userName={user.displayName || 'إدارة المدرسة'}
                earlyAbsenceInstantEnabled={earlyAbsenceInstantEmail}
                onToggleEarlyAbsenceInstant={setEarlyAbsenceInstantEmail}
                gmailConnected={Boolean(gmailToken)}
                onAlertTriggered={showToast}
                onTriggerAttendanceEmailWarning={handleTriggerAttendanceEmailWarning}
                onTriggerMonthlyGmailReports={handleTriggerMonthlyGmailReports}
                onSelectStudent={canOpenStudentProfile ? handleSelectStudentProfile : undefined}
              />
            )}

          {effectiveSection === 'grades' &&
            (activePermissions.viewGrades ||
              activePermissions.publishGrades ||
              activePermissions.deductBehavior) && (
              <GradesReportsView
                students={students}
                grades={grades}
                attendance={attendance}
                behaviorDeductions={behaviorDeductions}
                canViewAcademicGrades={
                  activePermissions.viewGrades || activePermissions.publishGrades
                }
                canPublishGrades={activePermissions.publishGrades}
                canDeductBehavior={
                  effectiveEdition !== 'parent' && activePermissions.deductBehavior
                }
                activeEdition={effectiveEdition}
                userName={user.displayName || 'الكادر التعليمي'}
                onNotify={showToast}
                onTriggerBehaviorEmailWarning={handleTriggerBehaviorEmailWarning}
                onTriggerMonthlyGmailReports={() => handleTriggerMonthlyGmailReports()}
                onSelectStudent={canOpenStudentProfile ? handleSelectStudentProfile : undefined}
              />
            )}

          {effectiveSection === 'resources' &&
            (activePermissions.viewResources || activePermissions.publishResources) && (
              <ResourcesView
                homework={homework}
                libraryResources={libraryResources}
                notifications={notifications}
                canPublishResources={activePermissions.publishResources}
                currentUid={user.uid}
                userName={user.displayName || 'الكادر التعليمي'}
                onRunHomeworkReminders={() => runHomeworkReminderService(true)}
                onNotify={showToast}
              />
            )}

          {effectiveSection === 'communication' &&
            (activePermissions.messageStaff ||
              activePermissions.messageParents ||
              activePermissions.viewAnnouncements ||
              activePermissions.manageAnnouncements) && (
              <CommunicationView
                students={students}
                teachers={teachers}
                messages={messages}
                announcements={announcements}
                activities={activities}
                calendarEvents={calendarEvents}
                polls={polls}
                pollVotes={pollVotes}
                emailSubscriptions={emailSubscriptions}
                emailLogs={emailLogs}
                attendance={attendance}
                behaviorDeductions={behaviorDeductions}
                homework={homework}
                grades={grades}
                invoices={invoices}
                usersList={isPrincipalAccount ? usersList : userProfile ? [userProfile] : []}
                isAdminAccount={isAdminAccount}
                pendingAutoEmailsCount={pendingAutoEmailsCount}
                activeEdition={effectiveEdition}
                canMessageStaff={activePermissions.messageStaff}
                canMessageParents={activePermissions.messageParents}
                canViewAnnouncements={activePermissions.viewAnnouncements}
                canManageAnnouncements={activePermissions.manageAnnouncements}
                canPublishGrades={activePermissions.publishGrades}
                currentUid={user.uid}
                userName={user.displayName || 'مستخدم المنصة'}
                userEmail={user.email || ''}
                requestedSubTab={requestedCommSubTab}
                onClearRequestedSubTab={() => setRequestedCommSubTab(null)}
                prefilledEmailDraft={prefilledEmailDraft}
                onClearPrefilledEmailDraft={() => setPrefilledEmailDraft(null)}
                onNotify={showToast}
              />
            )}

          {effectiveSection === 'billing' &&
            (activePermissions.viewBilling || activePermissions.manageBilling) && (
              <BillingView
                students={students}
                invoices={invoices}
                canManageBilling={activePermissions.manageBilling}
                onOpenDonations={() => setActiveSection('donations')}
                onNotify={showToast}
              />
            )}

          {effectiveSection === 'donations' &&
            canAccessNavSection('donations', activePermissions) && (
              <DonationsView
                campaigns={donationCampaigns}
                donations={donations}
                canManageDonations={
                  effectiveEdition === 'admin' && activePermissions.manageBilling
                }
                currentUid={user.uid}
                userName={user.displayName || 'مستخدم المنصة'}
                onNotify={showToast}
              />
            )}

          {effectiveSection === 'teachers' && activePermissions.viewTeachersEval && (
            <TeachersEvalView
              teachers={teachers}
              canManageTeachers={effectiveEdition === 'admin'}
              onNotify={showToast}
            />
          )}

          {effectiveSection === 'permissions' && activePermissions.managePermissions && (
            <PermissionsAdminView
              rolePermissions={rolePermissions}
              usersList={isPrincipalAccount ? usersList : userProfile ? [userProfile] : []}
              activeEdition={effectiveEdition}
              canEditPermissions={isAdminAccount && activePermissions.managePermissions}
              isPrincipalAccount={isAdminAccount}
              userName={user.displayName || 'إدارة المدرسة'}
              onPreviewEdition={handleSwitchEdition}
              onNotify={showToast}
            />
          )}
            </>
          )}
        </main>
      </div>

      {/* Parent Mobile Notifications Slide-over */}
      <MobileNotificationsDrawer
        open={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        notifications={notifications}
        onOpenEmailAlerts={() => {
          setActiveSection('communication');
          setRequestedCommSubTab('email');
        }}
        onSendEmailForNotification={(notif) => {
          const mappedCategory: EmailAlertCategory = notif.notifType;
          setPrefilledEmailDraft({
            category: mappedCategory,
            subject: notif.title,
            body: `السلام عليكم ورحمة الله وبركاته،\n\n${notif.message}\n\nمع تحيات إدارة منصة مدارك المدرسية.`,
          });
          setActiveSection('communication');
          setRequestedCommSubTab('email');
        }}
      />

      {/* Global Confirmation Modal for Event-Driven Gmail Dispatches */}
      <GmailDispatchConfirmModal
        open={globalGmailConfirm.open}
        title={globalGmailConfirm.title}
        subtitle={globalGmailConfirm.subtitle}
        items={globalGmailConfirm.items}
        gmailConnected={Boolean(gmailToken)}
        sending={sendingGlobalGmail}
        onConfirm={handleConfirmGlobalGmailBatch}
        onCancel={() => setGlobalGmailConfirm((prev) => ({ ...prev, open: false }))}
      />

      {/* Action Confirmation Toast */}
      {toastMessage && (
        <div className="fixed bottom-5 left-5 z-50 bg-slate-900 text-white px-5 py-3 rounded-xl border border-slate-700 text-xs font-medium shadow-lg max-w-sm no-print">
          {toastMessage}
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <SchoolPlatform />
    </ErrorBoundary>
  );
}
