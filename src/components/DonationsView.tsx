import React, { useMemo, useState } from 'react';
import { doc, increment, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';
import {
  CheckCircle2,
  Download,
  HeartHandshake,
  Plus,
  Printer,
  Receipt,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { CURRENCY_SYMBOL, formatIQD } from '../lib/currency';
import { downloadCsv } from '../lib/csvExport';
import { PrintFooter, PrintHeader } from './PrintHeader';
import type { DonationCampaign, DonationCategory, DonationRecord } from '../types';

interface DonationsViewProps {
  campaigns: DonationCampaign[];
  donations: DonationRecord[];
  canManageDonations: boolean;
  currentUid: string;
  userName: string;
  onNotify: (msg: string) => void;
}

const CATEGORY_LABELS: Record<DonationCategory, string> = {
  orphans_support: 'كفالة ودعم الطلبة المتعففين',
  supplies: 'القرطاسية والكتب المدرسية',
  facilities: 'تطوير المختبرات والمرافق',
  activities: 'الأنشطة والرحلات الطلابية',
  general: 'الصندوق الخيري العام',
};

const PRESET_AMOUNTS_IQD = [10000, 25000, 50000, 100000];

export const DonationsView: React.FC<DonationsViewProps> = ({
  campaigns,
  donations,
  canManageDonations,
  currentUid,
  userName,
  onNotify,
}) => {
  const [categoryFilter, setCategoryFilter] = useState<'all' | DonationCategory>('all');
  const [showAddCampaign, setShowAddCampaign] = useState(false);

  // Create campaign state
  const [campTitle, setCampTitle] = useState('');
  const [campCategory, setCampCategory] = useState<DonationCategory>('orphans_support');
  const [campTarget, setCampTarget] = useState(2500000);
  const [campDesc, setCampDesc] = useState('');
  const [creatingCampaign, setCreatingCampaign] = useState(false);

  // Contribute modal state
  const [donatingCampaign, setDonatingCampaign] = useState<DonationCampaign | null>(null);
  const [donAmount, setDonAmount] = useState(25000);
  const [donPaymentMethod, setDonPaymentMethod] = useState('بطاقة كي كارد / ماستركارد');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [donNote, setDonNote] = useState('');
  const [submittingDonation, setSubmittingDonation] = useState(false);

  const filteredCampaigns = useMemo(() => {
    return campaigns.filter((c) =>
      categoryFilter === 'all' ? true : c.category === categoryFilter,
    );
  }, [campaigns, categoryFilter]);

  const totalCollected = campaigns.reduce((sum, c) => sum + c.collectedAmount, 0);
  const totalDonors = campaigns.reduce((sum, c) => sum + c.donorsCount, 0);
  const activeCount = campaigns.filter((c) => c.status === 'active').length;

  const sortedDonations = useMemo(() => {
    return [...donations].sort((a, b) => {
      const aSec = a.createdAt?.seconds || 0;
      const bSec = b.createdAt?.seconds || 0;
      return bSec - aSec;
    });
  }, [donations]);

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageDonations) return;
    const trimmedTitle = campTitle.trim();
    const trimmedDesc = campDesc.trim();
    const safeTarget = Math.round(Number(campTarget));
    if (trimmedTitle.length < 2 || trimmedDesc.length < 2 || safeTarget < 1000) {
      onNotify('يرجى إدخال عنوان ووصف ومبلغ هدف لا يقل عن 1,000 د.ع.');
      return;
    }

    setCreatingCampaign(true);
    const campId = `camp_${Date.now()}`;
    const safeCreator =
      userName && userName.trim().length >= 2 ? userName.trim().slice(0, 120) : 'إدارة المدرسة';

    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'donationCampaigns', campId), {
        title: trimmedTitle.slice(0, 160),
        description: trimmedDesc.slice(0, 600),
        category: campCategory,
        targetAmount: Math.min(1000000000, safeTarget),
        collectedAmount: 0,
        donorsCount: 0,
        status: 'active',
        createdByName: safeCreator,
        scope: 'school',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      setCampTitle('');
      setCampDesc('');
      setCampTarget(2500000);
      setShowAddCampaign(false);
      onNotify('تمت إضافة حملة التبرع الجديدة إلى صندوق التبرعات المدرسي.');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `donationCampaigns/${campId}`);
    } finally {
      setCreatingCampaign(false);
    }
  };

  const handleToggleCampaignStatus = async (camp: DonationCampaign) => {
    if (!canManageDonations) return;
    const nextStatus = camp.status === 'active' ? 'completed' : 'active';
    try {
      await updateDoc(doc(db, 'donationCampaigns', camp.id), {
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });
      onNotify(
        nextStatus === 'completed'
          ? `تم إغلاق حملة "${camp.title}" كمكتملة.`
          : `تمت إعادة تفعيل حملة "${camp.title}".`,
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `donationCampaigns/${camp.id}`);
    }
  };

  const handleSubmitDonation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!donatingCampaign || donatingCampaign.status !== 'active') return;

    const intAmount = Math.round(Number(donAmount));
    if (!Number.isFinite(intAmount) || intAmount < 1000 || intAmount > 100000000) {
      onNotify('يجب أن يكون مبلغ التبرع بين 1,000 و 100,000,000 د.ع.');
      return;
    }

    setSubmittingDonation(true);
    const donationId = `don_${Date.now()}`;
    const receiptRef = `DON-${Math.floor(100000 + Math.random() * 899999)}`;
    const safeDonorName = isAnonymous
      ? 'متبرع فاعل خير'
      : userName && userName.trim().length >= 2
        ? userName.trim().slice(0, 120)
        : 'ولي أمر / مساهم';
    const trimmedNote = donNote.trim().slice(0, 300);
    const nextCollected = donatingCampaign.collectedAmount + intAmount;
    const nextStatus =
      nextCollected >= donatingCampaign.targetAmount ? 'completed' : donatingCampaign.status;

    try {
      const batch = writeBatch(db);

      const donationPayload: Record<string, unknown> = {
        campaignId: donatingCampaign.id,
        campaignTitle: donatingCampaign.title.slice(0, 160),
        donorUid: currentUid,
        donorName: safeDonorName,
        isAnonymous,
        amount: intAmount,
        paymentMethod: donPaymentMethod.slice(0, 80),
        receiptRef,
        createdAt: serverTimestamp(),
      };
      if (trimmedNote) {
        donationPayload.note = trimmedNote;
      }

      batch.set(doc(db, 'donations', donationId), donationPayload);

      batch.update(doc(db, 'donationCampaigns', donatingCampaign.id), {
        collectedAmount: increment(intAmount),
        donorsCount: increment(1),
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });

      batch.set(doc(db, 'notifications', `notif_don_${Date.now()}`), {
        parentUid: currentUid,
        title: `إيصال تبرع — ${receiptRef}`,
        message: `شكراً لمساهمتكم بمبلغ ${formatIQD(intAmount)} في "${donatingCampaign.title}".`,
        notifType: 'payment',
        isRead: false,
        createdAt: serverTimestamp(),
      });

      await batch.commit();
      onNotify(`تم استلام تبرعكم بمبلغ ${formatIQD(intAmount)} بنجاح! رقم الإيصال: ${receiptRef}`);
      setDonatingCampaign(null);
      setDonNote('');
      setIsAnonymous(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `donations/${donationId}`);
    } finally {
      setSubmittingDonation(false);
    }
  };

  const handleExportDonationsCsv = () => {
    const rows = sortedDonations.map((d) => [
      d.receiptRef,
      d.campaignTitle,
      d.donorName,
      d.amount,
      d.paymentMethod,
      d.note || '',
      d.createdAt?.toDate ? d.createdAt.toDate().toISOString().slice(0, 10) : '',
    ]);
    downloadCsv(
      `school-donations-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        'رقم الإيصال',
        'الحملة / الصندوق',
        'المتبرع',
        `المبلغ (${CURRENCY_SYMBOL})`,
        'وسيلة الدفع',
        'ملاحظة',
        'التاريخ',
      ],
      rows,
    );
    onNotify('تم تصدير سجل التبرعات إلى ملف CSV بنجاح.');
  };

  return (
    <div className="space-y-6">
      <PrintHeader
        title="تقرير صندوق التبرعات والتكافل المدرسي"
        subtitle={`ملخص حملات الدعم الخيري وسجل الإيصالات المعتمدة بعملة الدينار العراقي (${CURRENCY_SYMBOL})`}
        documentCode={`DON-RPT-${new Date().toISOString().slice(0, 10)}`}
        metadata={[
          { label: 'إجمالي التبرعات', value: formatIQD(totalCollected) },
          { label: 'عدد المساهمات', value: totalDonors },
          { label: 'الحملات النشطة', value: `${activeCount} / ${campaigns.length}` },
        ]}
      />
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-slate-200 rounded-xl p-5 no-print">
        <div>
          <h2 className="text-lg font-bold font-display text-slate-900">
            صندوق التبرعات والتكافل المدرسي
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            دعم الطلبة المتعففين وتطوير المرافق والأنشطة المدرسية بعملة الدينار العراقي ({CURRENCY_SYMBOL}) مع إيصالات فورية.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {sortedDonations.length > 0 && (
            <button
              type="button"
              onClick={handleExportDonationsCsv}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 text-slate-800 text-xs font-medium rounded-lg hover:bg-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>تصدير سجل التبرعات</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>طباعة التقرير</span>
          </button>
          {canManageDonations && (
            <button
              type="button"
              onClick={() => setShowAddCampaign((v) => !v)}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة حملة تبرع</span>
            </button>
          )}
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 print-compact-grid-3 print-avoid-break">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs text-slate-500">إجمالي التبرعات المجموعة</p>
          <p className="text-2xl font-bold font-mono-num text-emerald-700 mt-1">
            {formatIQD(totalCollected)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs text-slate-500">عدد المساهمات المسجلة</p>
          <p className="text-2xl font-bold font-mono-num text-slate-900 mt-1">
            {totalDonors} <span className="text-sm font-normal text-slate-500">مساهمة</span>
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs text-slate-500">صناديق وحملات الدعم</p>
          <p className="text-2xl font-bold font-mono-num text-teal-700 mt-1">
            {activeCount}{' '}
            <span className="text-sm font-normal text-slate-500">
              نشطة من أصل {campaigns.length}
            </span>
          </p>
        </div>
      </div>

      {/* Create Campaign Form */}
      {showAddCampaign && canManageDonations && (
        <form
          onSubmit={handleCreateCampaign}
          className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 no-print"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-sm font-bold font-display text-slate-900">
              إنشاء صندوق أو حملة تبرعات جديدة
            </h3>
            <button
              type="button"
              onClick={() => setShowAddCampaign(false)}
              className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              aria-label="إغلاق"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                اسم الصندوق / الحملة
              </label>
              <input
                type="text"
                required
                minLength={2}
                maxLength={160}
                value={campTitle}
                onChange={(e) => setCampTitle(e.target.value)}
                placeholder="مثال: صندوق كفالة الطلبة الأيتام والمتعففين"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">المجال</label>
              <select
                value={campCategory}
                onChange={(e) => setCampCategory(e.target.value as DonationCategory)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                المبلغ المستهدف ({CURRENCY_SYMBOL})
              </label>
              <input
                type="number"
                required
                min={1000}
                step={1000}
                max={1000000000}
                value={campTarget}
                onChange={(e) => setCampTarget(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num"
              />
            </div>

            <div className="md:col-span-3">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                وصف الهدف وأوجه الصرف
              </label>
              <textarea
                rows={2}
                required
                minLength={2}
                maxLength={600}
                value={campDesc}
                onChange={(e) => setCampDesc(e.target.value)}
                placeholder="وضح كيف سيتم توجيه التبرعات لدعم الطلبة أو المدرسة..."
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={creatingCampaign}
              className="px-4 py-2 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 disabled:opacity-50 cursor-pointer"
            >
              {creatingCampaign ? 'جاري النشر...' : 'حفظ ونشر الحملة'}
            </button>
            <button
              type="button"
              onClick={() => setShowAddCampaign(false)}
              className="px-4 py-2 bg-slate-100 text-slate-700 text-xs font-medium rounded-lg cursor-pointer"
            >
              إلغاء
            </button>
          </div>
        </form>
      )}

      {/* Category Filter */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 overflow-x-auto no-print">
        <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            type="button"
            onClick={() => setCategoryFilter('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              categoryFilter === 'all'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            جميع الصناديق
          </button>
          {(Object.entries(CATEGORY_LABELS) as [DonationCategory, string][]).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setCategoryFilter(key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                categoryFilter === key
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Donation Campaigns Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {filteredCampaigns.map((camp) => {
          const pct = Math.min(
            100,
            camp.targetAmount > 0
              ? Math.round((camp.collectedAmount / camp.targetAmount) * 100)
              : 0,
          );
          const isCompleted = camp.status === 'completed';

          return (
            <article
              key={camp.id}
              className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between space-y-5 print-avoid-break"
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                  <span className="font-medium text-teal-800">
                    {CATEGORY_LABELS[camp.category]}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 font-semibold ${
                      isCompleted ? 'text-emerald-700' : 'text-teal-700'
                    }`}
                  >
                    {isCompleted && <CheckCircle2 className="w-3.5 h-3.5" />}
                    <span>{isCompleted ? 'مكتملة' : 'حملة نشطة'}</span>
                  </span>
                </div>

                <h3 className="text-base font-bold font-display text-slate-900">{camp.title}</h3>
                <p className="text-xs text-slate-600 leading-relaxed">{camp.description}</p>
              </div>

              <div className="space-y-3 pt-3 border-t border-slate-100">
                <div className="flex items-baseline justify-between gap-2">
                  <div>
                    <p className="text-[11px] text-slate-500">المبلغ المجموع</p>
                    <p className="text-base font-bold font-mono-num text-emerald-700">
                      {formatIQD(camp.collectedAmount)}
                    </p>
                  </div>
                  <div className="text-left">
                    <p className="text-[11px] text-slate-500">الهدف المطلوب</p>
                    <p className="text-sm font-semibold font-mono-num text-slate-700">
                      {formatIQD(camp.targetAmount)}
                    </p>
                  </div>
                </div>

                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      isCompleted ? 'bg-emerald-600' : 'bg-teal-700'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1">
                    <Users className="w-3.5 h-3.5" />
                    <span className="font-mono-num">{camp.donorsCount}</span> مساهمة
                  </span>
                  <span className="font-mono-num font-semibold text-slate-700">{pct}% مكتمل</span>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1 no-print">
                  <button
                    type="button"
                    disabled={isCompleted}
                    onClick={() => {
                      setDonatingCampaign(camp);
                      setDonAmount(25000);
                    }}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 px-4 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 disabled:bg-slate-200 disabled:text-slate-500 transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <HeartHandshake className="w-4 h-4" />
                    <span>{isCompleted ? 'اكتملت الحملة' : 'تبرع الآن في الصندوق'}</span>
                  </button>

                  {canManageDonations && (
                    <button
                      type="button"
                      onClick={() => handleToggleCampaignStatus(camp)}
                      className="py-2.5 px-3 bg-slate-100 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {isCompleted ? 'إعادة فتح' : 'إغلاق كمكتملة'}
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}

        {filteredCampaigns.length === 0 && (
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">
            لا توجد حملات تبرع مطابقة للتصنيف المختار حالياً.
          </div>
        )}
      </div>

      {/* Donation Receipts Ledger */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-teal-700" />
            <h3 className="text-sm font-bold font-display text-slate-900">
              سجل إيصالات التبرعات والمساهمات
            </h3>
          </div>
          <span className="text-xs text-slate-500 font-mono-num">
            {sortedDonations.length} إيصال
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
              <tr>
                <th className="py-3 px-4 font-semibold">رقم الإيصال</th>
                <th className="py-3 px-4 font-semibold">الصندوق / الحملة</th>
                <th className="py-3 px-4 font-semibold">المتبرع</th>
                <th className="py-3 px-4 font-semibold">المبلغ</th>
                <th className="py-3 px-4 font-semibold">وسيلة المساهمة</th>
                <th className="py-3 px-4 font-semibold">التاريخ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedDonations.map((d) => (
                <tr key={d.id} className="hover:bg-slate-50/70">
                  <td className="py-3 px-4 font-mono-num font-semibold text-slate-800">
                    {d.receiptRef}
                  </td>
                  <td className="py-3 px-4">
                    <p className="font-medium text-slate-900">{d.campaignTitle}</p>
                    {d.note && <p className="text-xs text-slate-500">{d.note}</p>}
                  </td>
                  <td className="py-3 px-4 text-slate-700">{d.donorName}</td>
                  <td className="py-3 px-4 font-mono-num font-bold text-emerald-700">
                    {formatIQD(d.amount)}
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-600">{d.paymentMethod}</td>
                  <td className="py-3 px-4 font-mono-num text-xs text-slate-500">
                    {d.createdAt?.toDate ? d.createdAt.toDate().toISOString().slice(0, 10) : 'الآن'}
                  </td>
                </tr>
              ))}
              {sortedDonations.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-sm text-slate-500">
                    لم تسجل تبرعات في حسابك بعد. يمكنك المساهمة في أي من الصناديق أعلاه.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PrintFooter
        preparedBy={userName || 'لجنة التكافل الاجتماعي'}
        approverTitle="اعتماد إدارة المدرسة"
      />

      {/* Donation Checkout Modal */}
      {donatingCampaign && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 no-print">
          <form
            onSubmit={handleSubmitDonation}
            className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-5"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2 text-teal-800">
                <ShieldCheck className="w-5 h-5" />
                <h3 className="text-base font-bold font-display">المساهمة في صندوق التبرعات</h3>
              </div>
              <button
                type="button"
                onClick={() => setDonatingCampaign(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                aria-label="إغلاق"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-1">
              <p className="text-xs text-teal-700 font-medium">
                {CATEGORY_LABELS[donatingCampaign.category]}
              </p>
              <p className="text-sm font-bold text-slate-900">{donatingCampaign.title}</p>
              <p className="text-xs text-slate-500 font-mono-num">
                المتبقي لتحقيق الهدف:{' '}
                {formatIQD(Math.max(0, donatingCampaign.targetAmount - donatingCampaign.collectedAmount))}
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  اختر مبلغ التبرع ({CURRENCY_SYMBOL})
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2.5">
                  {PRESET_AMOUNTS_IQD.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setDonAmount(preset)}
                      className={`py-2 px-2 text-xs font-mono-num font-semibold rounded-lg border transition-colors cursor-pointer ${
                        donAmount === preset
                          ? 'bg-teal-700 border-teal-700 text-white'
                          : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {preset.toLocaleString('en-US')}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  min={1000}
                  step={1000}
                  max={100000000}
                  required
                  value={donAmount}
                  onChange={(e) => setDonAmount(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">وسيلة المساهمة</label>
                <select
                  value={donPaymentMethod}
                  onChange={(e) => setDonPaymentMethod(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="بطاقة كي كارد / ماستركارد">بطاقة كي كارد / ماستركارد</option>
                  <option value="محفظة زين كاش (ZainCash)">محفظة زين كاش (ZainCash)</option>
                  <option value="بطاقة فيزا / ماستركارد">بطاقة فيزا / ماستركارد</option>
                  <option value="التبرع النقدي في الإدارة">التبرع النقدي في الإدارة</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  ملاحظة أو إهداء (اختياري)
                </label>
                <input
                  type="text"
                  maxLength={300}
                  value={donNote}
                  onChange={(e) => setDonNote(e.target.value)}
                  placeholder="مثال: مساهمة لدعم شراء الحقائب المدرسية"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isAnonymous}
                  onChange={(e) => setIsAnonymous(e.target.checked)}
                  className="rounded border-slate-300 text-teal-700"
                />
                <span>إخفاء الاسم في الإيصال (تسجيل التبرع باسم فاعل خير)</span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDonatingCampaign(null)}
                className="px-4 py-2 bg-slate-100 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-200 cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={submittingDonation}
                className="px-5 py-2 bg-teal-700 text-white text-sm font-medium rounded-lg hover:bg-teal-800 disabled:opacity-50 cursor-pointer"
              >
                {submittingDonation
                  ? 'جاري التأكيد...'
                  : `تأكيد التبرع (${formatIQD(donAmount)})`}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
