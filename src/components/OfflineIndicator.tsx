import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 max-w-md bg-amber-950 text-amber-50 border border-amber-700 rounded-xl px-4 py-3 shadow-lg flex items-start gap-3 no-print"
    >
      <WifiOff className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
      <div className="text-xs leading-relaxed">
        <p className="font-semibold text-white">وضع عدم الاتصال بالإنترنت</p>
        <p className="text-amber-100 mt-0.5">
          تعمل واجهة التطبيق وسجلاتك المخزنة محلياً بدون إنترنت، وستتم مزامنة أي تغييرات تلقائياً
          عند عودة الاتصال.
        </p>
      </div>
    </div>
  );
}
