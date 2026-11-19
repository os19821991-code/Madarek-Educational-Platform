import React, { useEffect, useState } from 'react';
import { Eye, Mail, Send, X } from 'lucide-react';
import { EMAIL_CATEGORY_LABELS } from '../lib/gmailService';
import type { AutomatedEmailItem } from '../lib/emailAutomationService';

interface GmailDispatchConfirmModalProps {
  open: boolean;
  title: string;
  subtitle: string;
  items: AutomatedEmailItem[];
  gmailConnected: boolean;
  sending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const GmailDispatchConfirmModal: React.FC<GmailDispatchConfirmModalProps> = ({
  open,
  title,
  subtitle,
  items,
  gmailConnected,
  sending,
  onConfirm,
  onCancel,
}) => {
  const [previewIdx, setPreviewIdx] = useState(0);

  useEffect(() => {
    setPreviewIdx(0);
  }, [open, items.length]);

  if (!open || items.length === 0) return null;

  const activeItem = items[previewIdx] || items[0];

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/55 flex items-center justify-center p-4 no-print">
      <div className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full p-6 space-y-4 shadow-xl max-h-[92vh] flex flex-col">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3 shrink-0">
          <div className="flex items-start gap-2.5">
            <div className="p-2 rounded-lg bg-teal-50 text-teal-700 shrink-0">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-base font-bold font-display text-slate-900">{title}</h4>
              <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            disabled={sending}
            onClick={onCancel}
            aria-label="إغلاق نافذة التأكيد"
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto flex-1 pr-1 text-xs">
          {/* Recipients List */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="font-semibold text-slate-700">
                قائمة المسجلين المستلمين ({items.length}):
              </p>
              <span className="text-slate-500">اضغط على أي مستلم لمعاينة رسالته</span>
            </div>
            <div className="max-h-36 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100 bg-slate-50">
              {items.map((item, idx) => {
                const isSelected = idx === previewIdx;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setPreviewIdx(idx)}
                    className={`w-full text-right px-3 py-2 flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                      isSelected ? 'bg-teal-50 text-teal-950' : 'hover:bg-white text-slate-800'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="font-semibold truncate">
                        {item.recipientName}{' '}
                        <span className="font-normal text-slate-500">
                          ({EMAIL_CATEGORY_LABELS[item.category]})
                        </span>
                      </p>
                      <p className="text-[11px] text-slate-600 truncate">{item.subject}</p>
                    </div>
                    <span className="font-mono-num text-slate-600 shrink-0" dir="ltr">
                      {item.recipientEmail}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Preview of Selected Recipient Email */}
          {activeItem && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-slate-700 flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5 text-teal-700" />
                  <span>معاينة الرسالة للمستلم: {activeItem.recipientName}</span>
                </p>
                {activeItem.highlights.length > 0 && (
                  <span className="text-[11px] text-slate-500 font-mono-num">
                    {activeItem.highlights.join(' · ')}
                  </span>
                )}
              </div>

              <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
                <div className="px-3.5 py-2 bg-slate-100 border-b border-slate-200 font-semibold text-slate-900">
                  {activeItem.subject}
                </div>
                <div className="p-3.5 max-h-56 overflow-y-auto text-slate-700 whitespace-pre-line leading-relaxed">
                  {activeItem.bodyText}
                </div>
              </div>
            </div>
          )}

          {!gmailConnected && (
            <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3.5 py-2.5">
              ملاحظة: جلسة Gmail غير مرتبطة حالياً في الذاكرة؛ عند الضغط على تأكيد الإرسال ستظهر
              نافذة Google لمنح تصريح إرسال البريد ثم يتم الإرسال فوراً.
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 pt-3 border-t border-slate-100 shrink-0">
          <p className="text-[11px] text-slate-500">
            يتم توثيق كل رسالة مرسلة في سجل البريد لمنع التكرار التلقائي.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={sending}
              onClick={onCancel}
              className="px-4 py-2 bg-slate-100 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-200 cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              إلغاء
            </button>
            <button
              type="button"
              disabled={sending}
              onClick={onConfirm}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-teal-700 text-white text-xs font-semibold rounded-lg hover:bg-teal-800 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
              <span>
                {sending ? 'جاري الإرسال عبر Gmail...' : `تأكيد وإرسال (${items.length})`}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
