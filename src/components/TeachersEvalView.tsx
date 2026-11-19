import React, { useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { Award, Download, Plus } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { downloadCsv } from '../lib/csvExport';
import type { TeacherEvaluation } from '../types';

interface TeachersEvalViewProps {
  teachers: TeacherEvaluation[];
  canManageTeachers: boolean;
  onNotify: (msg: string) => void;
}

export const TeachersEvalView: React.FC<TeachersEvalViewProps> = ({
  teachers,
  canManageTeachers,
  onNotify,
}) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [teacherName, setTeacherName] = useState('');
  const [subject, setSubject] = useState('');
  const [department, setDepartment] = useState('قسم العلوم والرياضيات');
  const [lessonsDelivered, setLessonsDelivered] = useState(40);
  const [homeworkPublished, setHomeworkPublished] = useState(18);
  const [avgResponseMinutes, setAvgResponseMinutes] = useState(15);
  const [studentMasteryPct, setStudentMasteryPct] = useState(92);
  const [evaluationScore, setEvaluationScore] = useState(94);
  const [evaluationSummary, setEvaluationSummary] = useState('');

  const handleSaveEvaluation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageTeachers || !teacherName.trim() || !subject.trim()) return;
    const teacherId = `tch_${Date.now()}`;

    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'teachers', teacherId), {
        teacherName: teacherName.trim(),
        subject: subject.trim(),
        department,
        lessonsDelivered: Number(lessonsDelivered),
        homeworkPublished: Number(homeworkPublished),
        avgResponseMinutes: Number(avgResponseMinutes),
        studentMasteryPct: Number(studentMasteryPct),
        evaluationScore: Number(evaluationScore),
        periodLabel: 'نوفمبر 2026',
        evaluationSummary: evaluationSummary.trim() || 'تقييم دوري معتمد من الإشراف التربوي.',
        scope: 'school',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      setTeacherName('');
      setSubject('');
      setEvaluationSummary('');
      setShowAddForm(false);
      onNotify('تم حفظ تقييم الأداء الدوري للمعلم بنجاح.');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `teachers/${teacherId}`);
    }
  };

  const chartData = teachers.map((t) => ({
    name: t.teacherName.replace(/^أ\.\s*/, '').split(' ').slice(0, 2).join(' '),
    evaluation: t.evaluationScore,
    mastery: t.studentMasteryPct,
  }));

  const handleExportTeachersCsv = () => {
    const rows = teachers.map((t) => [
      t.teacherName,
      t.subject,
      t.department,
      t.periodLabel,
      t.lessonsDelivered,
      t.homeworkPublished,
      t.avgResponseMinutes,
      `${t.studentMasteryPct}%`,
      `${t.evaluationScore}%`,
      t.evaluationSummary || '',
    ]);
    downloadCsv(
      `teacher-evaluations-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        'اسم المعلم',
        'التخصص',
        'القسم',
        'الفترة',
        'الحصص المنفذة',
        'الواجبات المنشورة',
        'متوسط الاستجابة (دقيقة)',
        'نسبة إتقان الطلاب',
        'التقييم الدوري',
        'التوصية التربوية',
      ],
      rows,
    );
    onNotify('تم تصدير جدول تقييم الكادر التعليمي إلى ملف CSV بنجاح.');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-slate-200 rounded-xl p-5">
        <div>
          <h2 className="text-lg font-bold font-display text-slate-900">
            إحصاء نشاطات المعلمين وتقييم أداء الكادر التعليمي
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            متابعة دورية لعدد الحصص، الواجبات المنشورة، سرعة التواصل مع أولياء الأمور، وإتقان الطلاب
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleExportTeachersCsv}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 text-slate-800 text-xs font-medium rounded-lg hover:bg-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>تصدير CSV</span>
          </button>
          {canManageTeachers && (
            <button
              type="button"
              onClick={() => setShowAddForm((v) => !v)}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة تقييم معلم</span>
            </button>
          )}
        </div>
      </div>

      {showAddForm && canManageTeachers && (
        <form
          onSubmit={handleSaveEvaluation}
          className="bg-white border border-slate-200 rounded-xl p-6 grid grid-cols-1 md:grid-cols-4 gap-4"
        >
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">اسم المعلم</label>
            <input
              type="text"
              required
              value={teacherName}
              onChange={(e) => setTeacherName(e.target.value)}
              placeholder="أ. فيصل بن حمد العتيبي"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">التخصص / المادة</label>
            <input
              type="text"
              required
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="الكيمياء"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">القسم</label>
            <input
              type="text"
              required
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              الحصص المنفذة
            </label>
            <input
              type="number"
              min={0}
              value={lessonsDelivered}
              onChange={(e) => setLessonsDelivered(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">الواجبات المنشورة</label>
            <input
              type="number"
              min={0}
              value={homeworkPublished}
              onChange={(e) => setHomeworkPublished(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              متوسط الاستجابة (دقيقة)
            </label>
            <input
              type="number"
              min={1}
              value={avgResponseMinutes}
              onChange={(e) => setAvgResponseMinutes(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              نسبة إتقان الطلاب (%)
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={studentMasteryPct}
              onChange={(e) => setStudentMasteryPct(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              الدرجة النهائية للتقييم (%)
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={evaluationScore}
              onChange={(e) => setEvaluationScore(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num"
            />
          </div>
          <div className="md:col-span-4">
            <label className="block text-xs font-medium text-slate-700 mb-1">
              ملاحظات الإشراف التربوي
            </label>
            <input
              type="text"
              value={evaluationSummary}
              onChange={(e) => setEvaluationSummary(e.target.value)}
              placeholder="تقرير مختصر عن جودة الأداء والتفاعل الصفي..."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <div className="md:col-span-4 flex gap-2">
            <button
              type="submit"
              className="px-4 py-2 bg-teal-700 text-white text-sm font-medium rounded-lg hover:bg-teal-800 cursor-pointer"
            >
              اعتماد التقييم
            </button>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="px-4 py-2 bg-slate-100 text-slate-700 text-sm font-medium rounded-lg cursor-pointer"
            >
              إلغاء
            </button>
          </div>
        </form>
      )}

      {/* Teacher Performance Comparison Chart */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Award className="w-4 h-4 text-teal-700" />
          <h3 className="text-base font-bold font-display text-slate-900">
            مقارنة التقييم العام ومعدل إتقان الطلاب للكادر التعليمي
          </h3>
        </div>
        <div className="h-64 w-full" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#475569' }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: '#475569' }} />
              <Tooltip
                contentStyle={{
                  borderRadius: '8px',
                  border: '1px solid #e2e8f0',
                  fontSize: '12px',
                }}
              />
              <Bar
                dataKey="evaluation"
                name="التقييم الدوري %"
                fill="#0f766e"
                radius={[6, 6, 0, 0]}
                maxBarSize={36}
              />
              <Bar
                dataKey="mastery"
                name="إتقان الطلاب %"
                fill="#64748b"
                radius={[6, 6, 0, 0]}
                maxBarSize={36}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Teacher Activity Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
              <tr>
                <th className="py-3 px-4 font-semibold">المعلم والمادة</th>
                <th className="py-3 px-4 font-semibold">الحصص</th>
                <th className="py-3 px-4 font-semibold">الواجبات</th>
                <th className="py-3 px-4 font-semibold">سرعة الرد</th>
                <th className="py-3 px-4 font-semibold">إتقان الطلاب</th>
                <th className="py-3 px-4 font-semibold">التقييم الدوري</th>
                <th className="py-3 px-4 font-semibold">التوصية التربوية</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {teachers.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50/70">
                  <td className="py-3.5 px-4">
                    <p className="font-semibold text-slate-900">{t.teacherName}</p>
                    <p className="text-xs text-slate-500">
                      {t.subject} · {t.department}
                    </p>
                  </td>
                  <td className="py-3.5 px-4 font-mono-num text-slate-700">
                    {t.lessonsDelivered}
                  </td>
                  <td className="py-3.5 px-4 font-mono-num text-slate-700">
                    {t.homeworkPublished}
                  </td>
                  <td className="py-3.5 px-4 font-mono-num text-slate-700">
                    {t.avgResponseMinutes} د
                  </td>
                  <td className="py-3.5 px-4 font-mono-num text-slate-700">
                    {t.studentMasteryPct}%
                  </td>
                  <td className="py-3.5 px-4 font-mono-num font-bold text-teal-700">
                    {t.evaluationScore}%
                  </td>
                  <td className="py-3.5 px-4 text-xs text-slate-600 max-w-xs">
                    {t.evaluationSummary || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
