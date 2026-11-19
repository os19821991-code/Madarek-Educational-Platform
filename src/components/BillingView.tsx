import React, { useState } from 'react';
import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { CheckCircle2, CreditCard, Download, HeartHandshake, Plus, Printer, Receipt, ShieldCheck } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { CURRENCY_SYMBOL, formatIQD } from '../lib/currency';
import { downloadCsv } from '../lib/csvExport';
import { PrintFooter, PrintHeader } from './PrintHeader';
import type { Invoice, Student } from '../types';

interface BillingViewProps {
  students: Student[];
  invoices: Invoice[];
  canManageBilling: boolean;
  onOpenDonations?: () => void;
  onNotify: (msg: string) => void;
}

export const BillingView: React.FC<BillingViewProps> = ({
  students,
  invoices,
  canManageBilling,
  onOpenDonations,
  onNotify,
}) => {
  const [showAddInvoice, setShowAddInvoice] = useState(false);
  const [payingInvoice, setPayingInvoice] = useState<Invoice | null>(null);
  const [paymentMethod, setPaymentMethod] = useState('بطاقة كي كارد / ماستركارد');
  const [cardLast4, setCardLast4] = useState('4821');
  const [processing, setProcessing] = useState(false);

  const [invStudentId, setInvStudentId] = useState(students[0]?.id || '');
  const [invTitle, setInvTitle] = useState('القسط الدراسي الثاني');
  const [invAmount, setInvAmount] = useState(250000);
  const [invDueDate, setInvDueDate] = useState('2026-12-15');

  const totalAmount = invoices.reduce((sum, i) => sum + i.amount, 0);
  const paidAmount = invoices
    .filter((i) => i.status === 'paid')
    .reduce((sum, i) => sum + i.amount, 0);
  const unpaidAmount = totalAmount - paidAmount;

  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    const stu = students.find((s) => s.id === invStudentId) || students[0];
    if (!stu || !invTitle.trim() || Number(invAmount) <= 0) return;

    const invId = `inv_${Date.now()}`;
    const invoiceNumber = `INV-2026-${Math.floor(100 + Math.random() * 899)}`;

    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'invoices', invId), {
        invoiceNumber,
        studentId: stu.id,
        studentName: stu.fullName,
        parentUid: stu.parentUid,
        title: invTitle.trim(),
        amount: Number(invAmount),
        dueDate: invDueDate,
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      batch.set(doc(db, 'notifications', `notif_inv_${Date.now()}`), {
        parentUid: stu.parentUid,
        title: `فاتورة رسوم دراسية جديدة — ${invoiceNumber}`,
        message: `تم إصدار فاتورة "${invTitle.trim()}" للطالب ${stu.fullName} بمبلغ ${formatIQD(Number(invAmount))} تستحق في ${invDueDate}.`,
        notifType: 'payment',
        isRead: false,
        createdAt: serverTimestamp(),
      });

      await batch.commit();
      setShowAddInvoice(false);
      onNotify(`تم إصدار الفاتورة ${invoiceNumber} وإشعار ولي الأمر إلكترونياً.`);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `invoices/${invId}`);
    }
  };

  const handlePayInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payingInvoice) return;
    setProcessing(true);
    const receiptRef = `RCP-${Math.floor(100000 + Math.random() * 899999)}`;

    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'invoices', payingInvoice.id), {
        status: 'paid',
        paymentMethod: `${paymentMethod} (**** ${cardLast4 || '0000'})`,
        receiptRef,
        updatedAt: serverTimestamp(),
      });

      batch.set(doc(db, 'notifications', `notif_pay_${Date.now()}`), {
        parentUid: payingInvoice.parentUid,
        title: `إيصال سداد إلكتروني — ${receiptRef}`,
        message: `تم سداد فاتورة ${payingInvoice.invoiceNumber} بمبلغ ${formatIQD(payingInvoice.amount)} للطالب ${payingInvoice.studentName} بنجاح.`,
        notifType: 'payment',
        isRead: false,
        createdAt: serverTimestamp(),
      });

      await batch.commit();
      onNotify(`تم الدفع الإلكتروني بنجاح! رقم الإيصال المرجعي: ${receiptRef}`);
      setPayingInvoice(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `invoices/${payingInvoice.id}`);
    } finally {
      setProcessing(false);
    }
  };

  const handleExportInvoicesCsv = () => {
    const statusMap: Record<string, string> = {
      paid: 'مدفوعة',
      pending: 'مستحقة للدفع',
      overdue: 'متأخرة السداد',
    };
    const rows = invoices.map((inv) => [
      inv.invoiceNumber,
      inv.studentName,
      inv.title,
      inv.amount,
      inv.dueDate,
      statusMap[inv.status] || inv.status,
      inv.paymentMethod || '',
      inv.receiptRef || '',
    ]);
    downloadCsv(
      `tuition-invoices-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        'رقم الفاتورة',
        'اسم الطالب',
        'البيان',
        `المبلغ (${CURRENCY_SYMBOL})`,
        'تاريخ الاستحقاق',
        'الحالة',
        'وسيلة الدفع',
        'رقم الإيصال',
      ],
      rows,
    );
    onNotify('تم تصدير سجل الفواتير والرسوم إلى ملف CSV بنجاح.');
  };

  return (
    <div className="space-y-6">
      <PrintHeader
        title="كشف الرسوم المدرسية والفواتير المالية"
        subtitle={`بيان الفواتير والمبالغ المحصلة والمستحقة بعملة الدينار العراقي (${CURRENCY_SYMBOL})`}
        documentCode={`FIN-INV-${new Date().toISOString().slice(0, 10)}`}
        metadata={[
          { label: 'عدد الفواتير', value: invoices.length },
          { label: 'إجمالي الفواتير', value: formatIQD(totalAmount) },
          { label: 'المحصل', value: formatIQD(paidAmount) },
        ]}
      />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-slate-200 rounded-xl p-5 no-print">
        <div>
          <h2 className="text-lg font-bold font-display text-slate-900">
            الرسوم المدرسية والدفع الإلكتروني بالدينار العراقي
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            متابعة الفواتير المستحقة بالدينار العراقي ({CURRENCY_SYMBOL})، الدفع الإلكتروني الآمن، وإصدار الإيصالات المرجعية الفورية
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {onOpenDonations && (
            <button
              type="button"
              onClick={onOpenDonations}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-medium rounded-lg hover:bg-emerald-100 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <HeartHandshake className="w-4 h-4" />
              <span>صندوق التبرعات</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleExportInvoicesCsv}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 text-slate-800 text-xs font-medium rounded-lg hover:bg-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>تصدير CSV</span>
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>طباعة الكشف</span>
          </button>
          {canManageBilling && (
            <button
              type="button"
              onClick={() => setShowAddInvoice((v) => !v)}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>إصدار فاتورة رسوم</span>
            </button>
          )}
        </div>
      </div>

      {/* Financial Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 print-compact-grid-3 print-avoid-break">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs text-slate-500">إجمالي الفواتير الصادرة</p>
          <p className="text-2xl font-bold font-mono-num text-slate-900 mt-1">
            {formatIQD(totalAmount)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs text-slate-500">المبالغ المحصلة إلكترونياً</p>
          <p className="text-2xl font-bold font-mono-num text-emerald-700 mt-1">
            {formatIQD(paidAmount)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs text-slate-500">الرصيد المستحق للدفع</p>
          <p className="text-2xl font-bold font-mono-num text-amber-700 mt-1">
            {formatIQD(unpaidAmount)}
          </p>
        </div>
      </div>

      {showAddInvoice && canManageBilling && (
        <form
          onSubmit={handleCreateInvoice}
          className="bg-white border border-slate-200 rounded-xl p-6 grid grid-cols-1 md:grid-cols-4 gap-4 no-print"
        >
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">الطالب</label>
            <select
              value={invStudentId || students[0]?.id}
              onChange={(e) => setInvStudentId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
            >
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">بيان الفاتورة</label>
            <input
              type="text"
              required
              value={invTitle}
              onChange={(e) => setInvTitle(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              المبلغ ({CURRENCY_SYMBOL})
            </label>
            <input
              type="number"
              min={1000}
              step={1000}
              max={100000000}
              required
              value={invAmount}
              onChange={(e) => setInvAmount(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">تاريخ الاستحقاق</label>
            <input
              type="date"
              required
              value={invDueDate}
              onChange={(e) => setInvDueDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num"
            />
          </div>
          <div className="md:col-span-4 flex gap-2">
            <button
              type="submit"
              className="px-4 py-2 bg-teal-700 text-white text-sm font-medium rounded-lg hover:bg-teal-800 cursor-pointer"
            >
              إصدار وإرسال لولي الأمر
            </button>
            <button
              type="button"
              onClick={() => setShowAddInvoice(false)}
              className="px-4 py-2 bg-slate-100 text-slate-700 text-sm font-medium rounded-lg cursor-pointer"
            >
              إلغاء
            </button>
          </div>
        </form>
      )}

      {/* Invoices Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
              <tr>
                <th className="py-3 px-4 font-semibold">رقم الفاتورة</th>
                <th className="py-3 px-4 font-semibold">الطالب والبيان</th>
                <th className="py-3 px-4 font-semibold">المبلغ</th>
                <th className="py-3 px-4 font-semibold">تاريخ الاستحقاق</th>
                <th className="py-3 px-4 font-semibold">الحالة والإيصال</th>
                <th className="py-3 px-4 font-semibold no-print">الدفع الإلكتروني</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-slate-50/70">
                  <td className="py-3.5 px-4 font-mono-num font-semibold text-slate-800">
                    {inv.invoiceNumber}
                  </td>
                  <td className="py-3.5 px-4">
                    <p className="font-semibold text-slate-900">{inv.studentName}</p>
                    <p className="text-xs text-slate-500">{inv.title}</p>
                  </td>
                  <td className="py-3.5 px-4 font-mono-num font-bold text-slate-900">
                    {formatIQD(inv.amount)}
                  </td>
                  <td className="py-3.5 px-4 font-mono-num text-slate-600">{inv.dueDate}</td>
                  <td className="py-3.5 px-4">
                    {inv.status === 'paid' ? (
                      <div className="space-y-0.5">
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>مدفوعة</span>
                        </span>
                        <p className="text-xs text-slate-500 font-mono-num">
                          {inv.receiptRef} · {inv.paymentMethod}
                        </p>
                      </div>
                    ) : (
                      <span
                        className={`text-xs font-semibold ${
                          inv.status === 'overdue' ? 'text-red-700' : 'text-amber-700'
                        }`}
                      >
                        {inv.status === 'overdue' ? 'متأخرة السداد' : 'مستحقة للدفع'}
                      </span>
                    )}
                  </td>
                  <td className="py-3.5 px-4 no-print">
                    {inv.status !== 'paid' ? (
                      <button
                        type="button"
                        onClick={() => setPayingInvoice(inv)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <CreditCard className="w-3.5 h-3.5" />
                        <span>سداد إلكتروني الآن</span>
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                        <Receipt className="w-3.5 h-3.5" />
                        <span>إيصال معتمد</span>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {invoices.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-sm text-slate-500">
                    لا توجد فواتير مسجلة.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PrintFooter
        preparedBy="الإدارة المالية والحسابات"
        approverTitle="اعتماد المحاسبة وإدارة المدرسة"
      />

      {/* Electronic Checkout Modal */}
      {payingInvoice && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 no-print">
          <form
            onSubmit={handlePayInvoice}
            className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-5"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2 text-teal-800">
                <ShieldCheck className="w-5 h-5" />
                <h3 className="text-base font-bold font-display">بوابة الدفع الإلكتروني</h3>
              </div>
              <span className="text-xs font-mono-num text-slate-500">
                {payingInvoice.invoiceNumber}
              </span>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-1">
              <p className="text-xs text-slate-500">{payingInvoice.studentName}</p>
              <p className="text-sm font-semibold text-slate-900">{payingInvoice.title}</p>
              <p className="text-xl font-bold font-mono-num text-teal-700 pt-1">
                {formatIQD(payingInvoice.amount)}
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">وسيلة الدفع</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="بطاقة كي كارد / ماستركارد">بطاقة كي كارد / ماستركارد</option>
                  <option value="محفظة زين كاش (ZainCash)">محفظة زين كاش (ZainCash)</option>
                  <option value="بطاقة فيزا / ماستركارد">بطاقة فيزا / ماستركارد</option>
                  <option value="تحويل مصرفي مباشر">تحويل مصرفي مباشر</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  آخر 4 أرقام من البطاقة
                </label>
                <input
                  type="text"
                  maxLength={4}
                  required
                  value={cardLast4}
                  onChange={(e) => setCardLast4(e.target.value.replace(/\D/g, ''))}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPayingInvoice(null)}
                className="px-4 py-2 bg-slate-100 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-200 cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={processing}
                className="px-5 py-2 bg-teal-700 text-white text-sm font-medium rounded-lg hover:bg-teal-800 disabled:opacity-50 cursor-pointer"
              >
                {processing ? 'جاري التنفيذ...' : 'تأكيد السداد الفوري'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
