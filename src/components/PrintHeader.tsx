import React from 'react';

interface PrintMetadataItem {
  label: string;
  value: string | number;
}

interface PrintHeaderProps {
  title: string;
  subtitle?: string;
  documentCode?: string;
  metadata?: PrintMetadataItem[];
}

export const PrintHeader: React.FC<PrintHeaderProps> = ({
  title,
  subtitle,
  documentCode,
  metadata = [],
}) => {
  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <div className="print-only mb-4 pb-3 border-b-2 border-teal-800 print-avoid-break">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold text-teal-800">
            منصة مدارك التعليمية — الإدارة المدرسية والشؤون الأكاديمية
          </p>
          <h1 className="text-xl font-bold font-display text-slate-900 mt-1">{title}</h1>
          {subtitle && <p className="text-xs text-slate-600 mt-0.5">{subtitle}</p>}
        </div>

        <div className="text-left text-xs text-slate-600 space-y-0.5 shrink-0">
          {documentCode && (
            <p className="font-mono-num font-semibold text-slate-800">
              المرجع: {documentCode}
            </p>
          )}
          <p className="font-mono-num">تاريخ الطباعة: {todayIso}</p>
          <p className="text-[11px] text-slate-500">وثيقة مدرسية رسمية</p>
        </div>
      </div>

      {metadata.length > 0 && (
        <div className="mt-3 pt-2.5 border-t border-slate-200 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs">
          {metadata.map((item) => (
            <div key={item.label} className="flex items-center gap-1.5">
              <span className="text-slate-500">{item.label}:</span>
              <span className="font-semibold text-slate-900 font-mono-num">{item.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

interface PrintFooterProps {
  preparedBy?: string;
  approverTitle?: string;
}

export const PrintFooter: React.FC<PrintFooterProps> = ({
  preparedBy = 'الكادر الإداري والتعليمي',
  approverTitle = 'اعتماد إدارة المدرسة',
}) => {
  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <div className="print-only mt-6 pt-4 border-t border-slate-300 print-avoid-break">
      <div className="grid grid-cols-3 gap-6 text-xs text-slate-700 pt-2">
        <div className="space-y-6">
          <p className="font-semibold text-slate-900">إعداد وتوثيق</p>
          <div className="border-t border-dashed border-slate-400 pt-1.5 text-slate-600">
            {preparedBy}
          </div>
        </div>
        <div className="space-y-6">
          <p className="font-semibold text-slate-900">{approverTitle}</p>
          <div className="border-t border-dashed border-slate-400 pt-1.5 text-slate-600">
            التوقيع: ..........................
          </div>
        </div>
        <div className="space-y-6">
          <p className="font-semibold text-slate-900">الختم الرسمي والتاريخ</p>
          <div className="border-t border-dashed border-slate-400 pt-1.5 font-mono-num text-slate-600">
            {todayIso}
          </div>
        </div>
      </div>
    </div>
  );
};
