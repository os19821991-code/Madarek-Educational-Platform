import React from 'react';
import { doc, writeBatch } from 'firebase/firestore';
import { BellRing, CheckCheck, Mail, Smartphone, X } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import type { NotificationType, ParentNotification } from '../types';

interface MobileNotificationsDrawerProps {
  open: boolean;
  onClose: () => void;
  notifications: ParentNotification[];
  onOpenEmailAlerts?: () => void;
  onSendEmailForNotification?: (notif: ParentNotification) => void;
}

const NOTIF_LABELS: Record<NotificationType, string> = {
  attendance: 'حضور وغياب',
  circular: 'تعميم مدرسي',
  homework: 'واجب منزلي',
  payment: 'مالية وفواتير',
  grade: 'درجات أكاديمية',
  behavior: 'السلوك والانضباط',
};

export const MobileNotificationsDrawer: React.FC<MobileNotificationsDrawerProps> = ({
  open,
  onClose,
  notifications,
  onOpenEmailAlerts,
  onSendEmailForNotification,
}) => {
  if (!open) return null;

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const handleMarkRead = async (notifId: string) => {
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'notifications', notifId), { isRead: true });
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `notifications/${notifId}`);
    }
  };

  const handleMarkAllRead = async () => {
    const unread = notifications.filter((n) => !n.isRead);
    if (unread.length === 0) return;
    try {
      const batch = writeBatch(db);
      for (const n of unread) {
        batch.update(doc(db, 'notifications', n.id), { isRead: true });
      }
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'notifications/markAll');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex justify-end">
      <div className="w-full max-w-md bg-white h-full border-r border-slate-200 flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Smartphone className="w-5 h-5 text-teal-700" />
            <div>
              <h3 className="text-base font-bold font-display text-slate-900">
                إشعارات تطبيق ولي الأمر الفورية
              </h3>
              <p className="text-xs text-slate-500">
                {unreadCount} إشعارات غير مقروءة على الهاتف المحمول
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق لوحة الإشعارات"
            className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
          {onOpenEmailAlerts ? (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenEmailAlerts();
              }}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-800 hover:text-teal-900 cursor-pointer"
            >
              <Mail className="w-3.5 h-3.5" />
              <span>إعدادات وإرسال تنبيهات البريد</span>
            </button>
          ) : (
            <span className="text-xs text-slate-600">بث مباشر لتنبيهات الجوال</span>
          )}
          <button
            type="button"
            onClick={handleMarkAllRead}
            disabled={unreadCount === 0}
            className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-800 disabled:opacity-40 cursor-pointer"
          >
            <CheckCheck className="w-4 h-4" />
            <span>تحديد الكل كمقروء</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 p-4 space-y-2">
          {notifications.map((n) => (
            <div
              key={n.id}
              onClick={() => !n.isRead && handleMarkRead(n.id)}
              className={`p-4 rounded-xl border transition-colors ${
                n.isRead
                  ? 'bg-white border-slate-200'
                  : 'bg-teal-50/60 border-teal-200 cursor-pointer hover:bg-teal-50'
              }`}
            >
              <div className="flex items-center justify-between gap-2 text-xs text-slate-500 mb-1.5">
                <span className="font-semibold text-teal-800">{NOTIF_LABELS[n.notifType]}</span>
                <span>{n.isRead ? 'مقروء' : 'إشعار جديد'}</span>
              </div>
              <h4 className="text-sm font-bold text-slate-900 flex items-start gap-2">
                <BellRing className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
                <span>{n.title}</span>
              </h4>
              <p className="text-xs text-slate-600 leading-relaxed mt-1.5">{n.message}</p>
              {onSendEmailForNotification && (
                <div className="mt-2.5 pt-2 border-t border-slate-200/70 flex justify-end">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onClose();
                      onSendEmailForNotification(n);
                    }}
                    className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-900 cursor-pointer"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    <span>إرسال تنبيه بالبريد</span>
                  </button>
                </div>
              )}
            </div>
          ))}
          {notifications.length === 0 && (
            <div className="py-16 text-center text-sm text-slate-500">
              لا توجد إشعارات مرسلة حتى الآن.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
