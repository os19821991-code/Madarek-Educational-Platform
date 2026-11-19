import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import type { HomeworkItem, ParentNotification, Student } from '../types';

export function getLocalDateIso(baseDate: Date = new Date()): string {
  const year = baseDate.getFullYear();
  const month = String(baseDate.getMonth() + 1).padStart(2, '0');
  const day = String(baseDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getTomorrowDateIso(baseDate: Date = new Date()): string {
  const tomorrow = new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate() + 1,
  );
  return getLocalDateIso(tomorrow);
}

function sanitizeIdPart(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_');
  return cleaned || 'id';
}

export function buildReminderNotificationId(homeworkId: string, recipientUid: string): string {
  const safeHw = sanitizeIdPart(homeworkId).slice(0, 48);
  const safeUid = sanitizeIdPart(recipientUid).slice(0, 64);
  return `hwrem_${safeHw}_${safeUid}`.slice(0, 128);
}

export function findDueTomorrowHomework(
  homeworkList: HomeworkItem[],
  baseDate: Date = new Date(),
): HomeworkItem[] {
  const tomorrowIso = getTomorrowDateIso(baseDate);
  return homeworkList.filter((item) => item.dueDate === tomorrowIso);
}

export function getReminderRecipientsForHomework(
  hw: HomeworkItem,
  students: Student[],
  currentUid: string,
  isPrincipal: boolean,
): string[] {
  if (!isPrincipal) {
    return currentUid ? [currentUid] : [];
  }

  const gradeMatches = students.filter((s) => s.grade === hw.grade && s.parentUid);
  const pool = gradeMatches.length > 0 ? gradeMatches : students.filter((s) => Boolean(s.parentUid));
  const uids = new Set<string>(pool.map((s) => s.parentUid));
  if (currentUid) {
    uids.add(currentUid);
  }
  return Array.from(uids);
}

export interface ReminderDispatchResult {
  sentCount: number;
  dueTomorrowCount: number;
  tomorrowIso: string;
}

export async function dispatchDueTomorrowHomeworkReminders(params: {
  homework: HomeworkItem[];
  students: Student[];
  existingNotifications: ParentNotification[];
  currentUid: string;
  isPrincipal: boolean;
  inFlightIds?: Set<string>;
  baseDate?: Date;
}): Promise<ReminderDispatchResult> {
  const {
    homework,
    students,
    existingNotifications,
    currentUid,
    isPrincipal,
    inFlightIds,
    baseDate = new Date(),
  } = params;

  const tomorrowIso = getTomorrowDateIso(baseDate);
  const dueTomorrow = homework.filter((item) => item.dueDate === tomorrowIso);

  if (dueTomorrow.length === 0 || !currentUid) {
    return { sentCount: 0, dueTomorrowCount: dueTomorrow.length, tomorrowIso };
  }

  const existingIds = new Set(existingNotifications.map((n) => n.id));
  const pendingWrites: {
    id: string;
    parentUid: string;
    title: string;
    message: string;
  }[] = [];

  for (const hw of dueTomorrow) {
    const recipients = getReminderRecipientsForHomework(hw, students, currentUid, isPrincipal);
    for (const recipientUid of recipients) {
      const notifId = buildReminderNotificationId(hw.id, recipientUid);
      if (existingIds.has(notifId) || inFlightIds?.has(notifId)) {
        continue;
      }

      const rawTitle = `تذكير: غداً موعد تسليم واجب "${hw.title}"`;
      const rawMessage = `يتبقى يوم واحد على تسليم واجب ${hw.subject} (${hw.grade}) — الموعد النهائي ${hw.dueDate}.`;

      pendingWrites.push({
        id: notifId,
        parentUid: recipientUid,
        title: rawTitle.slice(0, 140),
        message: rawMessage.slice(0, 500),
      });
    }
  }

  if (pendingWrites.length === 0) {
    return { sentCount: 0, dueTomorrowCount: dueTomorrow.length, tomorrowIso };
  }

  pendingWrites.forEach((p) => inFlightIds?.add(p.id));

  try {
    const CHUNK_SIZE = 400;
    for (let i = 0; i < pendingWrites.length; i += CHUNK_SIZE) {
      const chunk = pendingWrites.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);
      const now = serverTimestamp();

      for (const item of chunk) {
        batch.set(doc(db, 'notifications', item.id), {
          parentUid: item.parentUid,
          title: item.title,
          message: item.message,
          notifType: 'homework',
          isRead: false,
          createdAt: now,
        });
      }

      await batch.commit();
    }

    return {
      sentCount: pendingWrites.length,
      dueTomorrowCount: dueTomorrow.length,
      tomorrowIso,
    };
  } catch (error) {
    pendingWrites.forEach((p) => inFlightIds?.delete(p.id));
    handleFirestoreError(error, OperationType.CREATE, 'notifications/homeworkReminders');
  }
}
