import type { NavSection, PermissionKey, RolePermissionFlags, UserRole } from '../types';

export const EDITION_ORDER: UserRole[] = ['parent', 'teacher', 'admin', 'supervisor'];

export interface EditionMeta {
  role: UserRole;
  title: string;
  shortTitle: string;
  audience: string;
  summary: string;
}

export const EDITION_METADATA: Record<UserRole, EditionMeta> = {
  parent: {
    role: 'parent',
    title: 'نسخة ولي الأمر والطالب',
    shortTitle: 'ولي الأمر / الطالب',
    audience: 'الطلاب وأولياء الأمور',
    summary: 'معرفة درجات الطالب وتقاريره، ومراسلة المدرسين والمدراء مباشرة.',
  },
  teacher: {
    role: 'teacher',
    title: 'نسخة المدرسين',
    shortTitle: 'المدرسين',
    audience: 'أعضاء الهيئة التدريسية',
    summary: 'نشر درجات الطلاب، رفع الكتب والملازم والواجبات، ومراسلة الطلاب وأولياء الأمور.',
  },
  admin: {
    role: 'admin',
    title: 'نسخة المدراء',
    shortTitle: 'المدراء',
    audience: 'مدير المدرسة والإدارة العليا',
    summary: 'كافة الصلاحيات الأكاديمية والإدارية والمالية، مع التحكم الكامل بتعديل صلاحيات النسخ.',
  },
  supervisor: {
    role: 'supervisor',
    title: 'نسخة المراقبين',
    shortTitle: 'المراقبين',
    audience: 'مراقبو الدوام والانضباط اليومي',
    summary: 'تسجيل الحضور والغياب اليومي للطلاب والخصم من درجة السلوك عند المخالفات.',
  },
};

export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, RolePermissionFlags> = {
  parent: {
    viewOverview: false,
    viewAttendance: false,
    markAttendance: false,
    viewGrades: true,
    publishGrades: false,
    deductBehavior: false,
    viewResources: false,
    publishResources: false,
    messageStaff: true,
    messageParents: false,
    viewAnnouncements: false,
    manageAnnouncements: false,
    viewBilling: false,
    manageBilling: false,
    viewTeachersEval: false,
    managePermissions: false,
  },
  teacher: {
    viewOverview: false,
    viewAttendance: false,
    markAttendance: false,
    viewGrades: true,
    publishGrades: true,
    deductBehavior: true,
    viewResources: true,
    publishResources: true,
    messageStaff: false,
    messageParents: true,
    viewAnnouncements: false,
    manageAnnouncements: false,
    viewBilling: false,
    manageBilling: false,
    viewTeachersEval: false,
    managePermissions: false,
  },
  admin: {
    viewOverview: true,
    viewAttendance: true,
    markAttendance: true,
    viewGrades: true,
    publishGrades: true,
    deductBehavior: true,
    viewResources: true,
    publishResources: true,
    messageStaff: true,
    messageParents: true,
    viewAnnouncements: true,
    manageAnnouncements: true,
    viewBilling: true,
    manageBilling: true,
    viewTeachersEval: true,
    managePermissions: true,
  },
  supervisor: {
    viewOverview: false,
    viewAttendance: true,
    markAttendance: true,
    viewGrades: false,
    publishGrades: false,
    deductBehavior: true,
    viewResources: false,
    publishResources: false,
    messageStaff: false,
    messageParents: false,
    viewAnnouncements: false,
    manageAnnouncements: false,
    viewBilling: false,
    manageBilling: false,
    viewTeachersEval: false,
    managePermissions: false,
  },
};

export interface PermissionMeta {
  key: PermissionKey;
  label: string;
  description: string;
  group: string;
}

export const PERMISSION_CATALOG: PermissionMeta[] = [
  {
    key: 'viewOverview',
    label: 'عرض لوحة الإحصائيات الشاملة',
    description: 'الاطلاع على الرسوم البيانية والمؤشرات العامة للمدرسة',
    group: 'الإحصائيات والإدارة',
  },
  {
    key: 'viewAttendance',
    label: 'عرض سجلات وملخصات الحضور',
    description: 'الاطلاع على كشوف الحضور اليومي والأسبوعي وتقارير PDF الشهرية',
    group: 'الحضور والانضباط',
  },
  {
    key: 'markAttendance',
    label: 'تسجيل ورصد الحضور والغياب',
    description: 'رصد حضور وغياب وتأخر الطلاب وإرسال تنبيهات أولياء الأمور',
    group: 'الحضور والانضباط',
  },
  {
    key: 'viewGrades',
    label: 'معرفة درجات الطالب والتقارير',
    description: 'عرض سجل الدرجات التفصيلي والتقارير الدورية والسنوية PDF',
    group: 'الدرجات والتقارير',
  },
  {
    key: 'publishGrades',
    label: 'نشر ورصد درجات الطلاب',
    description: 'إضافة واعتماد الدرجات الفصلية والنهائية وملاحظات المعلمين',
    group: 'الدرجات والتقارير',
  },
  {
    key: 'deductBehavior',
    label: 'التنقيص من درجة السلوك',
    description: 'خصم نقاط من درجة السلوك (للمدرسين والمدراء والمراقبين فقط، ولا تقبل الزيادة) مع إشعار ولي الأمر',
    group: 'الدرجات والتقارير',
  },
  {
    key: 'viewResources',
    label: 'الاطلاع على الكتب والملازم والواجبات',
    description: 'تصفح وتحميل الكتب والملازم الإلكترونية ومتابعة الواجبات',
    group: 'المكتبة والواجبات',
  },
  {
    key: 'publishResources',
    label: 'نشر الملازم والكتب والواجبات',
    description: 'رفع الكتب والملازم الدراسية ونشر الواجبات المنزلية للطلاب',
    group: 'المكتبة والواجبات',
  },
  {
    key: 'messageStaff',
    label: 'مراسلة المدرسين والمدراء',
    description: 'إرسال واستقبال رسائل مباشرة مع الكادر التعليمي وإدارة المدرسة',
    group: 'التواصل والتعاميم',
  },
  {
    key: 'messageParents',
    label: 'مراسلة الطالب أو ولي الأمر',
    description: 'التواصل المباشر مع الطلاب وأولياء الأمور والرد على استفساراتهم',
    group: 'التواصل والتعاميم',
  },
  {
    key: 'viewAnnouncements',
    label: 'عرض الإعلانات والأنشطة والرحلات',
    description: 'متابعة التعاميم المدرسية والتسجيل في الفعاليات والرحلات',
    group: 'التواصل والتعاميم',
  },
  {
    key: 'manageAnnouncements',
    label: 'نشر التعاميم والأنشطة وإدارتها',
    description: 'إصدار تعاميم فورية لجميع أولياء الأمور وإضافة رحلات وفعاليات',
    group: 'التواصل والتعاميم',
  },
  {
    key: 'viewBilling',
    label: 'عرض الرسوم والفواتير والسداد',
    description: 'متابعة الفواتير المدرسية وسداد الرسوم إلكترونياً',
    group: 'المالية وتقييم الكادر',
  },
  {
    key: 'manageBilling',
    label: 'إصدار الفواتير وإدارة الرسوم',
    description: 'إنشاء فواتير الرسوم الدراسية ومتابعة التحصيل',
    group: 'المالية وتقييم الكادر',
  },
  {
    key: 'viewTeachersEval',
    label: 'عرض وتقييم أداء الكادر التعليمي',
    description: 'إحصاء نشاطات المعلمين وإضافة التقييمات الدورية',
    group: 'المالية وتقييم الكادر',
  },
  {
    key: 'managePermissions',
    label: 'إدارة النسخ وتعديل الصلاحيات',
    description: 'تعديل مصفوفة الصلاحيات للنسخ الأربع وتعيين أدوار المستخدمين',
    group: 'الإحصائيات والإدارة',
  },
];

export function canAccessNavSection(
  section: NavSection,
  perms: RolePermissionFlags,
): boolean {
  switch (section) {
    case 'overview':
      return perms.viewOverview;
    case 'attendance':
      return perms.viewAttendance || perms.markAttendance;
    case 'grades':
      return perms.viewGrades || perms.publishGrades || perms.deductBehavior;
    case 'resources':
      return perms.viewResources || perms.publishResources;
    case 'communication':
      return (
        perms.messageStaff ||
        perms.messageParents ||
        perms.viewAnnouncements ||
        perms.manageAnnouncements
      );
    case 'billing':
      return perms.viewBilling || perms.manageBilling;
    case 'donations':
      return (
        perms.viewBilling ||
        perms.manageBilling ||
        perms.viewGrades ||
        perms.publishGrades ||
        perms.messageStaff ||
        perms.messageParents
      );
    case 'teachers':
      return perms.viewTeachersEval;
    case 'permissions':
      return perms.managePermissions;
    default:
      return false;
  }
}

export function getDefaultNavSection(perms: RolePermissionFlags): NavSection {
  const priorityOrder: NavSection[] = [
    'overview',
    'attendance',
    'grades',
    'resources',
    'communication',
    'billing',
    'teachers',
    'permissions',
  ];
  return priorityOrder.find((s) => canAccessNavSection(s, perms)) || 'grades';
}
