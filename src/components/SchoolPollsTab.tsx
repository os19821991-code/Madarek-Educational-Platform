import React, { useMemo, useState } from 'react';
import { deleteDoc, doc, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';
import {
  BarChart3,
  CheckCircle2,
  Lock,
  MessageSquareText,
  Plus,
  Printer,
  Trash2,
  Unlock,
  Vote,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { SCHOOL_GRADES } from '../lib/grades';
import { PrintFooter, PrintHeader } from './PrintHeader';
import type {
  PollCategory,
  PollTargetAudience,
  PollVote,
  SchoolPoll,
  Student,
  UserRole,
} from '../types';

interface SchoolPollsTabProps {
  polls: SchoolPoll[];
  pollVotes: PollVote[];
  students: Student[];
  canManagePolls: boolean;
  activeEdition: UserRole;
  currentUid: string;
  userName: string;
  showCreateForm: boolean;
  onToggleCreateForm: (open: boolean) => void;
  onNotify: (msg: string) => void;
}

const POLL_CATEGORY_LABELS: Record<PollCategory, string> = {
  trip: 'الرحلات المدرسية',
  decision: 'القرارات المدرسية',
  schedule: 'الجداول والمواعيد',
  activity: 'الأنشطة والفعاليات',
  general: 'استطلاع عام',
};

const POLL_AUDIENCE_LABELS: Record<PollTargetAudience, string> = {
  all: 'أولياء الأمور والطلاب',
  parents: 'أولياء الأمور',
  students: 'الطلاب',
};

function getDefaultCloseDateIso(): string {
  const dt = new Date();
  dt.setDate(dt.getDate() + 7);
  return dt.toISOString().slice(0, 10);
}

export const SchoolPollsTab: React.FC<SchoolPollsTabProps> = ({
  polls,
  pollVotes,
  students,
  canManagePolls,
  activeEdition,
  currentUid,
  userName,
  showCreateForm,
  onToggleCreateForm,
  onNotify,
}) => {
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'closed'>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | PollCategory>('all');

  // Create Poll Form State
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<PollCategory>('trip');
  const [targetAudience, setTargetAudience] = useState<PollTargetAudience>('all');
  const [targetGrade, setTargetGrade] = useState('جميع الصفوف');
  const [closesAt, setClosesAt] = useState(getDefaultCloseDateIso());
  const [optionsDraft, setOptionsDraft] = useState<string[]>([
    'موافق / أؤيد المقترح',
    'أفضل الخيار البديل',
    'غير موافق',
  ]);
  const [notifyParentsOnCreate, setNotifyParentsOnCreate] = useState(true);
  const [creating, setCreating] = useState(false);

  // Per-poll interaction state
  const [selectedOptions, setSelectedOptions] = useState<Record<string, number>>({});
  const [voteComments, setVoteComments] = useState<Record<string, string>>({});
  const [submittingPollId, setSubmittingPollId] = useState<string | null>(null);
  const [expandedCommentsPollId, setExpandedCommentsPollId] = useState<string | null>(null);
  const [confirmDeletePollId, setConfirmDeletePollId] = useState<string | null>(null);

  const sortedPolls = useMemo(() => {
    return [...polls].sort((a, b) => {
      if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
      const aSec = a.createdAt?.seconds || 0;
      const bSec = b.createdAt?.seconds || 0;
      return bSec - aSec;
    });
  }, [polls]);

  const filteredPolls = useMemo(() => {
    return sortedPolls.filter((p) => {
      const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
      const matchesCat = categoryFilter === 'all' || p.category === categoryFilter;
      return matchesStatus && matchesCat;
    });
  }, [sortedPolls, statusFilter, categoryFilter]);

  const openCount = polls.filter((p) => p.status === 'open').length;
  const totalVotesAll = polls.reduce((sum, p) => sum + (p.totalVotes || 0), 0);
  const myVotesMap = useMemo(() => {
    const map = new Map<string, PollVote>();
    for (const v of pollVotes) {
      if (v.voterUid === currentUid) {
        map.set(v.pollId, v);
      }
    }
    return map;
  }, [pollVotes, currentUid]);

  const handleAddOptionRow = () => {
    if (optionsDraft.length >= 5) return;
    setOptionsDraft((prev) => [...prev, '']);
  };

  const handleRemoveOptionRow = (idx: number) => {
    if (optionsDraft.length <= 2) return;
    setOptionsDraft((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleOptionChange = (idx: number, val: string) => {
    setOptionsDraft((prev) => prev.map((item, i) => (i === idx ? val : item)));
  };

  const handleCreatePoll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManagePolls) return;

    const cleanTitle = title.trim().slice(0, 160);
    const cleanDesc = description.trim().slice(0, 800);
    const cleanOptions = optionsDraft.map((o) => o.trim().slice(0, 120)).filter((o) => o.length > 0);

    if (cleanTitle.length < 2 || cleanDesc.length < 2 || cleanOptions.length < 2) {
      onNotify('يرجى إدخال عنوان ووصف الاستطلاع وخيارين على الأقل للتصويت.');
      return;
    }

    setCreating(true);
    const pollId = `poll_${Date.now()}`;
    const creatorName =
      userName && userName.trim().length >= 2 ? userName.trim().slice(0, 120) : 'إدارة المدرسة';
    const creatorRole: 'admin' | 'teacher' = activeEdition === 'teacher' ? 'teacher' : 'admin';

    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'polls', pollId), {
        title: cleanTitle,
        description: cleanDesc,
        category,
        targetAudience,
        targetGrade,
        closesAt: closesAt || getDefaultCloseDateIso(),
        status: 'open',
        options: cleanOptions.slice(0, 5),
        optionCounts: cleanOptions.slice(0, 5).map(() => 0),
        totalVotes: 0,
        createdByName: creatorName,
        createdByRole: creatorRole,
        scope: 'school',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      if (notifyParentsOnCreate) {
        const uniqueParentUids = Array.from(
          new Set([currentUid, ...students.map((s) => s.parentUid)]),
        );
        uniqueParentUids.forEach((pUid, idx) => {
          batch.set(doc(db, 'notifications', `notif_poll_${Date.now()}_${idx}_${pUid.slice(0, 12)}`), {
            parentUid: pUid,
            title: `استطلاع رأي جديد: ${cleanTitle.slice(0, 100)}`,
            message: `${POLL_CATEGORY_LABELS[category]} (${POLL_AUDIENCE_LABELS[targetAudience]}): ${cleanDesc.slice(0, 180)}`,
            notifType: 'circular',
            isRead: false,
            createdAt: serverTimestamp(),
          });
        });
      }

      await batch.commit();
      setTitle('');
      setDescription('');
      setOptionsDraft(['موافق / أؤيد المقترح', 'أفضل الخيار البديل', 'غير موافق']);
      onToggleCreateForm(false);
      onNotify(
        notifyParentsOnCreate
          ? 'تم نشر الاستطلاع وإرسال تنبيه فوري لأولياء الأمور والطلاب.'
          : 'تم نشر استطلاع الرأي بنجاح.',
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `polls/${pollId}`);
    } finally {
      setCreating(false);
    }
  };

  const handleSubmitVote = async (poll: SchoolPoll) => {
    const selectedIdx = selectedOptions[poll.id];
    if (selectedIdx === undefined || selectedIdx < 0 || selectedIdx >= poll.options.length) {
      onNotify('يرجى اختيار أحد خيارات التصويت أولاً.');
      return;
    }
    if (poll.status !== 'open') {
      onNotify('تم إغلاق التصويت في هذا الاستطلاع.');
      return;
    }
    if (myVotesMap.has(poll.id)) {
      onNotify('تم تسجيل تصويتك في هذا الاستطلاع مسبقاً.');
      return;
    }

    setSubmittingPollId(poll.id);
    const voteId = `${poll.id}_${currentUid}`;
    const nextCounts = poll.options.map((_, i) =>
      (poll.optionCounts[i] || 0) + (i === selectedIdx ? 1 : 0),
    );
    const safeVoterName =
      userName && userName.trim().length >= 2 ? userName.trim().slice(0, 120) : 'ولي أمر / طالب';
    const trimmedComment = (voteComments[poll.id] || '').trim().slice(0, 400);

    try {
      const batch = writeBatch(db);
      const votePayload: Record<string, unknown> = {
        pollId: poll.id,
        voterUid: currentUid,
        voterName: safeVoterName,
        voterRole: activeEdition,
        selectedOptionIndex: selectedIdx,
        selectedOptionLabel: poll.options[selectedIdx].slice(0, 120),
        createdAt: serverTimestamp(),
      };
      if (trimmedComment) {
        votePayload.comment = trimmedComment;
      }

      batch.set(doc(db, 'pollVotes', voteId), votePayload);
      batch.update(doc(db, 'polls', poll.id), {
        optionCounts: nextCounts,
        totalVotes: (poll.totalVotes || 0) + 1,
        updatedAt: serverTimestamp(),
      });

      await batch.commit();
      onNotify(`شكراً لمشاركتك! تم تسجيل رأيك في "${poll.title}".`);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `pollVotes/${voteId}`);
    } finally {
      setSubmittingPollId(null);
    }
  };

  const handleTogglePollStatus = async (poll: SchoolPoll) => {
    if (!canManagePolls) return;
    const nextStatus = poll.status === 'open' ? 'closed' : 'open';
    try {
      await updateDoc(doc(db, 'polls', poll.id), {
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });
      onNotify(
        nextStatus === 'closed'
          ? `تم إغلاق استطلاع "${poll.title}".`
          : `تمت إعادة فتح استطلاع "${poll.title}" للتصويت.`,
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `polls/${poll.id}`);
    }
  };

  const handleDeletePoll = async (pollId: string) => {
    if (!canManagePolls) return;
    try {
      await deleteDoc(doc(db, 'polls', pollId));
      setConfirmDeletePollId(null);
      onNotify('تم حذف الاستطلاع بنجاح.');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `polls/${pollId}`);
    }
  };

  return (
    <div className="space-y-6">
      <PrintHeader
        title="تقرير نتائج استطلاعات الرأي المدرسية"
        subtitle="إحصاءات مشاركة أولياء الأمور والطلاب حول الرحلات والقرارات المدرسية"
        documentCode={`POLLS-${new Date().toISOString().slice(0, 10)}`}
        metadata={[
          { label: 'إجمالي الاستطلاعات', value: polls.length },
          { label: 'الاستطلاعات المفتوحة', value: openCount },
          { label: 'إجمالي الأصوات', value: totalVotesAll },
        ]}
      />

      {/* Summary KPI Strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 print-compact-grid-3 print-avoid-break">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs text-slate-500">الاستطلاعات المفتوحة للتصويت</p>
          <p className="text-2xl font-bold font-mono-num text-teal-700 mt-1">
            {openCount}{' '}
            <span className="text-sm font-normal text-slate-500">من أصل {polls.length}</span>
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs text-slate-500">إجمالي الآراء والأصوات المسجلة</p>
          <p className="text-2xl font-bold font-mono-num text-slate-900 mt-1">
            {totalVotesAll} <span className="text-sm font-normal text-slate-500">مشاركة</span>
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs text-slate-500">مشاركاتك المسجلة</p>
          <p className="text-2xl font-bold font-mono-num text-emerald-700 mt-1">
            {myVotesMap.size}{' '}
            <span className="text-sm font-normal text-slate-500">من {polls.length} استطلاعات</span>
          </p>
        </div>
      </div>

      {/* Create Poll Form (Admins & Teachers Only) */}
      {showCreateForm && canManagePolls && (
        <form
          onSubmit={handleCreatePoll}
          className="bg-white border border-slate-200 rounded-xl p-6 space-y-5 no-print"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-base font-bold font-display text-slate-900">
                إنشاء استطلاع رأي رقمي جديد
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                اجمع آراء أولياء الأمور والطلاب حول الرحلات أو القرارات والتنظيمات المدرسية
              </p>
            </div>
            <button
              type="button"
              onClick={() => onToggleCreateForm(false)}
              className="p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer"
              aria-label="إغلاق"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                عنوان الاستطلاع أو السؤال الرئيسي
              </label>
              <input
                type="text"
                required
                minLength={2}
                maxLength={160}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="مثال: استطلاع الرأي حول موعد الرحلة العلمية القادمة"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">التصنيف</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as PollCategory)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                {(Object.entries(POLL_CATEGORY_LABELS) as [PollCategory, string][]).map(
                  ([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ),
                )}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                تاريخ إغلاق التصويت
              </label>
              <input
                type="date"
                required
                value={closesAt}
                onChange={(e) => setClosesAt(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                الفئة المستهدفة
              </label>
              <select
                value={targetAudience}
                onChange={(e) => setTargetAudience(e.target.value as PollTargetAudience)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                {(Object.entries(POLL_AUDIENCE_LABELS) as [PollTargetAudience, string][]).map(
                  ([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ),
                )}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">الصف الدراسي</label>
              <select
                value={targetGrade}
                onChange={(e) => setTargetGrade(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="جميع الصفوف">جميع الصفوف</option>
                {SCHOOL_GRADES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                تفاصيل الاستطلاع والغرض منه
              </label>
              <input
                type="text"
                required
                minLength={2}
                maxLength={800}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="اشرح باختصار القرار أو الرحلة لمساعدة أولياء الأمور والطلاب على الاختيار..."
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          {/* Dynamic Poll Options Builder */}
          <div className="space-y-2.5 pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-800">
                خيارات التصويت ({optionsDraft.length} من 5 كحد أقصى)
              </label>
              {optionsDraft.length < 5 && (
                <button
                  type="button"
                  onClick={handleAddOptionRow}
                  className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-800 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>إضافة خيار</span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {optionsDraft.map((opt, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-xs font-mono-num text-slate-400 w-5 shrink-0">
                    {idx + 1}.
                  </span>
                  <input
                    type="text"
                    required
                    maxLength={120}
                    value={opt}
                    onChange={(e) => handleOptionChange(idx, e.target.value)}
                    placeholder={`الخيار ${idx + 1}`}
                    className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                  {optionsDraft.length > 2 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveOptionRow(idx)}
                      className="p-2 text-slate-400 hover:text-red-700 cursor-pointer"
                      aria-label="حذف الخيار"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-100">
            <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={notifyParentsOnCreate}
                onChange={(e) => setNotifyParentsOnCreate(e.target.checked)}
                className="rounded border-slate-300 text-teal-700"
              />
              <span>إرسال إشعار فوري لأولياء الأمور والطلاب عند النشر</span>
            </label>

            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={creating}
                className="px-5 py-2 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 disabled:opacity-50 cursor-pointer"
              >
                {creating ? 'جاري النشر...' : 'نشر الاستطلاع الآن'}
              </button>
              <button
                type="button"
                onClick={() => onToggleCreateForm(false)}
                className="px-4 py-2 bg-slate-100 text-slate-700 text-xs font-medium rounded-lg cursor-pointer"
              >
                إلغاء
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Filter & Action Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 no-print">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {[
              { id: 'all', label: 'جميع الاستطلاعات' },
              { id: 'open', label: 'مفتوحة للتصويت' },
              { id: 'closed', label: 'مغلقة' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id as 'all' | 'open' | 'closed')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  statusFilter === tab.id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as 'all' | PollCategory)}
            className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-700"
          >
            <option value="all">جميع المجالات</option>
            {(Object.entries(POLL_CATEGORY_LABELS) as [PollCategory, string][]).map(
              ([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ),
            )}
          </select>
        </div>

        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Printer className="w-4 h-4" />
          <span>طباعة النتائج</span>
        </button>
      </div>

      {/* Polls Cards List */}
      <div className="space-y-5">
        {filteredPolls.map((poll) => {
          const myVote = myVotesMap.get(poll.id);
          const isOpen = poll.status === 'open';
          const canVoteNow = isOpen && !myVote;
          const selectedIdx = selectedOptions[poll.id];
          const commentsForPoll = pollVotes.filter(
            (v) => v.pollId === poll.id && typeof v.comment === 'string' && v.comment.trim().length > 0,
          );
          const isCommentsOpen = expandedCommentsPollId === poll.id;

          return (
            <article
              key={poll.id}
              className="bg-white border border-slate-200 rounded-xl p-6 space-y-5 print-avoid-break"
            >
              {/* Header & Metadata */}
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="font-semibold text-teal-800">
                      {POLL_CATEGORY_LABELS[poll.category]}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{POLL_AUDIENCE_LABELS[poll.targetAudience]}</span>
                    <span aria-hidden="true">·</span>
                    <span>{poll.targetGrade}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-num">ينتهي في {poll.closesAt}</span>
                  </div>

                  <h3 className="text-base font-bold font-display text-slate-900">{poll.title}</h3>
                  <p className="text-xs text-slate-600 leading-relaxed">{poll.description}</p>
                </div>

                <div className="flex items-center gap-3 shrink-0 text-xs">
                  <span
                    className={`inline-flex items-center gap-1 font-semibold ${
                      isOpen ? 'text-emerald-700' : 'text-slate-500'
                    }`}
                  >
                    {isOpen ? <Vote className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                    <span>{isOpen ? 'مفتوح للتصويت' : 'مغلق'}</span>
                  </span>
                </div>
              </div>

              {/* Options & Live Results */}
              <div className="space-y-2.5">
                {poll.options.map((optLabel, idx) => {
                  const count = poll.optionCounts[idx] || 0;
                  const pct =
                    poll.totalVotes > 0 ? Math.round((count / poll.totalVotes) * 100) : 0;
                  const isMyChoice = myVote?.selectedOptionIndex === idx;
                  const isDraftSelected = canVoteNow && selectedIdx === idx;

                  if (canVoteNow) {
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() =>
                          setSelectedOptions((prev) => ({ ...prev, [poll.id]: idx }))
                        }
                        className={`w-full text-right p-3.5 rounded-lg border transition-colors cursor-pointer space-y-2 ${
                          isDraftSelected
                            ? 'border-teal-700 bg-teal-50/40'
                            : 'border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span
                              className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                                isDraftSelected
                                  ? 'border-teal-700 bg-teal-700 text-white'
                                  : 'border-slate-300 bg-white'
                              }`}
                            >
                              {isDraftSelected && <CheckCircle2 className="w-3 h-3" />}
                            </span>
                            <span className="text-sm font-medium text-slate-900">{optLabel}</span>
                          </div>
                          <span className="text-xs font-mono-num text-slate-600 shrink-0">
                            {pct}% ({count})
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              isDraftSelected ? 'bg-teal-700' : 'bg-slate-300'
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </button>
                    );
                  }

                  return (
                    <div
                      key={idx}
                      className={`p-3.5 rounded-lg border space-y-2 ${
                        isMyChoice
                          ? 'border-teal-700 bg-teal-50/30'
                          : 'border-slate-200 bg-slate-50/40'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          {isMyChoice && (
                            <CheckCircle2 className="w-4 h-4 text-teal-700 shrink-0" />
                          )}
                          <span
                            className={`text-sm ${
                              isMyChoice
                                ? 'font-bold text-teal-900'
                                : 'font-medium text-slate-800'
                            }`}
                          >
                            {optLabel}
                          </span>
                        </div>
                        <span className="text-xs font-mono-num font-semibold text-slate-700 shrink-0">
                          {pct}% ({count} صوت)
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            isMyChoice ? 'bg-teal-700' : 'bg-slate-400'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Voting Comment & Submit Bar (when open & not voted yet) */}
              {canVoteNow && (
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-2 no-print">
                  <input
                    type="text"
                    maxLength={400}
                    value={voteComments[poll.id] || ''}
                    onChange={(e) =>
                      setVoteComments((prev) => ({ ...prev, [poll.id]: e.target.value }))
                    }
                    placeholder="أضف تعليقاً أو اقتراحاً للإدارة حول هذا الموضوع (اختياري)..."
                    className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                  <button
                    type="button"
                    disabled={submittingPollId === poll.id || selectedIdx === undefined}
                    onClick={() => handleSubmitVote(poll)}
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Vote className="w-3.5 h-3.5" />
                    <span>
                      {submittingPollId === poll.id ? 'جاري التسجيل...' : 'إرسال التصويت والرأي'}
                    </span>
                  </button>
                </div>
              )}

              {/* Already Voted Confirmation */}
              {myVote && (
                <div className="text-xs text-teal-800 flex flex-wrap items-center gap-2 pt-1">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    تم تسجيل صوتك: <span className="font-semibold">{myVote.selectedOptionLabel}</span>
                  </span>
                  {myVote.comment && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-slate-600">ملاحظتك: «{myVote.comment}»</span>
                    </>
                  )}
                </div>
              )}

              {/* Footer Stats & Staff Controls */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100 text-xs text-slate-500">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="inline-flex items-center gap-1 font-mono-num font-semibold text-slate-700">
                    <BarChart3 className="w-3.5 h-3.5 text-teal-700" />
                    <span>{poll.totalVotes} صوت مشارك</span>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>بواسطة: {poll.createdByName}</span>
                </div>

                {canManagePolls && (
                  <div className="flex flex-wrap items-center gap-2 no-print">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedCommentsPollId(isCommentsOpen ? null : poll.id)
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <MessageSquareText className="w-3.5 h-3.5" />
                      <span>الآراء والتعليقات ({commentsForPoll.length})</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleTogglePollStatus(poll)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {isOpen ? (
                        <>
                          <Lock className="w-3.5 h-3.5" />
                          <span>إغلاق التصويت</span>
                        </>
                      ) : (
                        <>
                          <Unlock className="w-3.5 h-3.5" />
                          <span>إعادة الفتح</span>
                        </>
                      )}
                    </button>

                    {confirmDeletePollId === poll.id ? (
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleDeletePoll(poll.id)}
                          className="px-2.5 py-1.5 bg-red-700 text-white rounded-lg hover:bg-red-800 whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          تأكيد الحذف
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeletePollId(null)}
                          className="px-2.5 py-1.5 bg-slate-100 text-slate-700 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          إلغاء
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeletePollId(poll.id)}
                        aria-label="حذف الاستطلاع"
                        className="p-1.5 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded-lg cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Participant Comments Drawer for Admins/Teachers */}
              {canManagePolls && isCommentsOpen && (
                <div className="pt-3 border-t border-slate-100 space-y-2.5">
                  <p className="text-xs font-bold text-slate-800">
                    ملاحظات واقتراحات المشاركين
                  </p>
                  {commentsForPoll.length > 0 ? (
                    <div className="divide-y divide-slate-100">
                      {commentsForPoll.map((v) => (
                        <div key={v.id} className="py-2.5 space-y-1">
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="font-semibold text-slate-900">{v.voterName}</span>
                            <span className="text-teal-700 font-medium">
                              اختار: {v.selectedOptionLabel}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600">{v.comment}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">
                      لا توجد تعليقات نصية مرفقة مع الأصوات حتى الآن.
                    </p>
                  )}
                </div>
              )}
            </article>
          );
        })}

        {filteredPolls.length === 0 && (
          <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
            <p className="text-sm text-slate-500">
              لا توجد استطلاعات رأي مطابقة للتصفية الحالية.
            </p>
            {canManagePolls && (
              <button
                type="button"
                onClick={() => onToggleCreateForm(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>إنشاء أول استطلاع رأي</span>
              </button>
            )}
          </div>
        )}
      </div>

      <PrintFooter
        preparedBy={userName || 'إدارة المدرسة والكادر التعليمي'}
        approverTitle="اعتماد إدارة المدرسة"
      />
    </div>
  );
};
