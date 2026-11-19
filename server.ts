import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import express from 'express';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

type ScanMode = 'attendance' | 'students';

interface ScanRegisterBody {
  mode?: ScanMode;
  imageBase64?: string;
  mimeType?: string;
  knownStudentNames?: string[];
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY_MISSING');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function sanitizeScannedMark(raw: unknown): '/' | 'غ' | 'م' {
  const text = String(raw ?? '').trim();
  if (text.includes('غ') || /absent|غائب/i.test(text)) return 'غ';
  if (text.includes('م') || /excused|مجاز|مستأذن|معذور/i.test(text)) return 'م';
  return '/';
}

function statusFromMark(mark: '/' | 'غ' | 'م'): 'present' | 'absent' | 'excused' {
  if (mark === 'غ') return 'absent';
  if (mark === 'م') return 'excused';
  return 'present';
}

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '15mb' }));

  app.post('/api/scan-register', async (req, res) => {
    try {
      const body = (req.body || {}) as ScanRegisterBody;
      const mode = body.mode;
      const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64.trim() : '';
      const mimeType =
        typeof body.mimeType === 'string' && body.mimeType.startsWith('image/')
          ? body.mimeType
          : 'image/jpeg';
      const knownStudentNames = Array.isArray(body.knownStudentNames)
        ? body.knownStudentNames
            .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
            .slice(0, 120)
        : [];

      if (mode !== 'attendance' && mode !== 'students') {
        res.status(400).json({ error: 'نوع المسح غير صالح. استخدم attendance أو students.' });
        return;
      }

      if (!imageBase64) {
        res.status(400).json({ error: 'لم يتم استلام بيانات الصورة لتحليلها.' });
        return;
      }

      const ai = getGeminiClient();

      if (mode === 'attendance') {
        const knownListText =
          knownStudentNames.length > 0
            ? `\nقائمة مرجعية لأسماء الطلاب المسجلين في النظام (استفد منها فقط لتحسين دقة قراءة الخط اليدوي للأسماء الظاهرة فعلياً في الورقة، ولا تضف أسماء غير موجودة في الصورة):\n${knownStudentNames.map((n, idx) => `${idx + 1}. ${n}`).join('\n')}`
            : '';

        const prompt = `أنت مساعد إدخال بيانات مدرسي متخصص في قراءة سجل الغيابات والحضور العربي (المطبوع أو المكتوب بخط اليد).
افحص الصورة بعناية واستخرج كل صف طالب ظاهر في سجل الغيابات، ثم حدد رمز الحضور المكتوب أمام اسم الطالب بدقة وفق القاعدة الصارمة التالية:
1. إذا كان الحرف أو العلامة (/) أو خط مائل أو علامة صح (✓): يكون الرمز "/" والحالة "present" (حاضر).
2. إذا كان الحرف (غ) أو كلمة غائب/غا: يكون الرمز "غ" والحالة "absent" (غائب).
3. إذا كان الحرف (م) أو كلمة مجاز/مستأذن/معذور: يكون الرمز "م" والحالة "excused" (مجاز أو مستأذن بعذر).

ملاحظات مهمة:
- لا تخترع طلاباً غير ظاهرين في الصورة.
- إذا كانت العلامة غير واضحة تماماً، اختر أقرب رمز من ("/" أو "غ" أو "م") واكتب ملاحظة قصيرة بالعربية في حقل note.
- أرجع النتيجة بصيغة JSON مطابقة للمخطط فقط.${knownListText}`;

        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: [
            {
              inlineData: {
                mimeType,
                data: imageBase64,
              },
            },
            { text: prompt },
          ],
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                entries: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      studentName: { type: Type.STRING },
                      rawMark: { type: Type.STRING },
                      status: {
                        type: Type.STRING,
                        enum: ['present', 'absent', 'excused'],
                      },
                      note: { type: Type.STRING },
                    },
                    required: ['studentName', 'rawMark', 'status'],
                  },
                },
              },
              required: ['entries'],
            },
          },
        });

        const parsed = JSON.parse(response.text || '{"entries":[]}') as {
          entries?: Array<{
            studentName?: string;
            rawMark?: string;
            status?: string;
            note?: string;
          }>;
        };

        const entries = (parsed.entries || [])
          .filter((item) => typeof item.studentName === 'string' && item.studentName.trim().length >= 2)
          .map((item) => {
            const normalizedMark =
              item.status === 'absent'
                ? 'غ'
                : item.status === 'excused'
                  ? 'م'
                  : item.status === 'present' && !String(item.rawMark || '').includes('غ') && !String(item.rawMark || '').includes('م')
                    ? '/'
                    : sanitizeScannedMark(item.rawMark);

            return {
              studentName: item.studentName!.trim(),
              rawMark: normalizedMark,
              status: statusFromMark(normalizedMark),
              note: typeof item.note === 'string' ? item.note.trim() : '',
            };
          });

        res.json({ ok: true, mode: 'attendance', entries });
        return;
      }

      // mode === 'students'
      const studentsPrompt = `أنت مساعد إدخال بيانات مدرسي متخصص في قراءة قوائم وسجلات أسماء الطلاب باللغة العربية (سجل الطلاب).
افحص الصورة بعناية واستخرج جميع أسماء الطلاب الظاهرة في القائمة أو الجدول.
قواعد الاستخراج:
- استخرج اسم الطالب الكامل كما هو مكتوب في الورقة (الاسم الأول والأب والجد/اللقب إن وجد).
- تجاهل الأرقام التسلسلية (1، 2، 3...)، العناوين، الترويسات، التواريخ، وأسماء المعلمين أو التواقيع.
- لا تخترع أسماء غير ظاهرة في الصورة.
- أرجع النتيجة بصيغة JSON مطابقة للمخطط فقط.`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: [
          {
            inlineData: {
              mimeType,
              data: imageBase64,
            },
          },
          { text: studentsPrompt },
        ],
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              students: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    fullName: { type: Type.STRING },
                  },
                  required: ['fullName'],
                },
              },
            },
            required: ['students'],
          },
        },
      });

      const parsed = JSON.parse(response.text || '{"students":[]}') as {
        students?: Array<{ fullName?: string }>;
      };

      const seen = new Set<string>();
      const students = (parsed.students || [])
        .map((item) => (typeof item.fullName === 'string' ? item.fullName.trim() : ''))
        .filter((name) => {
          if (name.length < 2) return false;
          const key = name.replace(/\s+/g, ' ');
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((fullName) => ({ fullName }));

      res.json({ ok: true, mode: 'students', students });
    } catch (error) {
      if (error instanceof Error && error.message === 'GEMINI_API_KEY_MISSING') {
        res.status(503).json({
          error: 'مفتاح Gemini API غير مهيأ على الخادم. يرجى ضبط المتغير البيئي GEMINI_API_KEY.',
        });
        return;
      }
      console.error('Error in /api/scan-register:', error);
      res.status(500).json({
        error:
          error instanceof Error
            ? `تعذر تحليل صورة السجل: ${error.message}`
            : 'حدث خطأ أثناء تحليل صورة السجل.',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${port}`);
  });
}

void startServer();
