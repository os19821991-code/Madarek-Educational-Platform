import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  doc,
  getDoc,
  increment,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Clock,
  Copy,
  Maximize2,
  Minimize2,
  PauseCircle,
  PlayCircle,
  QrCode,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  SwitchCamera,
  Upload,
  Users,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { mergeSchoolGrades, mergeSchoolSections, SCHOOL_GRADES } from '../lib/grades';
import {
  buildQrSessionDocId,
  decodeQrFromImageData,
  decodeQrFromImageFile,
  encodeClassQrPayload,
  encodeStudentQrPayload,
  generateQrDataUrl,
  generateQrToken,
  parseQrPayload,
} from '../lib/qrAttendanceService';
import type { AttendanceRecord, QrAttendanceSession, Student } from '../types';

interface QrAttendancePanelProps {
  students: Student[];
  attendance: AttendanceRecord[];
  qrSessions: QrAttendanceSession[];
  selectedDate: string;
  onChangeDate: (date: string) => void;
  canMarkAttendance: boolean;
  currentUid: string;
  userName: string;
  onAlertTriggered: (msg: string) => void;
}

const ROTATION_OPTIONS = [30, 45, 60, 90] as const;

export const QrAttendancePanel: React.FC<QrAttendancePanelProps> = ({
  students,
  attendance,
  qrSessions,
  selectedDate,
  onChangeDate,
  canMarkAttendance,
  currentUid,
  userName,
  onAlertTriggered,
}) => {
  const gradesList = useMemo(
    () => mergeSchoolGrades(students.map((s) => s.grade)),
    [students],
  );
  const sectionsList = useMemo(
    () => mergeSchoolSections(students.map((s) => s.section)),
    [students],
  );

  // Panel mode: Staff can switch between Generator + Scanner; Parents default to Scanner
  const [activeSubMode, setActiveSubMode] = useState<'generator' | 'scanner'>(
    canMarkAttendance ? 'generator' : 'scanner',
  );

  // Generator state
  const [selectedGrade, setSelectedGrade] = useState<string>(gradesList[0] || SCHOOL_GRADES[0]);
  const [selectedSection, setSelectedSection] = useState<string>('all');
  const [rotationSeconds, setRotationSeconds] = useState<number>(45);
  const [qrImageUrl, setQrImageUrl] = useState<string>('');
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [sessionBusy, setSessionBusy] = useState(false);
  const [fullscreenQr, setFullscreenQr] = useState(false);
  const [showStudentBadges, setShowStudentBadges] = useState(false);
  const [selectedBadgeStudentId, setSelectedBadgeStudentId] = useState<string>('');
  const [studentBadgeQrUrl, setStudentBadgeQrUrl] = useState<string>('');

  // Scanner state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scanCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastDecodedRef = useRef<{ text: string; at: number } | null>(null);

  const [scannerOpen, setScannerOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [manualCodeInput, setManualCodeInput] = useState('');
  const [processingScan, setProcessingScan] = useState(false);
  const [scanResultBanner, setScanResultBanner] = useState<{
    type: 'success' | 'error' | 'info';
    title: string;
    detail: string;
  } | null>(null);
  const [verifiedClassSession, setVerifiedClassSession] = useState<QrAttendanceSession | null>(null);
  const [monitorCheckInStudentId, setMonitorCheckInStudentId] = useState<string>('');

  useEffect(() => {
    if (!canMarkAttendance && activeSubMode === 'generator') {
      setActiveSubMode('scanner');
    }
  }, [canMarkAttendance, activeSubMode]);

  const activeSessionId = useMemo(
    () => buildQrSessionDocId(selectedDate, selectedGrade),
    [selectedDate, selectedGrade],
  );

  const activeSession = useMemo(
    () => qrSessions.find((s) => s.id === activeSessionId) || null,
    [qrSessions, activeSessionId],
  );

  const gradeStudents = useMemo(
    () =>
      students.filter(
        (s) =>
          s.grade === selectedGrade &&
          (selectedSection === 'all' || s.section === selectedSection),
      ),
    [students, selectedGrade, selectedSection],
  );

  const gradePresentToday = useMemo(() => {
    const idSet = new Set(gradeStudents.map((s) => s.id));
    return attendance.filter(
      (a) => a.date === selectedDate && a.status === 'present' && idSet.has(a.studentId),
    );
  }, [attendance, gradeStudents, selectedDate]);

  // Live 1-second clock tick for countdown display
  useEffect(() => {
    if (!activeSession?.isActive) return;
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activeSession?.isActive]);

  // Render QR image whenever activeSession token changes
  useEffect(() => {
    let cancelled = false;
    if (!activeSession || !activeSession.isActive) {
      setQrImageUrl('');
      return;
    }
    const payload = encodeClassQrPayload(activeSession.id, activeSession.token);
    void generateQrDataUrl(payload, fullscreenQr ? 420 : 320).then((url) => {
      if (!cancelled) setQrImageUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [activeSession?.id, activeSession?.token, activeSession?.isActive, fullscreenQr]);

  // Render Student QR Badge if preview opened
  useEffect(() => {
    let cancelled = false;
    const targetStudent =
      gradeStudents.find((s) => s.id === selectedBadgeStudentId) || gradeStudents[0];
    if (!showStudentBadges || !targetStudent) {
      setStudentBadgeQrUrl('');
      return;
    }
    if (!selectedBadgeStudentId && targetStudent) {
      setSelectedBadgeStudentId(targetStudent.id);
    }
    const payload = encodeStudentQrPayload(targetStudent.id, targetStudent.studentCode);
    void generateQrDataUrl(payload, 220).then((url) => {
      if (!cancelled) setStudentBadgeQrUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [showStudentBadges, selectedBadgeStudentId, gradeStudents]);

  const handleStartOrRotateSession = useCallback(
    async (targetGrade = selectedGrade, explicitRotation = rotationSeconds) => {
      if (!canMarkAttendance) return;
      const docId = buildQrSessionDocId(selectedDate, targetGrade);
      const existing = qrSessions.find((s) => s.id === docId);
      const freshToken = generateQrToken(12);
      const nextExpiresAt = Date.now() + explicitRotation * 1000;

      setSessionBusy(true);
      try {
        if (existing) {
          await updateDoc(doc(db, 'qrAttendanceSessions', docId), {
            section: selectedSection,
            token: freshToken,
            rotationSeconds: explicitRotation,
            expiresAtMs: nextExpiresAt,
            isActive: true,
            updatedAt: serverTimestamp(),
          });
        } else {
          await setDoc(doc(db, 'qrAttendanceSessions', docId), {
            grade: targetGrade,
            section: selectedSection,
            date: selectedDate,
            token: freshToken,
            rotationSeconds: explicitRotation,
            expiresAtMs: nextExpiresAt,
            isActive: true,
            scanCount: 0,
            createdByUid: currentUid,
            createdByName: userName || 'إدارة المدرسة',
            scope: 'school',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        setNowMs(Date.now());
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `qrAttendanceSessions/${docId}`);
      } finally {
        setSessionBusy(false);
      }
    },
    [
      canMarkAttendance,
      selectedGrade,
      rotationSeconds,
      selectedDate,
      qrSessions,
      selectedSection,
      currentUid,
      userName,
    ],
  );

  // Auto-rotate token when expired while session is active and generator view is open
  const rotatingRef = useRef(false);
  useEffect(() => {
    if (!canMarkAttendance || activeSubMode !== 'generator' || !activeSession?.isActive) {
      return;
    }
    if (nowMs >= activeSession.expiresAtMs && !rotatingRef.current) {
      rotatingRef.current = true;
      void handleStartOrRotateSession(
        activeSession.grade,
        activeSession.rotationSeconds || rotationSeconds,
      ).finally(() => {
        rotatingRef.current = false;
      });
    }
  }, [
    canMarkAttendance,
    activeSubMode,
    activeSession,
    nowMs,
    rotationSeconds,
    handleStartOrRotateSession,
  ]);

  const handleToggleSessionPause = async () => {
    if (!canMarkAttendance || !activeSession) return;
    setSessionBusy(true);
    try {
      const nextActive = !activeSession.isActive;
      await updateDoc(doc(db, 'qrAttendanceSessions', activeSession.id), {
        isActive: nextActive,
        ...(nextActive
          ? {
              token: generateQrToken(12),
              expiresAtMs: Date.now() + (activeSession.rotationSeconds || rotationSeconds) * 1000,
            }
          : {}),
        updatedAt: serverTimestamp(),
      });
      onAlertTriggered(
        nextActive
          ? `تم تفعيل رمز QR المتغير لصف (${activeSession.grade}).`
          : `تم إيقاف استقبال الحضور عبر QR لصف (${activeSession.grade}).`,
      );
    } catch (error) {
      handleFirestoreError(
        error,
        OperationType.UPDATE,
        `qrAttendanceSessions/${activeSession.id}`,
      );
    } finally {
      setSessionBusy(false);
    }
  };

  const remainingSeconds = useMemo(() => {
    if (!activeSession?.isActive) return 0;
    return Math.max(0, Math.ceil((activeSession.expiresAtMs - nowMs) / 1000));
  }, [activeSession, nowMs]);

  const rotationProgressPct = useMemo(() => {
    if (!activeSession?.isActive || !activeSession.rotationSeconds) return 0;
    return Math.min(
      100,
      Math.max(0, Math.round((remainingSeconds / activeSession.rotationSeconds) * 100)),
    );
  }, [activeSession, remainingSeconds]);

  // Write attendance record in Firestore (for either parent self-check-in or monitor check-in)
  const recordStudentPresentViaQr = useCallback(
    async (student: Student, session?: QrAttendanceSession) => {
      const targetDate = session?.date || selectedDate;
      const recordId = `att_${student.id}_${targetDate}`;
      const existingAtt = attendance.find(
        (a) => a.studentId === student.id && a.date === targetDate,
      );
      const timeStr = new Date().toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
      });
      const noteText = session
        ? `تسجيل حضور آلي عبر رمز QR المتغير (${timeStr})`
        : `تسجيل حضور عبر بطاقة QR الطالب (${timeStr})`;

      const batch = writeBatch(db);
      if (existingAtt) {
        batch.update(doc(db, 'attendance', recordId), {
          status: 'present',
          checkInTime: timeStr,
          notes: noteText,
          ...(session ? { qrSessionId: session.id } : {}),
          updatedAt: serverTimestamp(),
        });
      } else {
        batch.set(doc(db, 'attendance', recordId), {
          studentId: student.id,
          studentName: student.fullName,
          grade: student.grade,
          parentUid: student.parentUid,
          date: targetDate,
          status: 'present',
          checkInTime: timeStr,
          parentNotified: true,
          notes: noteText,
          ...(session ? { qrSessionId: session.id } : {}),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      if (session) {
        batch.update(doc(db, 'qrAttendanceSessions', session.id), {
          scanCount: increment(1),
          updatedAt: serverTimestamp(),
        });
      }

      try {
        await batch.commit();
        return timeStr;
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `attendance/${recordId}`);
      }
    },
    [attendance, selectedDate],
  );

  // Stop QR camera loop
  const stopQrCamera = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setScannerOpen(false);
  }, []);

  const handleProcessDecodedQr = useCallback(
    async (rawQrText: string) => {
      if (processingScan) return;
      const parsed = parseQrPayload(rawQrText);
      if (!parsed) {
        setScanResultBanner({
          type: 'error',
          title: 'رمز QR غير تابع للمنصة',
          detail: 'تأكد من مسح رمز QR الخاص بالصف الدراسي أو بطاقة الطالب الصادرة من نظام مدارك.',
        });
        return;
      }

      setProcessingScan(true);
      setVerifiedClassSession(null);

      try {
        if (parsed.kind === 'student') {
          if (!canMarkAttendance) {
            setScanResultBanner({
              type: 'error',
              title: 'صلاحية المراقب مطلوبة',
              detail: 'مسح بطاقات الطلاب متاح للمراقبين والمعلمين. يرجى مسح رمز QR المتغير الخاص بالصف.',
            });
            return;
          }

          const matchedStudent = students.find(
            (s) => s.id === parsed.studentId || s.studentCode === parsed.studentCode,
          );
          if (!matchedStudent) {
            setScanResultBanner({
              type: 'error',
              title: 'لم يتم العثور على الطالب',
              detail: `الرمز الأكاديمي (${parsed.studentCode}) غير مطابق لأي طالب مسجل حالياً.`,
            });
            return;
          }

          const checkInTime = await recordStudentPresentViaQr(matchedStudent);
          setScanResultBanner({
            type: 'success',
            title: `تم تسجيل حضور ${matchedStudent.fullName}`,
            detail: `الصف: ${matchedStudent.grade} (${matchedStudent.section}) · وقت التسجيل: ${checkInTime}`,
          });
          onAlertTriggered(`تم تسجيل حضور ${matchedStudent.fullName} عبر رمز QR بنجاح.`);
          return;
        }

        // parsed.kind === 'class'
        const sessionSnap = await getDoc(doc(db, 'qrAttendanceSessions', parsed.sessionId));
        if (!sessionSnap.exists()) {
          setScanResultBanner({
            type: 'error',
            title: 'جلسة QR غير موجودة',
            detail: 'تعذر العثور على جلسة الحضور المطابقة لهذا الرمز.',
          });
          return;
        }

        const sessionData = {
          id: sessionSnap.id,
          ...(sessionSnap.data() as Omit<QrAttendanceSession, 'id'>),
        };

        if (!sessionData.isActive) {
          setScanResultBanner({
            type: 'error',
            title: `جلسة ${sessionData.grade} متوقفة`,
            detail: 'تم إيقاف استقبال الحضور لهذا الصف من قِبل المراقب أو الإدارة.',
          });
          return;
        }

        if (sessionData.token !== parsed.token) {
          setScanResultBanner({
            type: 'error',
            title: 'رمز QR قديم أو مستبدل',
            detail: 'تغيّر رمز الصف تلقائياً. يرجى مسح الرمز الأحدث الظاهر الآن على شاشة الصف.',
          });
          return;
        }

        if (Date.now() > sessionData.expiresAtMs + 8000) {
          setScanResultBanner({
            type: 'error',
            title: 'انتهت صلاحية رمز QR المتغير',
            detail: 'يرجى الانتظار لثوانٍ حتى يتجدد الرمز على شاشة الصف ثم إعادة المسح.',
          });
          return;
        }

        // Valid live class session!
        const eligibleStudents = students.filter(
          (s) =>
            s.grade === sessionData.grade &&
            (sessionData.section === 'all' || s.section === sessionData.section) &&
            (canMarkAttendance || s.parentUid === currentUid),
        );

        if (!canMarkAttendance) {
          // Student / Parent self check-in
          if (eligibleStudents.length === 0) {
            setScanResultBanner({
              type: 'error',
              title: 'لا يوجد طالب مرتبط بهذا الصف',
              detail: `حسابك غير مرتبط بطالب مسجل في (${sessionData.grade}) ليتم تحضيره تلقائياً.`,
            });
            return;
          }

          if (eligibleStudents.length === 1) {
            const targetStudent = eligibleStudents[0];
            const checkInTime = await recordStudentPresentViaQr(targetStudent, sessionData);
            setScanResultBanner({
              type: 'success',
              title: `تم تسجيل حضورك بنجاح — ${targetStudent.fullName}`,
              detail: `${sessionData.grade} · التاريخ: ${sessionData.date} · الساعة ${checkInTime}`,
            });
            onAlertTriggered(
              `تم تسجيل حضور ${targetStudent.fullName} آلياً عبر مسح رمز QR للصف (${sessionData.grade}).`,
            );
            return;
          }

          // Multiple students in the same grade under this parent account -> show picker
          setVerifiedClassSession(sessionData);
          setMonitorCheckInStudentId(eligibleStudents[0]?.id || '');
          setScanResultBanner({
            type: 'info',
            title: `تم التحقق من رمز ${sessionData.grade}`,
            detail: 'يوجد أكثر من طالب مرتبط بحسابك في هذا الصف، اختر الطالب لتأكيد حضوره.',
          });
          return;
        }

        // Staff / Monitor scanned Class QR -> show quick check-in selector for this grade
        setVerifiedClassSession(sessionData);
        const firstUnmarked = eligibleStudents.find(
          (s) =>
            !attendance.some(
              (a) => a.studentId === s.id && a.date === sessionData.date && a.status === 'present',
            ),
        );
        setMonitorCheckInStudentId((firstUnmarked || eligibleStudents[0])?.id || '');
        setScanResultBanner({
          type: 'info',
          title: `تم التحقق من رمز QR النشط لصف ${sessionData.grade}`,
          detail: `الرمز صالح لتاريخ ${sessionData.date}. اختر الطالب لتسجيل حضوره فوراً أو واصل المسح.`,
        });
      } catch (error) {
        setScanResultBanner({
          type: 'error',
          title: 'تعذر إتمام تسجيل الحضور',
          detail: error instanceof Error ? error.message : 'حدث خطأ أثناء التحقق من رمز QR.',
        });
      } finally {
        setProcessingScan(false);
      }
    },
    [
      processingScan,
      canMarkAttendance,
      students,
      recordStudentPresentViaQr,
      onAlertTriggered,
      currentUid,
      attendance,
    ],
  );

  // Start live camera QR detection loop
  const startQrCamera = useCallback(
    async (preferredFacing: 'environment' | 'user' = facingMode) => {
      stopQrCamera();
      setCameraError(null);

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError(
          'المتصفح لا يدعم تشغيل الكاميرا مباشرة. يمكنك رفع صورة رمز QR أو لصق الرمز النصي أدناه.',
        );
        return;
      }

      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: preferredFacing },
              width: { ideal: 1280 },
              height: { ideal: 720 },
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
        setScannerOpen(true);

        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        setHasMultipleCameras(devices.filter((d) => d.kind === 'videoinput').length > 1);

        const tick = () => {
          const video = videoRef.current;
          const canvas = scanCanvasRef.current;
          if (video && canvas && video.readyState >= 2 && video.videoWidth > 0) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const decoded = decodeQrFromImageData(imgData);
              if (decoded) {
                const now = Date.now();
                const isRecentSame =
                  lastDecodedRef.current &&
                  lastDecodedRef.current.text === decoded &&
                  now - lastDecodedRef.current.at < 3500;
                if (!isRecentSame) {
                  lastDecodedRef.current = { text: decoded, at: now };
                  void handleProcessDecodedQr(decoded);
                }
              }
            }
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch {
        setCameraError(
          'تعذر فتح الكاميرا (قد تكون الصلاحية مرفوضة). يمكنك رفع صورة لرمز QR أو استخدام خيار الرمز المباشر أدناه.',
        );
      }
    },
    [facingMode, stopQrCamera, handleProcessDecodedQr],
  );

  useEffect(() => {
    return () => {
      stopQrCamera();
    };
  }, [stopQrCamera]);

  useEffect(() => {
    if (activeSubMode !== 'scanner') {
      stopQrCamera();
    }
  }, [activeSubMode, stopQrCamera]);

  const handleQrImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setScanResultBanner(null);
    const decoded = await decodeQrFromImageFile(file);
    if (!decoded) {
      setScanResultBanner({
        type: 'error',
        title: 'لم يتم اكتشاف رمز QR في الصورة',
        detail: 'تأكد من أن الصورة تحتوي على رمز QR واضح وغير مقطوع.',
      });
      return;
    }
    await handleProcessDecodedQr(decoded);
  };

  const handleConfirmVerifiedClassStudent = async () => {
    if (!verifiedClassSession || !monitorCheckInStudentId) return;
    const student = students.find((s) => s.id === monitorCheckInStudentId);
    if (!student) return;
    setProcessingScan(true);
    try {
      const checkInTime = await recordStudentPresentViaQr(student, verifiedClassSession);
      setScanResultBanner({
        type: 'success',
        title: `تم تسجيل حضور ${student.fullName}`,
        detail: `${verifiedClassSession.grade} · الساعة ${checkInTime}`,
      });
      onAlertTriggered(`تم تسجيل حضور ${student.fullName} عبر رمز QR بنجاح.`);
    } finally {
      setProcessingScan(false);
    }
  };

  const activeSchoolSessionsToday = useMemo(
    () =>
      qrSessions.filter((s) => s.date === selectedDate && s.isActive && Date.now() <= s.expiresAtMs + 8000),
    [qrSessions, selectedDate, nowMs],
  );

  const verifiedEligibleStudents = useMemo(() => {
    if (!verifiedClassSession) return [];
    return students.filter(
      (s) =>
        s.grade === verifiedClassSession.grade &&
        (verifiedClassSession.section === 'all' || s.section === verifiedClassSession.section) &&
        (canMarkAttendance || s.parentUid === currentUid),
    );
  }, [verifiedClassSession, students, canMarkAttendance, currentUid]);

  return (
    <div className="space-y-6 no-print">
      {/* Top Sub-Navigation & Date Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-bold font-display text-slate-900 flex items-center gap-2">
            <QrCode className="w-5 h-5 text-teal-700 shrink-0" />
            <span>نظام رموز QR المتغيرة لتسجيل الحضور اليومي</span>
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            توليد رمز QR متغير تلقائياً لكل صف دراسي لمنع التكرار، مع ماسح فوري للطلاب والمراقبين لتسجيل الحضور آلياً
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => onChangeDate(e.target.value)}
            className="px-3 py-2 text-xs border border-slate-200 rounded-lg font-mono-num bg-white"
          />

          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {canMarkAttendance && (
              <button
                type="button"
                onClick={() => setActiveSubMode('generator')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeSubMode === 'generator'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <QrCode className="w-3.5 h-3.5" />
                <span>توليد QR للصفوف</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setActiveSubMode('scanner')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeSubMode === 'scanner'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ScanLine className="w-3.5 h-3.5" />
              <span>مسح QR للحضور</span>
            </button>
          </div>
        </div>
      </div>

      {/* GENERATOR VIEW (Staff / Monitors / Admins) */}
      {activeSubMode === 'generator' && canMarkAttendance && (
        <div className="space-y-6">
          {/* Controls Card */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">الصف الدراسي</label>
              <select
                value={selectedGrade}
                onChange={(e) => setSelectedGrade(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                {gradesList.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">الشعبة / الفئة</label>
              <select
                value={selectedSection}
                onChange={(e) => setSelectedSection(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="all">جميع شعب الصف</option>
                {sectionsList.map((sec) => (
                  <option key={sec} value={sec}>
                    الفئة ({sec})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                مدة تغيّر الرمز التلقائي
              </label>
              <select
                value={rotationSeconds}
                onChange={(e) => setRotationSeconds(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white font-mono-num"
              >
                {ROTATION_OPTIONS.map((sec) => (
                  <option key={sec} value={sec}>
                    كل {sec} ثانية
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <button
                type="button"
                disabled={sessionBusy}
                onClick={() => void handleStartOrRotateSession()}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-teal-700 text-white text-xs font-semibold rounded-lg hover:bg-teal-800 transition-colors whitespace-nowrap cursor-pointer disabled:opacity-60"
              >
                <RefreshCw className={`w-4 h-4 ${sessionBusy ? 'animate-spin' : ''}`} />
                <span>{activeSession?.isActive ? 'تحديث الرمز الآن' : 'توليد وتفعيل QR'}</span>
              </button>
              {activeSession && (
                <button
                  type="button"
                  disabled={sessionBusy}
                  onClick={() => void handleToggleSessionPause()}
                  title={activeSession.isActive ? 'إيقاف الجلسة' : 'إعادة تفعيل الجلسة'}
                  className={`p-2 rounded-lg border cursor-pointer ${
                    activeSession.isActive
                      ? 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                      : 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                  }`}
                >
                  {activeSession.isActive ? (
                    <PauseCircle className="w-4 h-4" />
                  ) : (
                    <PlayCircle className="w-4 h-4" />
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Active Rotating QR Display + Live Check-In Monitor */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 flex flex-col items-center text-center space-y-4">
              <div className="w-full flex items-center justify-between gap-2">
                <div className="text-right">
                  <p className="text-sm font-bold text-slate-900">{selectedGrade}</p>
                  <p className="text-xs text-slate-500 font-mono-num">
                    {selectedSection === 'all' ? 'جميع الشعب' : `الفئة (${selectedSection})`} · {selectedDate}
                  </p>
                </div>
                {activeSession?.isActive && (
                  <button
                    type="button"
                    onClick={() => setFullscreenQr(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-slate-800 text-xs font-medium rounded-lg hover:bg-slate-200 cursor-pointer"
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                    <span>عرض شاشة الصف</span>
                  </button>
                )}
              </div>

              {activeSession?.isActive && qrImageUrl ? (
                <>
                  <div className="p-4 bg-white border-2 border-teal-700/20 rounded-2xl shadow-sm">
                    <img
                      src={qrImageUrl}
                      alt={`رمز QR حضور ${selectedGrade}`}
                      className="w-60 h-60 object-contain"
                    />
                  </div>

                  {/* Countdown Progress */}
                  <div className="w-full space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-600 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-teal-700" />
                        <span>يتجدد الرمز تلقائياً خلال</span>
                      </span>
                      <span className="font-bold font-mono-num text-teal-800">
                        {remainingSeconds} ثانية
                      </span>
                    </div>
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-teal-700 transition-all duration-500"
                        style={{ width: `${rotationProgressPct}%` }}
                      />
                    </div>
                  </div>

                  {/* Token Display & Copy */}
                  <div className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
                    <div className="text-right min-w-0">
                      <span className="text-[11px] text-slate-500 block">رمز الجلسة المتغير</span>
                      <span className="text-xs font-bold font-mono-num text-slate-900 truncate block">
                        {activeSession.token}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const payload = encodeClassQrPayload(activeSession.id, activeSession.token);
                        void navigator.clipboard?.writeText(payload);
                        onAlertTriggered('تم نسخ رمز QR المتغير للجلسة الحالية.');
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white border border-slate-300 text-slate-700 text-xs font-medium rounded-md hover:bg-slate-100 cursor-pointer shrink-0"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>نسخ الرمز</span>
                    </button>
                  </div>
                </>
              ) : (
                <div className="py-12 px-4 space-y-3 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                    <QrCode className="w-8 h-8" />
                  </div>
                  <p className="text-sm font-semibold text-slate-800">
                    لم يتم تفعيل رمز QR لصف ({selectedGrade}) اليوم
                  </p>
                  <p className="text-xs text-slate-500 max-w-xs mx-auto">
                    اضغط على زر التوليد لإنشاء رمز QR متغير يمسحه الطلاب أو المراقبون لتسجيل الحضور آلياً.
                  </p>
                  <button
                    type="button"
                    disabled={sessionBusy}
                    onClick={() => void handleStartOrRotateSession()}
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-teal-700 text-white text-xs font-semibold rounded-lg hover:bg-teal-800 cursor-pointer"
                  >
                    <QrCode className="w-4 h-4" />
                    <span>توليد رمز QR للصف الآن</span>
                  </button>
                </div>
              )}
            </div>

            {/* Live Attendance Feed for Grade + Student QR Cards */}
            <div className="lg:col-span-7 space-y-4">
              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <Users className="w-4 h-4 text-teal-700" />
                      <span>الحضور المسجل لصف ({selectedGrade}) — {selectedDate}</span>
                    </h4>
                    <p className="text-xs text-slate-500 mt-0.5">
                      حضور اليوم: <strong className="font-mono-num text-emerald-700">{gradePresentToday.length}</strong> من أصل{' '}
                      <strong className="font-mono-num text-slate-900">{gradeStudents.length}</strong> طالب · عمليات مسح QR:{' '}
                      <strong className="font-mono-num text-teal-800">{activeSession?.scanCount ?? 0}</strong>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowStudentBadges((v) => !v)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-slate-800 text-xs font-medium rounded-lg hover:bg-slate-200 cursor-pointer"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                    <span>{showStudentBadges ? 'إخفاء بطاقات الطلاب' : 'بطاقة QR للطالب'}</span>
                  </button>
                </div>

                {showStudentBadges && gradeStudents.length > 0 && (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row items-center gap-4">
                    {studentBadgeQrUrl && (
                      <img
                        src={studentBadgeQrUrl}
                        alt="بطاقة QR الطالب"
                        className="w-32 h-32 bg-white p-2 rounded-xl border border-slate-200 shrink-0"
                      />
                    )}
                    <div className="flex-1 w-full space-y-2">
                      <label className="block text-xs font-semibold text-slate-700">
                        اختر طالباً لعرض رمز بطاقته الشخصية (لمسحه من قِبل المراقب):
                      </label>
                      <select
                        value={selectedBadgeStudentId}
                        onChange={(e) => setSelectedBadgeStudentId(e.target.value)}
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                      >
                        {gradeStudents.map((st) => (
                          <option key={st.id} value={st.id}>
                            {st.fullName} ({st.studentCode})
                          </option>
                        ))}
                      </select>
                      <p className="text-[11px] text-slate-500">
                        يمكن للمراقب مسح بطاقة QR الطالب أو رمز الصف المتغير مباشرة من تبويب «مسح QR للحضور».
                      </p>
                    </div>
                  </div>
                )}

                <div className="max-h-[260px] overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-lg">
                  {gradeStudents.map((st) => {
                    const rec = attendance.find(
                      (a) => a.studentId === st.id && a.date === selectedDate,
                    );
                    const isPresent = rec?.status === 'present';
                    return (
                      <div
                        key={st.id}
                        className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs hover:bg-slate-50"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 truncate">{st.fullName}</p>
                          <p className="text-[11px] text-slate-500 font-mono-num">
                            {st.studentCode} · الفئة ({st.section})
                          </p>
                        </div>
                        {isPresent ? (
                          <span className="inline-flex items-center gap-1.5 text-emerald-700 font-semibold shrink-0">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>حاضر</span>
                            <span className="font-mono-num text-[11px] text-slate-500">
                              ({rec?.checkInTime || '--:--'})
                            </span>
                          </span>
                        ) : (
                          <span className="text-slate-400 shrink-0">بانتظار المسح</span>
                        )}
                      </div>
                    );
                  })}
                  {gradeStudents.length === 0 && (
                    <p className="py-8 text-center text-xs text-slate-500">
                      لا يوجد طلاب مسجلون ضمن هذا الصف حالياً.
                    </p>
                  )}
                </div>
              </div>

              {/* Quick All-Grades Grid */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                <h4 className="text-xs font-bold text-slate-700">حالة رموز QR لجميع الصفوف اليوم ({selectedDate})</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {gradesList.map((g) => {
                    const sId = buildQrSessionDocId(selectedDate, g);
                    const sess = qrSessions.find((x) => x.id === sId);
                    const isLive = Boolean(sess?.isActive);
                    const isSelected = g === selectedGrade;
                    return (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setSelectedGrade(g)}
                        className={`text-right p-3 rounded-lg border transition-colors cursor-pointer ${
                          isSelected
                            ? 'border-teal-700 bg-teal-50/70'
                            : 'border-slate-200 bg-slate-50/50 hover:bg-slate-100/70'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-slate-900 truncate">{g}</span>
                          <span
                            className={`text-[11px] font-semibold shrink-0 ${
                              isLive ? 'text-emerald-700' : 'text-slate-400'
                            }`}
                          >
                            {isLive ? 'نشط' : 'متوقف'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 font-mono-num mt-1">
                          مسح QR: {sess?.scanCount ?? 0}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SCANNER VIEW (Students/Parents + Monitors/Staff) */}
      {activeSubMode === 'scanner' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <ScanLine className="w-4 h-4 text-teal-700" />
                  <span>ماسح رمز QR المباشر لتسجيل الحضور</span>
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  وجّه الكاميرا نحو رمز QR المتغير للصف (أو بطاقة الطالب للمراقب) ليتم التحضير آلياً فوراً
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {!scannerOpen ? (
                  <button
                    type="button"
                    onClick={() => void startQrCamera(facingMode)}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-teal-700 text-white text-xs font-semibold rounded-lg hover:bg-teal-800 cursor-pointer"
                  >
                    <Camera className="w-4 h-4" />
                    <span>تشغيل كاميرا المسح</span>
                  </button>
                ) : (
                  <>
                    {hasMultipleCameras && (
                      <button
                        type="button"
                        onClick={() => {
                          const next = facingMode === 'environment' ? 'user' : 'environment';
                          setFacingMode(next);
                          void startQrCamera(next);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-100 text-slate-800 text-xs font-medium rounded-lg hover:bg-slate-200 cursor-pointer"
                      >
                        <SwitchCamera className="w-4 h-4" />
                        <span>تبديل</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={stopQrCamera}
                      className="inline-flex items-center gap-1.5 px-3 py-2 bg-red-50 text-red-700 border border-red-200 text-xs font-medium rounded-lg hover:bg-red-100 cursor-pointer"
                    >
                      <span>إيقاف الكاميرا</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="relative bg-slate-900 rounded-xl overflow-hidden aspect-video max-h-[330px] flex items-center justify-center border border-slate-800">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover ${scannerOpen ? 'block' : 'hidden'}`}
              />
              <canvas ref={scanCanvasRef} className="hidden" />

              {scannerOpen && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="w-48 h-48 border-2 border-teal-400 rounded-2xl shadow-[0_0_0_9999px_rgba(2,6,23,0.45)] flex items-end justify-center pb-2">
                    <span className="text-[11px] text-white bg-slate-950/75 px-2.5 py-0.5 rounded">
                      ضع رمز QR داخل الإطار
                    </span>
                  </div>
                </div>
              )}

              {!scannerOpen && (
                <div className="text-center text-slate-200 p-6 space-y-3 max-w-md">
                  <QrCode className="w-12 h-12 mx-auto text-teal-400" />
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {cameraError ||
                      'اضغط على «تشغيل كاميرا المسح» لقراءة رمز QR مباشرة، أو ارفع صورة رمز QR من جهازك.'}
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => void startQrCamera(facingMode)}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-teal-700 text-white text-xs font-semibold rounded-lg hover:bg-teal-800 cursor-pointer"
                    >
                      <Camera className="w-4 h-4" />
                      <span>فتح الكاميرا</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-white text-slate-900 text-xs font-semibold rounded-lg hover:bg-slate-100 cursor-pointer"
                    >
                      <Upload className="w-4 h-4" />
                      <span>رفع صورة QR</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleQrImageUpload}
              className="hidden"
            />

            {/* Upload or Paste Fallback */}
            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <input
                type="text"
                value={manualCodeInput}
                onChange={(e) => setManualCodeInput(e.target.value)}
                placeholder="أو الصق رمز QR النصي (MADARIK_QR:...) للتحقق الفوري"
                className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-lg font-mono-num"
              />
              <button
                type="button"
                disabled={processingScan || !manualCodeInput.trim()}
                onClick={() => void handleProcessDecodedQr(manualCodeInput)}
                className="px-4 py-2 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-800 cursor-pointer disabled:opacity-50 whitespace-nowrap"
              >
                تحقق وتسجيل
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-slate-100 text-slate-800 text-xs font-medium rounded-lg hover:bg-slate-200 cursor-pointer whitespace-nowrap"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>صورة QR</span>
              </button>
            </div>
          </div>

          {/* Scan Verification Status & Active Sessions List */}
          <div className="lg:col-span-5 space-y-4">
            {scanResultBanner && (
              <div
                className={`rounded-xl border p-4 flex items-start gap-3 ${
                  scanResultBanner.type === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : scanResultBanner.type === 'error'
                      ? 'bg-red-50 border-red-200 text-red-900'
                      : 'bg-teal-50 border-teal-200 text-teal-900'
                }`}
              >
                {scanResultBanner.type === 'success' ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
                ) : scanResultBanner.type === 'error' ? (
                  <AlertCircle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
                ) : (
                  <ShieldCheck className="w-5 h-5 text-teal-700 shrink-0 mt-0.5" />
                )}
                <div className="space-y-1">
                  <p className="text-sm font-bold">{scanResultBanner.title}</p>
                  <p className="text-xs opacity-90">{scanResultBanner.detail}</p>
                </div>
              </div>
            )}

            {/* If Class QR was verified and user needs to pick student (Monitor or Multi-child Parent) */}
            {verifiedClassSession && (
              <div className="bg-white border border-teal-300 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h5 className="text-xs font-bold text-slate-900">
                    تأكيد حضور طالب في ({verifiedClassSession.grade})
                  </h5>
                  <span className="text-[11px] font-mono-num text-teal-700">
                    {verifiedClassSession.date}
                  </span>
                </div>
                {verifiedEligibleStudents.length > 0 ? (
                  <>
                    <select
                      value={monitorCheckInStudentId}
                      onChange={(e) => setMonitorCheckInStudentId(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                    >
                      {verifiedEligibleStudents.map((st) => {
                        const already = attendance.some(
                          (a) =>
                            a.studentId === st.id &&
                            a.date === verifiedClassSession.date &&
                            a.status === 'present',
                        );
                        return (
                          <option key={st.id} value={st.id}>
                            {st.fullName} ({st.studentCode}) {already ? '— مسجل حاضر' : ''}
                          </option>
                        );
                      })}
                    </select>
                    <button
                      type="button"
                      disabled={processingScan || !monitorCheckInStudentId}
                      onClick={() => void handleConfirmVerifiedClassStudent()}
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-teal-700 text-white text-xs font-semibold rounded-lg hover:bg-teal-800 cursor-pointer disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>تسجيل حضور الطالب الآن</span>
                    </button>
                  </>
                ) : (
                  <p className="text-xs text-slate-500">
                    لا يوجد طلاب مطابقون لهذا الصف ضمن نطاق حسابك الحالي.
                  </p>
                )}
              </div>
            )}

            {/* Active Sessions Info */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <h4 className="text-xs font-bold text-slate-800">
                الصفوف المفعّل لها رمز QR متغير اليوم ({selectedDate})
              </h4>
              {activeSchoolSessionsToday.length > 0 ? (
                <div className="space-y-2">
                  {activeSchoolSessionsToday.map((sess) => (
                    <div
                      key={sess.id}
                      className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between gap-2 text-xs"
                    >
                      <div>
                        <p className="font-bold text-slate-900">{sess.grade}</p>
                        <p className="text-[11px] text-slate-500 font-mono-num">
                          المشرف: {sess.createdByName} · عمليات مسح: {sess.scanCount}
                        </p>
                      </div>
                      <span className="text-[11px] font-semibold text-emerald-700">نشط الآن</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500 py-4 text-center">
                  لا توجد جلسات QR نشطة حالياً لهذا التاريخ. يمكن للمراقب أو الإدارة تفعيل رمز الصف من تبويب «توليد QR للصفوف».
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Fullscreen Projector Modal for Classroom QR */}
      {fullscreenQr && activeSession?.isActive && qrImageUrl && (
        <div className="fixed inset-0 z-50 bg-slate-950/95 text-white flex flex-col items-center justify-center p-6">
          <button
            type="button"
            onClick={() => setFullscreenQr(false)}
            className="absolute top-5 left-5 inline-flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-xs font-medium rounded-lg cursor-pointer"
          >
            <Minimize2 className="w-4 h-4" />
            <span>إغلاق العرض الكامل</span>
          </button>

          <div className="text-center space-y-3 mb-6">
            <p className="text-xs uppercase tracking-wider text-teal-400 font-semibold">
              تسجيل الحضور اليومي بالرمز المتغير
            </p>
            <h2 className="text-2xl lg:text-3xl font-bold font-display">{selectedGrade}</h2>
            <p className="text-sm text-slate-300 font-mono-num">
              {selectedSection === 'all' ? 'جميع الشعب' : `الفئة (${selectedSection})`} · {selectedDate}
            </p>
          </div>

          <div className="p-6 bg-white rounded-3xl shadow-2xl">
            <img
              src={qrImageUrl}
              alt={`رمز QR شاشة ${selectedGrade}`}
              className="w-80 h-80 sm:w-96 sm:h-96 object-contain"
            />
          </div>

          <div className="mt-6 w-full max-w-sm space-y-2 text-center">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-300">يتغيّر الرمز خلال</span>
              <span className="font-bold font-mono-num text-teal-400">{remainingSeconds} ثانية</span>
            </div>
            <div className="w-full h-2.5 bg-white/15 rounded-full overflow-hidden">
              <div
                className="h-full bg-teal-400 transition-all duration-500"
                style={{ width: `${rotationProgressPct}%` }}
              />
            </div>
            <p className="text-xs text-slate-400 font-mono-num pt-1">
              تم تسجيل حضور {gradePresentToday.length} من {gradeStudents.length} طالب
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
