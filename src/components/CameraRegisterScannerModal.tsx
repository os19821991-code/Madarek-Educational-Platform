import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
  Shuffle,
  SwitchCamera,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { PERIOD_CATEGORY_PRESETS, SCHOOL_GRADES } from '../lib/grades';
import {
  type AttendanceScanMark,
  compressImageToJpegBase64,
  findBestStudentMatch,
  generateRandomAcademicCode,
  scanRegisterImage,
  statusFromAttendanceMark,
} from '../lib/registerScanService';
import type { Student } from '../types';

export interface ConfirmedStudentScanItem {
  fullName: string;
  studentCode: string;
  grade: string;
  section: string;
  parentName: string;
  parentPhone: string;
}

export interface ConfirmedAttendanceScanItem {
  student: Student;
  mark: AttendanceScanMark;
  status: 'present' | 'absent' | 'excused';
  categoryLabel: string;
}

interface CameraRegisterScannerModalProps {
  isOpen: boolean;
  mode: 'students' | 'attendance';
  students: Student[];
  defaultGrade?: string;
  defaultSection?: string;
  attendanceContext?: {
    date: string;
    periodLabel: string;
    subject: string;
    defaultCategory: string;
  };
  onClose: () => void;
  onConfirmStudents?: (items: ConfirmedStudentScanItem[]) => Promise<void>;
  onConfirmAttendance?: (items: ConfirmedAttendanceScanItem[]) => Promise<void>;
}

interface DraftStudentRow {
  rowId: string;
  selected: boolean;
  fullName: string;
  studentCode: string;
  parentName: string;
}

interface DraftAttendanceRow {
  rowId: string;
  selected: boolean;
  scannedName: string;
  matchedStudentId: string;
  mark: AttendanceScanMark;
  categoryLabel: string;
  note?: string;
}

export const CameraRegisterScannerModal: React.FC<CameraRegisterScannerModalProps> = ({
  isOpen,
  mode,
  students,
  defaultGrade,
  defaultSection,
  attendanceContext,
  onClose,
  onConfirmStudents,
  onConfirmAttendance,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Batch defaults for 'students' mode
  const [batchGrade, setBatchGrade] = useState<string>(defaultGrade || SCHOOL_GRADES[0]);
  const [batchSection, setBatchSection] = useState<string>(defaultSection || 'أ');
  const [batchParentPhone, setBatchParentPhone] = useState<string>('07700000000');

  const [studentRows, setStudentRows] = useState<DraftStudentRow[]>([]);
  const [attendanceRows, setAttendanceRows] = useState<DraftAttendanceRow[]>([]);

  const existingCodes = useMemo(() => students.map((s) => s.studentCode), [students]);

  const stopCameraStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }, []);

  const startCameraStream = useCallback(
    async (preferredFacing: 'environment' | 'user' = facingMode) => {
      stopCameraStream();
      setCameraError(null);

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError('المتصفح الحالي لا يدعم تشغيل الكاميرا مباشرة. يمكنك اختيار صورة أو التصوير عبر ملف الصورة أدناه.');
        return;
      }

      setCameraLoading(true);
      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: preferredFacing },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
            audio: false,
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setCameraActive(true);

        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        const videoInputs = devices.filter((d) => d.kind === 'videoinput');
        setHasMultipleCameras(videoInputs.length > 1);
      } catch {
        setCameraError(
          'تعذر الوصول إلى الكاميرا (قد تكون الصلاحية مرفوضة أو لا توجد كاميرا متصلة). يمكنك التقاط صورة أو رفعها من الجهاز أدناه.',
        );
      } finally {
        setCameraLoading(false);
      }
    },
    [facingMode, stopCameraStream],
  );

  useEffect(() => {
    if (!isOpen) {
      stopCameraStream();
      setPreviewUrl(null);
      setScanError(null);
      setCameraError(null);
      setStudentRows([]);
      setAttendanceRows([]);
      return;
    }

    setBatchGrade(defaultGrade || SCHOOL_GRADES[0]);
    setBatchSection(defaultSection || 'أ');
    void startCameraStream('environment');

    return () => {
      stopCameraStream();
    };
  }, [isOpen, defaultGrade, defaultSection, startCameraStream, stopCameraStream]);

  const defaultCategoryForMark = useCallback(
    (mark: AttendanceScanMark) => {
      if (mark === 'غ') return 'غائب عن الحصة';
      if (mark === 'م') return 'مستأذن بعذر';
      return attendanceContext?.defaultCategory || 'منضبط';
    },
    [attendanceContext?.defaultCategory],
  );

  const analyzeBlob = async (blob: Blob) => {
    setScanError(null);
    setScanning(true);
    try {
      const { base64, mimeType, previewDataUrl } = await compressImageToJpegBase64(blob);
      setPreviewUrl(previewDataUrl);
      stopCameraStream();

      if (mode === 'students') {
        const result = await scanRegisterImage({
          mode: 'students',
          imageBase64: base64,
          mimeType,
        });

        const usedCodes = new Set(existingCodes);
        const rows: DraftStudentRow[] = result.students.map((item, idx) => {
          const code = generateRandomAcademicCode(usedCodes);
          usedCodes.add(code);
          return {
            rowId: `scan_stu_${Date.now()}_${idx}`,
            selected: true,
            fullName: item.fullName,
            studentCode: code,
            parentName: `ولي أمر ${item.fullName}`,
          };
        });

        setStudentRows(rows);
        if (rows.length === 0) {
          setScanError('لم يتم العثور على أسماء طلاب واضحة في الصورة. جرب التقاط صورة أوضح أو أضف الأسماء يدوياً.');
        }
      } else {
        const result = await scanRegisterImage({
          mode: 'attendance',
          imageBase64: base64,
          mimeType,
          knownStudentNames: students.map((s) => s.fullName),
        });

        const rows: DraftAttendanceRow[] = result.entries.map((entry, idx) => {
          const match = findBestStudentMatch(entry.studentName, students);
          return {
            rowId: `scan_att_${Date.now()}_${idx}`,
            selected: Boolean(match.student),
            scannedName: entry.studentName,
            matchedStudentId: match.student?.id || '',
            mark: entry.rawMark,
            categoryLabel: defaultCategoryForMark(entry.rawMark),
            note: entry.note,
          };
        });

        setAttendanceRows(rows);
        if (rows.length === 0) {
          setScanError('لم يتم العثور على صفوف حضور واضحة في الصورة. تأكد من وضوح الأسماء والرموز (/ ، غ ، م).');
        }
      }
    } catch (error) {
      setScanError(
        error instanceof Error ? error.message : 'حدث خطأ غير متوقع أثناء تحليل الصورة.',
      );
    } finally {
      setScanning(false);
    }
  };

  const handleCaptureFrame = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.92),
    );
    if (blob) {
      await analyzeBlob(blob);
    }
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await analyzeBlob(file);
  };

  const handleRetake = () => {
    setPreviewUrl(null);
    setScanError(null);
    setStudentRows([]);
    setAttendanceRows([]);
    void startCameraStream(facingMode);
  };

  const handleToggleCamera = () => {
    const next = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(next);
    void startCameraStream(next);
  };

  const handleRegenerateCode = (rowId: string) => {
    setStudentRows((prev) => {
      const used = new Set([...existingCodes, ...prev.map((r) => r.studentCode)]);
      return prev.map((row) => {
        if (row.rowId !== rowId) return row;
        const fresh = generateRandomAcademicCode(used);
        used.add(fresh);
        return { ...row, studentCode: fresh };
      });
    });
  };

  const handleRegenerateAllCodes = () => {
    setStudentRows((prev) => {
      const used = new Set(existingCodes);
      return prev.map((row) => {
        const fresh = generateRandomAcademicCode(used);
        used.add(fresh);
        return { ...row, studentCode: fresh };
      });
    });
  };

  const handleAddBlankStudentRow = () => {
    setStudentRows((prev) => {
      const used = new Set([...existingCodes, ...prev.map((r) => r.studentCode)]);
      const code = generateRandomAcademicCode(used);
      return [
        ...prev,
        {
          rowId: `manual_stu_${Date.now()}`,
          selected: true,
          fullName: '',
          studentCode: code,
          parentName: '',
        },
      ];
    });
  };

  const handleAddBlankAttendanceRow = () => {
    setAttendanceRows((prev) => [
      ...prev,
      {
        rowId: `manual_att_${Date.now()}`,
        selected: true,
        scannedName: 'إدخال يدوي',
        matchedStudentId: students[0]?.id || '',
        mark: '/',
        categoryLabel: defaultCategoryForMark('/'),
      },
    ]);
  };

  const handleChangeRowMark = (rowId: string, nextMark: AttendanceScanMark) => {
    setAttendanceRows((prev) =>
      prev.map((row) =>
        row.rowId === rowId
          ? {
              ...row,
              mark: nextMark,
              categoryLabel: defaultCategoryForMark(nextMark),
            }
          : row,
      ),
    );
  };

  const validSelectedStudents = useMemo(
    () =>
      studentRows.filter(
        (r) =>
          r.selected &&
          r.fullName.trim().length >= 2 &&
          r.studentCode.trim().replace(/[^a-zA-Z0-9_-]/g, '').length >= 2,
      ),
    [studentRows],
  );

  const validSelectedAttendance = useMemo(
    () =>
      attendanceRows.filter(
        (r) => r.selected && Boolean(r.matchedStudentId) && students.some((s) => s.id === r.matchedStudentId),
      ),
    [attendanceRows, students],
  );

  const handleSaveStudents = async () => {
    if (!onConfirmStudents || validSelectedStudents.length === 0) return;
    const cleanPhone = batchParentPhone.trim().length >= 6 ? batchParentPhone.trim() : '07700000000';
    const cleanSection = batchSection.trim() || 'أ';

    setSaving(true);
    setScanError(null);
    try {
      const payload: ConfirmedStudentScanItem[] = validSelectedStudents.map((row) => {
        const cleanName = row.fullName.trim();
        const cleanCode =
          row.studentCode.trim().replace(/[^a-zA-Z0-9_-]/g, '') ||
          generateRandomAcademicCode(existingCodes);
        const resolvedParent =
          row.parentName.trim().length >= 2 ? row.parentName.trim() : `ولي أمر ${cleanName}`;
        return {
          fullName: cleanName,
          studentCode: cleanCode,
          grade: batchGrade,
          section: cleanSection,
          parentName: resolvedParent,
          parentPhone: cleanPhone,
        };
      });
      await onConfirmStudents(payload);
      onClose();
    } catch (error) {
      setScanError(
        error instanceof Error ? error.message : 'تعذر حفظ الطلاب المستخرجين في قاعدة البيانات.',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAttendance = async () => {
    if (!onConfirmAttendance || validSelectedAttendance.length === 0) return;
    setSaving(true);
    setScanError(null);
    try {
      const payload: ConfirmedAttendanceScanItem[] = [];
      for (const row of validSelectedAttendance) {
        const student = students.find((s) => s.id === row.matchedStudentId);
        if (!student) continue;
        payload.push({
          student,
          mark: row.mark,
          status: statusFromAttendanceMark(row.mark),
          categoryLabel: row.categoryLabel || defaultCategoryForMark(row.mark),
        });
      }
      await onConfirmAttendance(payload);
      onClose();
    } catch (error) {
      setScanError(
        error instanceof Error ? error.message : 'تعذر حفظ سجل الحضور المقروء في قاعدة البيانات.',
      );
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-xs flex items-center justify-center p-4 no-print">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4 bg-slate-50">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-teal-700 text-white flex items-center justify-center shrink-0">
              <Camera className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold font-display text-slate-900 truncate">
                {mode === 'students'
                  ? 'مسح سجل الطلاب بالكاميرا وإضافة القائمة'
                  : 'مسح سجل الغيابات بالكاميرا — سجل الفئات'}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5 truncate">
                {mode === 'students'
                  ? 'التقط صورة لقائمة أسماء الطلاب ليتم قراءتها وتوليد أرقام أكاديمية عشوائية تلقائياً'
                  : 'التقط صورة لكشف الغيابات ليتم تطبيق الرموز تلقائياً: (/) حاضر · (غ) غائب · (م) مجاز أو مستأذن بعذر'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 rounded-lg cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {mode === 'attendance' && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-4">
                <span className="font-bold text-slate-800">قاعدة الرموز المعتمدة:</span>
                <span className="inline-flex items-center gap-1.5 text-emerald-800 font-semibold">
                  <span className="w-6 h-6 rounded-md bg-emerald-100 border border-emerald-300 inline-flex items-center justify-center font-mono-num">
                    /
                  </span>
                  <span>حاضر</span>
                </span>
                <span className="inline-flex items-center gap-1.5 text-red-800 font-semibold">
                  <span className="w-6 h-6 rounded-md bg-red-100 border border-red-300 inline-flex items-center justify-center font-bold">
                    غ
                  </span>
                  <span>غائب</span>
                </span>
                <span className="inline-flex items-center gap-1.5 text-amber-800 font-semibold">
                  <span className="w-6 h-6 rounded-md bg-amber-100 border border-amber-300 inline-flex items-center justify-center font-bold">
                    م
                  </span>
                  <span>مجاز / مستأذن بعذر</span>
                </span>
              </div>
              {attendanceContext && (
                <div className="text-slate-600 font-mono-num">
                  {attendanceContext.periodLabel} · {attendanceContext.subject} · {attendanceContext.date}
                </div>
              )}
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileSelected}
            className="hidden"
          />

          {/* Camera / Preview Area */}
          {!previewUrl ? (
            <div className="space-y-3">
              <div className="relative bg-slate-900 rounded-xl overflow-hidden aspect-video max-h-[340px] flex items-center justify-center border border-slate-800">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full object-cover ${cameraActive ? 'block' : 'hidden'}`}
                />

                {cameraActive && (
                  <div className="pointer-events-none absolute inset-5 border-2 border-dashed border-white/50 rounded-xl flex items-end justify-center pb-3">
                    <span className="bg-slate-950/70 text-white text-xs px-3 py-1 rounded-md">
                      وجّه الكاميرا نحو ورقة {mode === 'students' ? 'سجل الطلاب' : 'سجل الغيابات'} بوضوح
                    </span>
                  </div>
                )}

                {cameraLoading && (
                  <div className="text-center text-slate-200 space-y-2 p-6">
                    <Loader2 className="w-7 h-7 animate-spin mx-auto text-teal-400" />
                    <p className="text-xs">جاري تشغيل الكاميرا...</p>
                  </div>
                )}

                {!cameraLoading && !cameraActive && (
                  <div className="text-center text-slate-200 space-y-3 p-6 max-w-md">
                    <Camera className="w-10 h-10 mx-auto text-slate-400" />
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {cameraError || 'الكاميرا غير مفعّلة حالياً. يمكنك تشغيلها أو اختيار صورة للسجل مباشرة.'}
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => void startCameraStream(facingMode)}
                        className="inline-flex items-center gap-2 px-3.5 py-2 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>إعادة محاولة الكاميرا</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="inline-flex items-center gap-2 px-3.5 py-2 bg-white text-slate-900 text-xs font-medium rounded-lg hover:bg-slate-100 cursor-pointer"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>التقاط / رفع صورة</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={!cameraActive || scanning}
                    onClick={() => void handleCaptureFrame()}
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-teal-700 text-white text-xs font-semibold rounded-lg hover:bg-teal-800 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <Camera className="w-4 h-4" />
                    <span>التقاط وقراءة السجل</span>
                  </button>

                  {hasMultipleCameras && cameraActive && (
                    <button
                      type="button"
                      onClick={handleToggleCamera}
                      className="inline-flex items-center gap-2 px-3.5 py-2.5 bg-slate-100 text-slate-800 text-xs font-medium rounded-lg hover:bg-slate-200 cursor-pointer"
                    >
                      <SwitchCamera className="w-4 h-4" />
                      <span>تبديل الكاميرا</span>
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-3.5 py-2.5 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-800 cursor-pointer"
                >
                  <Upload className="w-4 h-4" />
                  <span>اختيار صورة من الجهاز / كاميرا الهاتف</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Captured Photo Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3">
                <div className="flex items-center gap-3">
                  <img
                    src={previewUrl}
                    alt="صورة السجل الملتقطة"
                    className="w-20 h-14 object-cover rounded-lg border border-slate-300 shrink-0"
                  />
                  <div>
                    <p className="text-xs font-bold text-slate-900">
                      {scanning ? 'جاري قراءة السجل وتحليل البيانات...' : 'تم التقاط صورة السجل'}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {mode === 'students'
                        ? `تم استخراج ${studentRows.length} اسم طالب مع توليد الأرقام الأكاديمية عشوائياً`
                        : `تم استخراج ${attendanceRows.length} سجل حضور من الورقة`}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={scanning}
                    onClick={handleRetake}
                    className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-300 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-100 cursor-pointer disabled:opacity-50"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>التقاط صورة جديدة</span>
                  </button>
                  <button
                    type="button"
                    disabled={scanning}
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-800 cursor-pointer disabled:opacity-50"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>تغيير الصورة</span>
                  </button>
                </div>
              </div>

              {scanning && (
                <div className="bg-teal-50 border border-teal-200 rounded-xl p-6 text-center space-y-2">
                  <Loader2 className="w-7 h-7 animate-spin text-teal-700 mx-auto" />
                  <p className="text-sm font-semibold text-teal-900">
                    جاري قراءة الأسماء والرموز من الصورة بدقة...
                  </p>
                </div>
              )}

              {scanError && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3.5 flex items-start gap-2.5 text-xs text-red-800">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <span>{scanError}</span>
                </div>
              )}

              {/* Students Scan Review */}
              {!scanning && mode === 'students' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3.5">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        الصف الدراسي للمجموعة
                      </label>
                      <select
                        value={batchGrade}
                        onChange={(e) => setBatchGrade(e.target.value)}
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                      >
                        {SCHOOL_GRADES.map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        الشعبة / الفئة
                      </label>
                      <input
                        type="text"
                        value={batchSection}
                        onChange={(e) => setBatchSection(e.target.value)}
                        placeholder="أ"
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        رقم تواصل افتراضي لولي الأمر
                      </label>
                      <input
                        type="text"
                        value={batchParentPhone}
                        onChange={(e) => setBatchParentPhone(e.target.value)}
                        placeholder="07700000000"
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white font-mono-num"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-slate-700">
                      مراجعة أسماء الطلاب والأرقام الأكاديمية العشوائية ({validSelectedStudents.length} جاهز للإضافة)
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleRegenerateAllCodes}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-slate-800 text-xs font-medium rounded-lg hover:bg-slate-200 cursor-pointer"
                      >
                        <Shuffle className="w-3.5 h-3.5" />
                        <span>توليد أرقام عشوائية للجميع</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleAddBlankStudentRow}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-teal-50 text-teal-800 border border-teal-200 text-xs font-medium rounded-lg hover:bg-teal-100 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>إضافة سطر</span>
                      </button>
                    </div>
                  </div>

                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-right text-xs">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                          <tr>
                            <th className="py-2.5 px-3 w-10">اختيار</th>
                            <th className="py-2.5 px-3">اسم الطالب</th>
                            <th className="py-2.5 px-3">الرقم الأكاديمي (عشوائي)</th>
                            <th className="py-2.5 px-3">اسم ولي الأمر</th>
                            <th className="py-2.5 px-3 w-12">حذف</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {studentRows.map((row) => (
                            <tr key={row.rowId} className="hover:bg-slate-50/70">
                              <td className="py-2.5 px-3 text-center">
                                <input
                                  type="checkbox"
                                  checked={row.selected}
                                  onChange={(e) =>
                                    setStudentRows((prev) =>
                                      prev.map((r) =>
                                        r.rowId === row.rowId ? { ...r, selected: e.target.checked } : r,
                                      ),
                                    )
                                  }
                                  className="w-4 h-4 accent-teal-700 cursor-pointer"
                                />
                              </td>
                              <td className="py-2.5 px-3 min-w-[200px]">
                                <input
                                  type="text"
                                  value={row.fullName}
                                  onChange={(e) => {
                                    const nextName = e.target.value;
                                    setStudentRows((prev) =>
                                      prev.map((r) =>
                                        r.rowId === row.rowId
                                          ? {
                                              ...r,
                                              fullName: nextName,
                                              parentName:
                                                !r.parentName || r.parentName.startsWith('ولي أمر ')
                                                  ? `ولي أمر ${nextName}`
                                                  : r.parentName,
                                            }
                                          : r,
                                      ),
                                    );
                                  }}
                                  placeholder="اسم الطالب الكامل"
                                  className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                                />
                              </td>
                              <td className="py-2.5 px-3 min-w-[180px]">
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="text"
                                    value={row.studentCode}
                                    onChange={(e) =>
                                      setStudentRows((prev) =>
                                        prev.map((r) =>
                                          r.rowId === row.rowId
                                            ? { ...r, studentCode: e.target.value }
                                            : r,
                                        ),
                                      )
                                    }
                                    className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg font-mono-num"
                                  />
                                  <button
                                    type="button"
                                    title="توليد رقم عشوائي جديد"
                                    onClick={() => handleRegenerateCode(row.rowId)}
                                    className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg cursor-pointer shrink-0"
                                  >
                                    <Shuffle className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                              <td className="py-2.5 px-3 min-w-[180px]">
                                <input
                                  type="text"
                                  value={row.parentName}
                                  onChange={(e) =>
                                    setStudentRows((prev) =>
                                      prev.map((r) =>
                                        r.rowId === row.rowId ? { ...r, parentName: e.target.value } : r,
                                      ),
                                    )
                                  }
                                  placeholder="اسم ولي الأمر"
                                  className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                                />
                              </td>
                              <td className="py-2.5 px-3 text-center">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setStudentRows((prev) => prev.filter((r) => r.rowId !== row.rowId))
                                  }
                                  className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))}
                          {studentRows.length === 0 && (
                            <tr>
                              <td colSpan={5} className="py-6 text-center text-slate-500">
                                لا توجد صفوف حالياً. التقط صورة واضحة أو أضف سطراً يدوياً.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* Attendance Scan Review */}
              {!scanning && mode === 'attendance' && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-slate-700">
                      مراجعة الحضور المستخرج ({validSelectedAttendance.length} سجل مطابق وجاهز للحفظ)
                    </p>
                    <button
                      type="button"
                      onClick={handleAddBlankAttendanceRow}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-teal-50 text-teal-800 border border-teal-200 text-xs font-medium rounded-lg hover:bg-teal-100 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>إضافة طالب يدوياً</span>
                    </button>
                  </div>

                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-right text-xs">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                          <tr>
                            <th className="py-2.5 px-3 w-10">حفظ</th>
                            <th className="py-2.5 px-3">الاسم المقروء من الورقة</th>
                            <th className="py-2.5 px-3">الطالب المطابق في النظام</th>
                            <th className="py-2.5 px-3">الرمز والحالة (/ · غ · م)</th>
                            <th className="py-2.5 px-3">تصنيف الفئة</th>
                            <th className="py-2.5 px-3 w-10">حذف</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {attendanceRows.map((row) => {
                            const isUnmatched = !row.matchedStudentId;
                            return (
                              <tr key={row.rowId} className="hover:bg-slate-50/70">
                                <td className="py-2.5 px-3 text-center">
                                  <input
                                    type="checkbox"
                                    checked={row.selected}
                                    disabled={isUnmatched}
                                    onChange={(e) =>
                                      setAttendanceRows((prev) =>
                                        prev.map((r) =>
                                          r.rowId === row.rowId
                                            ? { ...r, selected: e.target.checked }
                                            : r,
                                        ),
                                      )
                                    }
                                    className="w-4 h-4 accent-teal-700 cursor-pointer disabled:opacity-40"
                                  />
                                </td>
                                <td className="py-2.5 px-3">
                                  <p className="font-semibold text-slate-900">{row.scannedName}</p>
                                  {row.note && (
                                    <p className="text-[11px] text-amber-700 mt-0.5">{row.note}</p>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 min-w-[210px]">
                                  <select
                                    value={row.matchedStudentId}
                                    onChange={(e) => {
                                      const nextId = e.target.value;
                                      setAttendanceRows((prev) =>
                                        prev.map((r) =>
                                          r.rowId === row.rowId
                                            ? {
                                                ...r,
                                                matchedStudentId: nextId,
                                                selected: Boolean(nextId),
                                              }
                                            : r,
                                        ),
                                      );
                                    }}
                                    className={`w-full px-2.5 py-1.5 text-xs border rounded-lg bg-white ${
                                      isUnmatched ? 'border-amber-400 bg-amber-50/40' : 'border-slate-300'
                                    }`}
                                  >
                                    <option value="">-- اختر الطالب المطابق --</option>
                                    {students.map((st) => (
                                      <option key={st.id} value={st.id}>
                                        {st.fullName} ({st.grade} - {st.section})
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td className="py-2.5 px-3 min-w-[230px]">
                                  <div className="inline-flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => handleChangeRowMark(row.rowId, '/')}
                                      className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer transition-colors whitespace-nowrap ${
                                        row.mark === '/'
                                          ? 'bg-emerald-700 text-white border-emerald-700'
                                          : 'bg-white text-slate-700 border-slate-200 hover:bg-emerald-50'
                                      }`}
                                    >
                                      ( / ) حاضر
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleChangeRowMark(row.rowId, 'غ')}
                                      className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer transition-colors whitespace-nowrap ${
                                        row.mark === 'غ'
                                          ? 'bg-red-700 text-white border-red-700'
                                          : 'bg-white text-slate-700 border-slate-200 hover:bg-red-50'
                                      }`}
                                    >
                                      ( غ ) غائب
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleChangeRowMark(row.rowId, 'م')}
                                      className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer transition-colors whitespace-nowrap ${
                                        row.mark === 'م'
                                          ? 'bg-amber-600 text-white border-amber-600'
                                          : 'bg-white text-slate-700 border-slate-200 hover:bg-amber-50'
                                      }`}
                                    >
                                      ( م ) مجاز/بعذر
                                    </button>
                                  </div>
                                </td>
                                <td className="py-2.5 px-3 min-w-[140px]">
                                  <select
                                    value={row.categoryLabel}
                                    onChange={(e) =>
                                      setAttendanceRows((prev) =>
                                        prev.map((r) =>
                                          r.rowId === row.rowId
                                            ? { ...r, categoryLabel: e.target.value }
                                            : r,
                                        ),
                                      )
                                    }
                                    className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                                  >
                                    {PERIOD_CATEGORY_PRESETS.map((cat) => (
                                      <option key={cat} value={cat}>
                                        {cat}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td className="py-2.5 px-3 text-center">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setAttendanceRows((prev) => prev.filter((r) => r.rowId !== row.rowId))
                                    }
                                    className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg cursor-pointer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                          {attendanceRows.length === 0 && (
                            <tr>
                              <td colSpan={6} className="py-6 text-center text-slate-500">
                                لا توجد سجلات مقروءة. التقط صورة واضحة لجدول الغيابات أو أضف سطراً يدوياً.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-100 cursor-pointer"
          >
            إغلاق
          </button>

          {previewUrl && !scanning && mode === 'students' && (
            <button
              type="button"
              disabled={saving || validSelectedStudents.length === 0}
              onClick={() => void handleSaveStudents()}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-teal-700 text-white text-xs font-semibold rounded-lg hover:bg-teal-800 cursor-pointer disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              <span>اعتماد وإضافة ({validSelectedStudents.length}) طالب للقائمة</span>
            </button>
          )}

          {previewUrl && !scanning && mode === 'attendance' && (
            <button
              type="button"
              disabled={saving || validSelectedAttendance.length === 0}
              onClick={() => void handleSaveAttendance()}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-teal-700 text-white text-xs font-semibold rounded-lg hover:bg-teal-800 cursor-pointer disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              <span>حفظ ({validSelectedAttendance.length}) سجل في الحصة</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
