import React, { useEffect, useMemo, useState } from 'react';
import { doc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import {
  AlertCircle,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Eye,
  Mail,
  MailCheck,
  Plus,
  Printer,
  Send,
  Settings2,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  connectGmailAccess,
  db,
  handleFirestoreError,
  OperationType,
  setGmailAccessToken,
  subscribeGmailToken,
} from '../firebase';
import { formatIQD } from '../lib/currency';
import {
  buildMonthlyPerformanceReportEmails,
  collectAutomatedSchoolWarnings,
  dispatchAutomatedEmailsViaGmail,
  getDefaultReportMonthKey,
  type AutomatedEmailItem,
} from '../lib/emailAutomationService';
import {
  EMAIL_CATEGORY_LABELS,
  GmailAuthError,
  isValidEmailAddress,
  sendGmailEmail,
} from '../lib/gmailService';
import { SCHOOL_GRADES } from '../lib/grades';
import { findDueTomorrowHomework, getLocalDateIso } from '../lib/homeworkReminderService';
import { formatArabicMonth } from '../lib/pdfReportGenerator';
import { GmailDispatchConfirmModal } from './GmailDispatchConfirmModal';
import { PrintFooter, PrintHeader } from './PrintHeader';
import type {
  Announcement,
  AttendanceRecord,
  BehaviorDeduction,
  EmailAlertCategory,
  EmailAlertLog,
  EmailAlertSubscription,
  GradeRecord,
  HomeworkItem,
  Invoice,
  SchoolPoll,
  Student,
  UserProfile,
  UserRole,
} from '../types';

export interface EmailAlertDraft {
  category: EmailAlertCategory;
  subject: string;
  body: string;
}

interface EmailAlertsTabProps {
  subscriptions: EmailAlertSubscription[];
  emailLogs: EmailAlertLog[];
  students: Student[];
  usersList?: UserProfile[];
  attendance: AttendanceRecord[];
  behaviorDeductions: BehaviorDeduction[];
  homework: HomeworkItem[];
  grades: GradeRecord[];
  invoices: Invoice[];
  announcements: Announcement[];
  polls: SchoolPoll[];
  activeEdition: UserRole;
  canSendSchoolAlerts: boolean;
  isAdminAccount?: boolean;
  currentUid: string;
  userName: string;
  userEmail: string;
  prefilledDraft?: EmailAlertDraft | null;
  onClearPrefilledDraft?: () => void;
  onNotify: (msg: string) => void;
}

const ROLE_LABELS_AR: Record<UserRole, string> = {
  admin: 'إدارة المدرسة',
  teacher: 'مدرس',
  supervisor: 'مراقب',
  parent: 'ولي أمر / طالب',
};

interface RecipientTarget {
  uid: string;
  name: string;
  email: string;
}

function doesSubMatchCategory(sub: EmailAlertSubscription, category: EmailAlertCategory): boolean {
  if (!sub.enabled) return false;
  switch (category) {
    case 'attendance':
      return sub.alertAttendance;
    case 'behavior':
      return sub.alertBehavior;
    case 'homework':
      return sub.alertHomework;
    case 'grade':
    case 'monthly_report':
      return sub.alertGrades || sub.alertAttendance;
    case 'payment':
      return sub.alertPayments;
    case 'circular':
      return sub.alertCirculars;
    case 'custom':
    default:
      return true;
  }
}

function formatLogTime(log: EmailAlertLog): string {
  const sec = log.createdAt?.seconds;
  if (!sec) return 'الآن';
  return new Date(sec * 1000).toLocaleString('ar-IQ', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const EmailAlertsTab: React.FC<EmailAlertsTabProps> = ({
  subscriptions,
  emailLogs,
  students,
  usersList = [],
  attendance,
  behaviorDeductions,
  homework,
  grades,
  invoices,
  announcements,
  polls,
  activeEdition,
  canSendSchoolAlerts,
  isAdminAccount = false,
  currentUid,
  userName,
  userEmail,
  prefilledDraft,
  onClearPrefilledDraft,
  onNotify,
}) => {
  const [gmailToken, setGmailToken] = useState<string | null>(null);
  const [connectingGmail, setConnectingGmail] = useState(false);

  const mySubscription = useMemo(
    () => subscriptions.find((s) => s.uid === currentUid || s.id === currentUid) || null,
    [subscriptions, currentUid],
  );

  // Automation Engine State
  const [automationTab, setAutomationTab] = useState<'monthly' | 'warnings' | 'subscribers'>(
    'monthly',
  );
  const [reportMonth, setReportMonth] = useState(getDefaultReportMonthKey());
  const [warningCategoryFilter, setWarningCategoryFilter] = useState<
    'all' | 'attendance' | 'behavior' | 'payment' | 'homework'
  >('all');
  const [warningStatusFilter, setWarningStatusFilter] = useState<'pending' | 'all'>('pending');
  const [selectedWarningKeys, setSelectedWarningKeys] = useState<string[]>([]);
  const [previewItem, setPreviewItem] = useState<AutomatedEmailItem | null>(null);

  // Automated Gmail batch confirmation state
  const [autoModalState, setAutoModalState] = useState<{
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
  const [sendingAutoBatch, setSendingAutoBatch] = useState(false);

  // Admin quick-add subscriber state
  const [showAddSubscriber, setShowAddSubscriber] = useState(false);
  const [newSubName, setNewSubName] = useState('');
  const [newSubEmail, setNewSubEmail] = useState('');
  const [newSubRole, setNewSubRole] = useState<UserRole>('parent');
  const [newSubGrade, setNewSubGrade] = useState('جميع الصفوف');
  const [newSubLinkedUid, setNewSubLinkedUid] = useState(currentUid);
  const [savingSubscriber, setSavingSubscriber] = useState(false);

  // Personal email alert preferences state
  const [prefEmail, setPrefEmail] = useState(userEmail || '');
  const [prefEnabled, setPrefEnabled] = useState(true);
  const [prefGradeLabel, setPrefGradeLabel] = useState('جميع الصفوف');
  const [alertAttendance, setAlertAttendance] = useState(true);
  const [alertBehavior, setAlertBehavior] = useState(true);
  const [alertHomework, setAlertHomework] = useState(true);
  const [alertGrades, setAlertGrades] = useState(true);
  const [alertPayments, setAlertPayments] = useState(true);
  const [alertCirculars, setAlertCirculars] = useState(true);
  const [savingPrefs, setSavingPrefs] = useState(false);

  // Composer state
  const [composerCategory, setComposerCategory] = useState<EmailAlertCategory>('circular');
  const [composerSubject, setComposerSubject] = useState('');
  const [composerBody, setComposerBody] = useState('');
  const [selectedRecipients, setSelectedRecipients] = useState<RecipientTarget[]>([]);
  const [manualRecipientName, setManualRecipientName] = useState('');
  const [manualRecipientEmail, setManualRecipientEmail] = useState('');
  const [confirmSendOpen, setConfirmSendOpen] = useState(false);
  const [sendingEmails, setSendingEmails] = useState(false);

  // History filters
  const [logStatusFilter, setLogStatusFilter] = useState<'all' | 'sent' | 'failed'>('all');
  const [logCategoryFilter, setLogCategoryFilter] = useState<'all' | EmailAlertCategory>('all');

  useEffect(() => {
    return subscribeGmailToken(setGmailToken);
  }, []);

  useEffect(() => {
    if (mySubscription) {
      setPrefEmail(mySubscription.email);
      setPrefEnabled(mySubscription.enabled);
      setPrefGradeLabel(mySubscription.gradeLabel || 'جميع الصفوف');
      setAlertAttendance(mySubscription.alertAttendance);
      setAlertBehavior(mySubscription.alertBehavior);
      setAlertHomework(mySubscription.alertHomework);
      setAlertGrades(mySubscription.alertGrades);
      setAlertPayments(mySubscription.alertPayments);
      setAlertCirculars(mySubscription.alertCirculars);
    } else if (userEmail) {
      setPrefEmail((prev) => prev || userEmail);
    }
  }, [mySubscription, userEmail]);

  useEffect(() => {
    if (!prefilledDraft) return;
    setComposerCategory(prefilledDraft.category);
    setComposerSubject(prefilledDraft.subject);
    setComposerBody(prefilledDraft.body);
    onClearPrefilledDraft?.();
  }, [prefilledDraft, onClearPrefilledDraft]);

  const safeSenderName =
    userName && userName.trim().length >= 2 ? userName.trim().slice(0, 120) : 'إدارة المدرسة';

  // Automated Monthly Performance Reports computed per registered subscriber
  const monthlyReportItems = useMemo(
    () =>
      buildMonthlyPerformanceReportEmails({
        monthKey: reportMonth,
        subscriptions,
        students,
        attendance,
        grades,
        behaviorDeductions,
        invoices,
        emailLogs,
        senderName: safeSenderName,
      }),
    [
      reportMonth,
      subscriptions,
      students,
      attendance,
      grades,
      behaviorDeductions,
      invoices,
      emailLogs,
      safeSenderName,
    ],
  );

  const pendingMonthlyReports = useMemo(
    () => monthlyReportItems.filter((item) => !item.alreadySent),
    [monthlyReportItems],
  );

  // Automated School Warnings Queue matched to active registered subscribers
  const allWarningItems = useMemo(
    () =>
      collectAutomatedSchoolWarnings({
        subscriptions,
        attendance,
        behaviorDeductions,
        invoices,
        homework,
        emailLogs,
        senderName: safeSenderName,
      }),
    [subscriptions, attendance, behaviorDeductions, invoices, homework, emailLogs, safeSenderName],
  );

  const pendingWarnings = useMemo(
    () => allWarningItems.filter((item) => !item.alreadySent),
    [allWarningItems],
  );

  const filteredWarnings = useMemo(() => {
    return allWarningItems.filter((item) => {
      const matchesCat =
        warningCategoryFilter === 'all' || item.category === warningCategoryFilter;
      const matchesStatus =
        warningStatusFilter === 'all' || (warningStatusFilter === 'pending' && !item.alreadySent);
      return matchesCat && matchesStatus;
    });
  }, [allWarningItems, warningCategoryFilter, warningStatusFilter]);

  useEffect(() => {
    // Keep selected warnings defaulted to pending filtered warnings cleanly
    const pendingKeys = filteredWarnings
      .filter((w) => !w.alreadySent)
      .map((w) => w.autoDispatchKey);
    setSelectedWarningKeys((prev) => {
      const existingValid = prev.filter((k) =>
        allWarningItems.some((w) => w.autoDispatchKey === k && !w.alreadySent),
      );
      if (existingValid.length > 0) return existingValid;
      return pendingKeys.slice(0, 25);
    });
  }, [filteredWarnings, allWarningItems]);

  const unsubscribedUsers = useMemo(() => {
    const subUids = new Set(subscriptions.map((s) => s.uid));
    return usersList.filter((u) => !subUids.has(u.uid) && isValidEmailAddress(u.email));
  }, [usersList, subscriptions]);

  const sortedLogs = useMemo(() => {
    return [...emailLogs].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  }, [emailLogs]);

  const filteredLogs = useMemo(() => {
    return sortedLogs.filter((log) => {
      const okStatus = logStatusFilter === 'all' || log.status === logStatusFilter;
      const okCat = logCategoryFilter === 'all' || log.category === logCategoryFilter;
      return okStatus && okCat;
    });
  }, [sortedLogs, logStatusFilter, logCategoryFilter]);

  const activeSubscribersCount = subscriptions.filter((s) => s.enabled).length;
  const sentLogsCount = emailLogs.filter((l) => l.status === 'sent').length;

  const handleConnectGmail = async () => {
    setConnectingGmail(true);
    try {
      await connectGmailAccess();
      onNotify('تم ربط حساب Gmail بنجاح وأصبح جاهزاً لإرسال التقارير والإنذارات التلقائية.');
    } catch (error) {
      onNotify(
        error instanceof Error
          ? error.message
          : 'تعذر ربط حساب Gmail. يرجى المحاولة مرة أخرى.',
      );
    } finally {
      setConnectingGmail(false);
    }
  };

  const openAutomatedDispatchModal = (params: {
    title: string;
    subtitle: string;
    items: AutomatedEmailItem[];
  }) => {
    if (params.items.length === 0) {
      onNotify('لا توجد رسائل جاهزة للإرسال في هذه الدفعة.');
      return;
    }
    setAutoModalState({
      open: true,
      title: params.title,
      subtitle: params.subtitle,
      items: params.items,
    });
  };

  const handleConfirmAutomatedBatchDispatch = async () => {
    if (autoModalState.items.length === 0) return;
    setSendingAutoBatch(true);
    let activeToken = gmailToken;

    try {
      if (!activeToken) {
        activeToken = await connectGmailAccess();
      }

      const result = await dispatchAutomatedEmailsViaGmail({
        accessToken: activeToken,
        items: autoModalState.items,
        senderUid: currentUid,
        senderName: safeSenderName,
        senderEmail: userEmail || prefEmail || 'school@madarek.edu',
      });

      setAutoModalState((prev) => ({ ...prev, open: false, items: [] }));
      if (result.failedCount === 0) {
        onNotify(
          `تم إرسال ${result.sentCount} رسالة/تقرير عبر Gmail بنجاح للمسجلين وتوثيقها في السجل.`,
        );
      } else {
        onNotify(
          `تم إرسال ${result.sentCount} بنجاح وتعذر إرسال ${result.failedCount}. راجع سجل البريد للتفاصيل.`,
        );
      }
    } catch (error) {
      onNotify(
        error instanceof Error
          ? error.message
          : 'تعذر إرسال الدفعة البريدية عبر Gmail. يرجى التحقق من ربط الحساب.',
      );
    } finally {
      setSendingAutoBatch(false);
    }
  };

  const handleToggleWarningSelection = (key: string) => {
    setSelectedWarningKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const handleAddAdminSubscriber = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = newSubEmail.trim();
    const cleanName = newSubName.trim();
    if (cleanName.length < 2 || !isValidEmailAddress(cleanEmail)) {
      onNotify('يرجى إدخال اسم صحيح وعنوان بريد إلكتروني صالح للمشترك.');
      return;
    }

    setSavingSubscriber(true);
    const subId = `sub_${Date.now()}`;
    const targetUid = newSubLinkedUid.trim() || subId;

    try {
      await setDoc(doc(db, 'emailAlertSubscriptions', subId), {
        uid: targetUid.slice(0, 128),
        displayName: cleanName.slice(0, 120),
        email: cleanEmail.slice(0, 160),
        role: newSubRole,
        enabled: true,
        alertAttendance: true,
        alertBehavior: true,
        alertHomework: true,
        alertGrades: true,
        alertPayments: true,
        alertCirculars: true,
        gradeLabel: newSubGrade.slice(0, 60),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setNewSubName('');
      setNewSubEmail('');
      setShowAddSubscriber(false);
      onNotify(`تم تسجيل ${cleanName} في نظام التقارير والإنذارات البريدية.`);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `emailAlertSubscriptions/${subId}`);
    } finally {
      setSavingSubscriber(false);
    }
  };

  const handleSubscribeExistingUser = async (profile: UserProfile) => {
    try {
      await setDoc(doc(db, 'emailAlertSubscriptions', profile.uid), {
        uid: profile.uid,
        displayName: (profile.displayName || profile.email).slice(0, 120),
        email: profile.email.slice(0, 160),
        role: profile.role,
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
      onNotify(`تم تفعيل اشتراك البريد الإلكتروني للمستخدم ${profile.displayName}.`);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `emailAlertSubscriptions/${profile.uid}`);
    }
  };

  const handleToggleSubscriberEnabled = async (sub: EmailAlertSubscription) => {
    try {
      await updateDoc(doc(db, 'emailAlertSubscriptions', sub.id), {
        enabled: !sub.enabled,
        updatedAt: serverTimestamp(),
      });
      onNotify(
        !sub.enabled
          ? `تم تفعيل إرسال التقارير والإنذارات لحساب ${sub.displayName}.`
          : `تم إيقاف الإرسال التلقائي مؤقتاً لحساب ${sub.displayName}.`,
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `emailAlertSubscriptions/${sub.id}`);
    }
  };

  const handleSavePreferences = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = prefEmail.trim();
    if (!isValidEmailAddress(cleanEmail)) {
      onNotify('يرجى إدخال عنوان بريد إلكتروني صحيح.');
      return;
    }

    setSavingPrefs(true);
    const safeName =
      userName && userName.trim().length >= 2 ? userName.trim().slice(0, 120) : 'مستخدم المنصة';

    try {
      const subRef = doc(db, 'emailAlertSubscriptions', currentUid);
      const baseFields = {
        displayName: safeName,
        email: cleanEmail.slice(0, 160),
        role: activeEdition,
        enabled: prefEnabled,
        alertAttendance,
        alertBehavior,
        alertHomework,
        alertGrades,
        alertPayments,
        alertCirculars,
        gradeLabel: prefGradeLabel.slice(0, 60),
        updatedAt: serverTimestamp(),
      };

      if (mySubscription) {
        await updateDoc(subRef, baseFields);
      } else {
        await setDoc(subRef, {
          uid: currentUid,
          ...baseFields,
          createdAt: serverTimestamp(),
        });
      }
      onNotify('تم حفظ تفضيلات التنبيهات وتقارير الأداء عبر البريد الإلكتروني بنجاح.');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `emailAlertSubscriptions/${currentUid}`);
    } finally {
      setSavingPrefs(false);
    }
  };

  const applySmartPreset = (category: EmailAlertCategory) => {
    setComposerCategory(category);
    const todayIso = getLocalDateIso();

    if (category === 'monthly_report') {
      const monthLabel = formatArabicMonth(reportMonth);
      setComposerSubject(`ملخص الأداء المدرسي الشهري — ${monthLabel}`);
      setComposerBody(
        `السلام عليكم ورحمة الله وبركاته،\n\nنشارككم خلاصة تقارير الأداء الشهرية لشهر ${monthLabel}، متضمنة معدلات التحصيل الدراسي، نسب الانتظام والحضور، وتقييم السلوك.\n\nلإرسال التقرير المفصل لكل مشترك تلقائياً بصيغة منسقة، استخدم تبويب "تقارير الأداء الشهرية" أعلاه.`,
      );
      return;
    }

    if (category === 'attendance') {
      const todayIssues = attendance.filter(
        (r) => r.date === todayIso && (r.status === 'absent' || r.status === 'late'),
      );
      setComposerSubject(`تنبيه الحضور والغياب المدرسي — ${todayIso}`);
      if (todayIssues.length > 0) {
        const lines = todayIssues
          .slice(0, 8)
          .map(
            (r) =>
              `- ${r.studentName} (${r.grade}): ${r.status === 'absent' ? 'غائب' : 'متأخر'}${
                r.checkInTime ? ` · الساعة ${r.checkInTime}` : ''
              }`,
          )
          .join('\n');
        setComposerBody(
          `السلام عليكم ورحمة الله وبركاته،\n\nيرجى العلم بملخص حالات الغياب والتأخر المسجلة اليوم (${todayIso}):\n${lines}\n\nللتوضيح أو إرفاق العذر، يرجى التواصل عبر بوابة التواصل المباشر في منصة مدارك.`,
        );
      } else {
        setComposerBody(
          `السلام عليكم ورحمة الله وبركاته،\n\nنود إبلاغكم بمتابعة سجل الحضور والانضباط اليومي للطلبة بتاريخ ${todayIso}، ونشكر أولياء الأمور الكرام على حرصهم على الانتظام المدرسي.`,
        );
      }
      return;
    }

    if (category === 'homework') {
      const dueTomorrow = findDueTomorrowHomework(homework);
      setComposerSubject('تذكير بالواجبات المنزلية المستحقة غداً');
      if (dueTomorrow.length > 0) {
        const lines = dueTomorrow
          .map((hw) => `- ${hw.title} (${hw.subject} · ${hw.grade}) — موعد التسليم: ${hw.dueDate}`)
          .join('\n');
        setComposerBody(
          `السلام عليكم ورحمة الله وبركاته،\n\nنذكّر أبناءنا الطلبة وأولياء الأمور الكرام بالواجبات المنزلية المقرر تسليمها غداً:\n${lines}\n\nيرجى متابعة إتمام الواجب وتسليمه في الوقت المحدد.`,
        );
      } else if (homework.length > 0) {
        const latestHw = homework[0];
        setComposerBody(
          `السلام عليكم ورحمة الله وبركاته،\n\nنذكّركم بالواجب المنزلي المنشور لمادة ${latestHw.subject} (${latestHw.grade}):\n"${latestHw.title}" — الموعد النهائي للتسليم: ${latestHw.dueDate}.\n\n${latestHw.description}`,
        );
      } else {
        setComposerBody(
          'السلام عليكم ورحمة الله وبركاته،\n\nيرجى مراجعة قسم الواجبات المنزلية في المنصة لمتابعة التكليفات الدراسية القادمة.',
        );
      }
      return;
    }

    if (category === 'behavior') {
      const latestDeduction = behaviorDeductions[0];
      setComposerSubject('إشعار متابعة السلوك والانضباط المدرسي');
      if (latestDeduction) {
        setComposerBody(
          `السلام عليكم ورحمة الله وبركاته،\n\nنود إشعاركم بتسجيل ملاحظة سلوكية للطالب/ة ${latestDeduction.studentName} (${latestDeduction.grade}):\n- النقاط المخصومة: ${latestDeduction.pointsDeducted} درجات\n- رصيد السلوك الحالي: ${latestDeduction.newScore} / 100\n- السبب: ${latestDeduction.reason}\n\nنأمل التعاون المشترك لتعزيز الانضباط الإيجابي لدى أبنائنا الطلبة.`,
        );
      } else {
        setComposerBody(
          'السلام عليكم ورحمة الله وبركاته،\n\nنود إشعاركم بمتابعة تقييم السلوك والانضباط المدرسي عبر بوابة الدرجات والسلوك في منصة مدارك.',
        );
      }
      return;
    }

    if (category === 'grade') {
      const sampleGrades = grades.slice(0, 4);
      setComposerSubject('إشعار تحديث الدرجات والتقارير الأكاديمية');
      if (sampleGrades.length > 0) {
        const lines = sampleGrades
          .map(
            (g) =>
              `- ${g.studentName} · ${g.subject} (${g.term}): المجموع ${g.totalScore} / 100`,
          )
          .join('\n');
        setComposerBody(
          `السلام عليكم ورحمة الله وبركاته،\n\nتم تحديث نتائج التقييمات الأكاديمية للفصل الدراسي الحالي:\n${lines}\n\nيمكنكم الاطلاع على كشف الدرجات التفصيلي وطباعته من المنصة.`,
        );
      } else {
        setComposerBody(
          'السلام عليكم ورحمة الله وبركاته،\n\nتم نشر نتائج الاختبارات والتقييمات الجديدة في بوابة الدرجات والتقارير.',
        );
      }
      return;
    }

    if (category === 'payment') {
      const pendingInvoices = invoices.filter((inv) => inv.status !== 'paid');
      setComposerSubject('تذكير بالرسوم الدراسية والفواتير المستحقة');
      if (pendingInvoices.length > 0) {
        const lines = pendingInvoices
          .slice(0, 5)
          .map(
            (inv) =>
              `- ${inv.studentName} · ${inv.title}: ${formatIQD(inv.amount)} (الاستحقاق: ${inv.dueDate})`,
          )
          .join('\n');
        setComposerBody(
          `السلام عليكم ورحمة الله وبركاته،\n\nنود تذكيركم بالفواتير الدراسية غير المسددة حالياً:\n${lines}\n\nيمكنكم السداد الإلكتروني واستلام الإيصال مباشرة عبر قسم الرسوم والفواتير في المنصة.`,
        );
      } else {
        setComposerBody(
          'السلام عليكم ورحمة الله وبركاته،\n\nيرجى مراجعة قسم الرسوم والفواتير وصندوق التبرعات في المنصة للاطلاع على أحدث المستحقات والإيصالات.',
        );
      }
      return;
    }

    if (category === 'circular') {
      const openPoll = polls.find((p) => p.status === 'open');
      const latestAnn = announcements[0];
      if (openPoll) {
        setComposerSubject(`دعوة للمشاركة في استطلاع رأي: ${openPoll.title}`);
        setComposerBody(
          `السلام عليكم ورحمة الله وبركاته،\n\nتدعوكم إدارة المدرسة للمشاركة برأيكم في استطلاع الرأي المفتوح:\n"${openPoll.title}"\n${openPoll.description}\n\nالفئة المستهدفة: ${openPoll.targetGrade} · آخر موعد للتصويت: ${openPoll.closesAt}.\nنسعد بمشاركتكم عبر تبويب استطلاعات الرأي في المنصة.`,
        );
      } else if (latestAnn) {
        setComposerSubject(`تعميم مدرسي: ${latestAnn.title}`);
        setComposerBody(
          `السلام عليكم ورحمة الله وبركاته،\n\n${latestAnn.body}\n\nمع تحيات ${latestAnn.authorName}.`,
        );
      } else {
        setComposerSubject('تعميم مدرسي جديد من إدارة المدرسة');
        setComposerBody(
          'السلام عليكم ورحمة الله وبركاته،\n\nيرجى الاطلاع على أحدث التعاميم والفعاليات المدرسية المنشورة في بوابة التواصل.',
        );
      }
      return;
    }

    setComposerSubject('');
    setComposerBody('');
  };

  const addRecipient = (target: RecipientTarget) => {
    const cleanEmail = target.email.trim().toLowerCase();
    if (!isValidEmailAddress(cleanEmail)) {
      onNotify('يرجى إدخال بريد إلكتروني صحيح للمستلم.');
      return;
    }
    setSelectedRecipients((prev) => {
      if (prev.some((item) => item.email.toLowerCase() === cleanEmail)) {
        return prev;
      }
      return [
        ...prev,
        {
          uid: target.uid || 'manual',
          name: target.name.trim() || cleanEmail,
          email: target.email.trim(),
        },
      ];
    });
  };

  const removeRecipient = (emailToRemove: string) => {
    setSelectedRecipients((prev) =>
      prev.filter((item) => item.email.toLowerCase() !== emailToRemove.toLowerCase()),
    );
  };

  const handleSelectMatchingSubscribers = () => {
    const matching = subscriptions.filter((sub) => doesSubMatchCategory(sub, composerCategory));
    if (matching.length === 0) {
      onNotify(
        'لا يوجد مشتركون مفعلون لهذا التصنيف حالياً. يمكنك إضافة بريد مستلم يدوياً أو إضافة بريدك للاختبار.',
      );
      return;
    }
    setSelectedRecipients((prev) => {
      const map = new Map<string, RecipientTarget>();
      for (const existing of prev) {
        map.set(existing.email.toLowerCase(), existing);
      }
      for (const sub of matching) {
        if (isValidEmailAddress(sub.email)) {
          map.set(sub.email.toLowerCase(), {
            uid: sub.uid,
            name: sub.displayName,
            email: sub.email,
          });
        }
      }
      return Array.from(map.values());
    });
    onNotify(
      `تمت إضافة ${matching.length} مشتركاً لتنبيهات "${EMAIL_CATEGORY_LABELS[composerCategory]}".`,
    );
  };

  const handleAddManualRecipient = () => {
    if (!isValidEmailAddress(manualRecipientEmail)) {
      onNotify('صيغة البريد الإلكتروني غير صحيحة.');
      return;
    }
    addRecipient({
      uid: 'manual',
      name: manualRecipientName.trim() || manualRecipientEmail.trim(),
      email: manualRecipientEmail.trim(),
    });
    setManualRecipientName('');
    setManualRecipientEmail('');
  };

  const handleOpenSendConfirmation = (e: React.FormEvent) => {
    e.preventDefault();
    if (composerSubject.trim().length < 2 || composerBody.trim().length < 2) {
      onNotify('يرجى كتابة عنوان ونص التنبيه البريدي قبل المتابعة.');
      return;
    }
    if (selectedRecipients.length === 0) {
      onNotify('يرجى اختيار مستلم واحد على الأقل أو إضافة بريد إلكتروني.');
      return;
    }
    setConfirmSendOpen(true);
  };

  const handleSendTestToSelf = () => {
    const targetEmail = (prefEmail || userEmail || '').trim();
    if (!isValidEmailAddress(targetEmail)) {
      onNotify('يرجى حفظ بريدك الإلكتروني في التفضيلات أولاً.');
      return;
    }
    setComposerCategory('custom');
    setComposerSubject('رسالة اختبار لتنبيهات منصة مدارك المدرسية');
    setComposerBody(
      `مرحباً ${userName || 'ولي الأمر'}،\n\nهذه رسالة اختبار لتأكيد تفعيل خدمة التنبيهات وتقارير الأداء عبر Gmail في منصة مدارك المدرسية.`,
    );
    setSelectedRecipients([
      {
        uid: currentUid,
        name: userName || 'حسابي',
        email: targetEmail,
      },
    ]);
    setConfirmSendOpen(true);
  };

  const handleConfirmDispatch = async () => {
    setSendingEmails(true);
    let activeToken = gmailToken;

    try {
      if (!activeToken) {
        activeToken = await connectGmailAccess();
      }

      const cleanSubject = composerSubject.trim().slice(0, 180);
      const cleanBody = composerBody.trim();
      const safeSenderEmail = (userEmail || prefEmail || 'school@madarek.edu').slice(0, 160);

      let sentCount = 0;
      let failedCount = 0;
      const logEntries: Omit<EmailAlertLog, 'id' | 'createdAt'>[] = [];

      for (const target of selectedRecipients) {
        try {
          const result = await sendGmailEmail({
            accessToken: activeToken,
            to: target.email,
            subject: cleanSubject,
            bodyText: cleanBody,
            categoryLabel: EMAIL_CATEGORY_LABELS[composerCategory],
            senderName: safeSenderName,
          });
          sentCount += 1;
          logEntries.push({
            senderUid: currentUid,
            senderName: safeSenderName,
            senderEmail: safeSenderEmail,
            recipientUid: (target.uid || 'manual').slice(0, 128),
            recipientName: (target.name || target.email).slice(0, 120),
            recipientEmail: target.email.slice(0, 160),
            category: composerCategory,
            subject: cleanSubject,
            bodyPreview: cleanBody.slice(0, 500),
            status: 'sent',
            gmailMessageId: result.id.slice(0, 128),
          });
        } catch (err) {
          if (err instanceof GmailAuthError && err.code === 'TOKEN_EXPIRED') {
            setGmailAccessToken(null);
            throw err;
          }
          failedCount += 1;
          logEntries.push({
            senderUid: currentUid,
            senderName: safeSenderName,
            senderEmail: safeSenderEmail,
            recipientUid: (target.uid || 'manual').slice(0, 128),
            recipientName: (target.name || target.email).slice(0, 120),
            recipientEmail: target.email.slice(0, 160),
            category: composerCategory,
            subject: cleanSubject,
            bodyPreview: cleanBody.slice(0, 500),
            status: 'failed',
            errorMessage: (err instanceof Error ? err.message : 'فشل الإرسال').slice(0, 300),
          });
        }
      }

      if (logEntries.length > 0) {
        const batch = writeBatch(db);
        const now = serverTimestamp();
        const stamp = Date.now();
        logEntries.forEach((entry, idx) => {
          const logRef = doc(db, 'emailAlertLogs', `emaillog_${stamp}_${idx}`);
          batch.set(logRef, {
            ...entry,
            createdAt: now,
          });
        });
        await batch.commit();
      }

      setConfirmSendOpen(false);
      if (failedCount === 0) {
        onNotify(`تم إرسال ${sentCount} تنبيه عبر Gmail بنجاح وحفظها في السجل.`);
      } else {
        onNotify(
          `تم إرسال ${sentCount} رسالة وتعذر إرسال ${failedCount} رسالة. راجع السجل للتفاصيل.`,
        );
      }
    } catch (error) {
      onNotify(
        error instanceof Error
          ? error.message
          : 'تعذر إتمام الإرسال عبر Gmail. يرجى التحقق من ربط الحساب والمحاولة مجدداً.',
      );
    } finally {
      setSendingEmails(false);
    }
  };

  return (
    <div className="space-y-6">
      <PrintHeader
        title="سجل وتقارير التنبيهات عبر البريد الإلكتروني (Gmail API)"
        subtitle="تقارير الأداء الشهرية والإنذارات المدرسية التلقائية المرسلة للمسجلين في النظام"
        documentCode={`EMAIL-${new Date().toISOString().slice(0, 10)}`}
        metadata={[
          { label: 'المشتركون المفعلون', value: activeSubscribersCount },
          { label: 'التقارير المعلقة', value: pendingMonthlyReports.length },
          { label: 'الإنذارات المعلقة', value: pendingWarnings.length },
          { label: 'الرسائل المرسلة', value: sentLogsCount },
        ]}
      />

      {/* Summary KPI & Gmail Connection Strip */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 no-print">
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-3 md:col-span-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-slate-500">تكامل Gmail API للإرسال الآلي</p>
              <p
                className={`text-sm font-bold mt-1 flex items-center gap-1.5 ${
                  gmailToken ? 'text-emerald-700' : 'text-amber-700'
                }`}
              >
                {gmailToken ? (
                  <>
                    <MailCheck className="w-4 h-4" />
                    <span>حساب Gmail متصل وجاهز للإرسال الفوري والمجدول</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-4 h-4" />
                    <span>يرجى ربط جلسة Google / Gmail لتفعيل الإرسال الفعلي</span>
                  </>
                )}
              </p>
            </div>
            <button
              type="button"
              disabled={connectingGmail}
              onClick={handleConnectGmail}
              className="inline-flex items-center justify-center gap-2 px-3.5 py-2 bg-white border border-slate-300 text-slate-800 text-xs font-medium rounded-lg hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <svg viewBox="0 0 48 48" className="w-4 h-4 shrink-0" aria-hidden="true">
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
              <span>
                {connectingGmail
                  ? 'جاري الربط...'
                  : gmailToken
                    ? 'تحديث اتصال Gmail'
                    : 'ربط Google / Gmail'}
              </span>
            </button>
          </div>
          <p className="text-xs text-slate-500">
            يتم تجهيز تقارير الأداء الشهرية والإنذارات المدرسية تلقائياً لجميع المسجلين في النظام مع
            منع التكرار وتوثيق كل عملية إرسال.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
          <div>
            <p className="text-xs text-slate-500">تقارير وإنذارات بانتظار الإرسال</p>
            <p className="text-2xl font-bold font-mono-num text-amber-700 mt-1">
              {pendingMonthlyReports.length + pendingWarnings.length}
            </p>
          </div>
          <p className="text-xs text-slate-500 mt-2 font-mono-num">
            {pendingMonthlyReports.length} تقرير شهري · {pendingWarnings.length} إنذار مدرسي
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
          <div>
            <p className="text-xs text-slate-500">المسجلون والرسائل المرسلة</p>
            <p className="text-2xl font-bold font-mono-num text-teal-700 mt-1">
              {activeSubscribersCount}{' '}
              <span className="text-sm font-normal text-slate-500">مشترك نشط</span>
            </p>
          </div>
          <p className="text-xs text-slate-500 mt-2 font-mono-num">
            إجمالي المرسل بنجاح: {sentLogsCount} رسالة
          </p>
        </div>
      </div>

      {/* Automated Monthly Performance Reports & School Warnings Engine (Staff/Admin) */}
      {canSendSchoolAlerts && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden no-print">
          <div className="p-5 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-bold font-display text-slate-900">
                نظام الأتمتة التلقائي لتقارير الأداء الشهرية والإنذارات المدرسية
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                رصد تلقائي لتقارير الشهر المحدّد ولحالات الغياب والتأخر والخصم السلوكي والفواتير
                المتأخرة للمسجلين
              </p>
            </div>

            <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto max-w-full">
              <button
                type="button"
                onClick={() => setAutomationTab('monthly')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  automationTab === 'monthly'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <BarChart3 className="w-3.5 h-3.5 text-teal-700" />
                <span>
                  تقارير الأداء الشهرية ({pendingMonthlyReports.length})
                </span>
              </button>
              <button
                type="button"
                onClick={() => setAutomationTab('warnings')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  automationTab === 'warnings'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                <span>الإنذارات التلقائية ({pendingWarnings.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setAutomationTab('subscribers')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  automationTab === 'subscribers'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Users className="w-3.5 h-3.5 text-slate-700" />
                <span>المسجلون في النظام ({subscriptions.length})</span>
              </button>
            </div>
          </div>

          {/* Automation Sub-tab 1: Automated Monthly Performance Reports */}
          {automationTab === 'monthly' && (
            <div className="p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 bg-slate-50 border border-slate-200 rounded-xl p-4">
                <div className="flex flex-wrap items-end gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      شهر تقرير الأداء
                    </label>
                    <input
                      type="month"
                      value={reportMonth}
                      onChange={(e) => setReportMonth(e.target.value || getDefaultReportMonthKey())}
                      className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white font-mono-num"
                    />
                  </div>
                  <div className="text-xs text-slate-600 pb-1.5">
                    تقرير شهر <strong className="text-slate-900">{formatArabicMonth(reportMonth)}</strong>{' '}
                    · تم تجهيز{' '}
                    <span className="font-mono-num font-bold text-teal-700">
                      {monthlyReportItems.length}
                    </span>{' '}
                    تقرير (معلق:{' '}
                    <span className="font-mono-num font-bold text-amber-700">
                      {pendingMonthlyReports.length}
                    </span>
                    )
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={pendingMonthlyReports.length === 0}
                    onClick={() =>
                      openAutomatedDispatchModal({
                        title: `إرسال تقارير الأداء الشهرية — ${formatArabicMonth(reportMonth)}`,
                        subtitle: `سيتم إرسال تقارير الأداء الأكاديمية والحضور والسلوك بصيغة منسقة إلى ${pendingMonthlyReports.length} مشترك لم يُرسل لهم تقرير هذا الشهر بعد.`,
                        items: pendingMonthlyReports,
                      })
                    }
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-teal-700 text-white text-xs font-semibold rounded-lg hover:bg-teal-800 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Send className="w-4 h-4" />
                    <span>
                      إرسال تقارير الشهر المعلقة تلقائياً ({pendingMonthlyReports.length})
                    </span>
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-right text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                    <tr>
                      <th className="py-3 px-4 font-semibold">المشترك المستلم</th>
                      <th className="py-3 px-4 font-semibold">البريد الإلكتروني</th>
                      <th className="py-3 px-4 font-semibold">ملخص الأداء المشمول</th>
                      <th className="py-3 px-4 font-semibold">الحالة للشهر</th>
                      <th className="py-3 px-4 font-semibold">الإجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {monthlyReportItems.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50/70">
                        <td className="py-3.5 px-4">
                          <p className="font-semibold text-slate-900">{item.recipientName}</p>
                          <p className="text-xs text-slate-500">
                            {ROLE_LABELS_AR[item.recipientRole]} · {item.gradeLabel}
                          </p>
                        </td>
                        <td className="py-3.5 px-4 font-mono-num text-xs text-slate-700" dir="ltr">
                          {item.recipientEmail}
                        </td>
                        <td className="py-3.5 px-4 text-xs text-slate-700 font-mono-num">
                          {item.highlights.join(' · ')}
                        </td>
                        <td className="py-3.5 px-4 text-xs font-semibold whitespace-nowrap">
                          {item.alreadySent ? (
                            <span className="text-emerald-700">تم إرسال تقرير الشهر</span>
                          ) : (
                            <span className="text-amber-700">جاهز للإرسال التلقائي</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setPreviewItem(item)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-100 text-slate-800 text-xs font-medium rounded-lg hover:bg-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>معاينة</span>
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                openAutomatedDispatchModal({
                                  title: `إرسال تقرير الأداء الشهري إلى ${item.recipientName}`,
                                  subtitle: item.alreadySent
                                    ? 'تم إرسال تقرير هذا الشهر مسبقاً؛ يمكنك إعادة الإرسال عند التحديث.'
                                    : 'مراجعة التقرير قبل الإرسال المباشر عبر Gmail.',
                                  items: [item],
                                })
                              }
                              className="inline-flex items-center gap-1 px-3 py-1.5 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <Send className="w-3.5 h-3.5" />
                              <span>{item.alreadySent ? 'إعادة إرسال' : 'إرسال عبر Gmail'}</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {monthlyReportItems.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-10 text-center text-sm text-slate-500">
                          لا يوجد مشتركون مفعلون مرتبطون بطلاب لإصدار تقارير الشهر المحدد. تأكد من
                          تفعيل اشتراك البريد الإلكتروني أو إضافة مشتركين في تبويب «المسجلون في
                          النظام».
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Automation Sub-tab 2: Automated School Warnings Queue */}
          {automationTab === 'warnings' && (
            <div className="p-5 space-y-4">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-xl p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <select
                    value={warningCategoryFilter}
                    onChange={(e) =>
                      setWarningCategoryFilter(
                        e.target.value as 'all' | 'attendance' | 'behavior' | 'payment' | 'homework',
                      )
                    }
                    className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="all">جميع أنواع الإنذارات</option>
                    <option value="attendance">إنذارات الغياب والتأخر</option>
                    <option value="behavior">إنذارات الخصم السلوكي</option>
                    <option value="payment">إنذارات الفواتير المتأخرة</option>
                    <option value="homework">تذكيرات الواجبات (غداً)</option>
                  </select>

                  <select
                    value={warningStatusFilter}
                    onChange={(e) =>
                      setWarningStatusFilter(e.target.value as 'pending' | 'all')
                    }
                    className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="pending">الإنذارات المعلقة فقط ({pendingWarnings.length})</option>
                    <option value="all">كافة الإنذارات المرصودة ({allWarningItems.length})</option>
                  </select>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={selectedWarningKeys.length === 0}
                    onClick={() => {
                      const chosen = allWarningItems.filter((w) =>
                        selectedWarningKeys.includes(w.autoDispatchKey),
                      );
                      openAutomatedDispatchModal({
                        title: `إرسال ${chosen.length} إنذار مدرسي تلقائي عبر Gmail`,
                        subtitle:
                          'سيتم إرسال الإنذارات المحددة مباشرة إلى بريد المسجلين وتوثيقها لمنع التكرار.',
                        items: chosen,
                      });
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-red-700 text-white text-xs font-semibold rounded-lg hover:bg-red-800 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Send className="w-4 h-4" />
                    <span>إرسال الإنذارات المحددة ({selectedWarningKeys.length})</span>
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-right text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                    <tr>
                      <th className="py-3 px-4 font-semibold w-10">اختيار</th>
                      <th className="py-3 px-4 font-semibold">التصنيف</th>
                      <th className="py-3 px-4 font-semibold">عنوان الإنذار والتفاصيل</th>
                      <th className="py-3 px-4 font-semibold">المستلم المسجل</th>
                      <th className="py-3 px-4 font-semibold">حالة الإرسال</th>
                      <th className="py-3 px-4 font-semibold">معاينة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredWarnings.map((item) => {
                      const checked = selectedWarningKeys.includes(item.autoDispatchKey);
                      return (
                        <tr key={item.id} className="hover:bg-slate-50/70">
                          <td className="py-3.5 px-4">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={item.alreadySent}
                              onChange={() => handleToggleWarningSelection(item.autoDispatchKey)}
                              className="w-4 h-4 accent-teal-700 cursor-pointer"
                            />
                          </td>
                          <td className="py-3.5 px-4 text-xs font-semibold whitespace-nowrap">
                            <span
                              className={
                                item.severity === 'urgent'
                                  ? 'text-red-700'
                                  : item.severity === 'warning'
                                    ? 'text-amber-700'
                                    : 'text-teal-700'
                              }
                            >
                              {EMAIL_CATEGORY_LABELS[item.category]}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 max-w-md">
                            <p className="text-xs font-bold text-slate-900">{item.subject}</p>
                            <p className="text-[11px] text-slate-500 font-mono-num mt-0.5">
                              {item.highlights.join(' · ')}
                            </p>
                          </td>
                          <td className="py-3.5 px-4">
                            <p className="text-xs font-semibold text-slate-800">
                              {item.recipientName}
                            </p>
                            <p className="text-[11px] font-mono-num text-slate-500" dir="ltr">
                              {item.recipientEmail}
                            </p>
                          </td>
                          <td className="py-3.5 px-4 text-xs font-semibold whitespace-nowrap">
                            {item.alreadySent ? (
                              <span className="text-emerald-700">تم الإرسال مسبقاً</span>
                            ) : (
                              <span className="text-amber-700">بانتظار الإرسال</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4">
                            <button
                              type="button"
                              onClick={() => setPreviewItem(item)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-100 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>معاينة</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredWarnings.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-10 text-center text-sm text-slate-500">
                          لا توجد إنذارات مدرسية مطابقة للفلتر الحالي.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Automation Sub-tab 3: Registered Subscribers Directory */}
          {automationTab === 'subscribers' && (
            <div className="p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <p className="text-xs text-slate-600">
                  قائمة الحسابات المسجلة لاستلام تقارير الأداء الشهرية والإنذارات المدرسية تلقائياً
                  عبر البريد الإلكتروني.
                </p>
                {isAdminAccount && (
                  <button
                    type="button"
                    onClick={() => setShowAddSubscriber((v) => !v)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <UserPlus className="w-4 h-4" />
                    <span>تسجيل مشترك بالبريد</span>
                  </button>
                )}
              </div>

              {isAdminAccount && showAddSubscriber && (
                <form
                  onSubmit={handleAddAdminSubscriber}
                  className="bg-slate-50 border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3"
                >
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      اسم ولي الأمر / المشترك
                    </label>
                    <input
                      type="text"
                      required
                      value={newSubName}
                      onChange={(e) => setNewSubName(e.target.value)}
                      placeholder="مثال: أبو علي الحسن"
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      البريد الإلكتروني
                    </label>
                    <input
                      type="email"
                      dir="ltr"
                      required
                      value={newSubEmail}
                      onChange={(e) => setNewSubEmail(e.target.value)}
                      placeholder="parent@gmail.com"
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white font-mono-num text-left"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">الصفة</label>
                    <select
                      value={newSubRole}
                      onChange={(e) => setNewSubRole(e.target.value as UserRole)}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="parent">ولي أمر / طالب</option>
                      <option value="teacher">مدرس</option>
                      <option value="supervisor">مراقب</option>
                      <option value="admin">إدارة المدرسة</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      النطاق / الصف الدراسي
                    </label>
                    <select
                      value={newSubGrade}
                      onChange={(e) => setNewSubGrade(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="جميع الصفوف">جميع الصفوف</option>
                      {SCHOOL_GRADES.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-end gap-2">
                    <button
                      type="submit"
                      disabled={savingSubscriber}
                      className="flex-1 px-3 py-2 bg-teal-700 text-white text-xs font-semibold rounded-lg hover:bg-teal-800 disabled:opacity-50 whitespace-nowrap cursor-pointer"
                    >
                      {savingSubscriber ? 'جاري التسجيل...' : 'حفظ المشترك'}
                    </button>
                  </div>
                  <div className="sm:col-span-2 lg:col-span-5">
                    <label className="block text-[11px] text-slate-500 mb-1">
                      ربط بحساب ولي أمر مسجل (UID) لتلقي تقارير وإنذارات أبنائه:
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={newSubLinkedUid}
                      onChange={(e) => setNewSubLinkedUid(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white font-mono-num text-left"
                    />
                  </div>
                </form>
              )}

              {isAdminAccount && unsubscribedUsers.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
                  <p className="text-xs font-bold text-amber-900">
                    حسابات مسجلة في المنصة لم تُفعّل لها التنبيهات البريدية بعد ({unsubscribedUsers.length}):
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {unsubscribedUsers.map((u) => (
                      <button
                        key={u.uid}
                        type="button"
                        onClick={() => handleSubscribeExistingUser(u)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-amber-300 text-xs text-slate-800 rounded-lg hover:bg-amber-100 whitespace-nowrap cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5 text-teal-700" />
                        <span>
                          {u.displayName} ({u.email})
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-right text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                    <tr>
                      <th className="py-3 px-4 font-semibold">الاسم والصفة</th>
                      <th className="py-3 px-4 font-semibold">البريد الإلكتروني</th>
                      <th className="py-3 px-4 font-semibold">التنبيهات المفعلة</th>
                      <th className="py-3 px-4 font-semibold">الحالة</th>
                      {isAdminAccount && <th className="py-3 px-4 font-semibold">تحكم</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {subscriptions.map((sub) => {
                      const activeCategories = [
                        sub.alertAttendance ? 'الحضور' : null,
                        sub.alertBehavior ? 'السلوك' : null,
                        sub.alertGrades ? 'التقارير والدرجات' : null,
                        sub.alertHomework ? 'الواجبات' : null,
                        sub.alertPayments ? 'الرسوم' : null,
                        sub.alertCirculars ? 'التعاميم' : null,
                      ]
                        .filter(Boolean)
                        .join(' · ');

                      return (
                        <tr key={sub.id} className="hover:bg-slate-50/70">
                          <td className="py-3.5 px-4">
                            <p className="font-semibold text-slate-900">{sub.displayName}</p>
                            <p className="text-xs text-slate-500">
                              {ROLE_LABELS_AR[sub.role]} · {sub.gradeLabel || 'جميع الصفوف'}
                            </p>
                          </td>
                          <td className="py-3.5 px-4 font-mono-num text-xs text-slate-700" dir="ltr">
                            {sub.email}
                          </td>
                          <td className="py-3.5 px-4 text-xs text-slate-600">
                            {activeCategories || 'بدون تصنيفات'}
                          </td>
                          <td className="py-3.5 px-4 text-xs font-semibold">
                            <span className={sub.enabled ? 'text-emerald-700' : 'text-slate-400'}>
                              {sub.enabled ? 'مفعل' : 'متوقف'}
                            </span>
                          </td>
                          {isAdminAccount && (
                            <td className="py-3.5 px-4">
                              <button
                                type="button"
                                onClick={() => handleToggleSubscriberEnabled(sub)}
                                className="px-3 py-1.5 bg-slate-100 text-slate-800 text-xs font-medium rounded-lg hover:bg-slate-200 whitespace-nowrap cursor-pointer"
                              >
                                {sub.enabled ? 'إيقاف مؤقت' : 'تفعيل'}
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                    {subscriptions.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-sm text-slate-500">
                          لا توجد اشتراكات بريدية مسجلة حتى الآن.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Personal Email Alert Preferences */}
      <form
        onSubmit={handleSavePreferences}
        className="bg-white border border-slate-200 rounded-xl p-6 space-y-5 no-print"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5">
            <Settings2 className="w-5 h-5 text-teal-700 shrink-0" />
            <div>
              <h3 className="text-base font-bold font-display text-slate-900">
                تفضيلات استلام التقارير الشهرية والتنبيهات عبر البريد الإلكتروني
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                حدّد بريدك الإلكتروني وتصنيفات الإنذارات وتقارير الأداء الشهرية التي ترغب باستلامها
                تلقائياً
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleSendTestToSelf}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 text-slate-800 text-xs font-medium rounded-lg hover:bg-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Mail className="w-4 h-4 text-teal-700" />
            <span>إرسال رسالة اختبار لبريدي</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              البريد الإلكتروني لاستلام التنبيهات والتقارير
            </label>
            <input
              type="email"
              dir="ltr"
              required
              value={prefEmail}
              onChange={(e) => setPrefEmail(e.target.value)}
              placeholder="name@example.com"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num text-left"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              الصف الدراسي المرتبط
            </label>
            <select
              value={prefGradeLabel}
              onChange={(e) => setPrefGradeLabel(e.target.value)}
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

          <div className="flex items-end">
            <label className="w-full flex items-center justify-between gap-3 px-4 py-2.5 border border-slate-200 rounded-lg bg-slate-50 cursor-pointer">
              <span className="text-xs font-semibold text-slate-800">
                تفعيل الاستلام التلقائي لحسابي
              </span>
              <input
                type="checkbox"
                checked={prefEnabled}
                onChange={(e) => setPrefEnabled(e.target.checked)}
                className="w-4 h-4 accent-teal-700"
              />
            </label>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            {
              key: 'att',
              label: 'إنذارات الحضور والغياب والتأخر',
              checked: alertAttendance,
              onChange: setAlertAttendance,
            },
            {
              key: 'beh',
              label: 'إنذارات درجات السلوك والانضباط',
              checked: alertBehavior,
              onChange: setAlertBehavior,
            },
            {
              key: 'hw',
              label: 'تذكيرات الواجبات المنزلية (قبل يوم)',
              checked: alertHomework,
              onChange: setAlertHomework,
            },
            {
              key: 'grd',
              label: 'تقارير الأداء الشهرية وإشعارات الدرجات',
              checked: alertGrades,
              onChange: setAlertGrades,
            },
            {
              key: 'pay',
              label: 'تنبيهات الرسوم والفواتير المتأخرة',
              checked: alertPayments,
              onChange: setAlertPayments,
            },
            {
              key: 'cir',
              label: 'التعاميم واستطلاعات الرأي والتقويم',
              checked: alertCirculars,
              onChange: setAlertCirculars,
            },
          ].map((item) => (
            <label
              key={item.key}
              className="flex items-center gap-2.5 p-3 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={item.checked}
                disabled={!prefEnabled}
                onChange={(e) => item.onChange(e.target.checked)}
                className="w-4 h-4 accent-teal-700"
              />
              <span className="text-xs font-medium text-slate-700">{item.label}</span>
            </label>
          ))}
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={savingPrefs}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-teal-700 text-white text-xs font-semibold rounded-lg hover:bg-teal-800 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{savingPrefs ? 'جاري الحفظ...' : 'حفظ تفضيلات التنبيهات البريدية'}</span>
          </button>
        </div>
      </form>

      {/* School Manual Email Dispatch Center */}
      {canSendSchoolAlerts && (
        <form
          onSubmit={handleOpenSendConfirmation}
          className="bg-white border border-slate-200 rounded-xl p-6 space-y-5 no-print"
        >
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-base font-bold font-display text-slate-900">
                إنشاء رسالة بريدية فورية أو تعميم عبر Gmail
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                أنشئ رسالة مخصصة أو اختر قالباً جاهزاً من بيانات المدرسة ثم راجع المستلمين قبل
                الإرسال
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 text-xs text-slate-500 ml-1">
                <Sparkles className="w-3.5 h-3.5 text-teal-700" />
                <span>تعبئة ذكية:</span>
              </span>
              {(
                [
                  'monthly_report',
                  'attendance',
                  'homework',
                  'behavior',
                  'grade',
                  'payment',
                  'circular',
                ] as EmailAlertCategory[]
              ).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => applySmartPreset(cat)}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    composerCategory === cat
                      ? 'bg-teal-700 text-white border-teal-700'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {EMAIL_CATEGORY_LABELS[cat]}
                </button>
              ))}
            </div>
          </div>

          {/* Recipients Manager */}
          <div className="space-y-3 bg-slate-50 border border-slate-200 rounded-xl p-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <p className="text-xs font-bold text-slate-800">
                المستلمون المحددون (<span className="font-mono-num">{selectedRecipients.length}</span>)
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleSelectMatchingSubscribers}
                  className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-100 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  إضافة المشتركين في هذا التصنيف
                </button>
                {userEmail && (
                  <button
                    type="button"
                    onClick={() =>
                      addRecipient({
                        uid: currentUid,
                        name: userName || 'بريدي الشخصي',
                        email: userEmail,
                      })
                    }
                    className="px-3 py-1.5 bg-white border border-slate-300 text-teal-800 text-xs font-medium rounded-lg hover:bg-teal-50 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    إضافة بريدي للاختبار ({userEmail})
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
              <input
                type="text"
                value={manualRecipientName}
                onChange={(e) => setManualRecipientName(e.target.value)}
                placeholder="اسم ولي الأمر / المستلم (اختياري)"
                className="sm:col-span-4 px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
              />
              <input
                type="email"
                dir="ltr"
                value={manualRecipientEmail}
                onChange={(e) => setManualRecipientEmail(e.target.value)}
                placeholder="parent@example.com"
                className="sm:col-span-6 px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white font-mono-num text-left"
              />
              <button
                type="button"
                onClick={handleAddManualRecipient}
                className="sm:col-span-2 inline-flex items-center justify-center gap-1 px-3 py-2 bg-slate-800 text-white text-xs font-medium rounded-lg hover:bg-slate-900 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>إضافة</span>
              </button>
            </div>

            {selectedRecipients.length > 0 ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {selectedRecipients.map((rec) => (
                  <div
                    key={rec.email}
                    className="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-800"
                  >
                    <span className="font-semibold">{rec.name}</span>
                    <span className="text-slate-400">·</span>
                    <span className="font-mono-num text-slate-600" dir="ltr">
                      {rec.email}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeRecipient(rec.email)}
                      aria-label={`إزالة ${rec.email}`}
                      className="text-slate-400 hover:text-red-700 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                لم يتم اختيار مستلمين بعد. أضف المشتركين تلقائياً أو أدخل بريداً إلكترونياً أعلاه.
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">تصنيف التنبيه</label>
              <select
                value={composerCategory}
                onChange={(e) => setComposerCategory(e.target.value as EmailAlertCategory)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                {(Object.keys(EMAIL_CATEGORY_LABELS) as EmailAlertCategory[]).map((cat) => (
                  <option key={cat} value={cat}>
                    {EMAIL_CATEGORY_LABELS[cat]}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                عنوان الرسالة (Subject)
              </label>
              <input
                type="text"
                required
                maxLength={180}
                value={composerSubject}
                onChange={(e) => setComposerSubject(e.target.value)}
                placeholder="مثال: تذكير بموعد تسليم الواجب المنزلي غداً"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            <div className="md:col-span-3">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                محتوى التنبيه البريدي
              </label>
              <textarea
                rows={5}
                required
                value={composerBody}
                onChange={(e) => setComposerBody(e.target.value)}
                placeholder="اكتب نص التنبيه الذي سيصل إلى البريد الإلكتروني للمستلمين..."
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg leading-relaxed"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 pt-2">
            <p className="text-xs text-slate-500">
              سيتم عرض نافذة تأكيد نهائية توضح قائمة المستلمين ونص الرسالة قبل إرسال أي بريد عبر
              Gmail.
            </p>
            <button
              type="submit"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-teal-700 text-white text-xs font-semibold rounded-lg hover:bg-teal-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Send className="w-4 h-4" />
              <span>مراجعة وإرسال عبر Gmail</span>
            </button>
          </div>
        </form>
      )}

      {/* Email Dispatch History Log */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold font-display text-slate-900">
              سجل التنبيهات والتقارير البريدية المرسلة
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              توثيق آلي وفوري لكل رسالة مرسلة عبر Gmail لمنع التكرار ومراجعة حالة الوصول
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 no-print">
            <select
              value={logCategoryFilter}
              onChange={(e) => setLogCategoryFilter(e.target.value as 'all' | EmailAlertCategory)}
              className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="all">كل التصنيفات</option>
              {(Object.keys(EMAIL_CATEGORY_LABELS) as EmailAlertCategory[]).map((cat) => (
                <option key={cat} value={cat}>
                  {EMAIL_CATEGORY_LABELS[cat]}
                </option>
              ))}
            </select>

            <select
              value={logStatusFilter}
              onChange={(e) => setLogStatusFilter(e.target.value as 'all' | 'sent' | 'failed')}
              className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="all">جميع الحالات</option>
              <option value="sent">تم الإرسال</option>
              <option value="failed">فشل الإرسال</option>
            </select>

            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-slate-800 text-xs font-medium rounded-lg hover:bg-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>طباعة السجل</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-5 py-3 font-semibold">التاريخ</th>
                <th className="px-5 py-3 font-semibold">التصنيف والنوع</th>
                <th className="px-5 py-3 font-semibold">المستلم</th>
                <th className="px-5 py-3 font-semibold">العنوان</th>
                <th className="px-5 py-3 font-semibold">الحالة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50/70">
                  <td className="px-5 py-3.5 text-xs font-mono-num text-slate-500 whitespace-nowrap">
                    {formatLogTime(log)}
                  </td>
                  <td className="px-5 py-3.5 whitespace-nowrap">
                    <p className="text-xs font-medium text-teal-800">
                      {EMAIL_CATEGORY_LABELS[log.category] || log.category}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {log.autoDispatchKey ? 'إرسال تلقائي مجدول' : 'إرسال يدوي'}
                    </p>
                  </td>
                  <td className="px-5 py-3.5">
                    <p className="text-xs font-semibold text-slate-900">{log.recipientName}</p>
                    <p className="text-xs font-mono-num text-slate-500" dir="ltr">
                      {log.recipientEmail}
                    </p>
                  </td>
                  <td className="px-5 py-3.5 max-w-xs">
                    <p className="text-xs font-semibold text-slate-900 truncate">{log.subject}</p>
                    <p className="text-xs text-slate-500 truncate">{log.bodyPreview}</p>
                  </td>
                  <td className="px-5 py-3.5 whitespace-nowrap">
                    {log.status === 'sent' ? (
                      <span className="text-xs font-semibold text-emerald-700">تم الإرسال</span>
                    ) : (
                      <span
                        className="text-xs font-semibold text-red-700"
                        title={log.errorMessage}
                      >
                        فشل الإرسال
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {filteredLogs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-sm text-slate-400">
                    لا توجد تنبيهات أو تقارير بريدية مسجلة حتى الآن.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PrintFooter />

      {/* Preview Modal for Single Automated Report / Warning */}
      {previewItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 no-print">
          <div className="bg-white border border-slate-200 rounded-xl max-w-xl w-full p-6 space-y-4 shadow-xl max-h-[90vh] flex flex-col">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <p className="text-xs font-medium text-teal-700">
                  معاينة {EMAIL_CATEGORY_LABELS[previewItem.category]}
                </p>
                <h4 className="text-base font-bold font-display text-slate-900 mt-0.5">
                  {previewItem.subject}
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setPreviewItem(null)}
                aria-label="إغلاق المعاينة"
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto space-y-3 text-xs flex-1">
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-800">{previewItem.recipientName}</span>
                <span className="font-mono-num text-slate-600" dir="ltr">
                  {previewItem.recipientEmail}
                </span>
              </div>

              {previewItem.highlights.length > 0 && (
                <div className="text-xs text-slate-600 font-mono-num">
                  ملخص سريع: {previewItem.highlights.join(' · ')}
                </div>
              )}

              <div className="bg-white border border-slate-200 rounded-lg p-4 text-slate-700 whitespace-pre-line leading-relaxed">
                {previewItem.bodyText}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setPreviewItem(null)}
                className="px-4 py-2 bg-slate-100 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-200 cursor-pointer"
              >
                إغلاق
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = previewItem;
                  setPreviewItem(null);
                  openAutomatedDispatchModal({
                    title: `تأكيد إرسال: ${target.subject}`,
                    subtitle: `سيتم إرسال البريد إلى ${target.recipientName} (${target.recipientEmail}) عبر Gmail.`,
                    items: [target],
                  });
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-teal-700 text-white text-xs font-semibold rounded-lg hover:bg-teal-800 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>إرسال عبر Gmail</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mandatory User Confirmation Modal for Automated Batch Sends */}
      <GmailDispatchConfirmModal
        open={autoModalState.open}
        title={autoModalState.title}
        subtitle={autoModalState.subtitle}
        items={autoModalState.items}
        gmailConnected={Boolean(gmailToken)}
        sending={sendingAutoBatch}
        onConfirm={handleConfirmAutomatedBatchDispatch}
        onCancel={() => setAutoModalState((prev) => ({ ...prev, open: false }))}
      />

      {/* Mandatory User Confirmation Modal before calling Gmail Send API (Manual Composer) */}
      {confirmSendOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 no-print">
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <h4 className="text-base font-bold font-display text-slate-900">
                  تأكيد إرسال التنبيه عبر Gmail
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  سيتم إرسال هذه الرسالة فعلياً من حساب Google المرتبط بك إلى{' '}
                  <span className="font-mono-num font-bold text-slate-800">
                    {selectedRecipients.length}
                  </span>{' '}
                  مستلم.
                </p>
              </div>
              <button
                type="button"
                disabled={sendingEmails}
                onClick={() => setConfirmSendOpen(false)}
                aria-label="إغلاق نافذة التأكيد"
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <p className="font-semibold text-slate-700 mb-1">
                  المستلمون ({selectedRecipients.length}):
                </p>
                <div className="max-h-24 overflow-y-auto bg-slate-50 border border-slate-200 rounded-lg p-2.5 space-y-1">
                  {selectedRecipients.map((r) => (
                    <div key={r.email} className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-800">{r.name}</span>
                      <span className="font-mono-num text-slate-600" dir="ltr">
                        {r.email}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="font-semibold text-slate-700 mb-1">عنوان الرسالة:</p>
                <p className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-900 font-medium">
                  {composerSubject}
                </p>
              </div>

              <div>
                <p className="font-semibold text-slate-700 mb-1">معاينة النص:</p>
                <div className="max-h-32 overflow-y-auto bg-slate-50 border border-slate-200 rounded-lg p-3 text-slate-700 whitespace-pre-line leading-relaxed">
                  {composerBody}
                </div>
              </div>

              {!gmailToken && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  ملاحظة: عند الضغط على تأكيد الإرسال، ستظهر نافذة Google لمنح إذن الإرسال عبر
                  Gmail إذا لم يكن متصلاً في هذه الجلسة.
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                disabled={sendingEmails}
                onClick={() => setConfirmSendOpen(false)}
                className="px-4 py-2 bg-slate-100 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-200 cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={sendingEmails}
                onClick={handleConfirmDispatch}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-teal-700 text-white text-xs font-semibold rounded-lg hover:bg-teal-800 disabled:opacity-50 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>
                  {sendingEmails
                    ? 'جاري الإرسال عبر Gmail...'
                    : `تأكيد وإرسال (${selectedRecipients.length})`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
