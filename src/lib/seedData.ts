import { collection, doc, getDocs, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { LEGACY_GRADE_MAP } from './grades';
import { getTomorrowDateIso } from './homeworkReminderService';
import { DEFAULT_ROLE_PERMISSIONS, EDITION_METADATA, EDITION_ORDER } from './permissions';

export const TODAY_ISO = new Date().toISOString().slice(0, 10);

let activeSeedWorkspacePromise: Promise<void> | null = null;

function sanitizeDisplayName(value: string | undefined | null, fallback: string): string {
  const trimmed = (value || '').trim();
  return trimmed.length >= 2 ? trimmed.slice(0, 120) : fallback;
}

function addDaysIso(days: number): string {
  const dt = new Date();
  dt.setDate(dt.getDate() + days);
  return dt.toISOString().slice(0, 10);
}

function buildDefaultCalendarEvents(adminName: string) {
  const creator = sanitizeDisplayName(adminName, 'إدارة المدرسة');

  return [
    {
      id: 'cal_exam_math_1',
      data: {
        title: 'الاختبار التقويمي في الرياضيات المتقدمة',
        eventType: 'exam' as const,
        eventDate: addDaysIso(2),
        startTime: '08:30',
        targetGrade: 'صف السادس علمي',
        location: 'قاعة الاختبارات الكبرى',
        notes: 'يشمل الفصلين الأول والثاني من المنهج، ويسمح باستخدام الآلة الحاسبة العلمية.',
        createdByName: creator,
        createdByRole: 'admin' as const,
        scope: 'school' as const,
      },
    },
    {
      id: 'cal_meeting_parents_1',
      data: {
        title: 'اجتماع مجلس الآباء والمعلمين الدوري',
        eventType: 'meeting' as const,
        eventDate: addDaysIso(4),
        startTime: '11:00',
        targetGrade: 'جميع الصفوف',
        location: 'مسرح المدرسة الرئيسي',
        notes: 'مناقشة خطط الدعم الأكاديمي ومتابعة السلوك والحضور للفصل الدراسي الأول.',
        createdByName: creator,
        createdByRole: 'admin' as const,
        scope: 'school' as const,
      },
    },
    {
      id: 'cal_trip_science_1',
      data: {
        title: 'الرحلة المدرسية العلمية إلى القبة الفلكية',
        eventType: 'trip' as const,
        eventDate: addDaysIso(7),
        startTime: '08:00',
        targetGrade: 'صف ثالث متوسط',
        location: 'واحة العلوم والتقنية',
        notes: 'التجمع في الساحة الرئيسية الساعة 07:45 صباحاً مع الالتزام بالزي المدرسي.',
        createdByName: creator,
        createdByRole: 'admin' as const,
        scope: 'school' as const,
      },
    },
    {
      id: 'cal_exam_bio_2',
      data: {
        title: 'امتحان الأحياء والعلوم الشهري',
        eventType: 'exam' as const,
        eventDate: addDaysIso(9),
        startTime: '09:00',
        targetGrade: 'صف ثالث متوسط',
        location: 'الفصول الدراسية — الجناح ب',
        notes: 'مراجعة ملزمة الأحياء الخلوية وأوراق العمل المنشورة في المكتبة الرقمية.',
        createdByName: 'أ. هند الشهري',
        createdByRole: 'teacher' as const,
        scope: 'school' as const,
      },
    },
  ];
}

function buildDefaultDonationCampaigns(adminName: string) {
  const creator = sanitizeDisplayName(adminName, 'إدارة المدرسة');

  return [
    {
      id: 'camp_orphans_1',
      data: {
        title: 'صندوق كفالة ودعم الطلبة المتعففين',
        description:
          'مساعدات شهرية وتغطية الرسوم الدراسية والزي المدرسي للطلبة الأيتام والأسر المتعففة لضمان استمرارهم الدراسي.',
        category: 'orphans_support' as const,
        targetAmount: 5000000,
        collectedAmount: 2150000,
        donorsCount: 18,
        status: 'active' as const,
        createdByName: creator,
        scope: 'school' as const,
      },
    },
    {
      id: 'camp_supplies_1',
      data: {
        title: 'صندوق توفير الحقائب والقرطاسية والملازم',
        description:
          'تجهيز الحقائب المدرسية والكتب والملازم الدراسية المطبوعة لطلبة الصفوف المتوسطة والإعدادية.',
        category: 'supplies' as const,
        targetAmount: 2500000,
        collectedAmount: 1450000,
        donorsCount: 24,
        status: 'active' as const,
        createdByName: creator,
        scope: 'school' as const,
      },
    },
    {
      id: 'camp_labs_1',
      data: {
        title: 'صندوق تطوير المختبرات العلمية والمكتبة',
        description:
          'تحديث أجهزة مختبر الفيزياء والكيمياء وإثراء المكتبة المدرسية بالمراجع العلمية الحديثة.',
        category: 'facilities' as const,
        targetAmount: 7500000,
        collectedAmount: 3200000,
        donorsCount: 12,
        status: 'active' as const,
        createdByName: creator,
        scope: 'school' as const,
      },
    },
  ];
}

function buildDefaultPolls(adminName: string) {
  const creator = sanitizeDisplayName(adminName, 'إدارة المدرسة');

  return [
    {
      id: 'poll_trip_science_2026',
      data: {
        title: 'استطلاع رأي: وجهة الرحلة العلمية الفصلية القادمة',
        description:
          'نود أخذ آراء أولياء الأمور والطلاب لاختيار الوجهة المفضلة للرحلة العلمية الترفيهية المقررة خلال الشهر القادم.',
        category: 'trip' as const,
        targetAudience: 'all' as const,
        targetGrade: 'جميع الصفوف',
        closesAt: addDaysIso(10),
        status: 'open' as const,
        options: [
          'المتحف الوطني والمركز الثقافي',
          'واحة العلوم والقبة الفلكية',
          'المنتزه البيئي والأنشطة الرياضية',
        ],
        optionCounts: [14, 26, 9],
        totalVotes: 49,
        createdByName: creator,
        createdByRole: 'admin' as const,
        scope: 'school' as const,
      },
    },
    {
      id: 'poll_decision_lab_2026',
      data: {
        title: 'قرار مدرسي مقترح: تخصيص ساعة إضافية لمختبر الحاسوب والبرمجة',
        description:
          'تدرس الإدارة تخصيص ساعة تطبيقية إضافية أسبوعياً لمادة الحاسوب والذكاء الاصطناعي بعد الدوام؛ نرجو مشاركة رأيكم قبل الاعتماد.',
        category: 'decision' as const,
        targetAudience: 'parents' as const,
        targetGrade: 'صف السادس علمي',
        closesAt: addDaysIso(7),
        status: 'open' as const,
        options: [
          'موافق وأؤيد تطبيق المقترح',
          'موافق بشرط توفير النقل المدرسي',
          'أفضل الإبقاء على الجدول الحالي',
        ],
        optionCounts: [22, 11, 5],
        totalVotes: 38,
        createdByName: creator,
        createdByRole: 'admin' as const,
        scope: 'school' as const,
      },
    },
    {
      id: 'poll_schedule_review_2026',
      data: {
        title: 'استطلاع: آلية تنظيم حصص المراجعة قبل امتحانات نصف السنة',
        description:
          'شاركونا تفضيلاتكم حول التوقيت الأنسب لجلسات المراجعة المركزة للمواد العلمية في المرحلة المتوسطة.',
        category: 'schedule' as const,
        targetAudience: 'students' as const,
        targetGrade: 'صف ثالث متوسط',
        closesAt: addDaysIso(5),
        status: 'open' as const,
        options: [
          'دروس تقوية حضورية صباحية',
          'مراجعات تفاعلية مسائية عبر المنصة',
          'دمج الحضوري والإلكتروني معاً',
        ],
        optionCounts: [18, 12, 29],
        totalVotes: 59,
        createdByName: 'أ. هند الشهري',
        createdByRole: 'teacher' as const,
        scope: 'school' as const,
      },
    },
  ];
}

export async function seedDefaultRolePermissions(adminName: string) {
  const existingSnap = await getDocs(
    query(collection(db, 'rolePermissions'), where('scope', '==', 'school')),
  );
  const existingIds = new Set(existingSnap.docs.map((d) => d.id));
  const rolesToSeed = EDITION_ORDER.filter((role) => !existingIds.has(role));
  if (rolesToSeed.length === 0) return;

  const batch = writeBatch(db);
  const now = serverTimestamp();
  const safeUpdater = sanitizeDisplayName(adminName, 'إدارة المدرسة');

  for (const role of rolesToSeed) {
    batch.set(doc(db, 'rolePermissions', role), {
      role,
      label: EDITION_METADATA[role].title,
      ...DEFAULT_ROLE_PERMISSIONS[role],
      scope: 'school',
      updatedBy: safeUpdater,
      updatedAt: now,
    });
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'rolePermissions');
  }
}

export function seedSchoolWorkspace(adminUid: string, adminName: string): Promise<void> {
  if (activeSeedWorkspacePromise) {
    return activeSeedWorkspacePromise;
  }
  activeSeedWorkspacePromise = runSeedSchoolWorkspace(adminUid, adminName).finally(() => {
    activeSeedWorkspacePromise = null;
  });
  return activeSeedWorkspacePromise;
}

async function runSeedSchoolWorkspace(adminUid: string, adminName: string) {
  const batch = writeBatch(db);
  const now = serverTimestamp();
  const safeAdminName = sanitizeDisplayName(adminName, 'إدارة المدرسة');
  const safeParentName = sanitizeDisplayName(adminName, 'فهد السبيعي');

  const students = [
    {
      id: 'stu_101',
      fullName: 'عبدالله بن فهد السبيعي',
      studentCode: 'MDR-2026-101',
      grade: 'صف السادس علمي',
      section: 'أ',
      parentUid: adminUid,
      parentName: safeParentName,
      parentPhone: '0551234890',
      gpa: 95.4,
      attendanceRate: 98,
    },
    {
      id: 'stu_102',
      fullName: 'نورة بنت خالد الدوسري',
      studentCode: 'MDR-2026-102',
      grade: 'صف خامس علمي',
      section: 'أ',
      parentUid: adminUid,
      parentName: 'خالد الدوسري',
      parentPhone: '0504458912',
      gpa: 97.2,
      attendanceRate: 99,
    },
    {
      id: 'stu_103',
      fullName: 'يوسف بن طارق العتيبي',
      studentCode: 'MDR-2026-103',
      grade: 'صف ثالث متوسط',
      section: 'ب',
      parentUid: adminUid,
      parentName: 'طارق العتيبي',
      parentPhone: '0548821034',
      gpa: 88.6,
      attendanceRate: 91,
    },
    {
      id: 'stu_104',
      fullName: 'سارة بنت ناصر القحطاني',
      studentCode: 'MDR-2026-104',
      grade: 'صف ثاني متوسط',
      section: 'ب',
      parentUid: adminUid,
      parentName: 'ناصر القحطاني',
      parentPhone: '0567712309',
      gpa: 92.8,
      attendanceRate: 96,
    },
    {
      id: 'stu_105',
      fullName: 'عمر بن سعيد الغامدي',
      studentCode: 'MDR-2026-105',
      grade: 'صف أول متوسط',
      section: 'أ',
      parentUid: adminUid,
      parentName: 'سعيد الغامدي',
      parentPhone: '0539014422',
      gpa: 85.1,
      attendanceRate: 89,
    },
  ];

  const existingStudentsSnap = await getDocs(collection(db, 'students'));
  const existingStudentIds = new Set(existingStudentsSnap.docs.map((d) => d.id));
  const missingStudents = students.filter((s) => !existingStudentIds.has(s.id));

  if (missingStudents.length > 0) {
    const studentsBatch = writeBatch(db);
    for (const { id, ...studentData } of missingStudents) {
      studentsBatch.set(doc(db, 'students', id), {
        ...studentData,
        behaviorScore: 100,
        createdAt: now,
        updatedAt: now,
      });
    }

    try {
      await studentsBatch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'seedSchoolWorkspace/students');
    }
  }

  // If primary school workspace collections already exist, avoid overwriting immutable docs
  const [
    existingTeachersSnap,
    existingCalSnap,
    existingPollsSnap,
    existingDonSnap,
    existingRepSnap,
    existingRoleSnap,
  ] = await Promise.all([
    getDocs(query(collection(db, 'teachers'), where('scope', '==', 'school'))),
    getDocs(query(collection(db, 'calendarEvents'), where('scope', '==', 'school'))),
    getDocs(query(collection(db, 'polls'), where('scope', '==', 'school'))),
    getDocs(query(collection(db, 'donationCampaigns'), where('scope', '==', 'school'))),
    getDocs(query(collection(db, 'attendanceReports'), where('scope', '==', 'school'))),
    getDocs(query(collection(db, 'rolePermissions'), where('scope', '==', 'school'))),
  ]);
  if (!existingTeachersSnap.empty) {
    return;
  }
  const existingCalIds = new Set(existingCalSnap.docs.map((d) => d.id));
  const existingPollIds = new Set(existingPollsSnap.docs.map((d) => d.id));
  const existingDonIds = new Set(existingDonSnap.docs.map((d) => d.id));
  const existingRepIds = new Set(existingRepSnap.docs.map((d) => d.id));
  const existingRoleIds = new Set(existingRoleSnap.docs.map((d) => d.id));

  const attendanceSeed = [
    {
      id: `att_stu_101_${TODAY_ISO}`,
      studentId: 'stu_101',
      studentName: 'عبدالله بن فهد السبيعي',
      grade: 'صف السادس علمي',
      parentUid: adminUid,
      date: TODAY_ISO,
      status: 'present',
      checkInTime: '07:18',
      parentNotified: true,
      notes: 'حضور مبكر عبر البوابة الذكية',
    },
    {
      id: `att_stu_102_${TODAY_ISO}`,
      studentId: 'stu_102',
      studentName: 'نورة بنت خالد الدوسري',
      grade: 'صف خامس علمي',
      parentUid: adminUid,
      date: TODAY_ISO,
      status: 'present',
      checkInTime: '07:22',
      parentNotified: true,
      notes: 'انتظام كامل في الطابور الصباحي',
    },
    {
      id: `att_stu_103_${TODAY_ISO}`,
      studentId: 'stu_103',
      studentName: 'يوسف بن طارق العتيبي',
      grade: 'صف ثالث متوسط',
      parentUid: adminUid,
      date: TODAY_ISO,
      status: 'absent',
      checkInTime: '--:--',
      parentNotified: true,
      notes: 'تم إرسال تنبيه غياب تلقائي لولي الأمر الساعة 07:45',
    },
    {
      id: `att_stu_104_${TODAY_ISO}`,
      studentId: 'stu_104',
      studentName: 'سارة بنت ناصر القحطاني',
      grade: 'صف ثاني متوسط',
      parentUid: adminUid,
      date: TODAY_ISO,
      status: 'late',
      checkInTime: '07:48',
      parentNotified: true,
      notes: 'تأخر صباحي 18 دقيقة — تم إشعار ولي الأمر',
    },
    {
      id: `att_stu_105_${TODAY_ISO}`,
      studentId: 'stu_105',
      studentName: 'عمر بن سعيد الغامدي',
      grade: 'صف أول متوسط',
      parentUid: adminUid,
      date: TODAY_ISO,
      status: 'present',
      checkInTime: '07:25',
      parentNotified: true,
      notes: 'حضور منتظم',
    },
  ];

  for (const { id, ...attendanceData } of attendanceSeed) {
    batch.set(doc(db, 'attendance', id), {
      ...attendanceData,
      createdAt: now,
      updatedAt: now,
    });
  }

  const periodAttendanceSeed = [
    {
      id: `per_1_stu_101_${TODAY_ISO}`,
      studentId: 'stu_101',
      studentName: 'عبدالله بن فهد السبيعي',
      grade: 'صف السادس علمي',
      section: 'أ',
      parentUid: adminUid,
      date: TODAY_ISO,
      periodNumber: 1,
      periodLabel: 'الحصة الأولى',
      subject: 'الرياضيات',
      status: 'present',
      categoryLabel: 'متفاعل ومتميز',
      recordedBy: safeAdminName,
      parentNotified: false,
    },
    {
      id: `per_1_stu_102_${TODAY_ISO}`,
      studentId: 'stu_102',
      studentName: 'نورة بنت خالد الدوسري',
      grade: 'صف خامس علمي',
      section: 'أ',
      parentUid: adminUid,
      date: TODAY_ISO,
      periodNumber: 1,
      periodLabel: 'الحصة الأولى',
      subject: 'الفيزياء',
      status: 'present',
      categoryLabel: 'منضبط',
      recordedBy: safeAdminName,
      parentNotified: false,
    },
    {
      id: `per_1_stu_103_${TODAY_ISO}`,
      studentId: 'stu_103',
      studentName: 'يوسف بن طارق العتيبي',
      grade: 'صف ثالث متوسط',
      section: 'ب',
      parentUid: adminUid,
      date: TODAY_ISO,
      periodNumber: 1,
      periodLabel: 'الحصة الأولى',
      subject: 'الأحياء',
      status: 'absent',
      categoryLabel: 'غائب عن الحصة',
      recordedBy: safeAdminName,
      parentNotified: true,
    },
  ];

  for (const { id, ...periodData } of periodAttendanceSeed) {
    batch.set(doc(db, 'periodAttendance', id), {
      ...periodData,
      createdAt: now,
      updatedAt: now,
    });
  }

  const gradesSeed = [
    {
      id: 'grd_101_math',
      studentId: 'stu_101',
      studentName: 'عبدالله بن فهد السبيعي',
      grade: 'صف السادس علمي',
      parentUid: adminUid,
      subject: 'الرياضيات المتقدمة',
      term: 'الفصل الدراسي الأول',
      midtermScore: 28,
      courseworkScore: 29,
      finalScore: 38,
      totalScore: 95,
      teacherNote: 'أداء متميز في حل المسائل الهندسية والتطبيقية.',
    },
    {
      id: 'grd_101_phys',
      studentId: 'stu_101',
      studentName: 'عبدالله بن فهد السبيعي',
      grade: 'صف السادس علمي',
      parentUid: adminUid,
      subject: 'الفيزياء',
      term: 'الفصل الدراسي الأول',
      midtermScore: 27,
      courseworkScore: 28,
      finalScore: 37,
      totalScore: 92,
      teacherNote: 'مشاركة فعالة في التجارب المخبرية الأسبوعية.',
    },
    {
      id: 'grd_102_math',
      studentId: 'stu_102',
      studentName: 'نورة بنت خالد الدوسري',
      grade: 'صف خامس علمي',
      parentUid: adminUid,
      subject: 'الرياضيات المتقدمة',
      term: 'الفصل الدراسي الأول',
      midtermScore: 30,
      courseworkScore: 29,
      finalScore: 39,
      totalScore: 98,
      teacherNote: 'تفوق مستمر ودقة عالية في الواجبات.',
    },
    {
      id: 'grd_103_bio',
      studentId: 'stu_103',
      studentName: 'يوسف بن طارق العتيبي',
      grade: 'صف ثالث متوسط',
      parentUid: adminUid,
      subject: 'الأحياء والعلوم',
      term: 'الفصل الدراسي الأول',
      midtermScore: 24,
      courseworkScore: 26,
      finalScore: 35,
      totalScore: 85,
      teacherNote: 'يحتاج إلى مراجعة إضافية في وحدة الوراثة الخلوية.',
    },
    {
      id: 'grd_104_arab',
      studentId: 'stu_104',
      studentName: 'سارة بنت ناصر القحطاني',
      grade: 'صف ثاني متوسط',
      parentUid: adminUid,
      subject: 'اللغة العربية',
      term: 'الفصل الدراسي الأول',
      midtermScore: 29,
      courseworkScore: 28,
      finalScore: 37,
      totalScore: 94,
      teacherNote: 'إجادة عالية في التعبير الكتابي والنقد الأدبي.',
    },
  ];

  for (const { id, ...gradeData } of gradesSeed) {
    batch.set(doc(db, 'grades', id), {
      ...gradeData,
      createdAt: now,
      updatedAt: now,
    });
  }

  const teachersSeed = [
    {
      id: 'tch_1',
      teacherName: 'أ. ماجد بن سليمان الحربي',
      subject: 'الرياضيات المتقدمة',
      department: 'قسم العلوم والرياضيات',
      lessonsDelivered: 48,
      homeworkPublished: 19,
      avgResponseMinutes: 14,
      studentMasteryPct: 94,
      evaluationScore: 96,
      periodLabel: 'نوفمبر 2026',
      evaluationSummary: 'التزام تام بالخطة الفصلية وسرعة استجابة عالية لاستفسارات أولياء الأمور.',
      scope: 'school',
    },
    {
      id: 'tch_2',
      teacherName: 'أ. هند بنت عبدالعزيز الشهري',
      subject: 'الأحياء والعلوم',
      department: 'قسم العلوم الطبيعية',
      lessonsDelivered: 44,
      homeworkPublished: 22,
      avgResponseMinutes: 18,
      studentMasteryPct: 91,
      evaluationScore: 93,
      periodLabel: 'نوفمبر 2026',
      evaluationSummary: 'توظيف ممتاز للمختبرات التفاعلية وإثراء المكتبة الرقمية بالملازم.',
      scope: 'school',
    },
    {
      id: 'tch_3',
      teacherName: 'أ. بدر بن محمد الزهراني',
      subject: 'اللغة العربية',
      department: 'قسم العلوم الإنسانية',
      lessonsDelivered: 46,
      homeworkPublished: 16,
      avgResponseMinutes: 25,
      studentMasteryPct: 89,
      evaluationScore: 90,
      periodLabel: 'نوفمبر 2026',
      evaluationSummary: 'مبادرات قرائية متميزة وتقارير دورية دقيقة لمستوى الطلاب.',
      scope: 'school',
    },
    {
      id: 'tch_4',
      teacherName: 'أ. ريم بنت فهد المري',
      subject: 'الحاسب الآلي والبرمجة',
      department: 'قسم التقنية والابتكار',
      lessonsDelivered: 42,
      homeworkPublished: 24,
      avgResponseMinutes: 11,
      studentMasteryPct: 95,
      evaluationScore: 97,
      periodLabel: 'نوفمبر 2026',
      evaluationSummary: 'إشراف رائد على مشاريع الروبوت والذكاء الاصطناعي الطلابية.',
      scope: 'school',
    },
  ];

  for (const { id, ...teacherData } of teachersSeed) {
    batch.set(doc(db, 'teachers', id), {
      ...teacherData,
      createdAt: now,
      updatedAt: now,
    });
  }

  const announcementsSeed = [
    {
      id: 'ann_1',
      title: 'تعميم مواعيد الاختبارات الشهرية للفصل الدراسي الأول',
      body: 'نود إشعار أولياء الأمور الكرام بأن جدول الاختبارات التقويمية للفترة الثانية سيبدأ يوم الأحد القادم، مع إتاحة الملازم والمراجعات الشاملة في المكتبة الرقمية.',
      category: 'circular',
      targetAudience: 'جميع أولياء الأمور',
      authorName: 'إدارة الشؤون الأكاديمية',
      scope: 'school',
    },
    {
      id: 'ann_2',
      title: 'فتح التسجيل في الرحلة العلمية إلى واحة العلوم والفضاء',
      body: 'تعلن إدارة الأنشطة المدرسية عن فتح باب التسجيل لطلاب صف ثالث متوسط وصف السادس علمي في الزيارة الميدانية لمعرض الفضاء والقبة الفلكية.',
      category: 'event',
      targetAudience: 'صف ثالث متوسط والسادس علمي',
      authorName: 'نشاط الطلاب والرحلات',
      scope: 'school',
    },
  ];

  for (const { id, ...announcementData } of announcementsSeed) {
    batch.set(doc(db, 'announcements', id), {
      ...announcementData,
      createdAt: now,
    });
  }

  const activitiesSeed = [
    {
      id: 'act_1',
      title: 'رحلة علمية إلى مركز القبة الفلكية والفضاء',
      description: 'زيارة ميدانية تفاعلية لاستكشاف القبة السماوية ومحاكاة المدارات الكوكبية وورش عمل في علوم الفيزياء التطبيقية.',
      activityType: 'trip',
      eventDate: '2026-11-26',
      location: 'واحة العلوم والتقنية — القاعة الرئيسية',
      capacity: 40,
      registeredCount: 28,
      imageUrl: '/src/assets/images/activity_science_trip_1795034380174.jpg',
      scope: 'school',
    },
    {
      id: 'act_2',
      title: 'أولمبياد الرياضيات والمنطق المدرسي',
      description: 'مسابقة تنافسية لتنمية مهارات التفكير الإبداعي وحل المشكلات الرياضية المتقدمة بمشاركة الفرق الطلابية.',
      activityType: 'competition',
      eventDate: '2026-12-03',
      location: 'مسرح المدرسة الرئيسي',
      capacity: 60,
      registeredCount: 41,
      imageUrl: '/src/assets/images/school_campus_hero_1795034380130.jpg',
      scope: 'school',
    },
  ];

  for (const { id, ...activityData } of activitiesSeed) {
    batch.set(doc(db, 'activities', id), {
      ...activityData,
      createdAt: now,
      updatedAt: now,
    });
  }

  for (const cal of buildDefaultCalendarEvents(adminName)) {
    if (!existingCalIds.has(cal.id)) {
      batch.set(doc(db, 'calendarEvents', cal.id), {
        ...cal.data,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  for (const pl of buildDefaultPolls(adminName)) {
    if (!existingPollIds.has(pl.id)) {
      batch.set(doc(db, 'polls', pl.id), {
        ...pl.data,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  const homeworkSeed = [
    {
      id: 'hw_1',
      title: 'حل تمارين الدوال المثلثية وتطبيقاتها',
      subject: 'الرياضيات المتقدمة',
      grade: 'صف السادس علمي',
      teacherName: 'أ. ماجد الحربي',
      description: 'حل التمارين من رقم 1 إلى 12 في الصفحة 64 مع إرفاق خطوات الحل التفصيلية قبل موعد التسليم.',
      dueDate: getTomorrowDateIso(),
      scope: 'school',
    },
    {
      id: 'hw_2',
      title: 'تقرير التجربة المخبرية: البناء الضوئي',
      subject: 'الأحياء والعلوم',
      grade: 'صف ثالث متوسط',
      teacherName: 'أ. هند الشهري',
      description: 'توثيق نتائج تجربة تأثير شدة الإضاءة على معدل التمثيل الضوئي مع رسم المنحنى البياني.',
      dueDate: '2026-11-23',
      scope: 'school',
    },
  ];

  for (const { id, ...homeworkData } of homeworkSeed) {
    batch.set(doc(db, 'homework', id), {
      ...homeworkData,
      createdAt: now,
    });
  }

  const librarySeed = [
    {
      id: 'lib_1',
      title: 'المرجع الشامل في الهندسة والرياضيات المتقدمة',
      subject: 'الرياضيات المتقدمة',
      grade: 'صف السادس علمي',
      resourceType: 'ebook',
      authorName: 'أ. ماجد الحربي',
      summary: 'كتاب إلكتروني متكامل يشمل شروحات مبسطة، أمثلة محلولة، واختبارات تدريبية للفصل الأول.',
      fileSizeLabel: '4.2 MB',
      coverUrl: '/src/assets/images/book_cover_math_1795034379260.jpg',
      downloadCount: 142,
      scope: 'school',
    },
    {
      id: 'lib_2',
      title: 'ملزمة الأحياء الخلوية والعلوم التطبيقية',
      subject: 'الأحياء والعلوم',
      grade: 'صف ثالث متوسط',
      resourceType: 'handout',
      authorName: 'أ. هند الشهري',
      summary: 'ملزمة دراسية مركزة تتضمن الرسوم التوضيحية للخلية النباتية وأوراق عمل المراجعة النهائية.',
      fileSizeLabel: '2.8 MB',
      coverUrl: '/src/assets/images/book_cover_science_1795034379446.jpg',
      downloadCount: 198,
      scope: 'school',
    },
  ];

  for (const { id, ...libraryData } of librarySeed) {
    batch.set(doc(db, 'libraryResources', id), {
      ...libraryData,
      createdAt: now,
      updatedAt: now,
    });
  }

  const invoicesSeed = [
    {
      id: 'inv_2026_01',
      invoiceNumber: 'INV-2026-001',
      studentId: 'stu_101',
      studentName: 'عبدالله بن فهد السبيعي',
      parentUid: adminUid,
      title: 'القسط الدراسي الثاني — صف السادس علمي',
      amount: 450000,
      dueDate: '2026-11-30',
      status: 'pending',
    },
    {
      id: 'inv_2026_02',
      invoiceNumber: 'INV-2026-002',
      studentId: 'stu_102',
      studentName: 'نورة بنت خالد الدوسري',
      parentUid: adminUid,
      title: 'القسط الدراسي الأول + رسوم المختبرات',
      amount: 480000,
      dueDate: '2026-10-15',
      status: 'paid',
      paymentMethod: 'بطاقة كي كارد الإلكترونية',
      receiptRef: 'RCP-884120',
    },
    {
      id: 'inv_2026_03',
      invoiceNumber: 'INV-2026-003',
      studentId: 'stu_103',
      studentName: 'يوسف بن طارق العتيبي',
      parentUid: adminUid,
      title: 'رسوم النقل المدرسي والأنشطة الفصلية',
      amount: 120000,
      dueDate: '2026-11-10',
      status: 'overdue',
    },
  ];

  for (const { id, ...invoiceData } of invoicesSeed) {
    batch.set(doc(db, 'invoices', id), {
      ...invoiceData,
      createdAt: now,
      updatedAt: now,
    });
  }

  for (const camp of buildDefaultDonationCampaigns(adminName)) {
    if (!existingDonIds.has(camp.id)) {
      batch.set(doc(db, 'donationCampaigns', camp.id), {
        ...camp.data,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  const messagesSeed = [
    {
      id: 'msg_1',
      parentUid: adminUid,
      studentId: 'stu_101',
      studentName: 'عبدالله بن فهد السبيعي',
      teacherName: 'أ. ماجد بن سليمان الحربي',
      senderRole: 'teacher',
      senderName: 'أ. ماجد بن سليمان الحربي',
      body: 'السلام عليكم، أود الإشادة بتفوق الطالب عبدالله في اختبار الرياضيات الأخير ومشاركته الفعالة في الصف.',
    },
    {
      id: 'msg_2',
      parentUid: adminUid,
      studentId: 'stu_101',
      studentName: 'عبدالله بن فهد السبيعي',
      teacherName: 'أ. ماجد بن سليمان الحربي',
      senderRole: 'parent',
      senderName: safeAdminName,
      body: 'وعليكم السلام أستاذ ماجد، شاكرين لكم جهودكم ومتابعتكم المستمرة، هل تنصحون بتمارين إضافية للأسبوع القادم؟',
    },
  ];

  for (const { id, ...messageData } of messagesSeed) {
    batch.set(doc(db, 'messages', id), {
      ...messageData,
      createdAt: now,
    });
  }

  const notificationsSeed = [
    {
      id: 'notif_1',
      parentUid: adminUid,
      title: 'تنبيه غياب تلقائي — يوسف العتيبي',
      message: 'تم رصد غياب الطالب يوسف بن طارق العتيبي عن الحصة الأولى اليوم الساعة 07:45 صباحاً.',
      notifType: 'attendance',
      isRead: false,
    },
    {
      id: 'notif_2',
      parentUid: adminUid,
      title: 'تعميم إداري جديد: جدول الاختبارات الشهرية',
      message: 'يرجى الاطلاع على جدول الاختبارات والملازم الإلكترونية المتاحة للتحميل في المكتبة الرقمية.',
      notifType: 'circular',
      isRead: false,
    },
    {
      id: 'notif_3',
      parentUid: adminUid,
      title: 'واجب منزلي جديد في الرياضيات المتقدمة',
      message: 'تم نشر واجب الدوال المثلثية لصف السادس علمي — آخر موعد للتسليم 2026-11-21.',
      notifType: 'homework',
      isRead: true,
    },
  ];

  for (const { id, ...notificationData } of notificationsSeed) {
    batch.set(doc(db, 'notifications', id), {
      ...notificationData,
      createdAt: now,
    });
  }

  if (!existingRepIds.has('rep_2026_10')) {
    batch.set(doc(db, 'attendanceReports', 'rep_2026_10'), {
      monthKey: '2026-10',
      monthLabel: 'أكتوبر 2026',
      gradeFilter: 'جميع الصفوف الدراسية',
      totalStudents: 5,
      totalRecords: 105,
      presentCount: 98,
      absentCount: 4,
      lateCount: 3,
      excusedCount: 0,
      avgAttendancePct: 96,
      fileName: 'madarik-attendance-2026-10.pdf',
      generatedBy: safeAdminName,
      scope: 'school',
      createdAt: now,
    });
  }

  for (const role of EDITION_ORDER) {
    if (!existingRoleIds.has(role)) {
      batch.set(doc(db, 'rolePermissions', role), {
        role,
        label: EDITION_METADATA[role].title,
        ...DEFAULT_ROLE_PERMISSIONS[role],
        scope: 'school',
        updatedBy: safeAdminName,
        updatedAt: now,
      });
    }
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'seedSchoolWorkspace');
  }
}

export async function migrateLegacyGradesIfNeeded() {
  try {
    const batch = writeBatch(db);
    const now = serverTimestamp();
    let hasChanges = false;

    const [stuSnap, hwSnap, libSnap, annSnap, invSnap] = await Promise.all([
      getDocs(collection(db, 'students')),
      getDocs(query(collection(db, 'homework'), where('scope', '==', 'school'))),
      getDocs(query(collection(db, 'libraryResources'), where('scope', '==', 'school'))),
      getDocs(query(collection(db, 'announcements'), where('scope', '==', 'school'))),
      getDocs(collection(db, 'invoices')),
    ]);

    for (const d of stuSnap.docs) {
      const currentGrade = d.data().grade as string | undefined;
      if (currentGrade && LEGACY_GRADE_MAP[currentGrade]) {
        batch.update(d.ref, {
          grade: LEGACY_GRADE_MAP[currentGrade],
          updatedAt: now,
        });
        hasChanges = true;
      }
    }

    for (const d of hwSnap.docs) {
      const currentGrade = d.data().grade as string | undefined;
      if (currentGrade && LEGACY_GRADE_MAP[currentGrade]) {
        batch.update(d.ref, {
          grade: LEGACY_GRADE_MAP[currentGrade],
        });
        hasChanges = true;
      }
    }

    for (const d of libSnap.docs) {
      const currentGrade = d.data().grade as string | undefined;
      if (currentGrade && LEGACY_GRADE_MAP[currentGrade]) {
        batch.update(d.ref, {
          grade: LEGACY_GRADE_MAP[currentGrade],
          updatedAt: now,
        });
        hasChanges = true;
      }
    }

    for (const d of annSnap.docs) {
      const audience = d.data().targetAudience as string | undefined;
      if (audience === 'الصف التاسع والعاشر') {
        batch.update(d.ref, {
          targetAudience: 'صف ثالث متوسط ورابع علمي',
        });
        hasChanges = true;
      }
    }

    for (const d of invSnap.docs) {
      const title = d.data().title as string | undefined;
      if (title && title.includes('الصف العاشر')) {
        batch.update(d.ref, {
          title: title.replace('الصف العاشر', 'صف رابع علمي'),
          updatedAt: now,
        });
        hasChanges = true;
      }
    }

    if (hasChanges) {
      await batch.commit();
    }
  } catch (error) {
    console.warn('Legacy grade migration skipped:', error);
  }
}

export async function seedDefaultCalendarEvents(adminName: string) {
  const existingSnap = await getDocs(
    query(collection(db, 'calendarEvents'), where('scope', '==', 'school')),
  );
  const existingIds = new Set(existingSnap.docs.map((d) => d.id));
  const items = buildDefaultCalendarEvents(adminName).filter((c) => !existingIds.has(c.id));
  if (items.length === 0) return;

  const batch = writeBatch(db);
  const now = serverTimestamp();

  for (const cal of items) {
    batch.set(doc(db, 'calendarEvents', cal.id), {
      ...cal.data,
      createdAt: now,
      updatedAt: now,
    });
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'calendarEvents');
  }
}

export async function seedDefaultDonationCampaigns(adminName: string) {
  const existingSnap = await getDocs(
    query(collection(db, 'donationCampaigns'), where('scope', '==', 'school')),
  );
  const existingIds = new Set(existingSnap.docs.map((d) => d.id));
  const items = buildDefaultDonationCampaigns(adminName).filter((c) => !existingIds.has(c.id));
  if (items.length === 0) return;

  const batch = writeBatch(db);
  const now = serverTimestamp();

  for (const camp of items) {
    batch.set(doc(db, 'donationCampaigns', camp.id), {
      ...camp.data,
      createdAt: now,
      updatedAt: now,
    });
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'donationCampaigns');
  }
}

export async function seedDefaultPolls(adminName: string) {
  const existingSnap = await getDocs(
    query(collection(db, 'polls'), where('scope', '==', 'school')),
  );
  const existingIds = new Set(existingSnap.docs.map((d) => d.id));
  const items = buildDefaultPolls(adminName).filter((p) => !existingIds.has(p.id));
  if (items.length === 0) return;

  const batch = writeBatch(db);
  const now = serverTimestamp();

  for (const pl of items) {
    batch.set(doc(db, 'polls', pl.id), {
      ...pl.data,
      createdAt: now,
      updatedAt: now,
    });
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'polls');
  }
}
