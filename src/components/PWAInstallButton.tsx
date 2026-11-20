import { useState } from 'react';
import { Download, Share, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  compact?: boolean;
  onNotify?: (msg: string) => void;
}

export function PWAInstallButton({ compact = false, onNotify }: PWAInstallButtonProps) {
  const { canNativeInstall, isInstalled, isIOS, promptInstall } = usePWAInstall();
  const [guideOpen, setGuideOpen] = useState(false);

  if (isInstalled) return null;

  const handleClick = async () => {
    if (canNativeInstall) {
      const outcome = await promptInstall();
      if (outcome === 'accepted') {
        onNotify?.('تم بدء تثبيت منصة مدارك كتطبيق على جهازك للعمل دون اتصال.');
      }
      return;
    }
    setGuideOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={`inline-flex items-center gap-2 border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 rounded-lg font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
          compact ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-xs'
        }`}
        title="تثبيت منصة مدارك كتطبيق هاتف بدون إنترنت"
      >
        <Download className="w-3.5 h-3.5 text-teal-700 shrink-0" />
        <span>تثبيت التطبيق</span>
      </button>

      {guideOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 no-print"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-install-guide-title"
        >
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-700 shrink-0">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <h3
                    id="pwa-install-guide-title"
                    className="text-sm font-bold font-display text-slate-900"
                  >
                    تثبيت منصة مدارك على الهاتف أو الحاسوب
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    يعمل التطبيق بواجهة مستقلة ويدعم الفتح والتصفح بدون إنترنت
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setGuideOpen(false)}
                aria-label="إغلاق"
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isIOS ? (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-2.5 text-xs text-slate-700 leading-relaxed">
                <p className="font-semibold text-slate-900">خطوات التثبيت على iPhone و iPad (Safari):</p>
                <ol className="list-decimal list-inside space-y-1.5">
                  <li className="flex items-center gap-1.5">
                    <span>1. اضغط على أيقونة المشاركة</span>
                    <Share className="w-3.5 h-3.5 text-teal-700 inline shrink-0" />
                    <span>في شريط المتصفح السفلي.</span>
                  </li>
                  <li>2. اختر «إضافة إلى الشاشة الرئيسية» (Add to Home Screen).</li>
                  <li>3. اضغط على «إضافة» ليظهر التطبيق كأيقونة مستقلة على هاتفك.</li>
                </ol>
              </div>
            ) : (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-2.5 text-xs text-slate-700 leading-relaxed">
                <p className="font-semibold text-slate-900">خطوات التثبيت المباشر (Android / Desktop):</p>
                <ol className="space-y-1.5">
                  <li>
                    1. افتح رابط التطبيق في علامة تبويب مستقلة عبر متصفح Chrome أو Edge.
                  </li>
                  <li>
                    2. اضغط على قائمة المتصفح (⋮) واختر «تثبيت التطبيق» (Install App) أو «إضافة إلى
                    الشاشة الرئيسية».
                  </li>
                  <li>
                    3. بعد التثبيت سيتم تخزين واجهة المنصة والملفات الأساسية محلياً للعمل حتى عند
                    انقطاع الإنترنت.
                  </li>
                </ol>
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setGuideOpen(false)}
                className="px-4 py-2 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 cursor-pointer"
              >
                فهمت
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
