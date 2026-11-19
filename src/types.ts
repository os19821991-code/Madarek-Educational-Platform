import type { Timestamp } from 'firebase/firestore';

export type UserRole = 'parent' | 'teacher' | 'admin' | 'supervisor';

export type NavSection =
  | 'overview'
  | 'attendance'
  | 'grades'
  | 'resources'
  | 'communication'
  | 'billing'
  | 'donations'
  | 'teachers'
  | 'permissions';

export type PermissionKey =
  | 'viewOverview'
  | 'viewAttendance'
  | 'markAttendance'
  | 'viewGrades'
  | 'publishGrades'
  | 'deductBehavior'
  | 'viewResources'
  | 'publishResources'
  | 'messageStaff'
  | 'messageParents'
  | 'viewAnnouncements'
  | 'manageAnnouncements'
  | 'viewBilling'
  | 'manageBilling'
  | 'viewTeachersEval'
  | 'managePermissions';

export type RolePermissionFlags = Record<PermissionKey, boolean>;

export interface RolePermissionDoc extends RolePermissionFlags {
  id: string;
  role: UserRole;
  label: string;
  scope: 'school';
  updatedBy: string;
  updatedAt?: Timestamp;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  role: UserRole;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface Student {
  id: string;
  fullName: string;
  studentCode: string;
  grade: string;
  section: string;
  parentUid: string;
  parentName: string;
  parentPhone: string;
  gpa: number;
  attendanceRate: number;
  behaviorScore?: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface BehaviorDeduction {
  id: string;
  studentId: string;
  studentName: string;
  grade: string;
  parentUid: string;
  pointsDeducted: number;
  previousScore: number;
  newScore: number;
  reason: string;
  deductedByName: string;
  deductedByRole: 'teacher' | 'admin' | 'supervisor';
  createdAt?: Timestamp;
}

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';

export interface AttendanceRecord {
  id: string;
  studentId: string;
  studentName: string;
  grade: string;
  parentUid: string;
  date: string;
  status: AttendanceStatus;
  checkInTime?: string;
  parentNotified: boolean;
  notes?: string;
  qrSessionId?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface QrAttendanceSession {
  id: string;
  grade: string;
  section: string;
  date: string;
  token: string;
  rotationSeconds: number;
  expiresAtMs: number;
  isActive: boolean;
  scanCount: number;
  createdByUid: string;
  createdByName: string;
  scope: 'school';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface PeriodAttendanceRecord {
  id: string;
  studentId: string;
  studentName: string;
  grade: string;
  section: string;
  parentUid: string;
  date: string;
  periodNumber: number;
  periodLabel: string;
  subject: string;
  status: AttendanceStatus;
  categoryLabel: string;
  recordedBy: string;
  parentNotified: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface GradeRecord {
  id: string;
  studentId: string;
  studentName: string;
  grade: string;
  parentUid: string;
  subject: string;
  term: string;
  midtermScore: number;
  courseworkScore: number;
  finalScore: number;
  totalScore: number;
  teacherNote?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface TeacherEvaluation {
  id: string;
  teacherName: string;
  subject: string;
  department: string;
  lessonsDelivered: number;
  homeworkPublished: number;
  avgResponseMinutes: number;
  studentMasteryPct: number;
  evaluationScore: number;
  periodLabel: string;
  evaluationSummary?: string;
  scope: 'school';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface MessageItem {
  id: string;
  parentUid: string;
  studentId: string;
  studentName: string;
  teacherName: string;
  senderRole: 'parent' | 'teacher' | 'admin';
  senderName: string;
  body: string;
  createdAt?: Timestamp;
}

export type AnnouncementCategory = 'circular' | 'urgent' | 'academic' | 'event';

export interface Announcement {
  id: string;
  title: string;
  body: string;
  category: AnnouncementCategory;
  targetAudience: string;
  authorName: string;
  scope: 'school';
  createdAt?: Timestamp;
}

export type ActivityType = 'trip' | 'workshop' | 'competition' | 'ceremony';

export interface Activity {
  id: string;
  title: string;
  description: string;
  activityType: ActivityType;
  eventDate: string;
  location: string;
  capacity: number;
  registeredCount: number;
  imageUrl?: string;
  scope: 'school';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type CalendarEventType = 'exam' | 'trip' | 'meeting';

export interface SchoolCalendarEvent {
  id: string;
  title: string;
  eventType: CalendarEventType;
  eventDate: string;
  startTime?: string;
  targetGrade: string;
  location?: string;
  notes?: string;
  createdByName: string;
  createdByRole: 'admin' | 'teacher';
  scope: 'school';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type PollCategory = 'trip' | 'decision' | 'schedule' | 'activity' | 'general';

export type PollTargetAudience = 'all' | 'parents' | 'students';

export interface SchoolPoll {
  id: string;
  title: string;
  description: string;
  category: PollCategory;
  targetAudience: PollTargetAudience;
  targetGrade: string;
  closesAt: string;
  status: 'open' | 'closed';
  options: string[];
  optionCounts: number[];
  totalVotes: number;
  createdByName: string;
  createdByRole: 'admin' | 'teacher';
  scope: 'school';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface PollVote {
  id: string;
  pollId: string;
  voterUid: string;
  voterName: string;
  voterRole: UserRole;
  selectedOptionIndex: number;
  selectedOptionLabel: string;
  comment?: string;
  createdAt?: Timestamp;
}

export interface ActivityRegistration {
  id: string;
  activityId: string;
  studentId: string;
  studentName: string;
  parentUid: string;
  createdAt?: Timestamp;
}

export type InvoiceStatus = 'pending' | 'paid' | 'overdue';

export interface Invoice {
  id: string;
  invoiceNumber: string;
  studentId: string;
  studentName: string;
  parentUid: string;
  title: string;
  amount: number;
  dueDate: string;
  status: InvoiceStatus;
  paymentMethod?: string;
  receiptRef?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type DonationCategory =
  | 'orphans_support'
  | 'supplies'
  | 'facilities'
  | 'activities'
  | 'general';

export interface DonationCampaign {
  id: string;
  title: string;
  description: string;
  category: DonationCategory;
  targetAmount: number;
  collectedAmount: number;
  donorsCount: number;
  status: 'active' | 'completed';
  createdByName: string;
  scope: 'school';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface DonationRecord {
  id: string;
  campaignId: string;
  campaignTitle: string;
  donorUid: string;
  donorName: string;
  isAnonymous: boolean;
  amount: number;
  paymentMethod: string;
  receiptRef: string;
  note?: string;
  createdAt?: Timestamp;
}

export interface HomeworkItem {
  id: string;
  title: string;
  subject: string;
  grade: string;
  teacherName: string;
  description: string;
  dueDate: string;
  scope: 'school';
  createdAt?: Timestamp;
}

export type ResourceType = 'ebook' | 'handout' | 'guide' | 'worksheet';

export interface LibraryResource {
  id: string;
  title: string;
  subject: string;
  grade: string;
  resourceType: ResourceType;
  authorName: string;
  summary: string;
  fileSizeLabel: string;
  coverUrl?: string;
  downloadCount: number;
  scope: 'school';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type NotificationType = 'attendance' | 'circular' | 'homework' | 'payment' | 'grade' | 'behavior';

export interface ParentNotification {
  id: string;
  parentUid: string;
  title: string;
  message: string;
  notifType: NotificationType;
  isRead: boolean;
  createdAt?: Timestamp;
}

export interface AttendanceReport {
  id: string;
  monthKey: string;
  monthLabel: string;
  gradeFilter: string;
  totalStudents: number;
  totalRecords: number;
  presentCount: number;
  absentCount: number;
  lateCount: number;
  excusedCount: number;
  avgAttendancePct: number;
  fileName: string;
  generatedBy: string;
  scope: 'school';
  createdAt?: Timestamp;
}

export type EmailAlertCategory =
  | 'attendance'
  | 'behavior'
  | 'homework'
  | 'grade'
  | 'payment'
  | 'circular'
  | 'monthly_report'
  | 'custom';

export interface EmailAlertSubscription {
  id: string;
  uid: string;
  displayName: string;
  email: string;
  role: UserRole;
  enabled: boolean;
  alertAttendance: boolean;
  alertBehavior: boolean;
  alertHomework: boolean;
  alertGrades: boolean;
  alertPayments: boolean;
  alertCirculars: boolean;
  gradeLabel?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface EmailAlertLog {
  id: string;
  senderUid: string;
  senderName: string;
  senderEmail: string;
  recipientUid: string;
  recipientName: string;
  recipientEmail: string;
  category: EmailAlertCategory;
  subject: string;
  bodyPreview: string;
  status: 'sent' | 'failed';
  gmailMessageId?: string;
  errorMessage?: string;
  autoDispatchKey?: string;
  createdAt?: Timestamp;
}
