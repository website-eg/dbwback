// api/ai-chat.js
// Groq AI — "روبو" Multi-role assistant with Function Calling
// Model: Llama 3.3 70B | Architecture: Tool Use (Function Calling)
//
// 🧠 HOW IT WORKS:
// 1. User sends message → Groq receives it with available tools
// 2. Groq DECIDES which tools to call (if any) based on the question
// 3. We execute the tool calls → return results to Groq
// 4. Groq formulates a natural response using the real data
//
// No more keyword matching. The AI decides what it needs.

import admin from "firebase-admin";

if (!admin.apps.length) {
    if (!process.env.FIREBASE_PRIVATE_KEY) {
        throw new Error("Missing FIREBASE_PRIVATE_KEY");
    }
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
        }),
    });
}

const db = admin.firestore();

// ─── API Key Rotation (supports up to 20 keys) ───
const GROQ_API_KEYS = [];
for (let i = 1; i <= 20; i++) {
    const key = process.env[`GROQ_API_KEY_${i}`];
    if (key) GROQ_API_KEYS.push(key);
}
// Fallback to single key if no numbered keys found
if (GROQ_API_KEYS.length === 0 && process.env.GROQ_API_KEY) {
    GROQ_API_KEYS.push(process.env.GROQ_API_KEY);
}
let _keyIndex = 0;
function getNextKey() {
    if (GROQ_API_KEYS.length === 0) return null;
    const key = GROQ_API_KEYS[_keyIndex % GROQ_API_KEYS.length];
    _keyIndex++;
    return key;
}
console.log(`🔑 Loaded ${GROQ_API_KEYS.length} Groq API keys`);

// ═══════════════════════════════════════════════
// SYSTEM PROMPTS — Clean, no data logic needed
// ═══════════════════════════════════════════════

const BASE_RULES = `أنت "روبو" — مساعد ذكي لتطبيق "بِرّ الوالدين" لتحفيظ القرآن الكريم.

شخصيتك: ودود، محفز، ذكي. تتحدث بالعربية الفصحى البسيطة مع إيموجي مناسب.

⚠️ قواعد صارمة:
- أجب بشكل مباشر وطبيعي كصديق ذكي. لا تقل "بعد تحليل البيانات" أو "وفقاً للسجلات".
- تصرف وكأنك تعرف كل شيء بنفسك — لا تذكر أبداً مصدر المعلومات.
- كن مختصراً. السؤال البسيط = جواب بسيط. لا مقدمات.
- استخدم أرقام محددة دائماً. لا تقل "بعض" بل حدد العدد.
- لا تقترح فتح المصحف أو تشغيل سور أو أي إجراءات داخل التطبيق.
- استخدم الأدوات المتاحة لك لجلب أي معلومات تحتاجها قبل الإجابة.
- إذا لم تجد بيانات بعد استخدام الأدوات, قُل "ما عندي هالمعلومة حالياً".

أرجع دائماً JSON بالشكل: {"reply": "نص الرد"}`;

const PROMPTS = {
    student: `${BASE_RULES}

أنت تتحدث مع **طالب**. نادِه باسمه الأول.

ماذا تفعل:
- "كم غبت؟" ← استخدم أداة الحضور ثم أجب بالرقم مباشرة
- "كم نجومي؟" ← استخدم أداة معلومات الطالب
- "كيف أدائي؟" ← اجلب الحضور + الدرجات ولخّص في 2-3 سطور
- "كيف أتحسن؟" ← اجلب درجاته وقدّم نصائح مخصصة لنقاط ضعفه
- أسئلة دينية ← أجب مباشرة بدون أدوات

🧠 نصائح ذكية تلقائية:
- غياب ≥ 3 ← "حاول تحافظ على حضورك 💪"
- درجة درس < 7/10 ← "حضّر قبل الحصة"
- مراجعة < 7/10 ← "راجع حفظك 10 دقائق يومياً"
- واجب < 7/10 ← "لا تنسى واجباتك!"
- أداء ممتاز ← "ما شاء الله! استمر 🌟"`,

    teacher: `${BASE_RULES}

أنت تتحدث مع **معلم**. نادِه "يا شيخ" أو باسمه.

ماذا تفعل:
- "مين متغيب؟" ← اجلب حضور الحلقة واذكر الأسماء
- "تقرير الحلقة" ← اجلب كل بيانات الحلقة ولخّص: حضور + درجات + سلوك + تنبيهات
- "تقرير عن أحمد" ← ابحث عن الطالب بالاسم ثم اجلب بياناته
- "مين يحتاج متابعة؟" ← اجلب التنبيهات الذكية

⚠️ كن استباقياً:
- طالب غاب ≥ 3 ← نبّه تلقائياً
- درجات منخفضة ← "📉 لاحظت تراجع"
- لم يُسجَّل حضور اليوم ← ذكّره`,

    admin: `${BASE_RULES}

أنت تتحدث مع **مدير الأكاديمية**. ردودك مختصرة كمستشار محترف.

ماذا تفعل:
- "كم طالب؟" ← اجلب إحصائيات الأكاديمية
- "نسبة الحضور" ← اجلب حضور اليوم
- "مقارنة الحلقات" ← اجلب بيانات كل الحلقات
- "تنبيهات" ← اجلب التنبيهات الذكية
- "تقرير شامل" ← اجلب كل شيء ولخّص: أرقام + تنبيهات + توصيات

⚠️ ابدأ بالأهم: التنبيهات العاجلة أولاً.`,
};

// ═══════════════════════════════════════════════
// TOOL DEFINITIONS — Groq Function Calling Schema
// ═══════════════════════════════════════════════

const PERIOD_PARAM = {
    type: "string",
    description: "الفترة الزمنية. القيم الممكنة: today (اليوم), week (الأسبوع), month (الشهر), semester (الفصل), year (العام الدراسي), all (كل البيانات). الافتراضي: month"
};

function getToolsForRole(role) {
    const commonTools = [
        {
            type: "function",
            function: {
                name: "get_student_info",
                description: "جلب معلومات طالب: الاسم، الحلقة، النجوم، النوع (أساسي/احتياط)، المستوى",
                parameters: {
                    type: "object",
                    properties: {
                        student_id: { type: "string", description: "معرّف الطالب في النظام" }
                    },
                    required: ["student_id"]
                }
            }
        },
        {
            type: "function",
            function: {
                name: "get_attendance",
                description: "جلب سجل حضور وغياب طالب: عدد أيام الحضور، الغياب، الأعذار، حالة اليوم. يمكن تحديد الفترة.",
                parameters: {
                    type: "object",
                    properties: {
                        student_id: { type: "string", description: "معرّف الطالب" },
                        period: PERIOD_PARAM
                    },
                    required: ["student_id"]
                }
            }
        },
        {
            type: "function",
            function: {
                name: "get_scores",
                description: "جلب درجات ومتوسطات طالب: درس، مراجعة، تلاوة، واجب + نصائح تحسين. يمكن تحديد الفترة.",
                parameters: {
                    type: "object",
                    properties: {
                        student_id: { type: "string", description: "معرّف الطالب" },
                        period: PERIOD_PARAM
                    },
                    required: ["student_id"]
                }
            }
        },
    ];

    const teacherTools = [
        {
            type: "function",
            function: {
                name: "get_halaqa_overview",
                description: "جلب نظرة شاملة عن الحلقة: قائمة الطلاب، حضور اليوم، إحصائيات الفترة المطلوبة، المتميزين وكثيري الغياب",
                parameters: {
                    type: "object",
                    properties: {
                        teacher_id: { type: "string", description: "معرّف المعلم" },
                        period: PERIOD_PARAM
                    },
                    required: ["teacher_id"]
                }
            }
        },
        {
            type: "function",
            function: {
                name: "get_halaqa_scores_and_behavior",
                description: "جلب درجات طلاب الحلقة واختباراتهم وسجلات السلوك",
                parameters: {
                    type: "object",
                    properties: {
                        teacher_id: { type: "string", description: "معرّف المعلم" },
                        period: PERIOD_PARAM
                    },
                    required: ["teacher_id"]
                }
            }
        },
        {
            type: "function",
            function: {
                name: "search_student_by_name",
                description: "بحث عن طالب بالاسم في حلقة المعلم وجلب كل بياناته",
                parameters: {
                    type: "object",
                    properties: {
                        teacher_id: { type: "string", description: "معرّف المعلم" },
                        student_name: { type: "string", description: "اسم الطالب أو جزء منه" }
                    },
                    required: ["teacher_id", "student_name"]
                }
            }
        },
        {
            type: "function",
            function: {
                name: "get_smart_alerts",
                description: "جلب التنبيهات الذكية: طلاب كثيري الغياب، درجات منخفضة، حضور غير مسجل",
                parameters: {
                    type: "object",
                    properties: {
                        teacher_id: { type: "string", description: "معرّف المعلم" }
                    },
                    required: ["teacher_id"]
                }
            }
        },
    ];

    const adminTools = [
        {
            type: "function",
            function: {
                name: "get_academy_overview",
                description: "جلب إحصائيات الأكاديمية الشاملة: عدد الطلاب، الحلقات، نسبة الحضور، مقارنة الحلقات. يمكن تحديد تاريخ معين.",
                parameters: {
                    type: "object",
                    properties: {
                        date: { type: "string", description: "التاريخ بصيغة YYYY-MM-DD أو yesterday أو today. الافتراضي: today" }
                    },
                    required: []
                }
            }
        },
        {
            type: "function",
            function: {
                name: "get_academy_alerts",
                description: "جلب التنبيهات والمشاكل: حلقات لم تحضّر، طلاب كثيري الغياب، أداء منخفض، حالات نقل",
                parameters: {
                    type: "object",
                    properties: {
                        period: PERIOD_PARAM
                    },
                    required: []
                }
            }
        },
        {
            type: "function",
            function: {
                name: "get_academy_exams_and_behavior",
                description: "جلب ملخص اختبارات وسجلات السلوك لكل الأكاديمية",
                parameters: {
                    type: "object",
                    properties: {
                        period: PERIOD_PARAM
                    },
                    required: []
                }
            }
        },
        {
            type: "function",
            function: {
                name: "get_top_absent_students",
                description: "ترتيب أكثر الطلاب غياباً في الأكاديمية كلها. ممكن على مستوى الشهر أو الفصل أو العام الدراسي أو كل الفترات.",
                parameters: {
                    type: "object",
                    properties: {
                        period: PERIOD_PARAM,
                        limit: { type: "string", description: "عدد النتائج المطلوبة (الافتراضي 10)" }
                    },
                    required: []
                }
            }
        },
    ];

    switch (role) {
        case 'teacher': return [...commonTools, ...teacherTools];
        case 'admin': return [...commonTools, ...adminTools];
        default: return commonTools; // student
    }
}

// ═══════════════════════════════════════════════
// TOOL IMPLEMENTATIONS — Each returns a string
// ═══════════════════════════════════════════════

function getTodayStr() {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
}

function getDateStr(dateInput) {
    // If no input or 'today', return today
    if (!dateInput || dateInput === 'today') return getTodayStr();
    // If 'yesterday'
    if (dateInput === 'yesterday') {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        return d.toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
    }
    // If already YYYY-MM-DD format
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) return dateInput;
    // Try to parse
    const parsed = new Date(dateInput);
    if (!isNaN(parsed)) return parsed.toLocaleDateString("en-CA");
    return getTodayStr();
}

function getMonthRange() {
    return getDateRange('month');
}

// Flexible date range based on period
function getDateRange(period) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const today = getTodayStr();

    switch (period) {
        case 'today':
            return { start: today, end: today, label: 'اليوم' };

        case 'week': {
            const weekAgo = new Date(now);
            weekAgo.setDate(weekAgo.getDate() - 7);
            return {
                start: weekAgo.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }),
                end: today,
                label: 'الأسبوع'
            };
        }

        case 'month': {
            const m = String(month + 1).padStart(2, '0');
            const endDate = new Date(year, month + 1, 0);
            return {
                start: `${year}-${m}-01`,
                end: `${year}-${m}-${String(endDate.getDate()).padStart(2, '0')}`,
                label: `${m}/${year}`
            };
        }

        case 'semester': {
            // Academic semester: Sep-Jan or Feb-Jun
            const semStart = month >= 8 ? new Date(year, 8, 1) : new Date(year, 1, 1);
            const semEnd = month >= 8 ? new Date(year + 1, 0, 31) : new Date(year, 5, 30);
            return {
                start: semStart.toLocaleDateString('en-CA'),
                end: semEnd.toLocaleDateString('en-CA'),
                label: month >= 8 ? 'الفصل الأول' : 'الفصل الثاني'
            };
        }

        case 'year': {
            // Academic year: Sep to Jun
            const acStart = month >= 8 ? new Date(year, 8, 1) : new Date(year - 1, 8, 1);
            const acEnd = month >= 8 ? new Date(year + 1, 5, 30) : new Date(year, 5, 30);
            return {
                start: acStart.toLocaleDateString('en-CA'),
                end: acEnd.toLocaleDateString('en-CA'),
                label: month >= 8 ? `${year}/${year + 1}` : `${year - 1}/${year}`
            };
        }

        case 'all':
            return { start: '2020-01-01', end: '2099-12-31', label: 'كل الفترات' };

        default:
            return getDateRange('month');
    }
}

// ─── In-Memory Cache ───
const _cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function getCached(key) {
    const entry = _cache.get(key);
    if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
    _cache.delete(key);
    return null;
}

function setCache(key, data) {
    _cache.set(key, { data, ts: Date.now() });
    if (_cache.size > 100) {
        const oldest = [..._cache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
        if (oldest) _cache.delete(oldest[0]);
    }
}

// ─── Tool: get_student_info ───
async function tool_get_student_info({ student_id }) {
    const ck = `info_${student_id}`;
    const cached = getCached(ck);
    if (cached) return cached;

    try {
        const doc = await db.collection('students').doc(student_id).get();
        if (!doc.exists) return JSON.stringify({ error: "الطالب غير موجود" });

        const s = doc.data();
        const result = JSON.stringify({
            name: s.fullName || 'غير معروف',
            halaqa: s.halaqaName || 'غير محدد',
            type: s.type === 'reserve' ? 'احتياط' : 'أساسي',
            stars: s.stars || 0,
            level: s.currentLevel || null,
        });
        setCache(ck, result);
        return result;
    } catch (e) {
        return JSON.stringify({ error: "فشل جلب بيانات الطالب" });
    }
}

// ─── Tool: get_attendance ───
async function tool_get_attendance({ student_id, period = 'month' }) {
    const ck = `att_${student_id}_${period}`;
    const cached = getCached(ck);
    if (cached) return cached;

    const today = getTodayStr();
    const { start, end, label } = getDateRange(period);

    try {
        const snap = await db.collection('attendance')
            .where('studentId', '==', student_id)
            .where('date', '>=', start)
            .where('date', '<=', end)
            .get();

        let present = 0, absent = 0, excused = 0;
        let todayStatus = 'لم يُسجّل بعد';

        snap.forEach(doc => {
            const d = doc.data();
            if (d.status === 'present' || d.status === 'sard') present++;
            else if (d.status === 'absent') absent++;
            else if (d.status === 'excused') excused++;
            if (d.date === today) {
                todayStatus = d.status === 'present' || d.status === 'sard' ? 'حاضر' : d.status === 'absent' ? 'غائب' : 'إذن';
            }
        });

        const total = present + absent + excused;
        const rate = total > 0 ? Math.round((present / total) * 100) : 0;

        const result = JSON.stringify({
            period: label,
            present, absent, excused,
            total_days: total,
            attendance_rate: `${rate}%`,
            today: todayStatus,
        });
        setCache(ck, result);
        return result;
    } catch (e) {
        return JSON.stringify({ error: "فشل جلب الحضور" });
    }
}

// ─── Tool: get_scores ───
async function tool_get_scores({ student_id, period = 'month' }) {
    const ck = `scores_${student_id}_${period}`;
    const cached = getCached(ck);
    if (cached) return cached;

    const { start, end, label } = getDateRange(period);

    try {
        const snap = await db.collection('progress')
            .where('studentId', '==', student_id)
            .where('date', '>=', start)
            .where('date', '<=', end)
            .get();

        const docs = [];
        snap.forEach(doc => docs.push(doc.data()));
        docs.sort((a, b) => b.date.localeCompare(a.date));

        if (docs.length === 0) {
            return JSON.stringify({ message: `لا توجد درجات مسجلة في فترة ${label}` });
        }

        let sumL = 0, sumR = 0, sumT = 0, sumH = 0;
        docs.forEach(p => {
            sumL += Number(p.lessonScore || 0);
            sumR += Number(p.revisionScore || 0);
            sumT += Number(p.tilawaScore || 0);
            sumH += Number(p.homeworkScore || 0);
        });
        const n = docs.length;
        const avgL = Math.round(sumL / n * 10) / 10;
        const avgR = Math.round(sumR / n * 10) / 10;
        const avgT = Math.round(sumT / n * 10) / 10;
        const avgH = Math.round(sumH / n * 10) / 10;
        const avgTotal = Math.round((avgL + avgR + avgT + avgH) * 10) / 10;

        // Smart advice
        const advice = [];
        if (avgL < 7) advice.push("حضّر الدرس قبل الحصة");
        if (avgR < 7) advice.push("راجع حفظك 10 دقائق يومياً");
        if (avgH < 7) advice.push("لا تنسى الواجبات");
        if (avgT < 7) advice.push("أكثر من التلاوة");
        if (avgTotal >= 36) advice.push("أداء ممتاز! استمر 🌟");
        else if (avgTotal >= 30) advice.push("أداء جيد، شوية جهد إضافي وتوصل القمة 💪");

        const last3 = docs.slice(0, 3).map(p => ({
            date: p.date,
            lesson: p.lessonScore || 0,
            revision: p.revisionScore || 0,
            tilawa: p.tilawaScore || 0,
            homework: p.homeworkScore || 0,
            total: (Number(p.lessonScore || 0) + Number(p.revisionScore || 0) + Number(p.tilawaScore || 0) + Number(p.homeworkScore || 0)),
            star: p.hasStar || false,
        }));

        const result = JSON.stringify({
            period: label,
            sessions: n,
            averages: { lesson: avgL, revision: avgR, tilawa: avgT, homework: avgH, total: avgTotal, max: 40 },
            last_sessions: last3,
            advice,
        });
        setCache(ck, result);
        return result;
    } catch (e) {
        return JSON.stringify({ error: "فشل جلب الدرجات" });
    }
}

// ─── Tool: get_halaqa_overview ───
async function tool_get_halaqa_overview({ teacher_id, period = 'month' }) {
    const ck = `halaqa_${teacher_id}_${period}`;
    const cached = getCached(ck);
    if (cached) return cached;

    const today = getTodayStr();
    const { start, end, label } = getDateRange(period);

    try {
        const teacherDoc = await db.collection('users').doc(teacher_id).get();
        if (!teacherDoc.exists) return JSON.stringify({ error: "المعلم غير موجود" });

        const teacher = teacherDoc.data();
        const halaqaId = teacher.halaqaId;
        if (!halaqaId) return JSON.stringify({ error: "المعلم غير مربوط بحلقة" });

        const [studentsSnap, todayAttSnap, monthAttSnap] = await Promise.all([
            db.collection('students').where('halaqaId', '==', halaqaId).get(),
            db.collection('attendance').where('halaqaId', '==', halaqaId).where('date', '==', today).get(),
            db.collection('attendance').where('halaqaId', '==', halaqaId).where('date', '>=', start).where('date', '<=', end).get(),
        ]);

        const studentMap = {};
        studentsSnap.forEach(doc => { studentMap[doc.id] = doc.data().fullName || doc.data().name || 'بدون اسم'; });

        // Today
        const todayStatuses = {};
        todayAttSnap.forEach(doc => { todayStatuses[doc.data().studentId] = doc.data().status; });

        const absentToday = [], presentToday = [], notRecorded = [];
        studentsSnap.forEach(doc => {
            const name = studentMap[doc.id];
            const status = todayStatuses[doc.id];
            if (status === 'absent') absentToday.push(name);
            else if (status === 'present' || status === 'sard') presentToday.push(name);
            else notRecorded.push(name);
        });

        // Period stats
        const periodStats = {};
        monthAttSnap.forEach(doc => {
            const d = doc.data();
            if (!studentMap[d.studentId]) return;
            if (!periodStats[d.studentId]) periodStats[d.studentId] = { name: studentMap[d.studentId], present: 0, absent: 0 };
            if (d.status === 'present' || d.status === 'sard') periodStats[d.studentId].present++;
            else if (d.status === 'absent') periodStats[d.studentId].absent++;
        });

        const sorted = Object.values(periodStats).sort((a, b) => b.absent - a.absent);
        const mostAbsent = sorted.filter(s => s.absent >= 2).slice(0, 5).map(s => `${s.name} (${s.absent} أيام)`);
        const bestStudents = sorted.filter(s => s.present >= 5 && s.absent === 0).slice(0, 5).map(s => s.name);

        const result = JSON.stringify({
            teacher_name: teacher.name || teacher.displayName,
            halaqa: teacher.halaqaName || halaqaId,
            total_students: studentsSnap.size,
            today: {
                date: today,
                present: presentToday,
                absent: absentToday,
                not_recorded: notRecorded,
                attendance_recorded: notRecorded.length === 0,
            },
            period_stats: {
                label,
                most_absent: mostAbsent,
                best_students: bestStudents,
            }
        });
        setCache(ck, result);
        return result;
    } catch (e) {
        return JSON.stringify({ error: "فشل جلب بيانات الحلقة" });
    }
}

// ─── Tool: get_halaqa_scores_and_behavior ───
async function tool_get_halaqa_scores_and_behavior({ teacher_id, period = 'month' }) {
    const ck = `halaqa_sb_${teacher_id}_${period}`;
    const cached = getCached(ck);
    if (cached) return cached;

    const { start, end, label } = getDateRange(period);

    try {
        const teacherDoc = await db.collection('users').doc(teacher_id).get();
        if (!teacherDoc.exists) return JSON.stringify({ error: "المعلم غير موجود" });

        const halaqaId = teacherDoc.data().halaqaId;
        if (!halaqaId) return JSON.stringify({ error: "لا توجد حلقة" });

        const [studentsSnap, examsSnap, behaviorSnap, progressSnap] = await Promise.all([
            db.collection('students').where('halaqaId', '==', halaqaId).get(),
            db.collection('exams').where('monthKey', '==', `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`).get(),
            db.collection('behavior_records').orderBy('createdAt', 'desc').limit(20).get(),
            db.collection('progress').where('halaqaId', '==', halaqaId).where('date', '>=', start).where('date', '<=', end).get(),
        ]);

        const studentMap = {};
        const studentIds = new Set();
        studentsSnap.forEach(doc => { studentMap[doc.id] = doc.data().fullName || doc.data().name || '?'; studentIds.add(doc.id); });

        // Latest progress per student
        const latest = {};
        progressSnap.forEach(doc => {
            const d = doc.data();
            if (!latest[d.studentId] || d.date > latest[d.studentId].date) latest[d.studentId] = d;
        });

        const scores = Object.entries(latest).slice(0, 10).map(([sid, p]) => ({
            name: studentMap[sid] || '?',
            date: p.date,
            total: (Number(p.lessonScore || 0) + Number(p.revisionScore || 0) + Number(p.tilawaScore || 0) + Number(p.homeworkScore || 0)),
            star: p.hasStar || false,
        }));

        // Exams for this halaqa
        const exams = [];
        examsSnap.forEach(doc => {
            const d = doc.data();
            if (studentIds.has(d.studentId)) {
                exams.push({
                    student: studentMap[d.studentId] || '?',
                    type: d.type === 'quran-oral' ? 'شفهي' : d.type === 'tajweed-written' ? 'تحريري' : 'قاعدة',
                    score: `${d.score}/50`,
                });
            }
        });

        // Behavior
        const behaviors = [];
        behaviorSnap.forEach(doc => {
            const d = doc.data();
            if (studentIds.has(d.studentId)) {
                behaviors.push({
                    student: d.studentName,
                    type: d.isPositive ? 'إيجابي 👍' : 'سلبي 👎',
                    category: d.category,
                    note: d.note || null,
                });
            }
        });

        const result = JSON.stringify({
            period: label,
            latest_scores: scores,
            exams: exams.slice(0, 8),
            recent_behavior: behaviors.slice(0, 5),
        });
        setCache(ck, result);
        return result;
    } catch (e) {
        return JSON.stringify({ error: "فشل جلب الدرجات والسلوك" });
    }
}

// ─── Tool: search_student_by_name ───
async function tool_search_student_by_name({ teacher_id, student_name }) {
    try {
        const teacherDoc = await db.collection('users').doc(teacher_id).get();
        if (!teacherDoc.exists) return JSON.stringify({ error: "المعلم غير موجود" });

        const halaqaId = teacherDoc.data().halaqaId;
        if (!halaqaId) return JSON.stringify({ error: "لا توجد حلقة" });

        const studentsSnap = await db.collection('students').where('halaqaId', '==', halaqaId).get();

        // Fuzzy name search
        const searchLower = student_name.toLowerCase().trim();
        let found = null;
        let foundId = null;

        studentsSnap.forEach(doc => {
            const name = (doc.data().fullName || doc.data().name || '').toLowerCase();
            if (name.includes(searchLower) || searchLower.includes(name.split(' ')[0])) {
                found = doc.data();
                foundId = doc.id;
            }
        });

        if (!found) return JSON.stringify({ error: `لم أجد طالب باسم "${student_name}" في الحلقة` });

        // Get attendance + scores for this student
        const { start, end } = getDateRange('year');
        const today = getTodayStr();

        const [attSnap, progSnap] = await Promise.all([
            db.collection('attendance').where('studentId', '==', foundId).where('date', '>=', start).where('date', '<=', end).get(),
            db.collection('progress').where('studentId', '==', foundId).where('date', '>=', start).where('date', '<=', end).get(),
        ]);

        let present = 0, absent = 0, todayStatus = 'لم يُسجّل';
        attSnap.forEach(doc => {
            const d = doc.data();
            if (d.status === 'present' || d.status === 'sard') present++;
            else if (d.status === 'absent') absent++;
            if (d.date === today) todayStatus = d.status;
        });

        const progs = [];
        progSnap.forEach(doc => progs.push(doc.data()));
        progs.sort((a, b) => b.date.localeCompare(a.date));

        let avgTotal = 0;
        if (progs.length > 0) {
            const sum = progs.reduce((acc, p) =>
                acc + Number(p.lessonScore || 0) + Number(p.revisionScore || 0) + Number(p.tilawaScore || 0) + Number(p.homeworkScore || 0), 0);
            avgTotal = Math.round(sum / progs.length * 10) / 10;
        }

        return JSON.stringify({
            name: found.fullName || found.name,
            type: found.type === 'reserve' ? 'احتياط' : 'أساسي',
            stars: found.stars || 0,
            attendance: { present, absent, today: todayStatus },
            scores: {
                sessions: progs.length,
                avg_total: `${avgTotal}/40`,
                last: progs.slice(0, 3).map(p => ({
                    date: p.date,
                    total: Number(p.lessonScore || 0) + Number(p.revisionScore || 0) + Number(p.tilawaScore || 0) + Number(p.homeworkScore || 0),
                }))
            }
        });
    } catch (e) {
        return JSON.stringify({ error: "فشل البحث عن الطالب" });
    }
}

// ─── Tool: get_smart_alerts (Teacher) ───
async function tool_get_smart_alerts({ teacher_id }) {
    const ck = `alerts_${teacher_id}`;
    const cached = getCached(ck);
    if (cached) return cached;

    try {
        const overview = JSON.parse(await tool_get_halaqa_overview({ teacher_id }));
        if (overview.error) return JSON.stringify(overview);

        const alerts = [];

        // Attendance not recorded
        if (!overview.today.attendance_recorded) {
            alerts.push({ level: "⚠️", message: `لم يتم تسجيل حضور ${overview.today.not_recorded.length} طالب اليوم` });
        }

        // Absent today
        if (overview.today.absent.length > 0) {
            alerts.push({ level: "📋", message: `الغائبون اليوم: ${overview.today.absent.join('، ')}` });
        }

        // Frequent absences
        if (overview.period_stats.most_absent.length > 0) {
            overview.period_stats.most_absent.forEach(s => {
                alerts.push({ level: "🔴", message: `${s} — يحتاج متابعة` });
            });
        }

        if (alerts.length === 0) {
            alerts.push({ level: "✅", message: "كل شيء ممتاز اليوم!" });
        }

        const result = JSON.stringify({ alerts });
        setCache(ck, result);
        return result;
    } catch (e) {
        return JSON.stringify({ error: "فشل جلب التنبيهات" });
    }
}

// ─── Tool: get_academy_overview (Admin) ───
async function tool_get_academy_overview({ date } = {}) {
    const targetDate = getDateStr(date);
    const ck = `academy_overview_${targetDate}`;
    const cached = getCached(ck);
    if (cached) return cached;

    try {
        const [studentsSnap, halaqatSnap, attSnap] = await Promise.all([
            db.collection('students').get(),
            db.collection('halaqat').get(),
            db.collection('attendance').where('date', '==', targetDate).get(),
        ]);

        let mainCount = 0, reserveCount = 0;
        studentsSnap.forEach(doc => {
            if (doc.data().type === 'reserve') reserveCount++;
            else mainCount++;
        });

        const halaqaNames = {};
        halaqatSnap.forEach(doc => { halaqaNames[doc.id] = doc.data().name || doc.id; });

        let todayPresent = 0, todayAbsent = 0, todayExcused = 0;
        const halaqaToday = {};
        const recordedHalaqas = new Set();

        attSnap.forEach(doc => {
            const d = doc.data();
            const hName = d.halaqaName || 'غير محدد';
            recordedHalaqas.add(d.halaqaId || hName);
            if (!halaqaToday[hName]) halaqaToday[hName] = { present: 0, absent: 0 };
            if (d.status === 'present' || d.status === 'sard') { todayPresent++; halaqaToday[hName].present++; }
            else if (d.status === 'absent') { todayAbsent++; halaqaToday[hName].absent++; }
            else if (d.status === 'excused') todayExcused++;
        });

        const total = todayPresent + todayAbsent + todayExcused;
        const rate = total > 0 ? Math.round((todayPresent / total) * 100) : 0;

        const unrecorded = Object.entries(halaqaNames).filter(([id]) => !recordedHalaqas.has(id)).map(([, n]) => n);

        const halaqaComparison = Object.entries(halaqaToday).map(([name, s]) => {
            const t = s.present + s.absent;
            return { name, present: s.present, total: t, rate: t > 0 ? `${Math.round((s.present / t) * 100)}%` : '0%' };
        }).sort((a, b) => parseInt(b.rate) - parseInt(a.rate));

        const result = JSON.stringify({
            date: targetDate,
            students: { total: studentsSnap.size, main: mainCount, reserve: reserveCount },
            halaqat: { total: halaqatSnap.size, names: Object.values(halaqaNames) },
            attendance: { present: todayPresent, absent: todayAbsent, excused: todayExcused, rate: `${rate}%` },
            halaqa_comparison: halaqaComparison,
            unrecorded_halaqat: unrecorded,
        });
        setCache(ck, result);
        return result;
    } catch (e) {
        return JSON.stringify({ error: "فشل جلب الإحصائيات" });
    }
}

// ─── Tool: get_academy_alerts (Admin) ───
async function tool_get_academy_alerts({ period = 'month' } = {}) {
    const ck = `academy_alerts_${period}`;
    const cached = getCached(ck);
    if (cached) return cached;

    const { start, end } = getDateRange(period);

    try {
        const [overview, monthAttSnap, demotionSnap] = await Promise.all([
            tool_get_academy_overview().then(JSON.parse),
            db.collection('attendance').where('date', '>=', start).where('date', '<=', end).get(),
            db.collection('demotion_alerts').orderBy('createdAt', 'desc').limit(10).get(),
        ]);

        const alerts = [];

        // Unrecorded halaqat
        if (overview.unrecorded_halaqat?.length > 0) {
            alerts.push({ level: "⚠️", message: `حلقات لم تحضّر اليوم: ${overview.unrecorded_halaqat.join('، ')}` });
        }

        // Low attendance
        if (parseInt(overview.today_attendance?.rate) < 60 && (overview.today_attendance?.present + overview.today_attendance?.absent) > 0) {
            alerts.push({ level: "⚠️", message: `نسبة الحضور منخفضة: ${overview.today_attendance.rate}` });
        }

        // Monthly top absentees
        const studentMap = {};
        const monthlyAbs = {};
        const studentsSnap = await db.collection('students').get();
        studentsSnap.forEach(doc => { studentMap[doc.id] = doc.data().fullName || '?'; });

        monthAttSnap.forEach(doc => {
            const d = doc.data();
            if (d.status === 'absent') {
                monthlyAbs[d.studentId] = (monthlyAbs[d.studentId] || 0) + 1;
            }
        });

        Object.entries(monthlyAbs)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .filter(([, count]) => count >= 4)
            .forEach(([sid, count]) => {
                alerts.push({ level: "🔴", message: `${studentMap[sid] || '?'} غاب ${count} مرات — يحتاج تدخل` });
            });

        // Demotions
        const demotions = [];
        demotionSnap.forEach(doc => {
            const d = doc.data();
            demotions.push(`${d.studentName || '?'}: ${d.reason || 'غياب متكرر'}`);
        });
        if (demotions.length > 0) {
            alerts.push({ level: "📋", message: `حالات نقل: ${demotions.join(' | ')}` });
        }

        if (alerts.length === 0) {
            alerts.push({ level: "✅", message: "لا توجد تنبيهات — أداء الأكاديمية ممتاز اليوم!" });
        }

        const result = JSON.stringify({ alerts });
        setCache(ck, result);
        return result;
    } catch (e) {
        return JSON.stringify({ error: "فشل جلب التنبيهات" });
    }
}

// ─── Tool: get_academy_exams_and_behavior (Admin) ───
async function tool_get_academy_exams_and_behavior() {
    const ck = `academy_eb`;
    const cached = getCached(ck);
    if (cached) return cached;

    try {
        const monthKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
        const [examsSnap, behaviorSnap] = await Promise.all([
            db.collection('exams').where('monthKey', '==', monthKey).get(),
            db.collection('behavior_records').orderBy('createdAt', 'desc').limit(15).get(),
        ]);

        // Exams by type
        const examsByType = {};
        examsSnap.forEach(doc => {
            const d = doc.data();
            const type = d.type === 'quran-oral' ? 'شفهي' : d.type === 'tajweed-written' ? 'تحريري' : 'قاعدة';
            if (!examsByType[type]) examsByType[type] = { count: 0, total: 0 };
            examsByType[type].count++;
            examsByType[type].total += Number(d.score || 0);
        });

        const exams = Object.entries(examsByType).map(([type, s]) => ({
            type, count: s.count, avg: `${Math.round(s.total / s.count)}/50`,
        }));

        // Behavior
        let positive = 0, negative = 0;
        behaviorSnap.forEach(doc => { if (doc.data().isPositive) positive++; else negative++; });

        const result = JSON.stringify({
            exams: { total: examsSnap.size, by_type: exams },
            behavior: { positive, negative, total: positive + negative },
        });
        setCache(ck, result);
        return result;
    } catch (e) {
        return JSON.stringify({ error: "فشل جلب الاختبارات والسلوك" });
    }
}

// ─── Tool: get_top_absent_students (Admin) ───
async function tool_get_top_absent_students({ period = 'year', limit = '10' } = {}) {
    const parsedLimit = parseInt(limit) || 10;
    const ck = `top_absent_${period}_${parsedLimit}`;
    const cached = getCached(ck);
    if (cached) return cached;

    const { start, end, label } = getDateRange(period);

    try {
        const [studentsSnap, attSnap] = await Promise.all([
            db.collection('students').get(),
            db.collection('attendance').where('date', '>=', start).where('date', '<=', end).get(),
        ]);

        const studentMap = {};
        const studentHalaqa = {};
        studentsSnap.forEach(doc => {
            const d = doc.data();
            studentMap[doc.id] = d.fullName || d.name || '?';
            studentHalaqa[doc.id] = d.halaqaName || 'غير محدد';
        });

        const absCount = {};
        const totalCount = {};
        attSnap.forEach(doc => {
            const d = doc.data();
            totalCount[d.studentId] = (totalCount[d.studentId] || 0) + 1;
            if (d.status === 'absent') absCount[d.studentId] = (absCount[d.studentId] || 0) + 1;
        });

        const ranked = Object.entries(absCount)
            .sort((a, b) => b[1] - a[1])
            .slice(0, parsedLimit)
            .map(([sid, count], i) => ({
                rank: i + 1,
                name: studentMap[sid] || '?',
                halaqa: studentHalaqa[sid] || '?',
                absent_days: count,
                total_days: totalCount[sid] || count,
                absence_rate: `${Math.round((count / (totalCount[sid] || 1)) * 100)}%`,
            }));

        const result = JSON.stringify({
            period: label,
            total_students_with_absence: Object.keys(absCount).length,
            top_absent: ranked,
        });
        setCache(ck, result);
        return result;
    } catch (e) {
        return JSON.stringify({ error: "فشل جلب ترتيب الغياب" });
    }
}

// ─── Tool Router ───
const TOOL_HANDLERS = {
    get_student_info: tool_get_student_info,
    get_attendance: tool_get_attendance,
    get_scores: tool_get_scores,
    get_halaqa_overview: tool_get_halaqa_overview,
    get_halaqa_scores_and_behavior: tool_get_halaqa_scores_and_behavior,
    search_student_by_name: tool_search_student_by_name,
    get_smart_alerts: tool_get_smart_alerts,
    get_academy_overview: tool_get_academy_overview,
    get_academy_alerts: tool_get_academy_alerts,
    get_academy_exams_and_behavior: tool_get_academy_exams_and_behavior,
    get_top_absent_students: tool_get_top_absent_students,
};

// ═══════════════════════════════════════════════
// GROQ API — with retry + function call loop
// ═══════════════════════════════════════════════

async function callGroq(messages, tools, maxRetries = 2) {
    const body = {
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages,
        temperature: 0.4,
        max_tokens: 1024,
    };

    if (tools && tools.length > 0) {
        body.tools = tools;
        body.tool_choice = "auto";
    } else {
        body.response_format = { type: 'json_object' };
    }

    const totalKeys = GROQ_API_KEYS.length;
    const maxKeyAttempts = totalKeys; // try ALL keys if needed

    for (let keyAttempt = 0; keyAttempt < maxKeyAttempts; keyAttempt++) {
        const apiKey = getNextKey();
        if (!apiKey) return { success: false, error: 'No API keys configured' };

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`,
                    },
                    body: JSON.stringify(body),
                });

                const data = await res.json();

                if (res.ok) return { success: true, data };

                // Rate limit OR model blocked/forbidden → try next key immediately
                if ((res.status === 429 || res.status === 403) && totalKeys > 1) {
                    console.warn(`⚡ Key #${(_keyIndex - 1) % totalKeys + 1} error ${res.status}, switching to next key...`);
                    break; // break inner retry loop → go to next key
                }

                // Server error → retry same key
                if (res.status >= 500 && attempt < maxRetries) {
                    const wait = Math.pow(2, attempt + 1) * 1000;
                    console.warn(`⏳ Groq ${res.status}, retry in ${wait}ms...`);
                    await new Promise(r => setTimeout(r, wait));
                    continue;
                }

                return { success: false, error: data.error?.message || JSON.stringify(data.error) || `HTTP ${res.status}` };
            } catch (err) {
                if (attempt < maxRetries) {
                    await new Promise(r => setTimeout(r, 2000));
                    continue;
                }
                // Network error → try next key
                if (totalKeys > 1 && keyAttempt < maxKeyAttempts - 1) break;
                return { success: false, error: err.message };
            }
        }
    }
    return { success: false, error: 'All API keys exhausted' };
}

// ═══════════════════════════════════════════════
// HANDLER — Function Calling Loop
// ═══════════════════════════════════════════════

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (GROQ_API_KEYS.length === 0) return res.status(500).json({ error: 'No GROQ API keys configured' });

    const { message, role, studentId, teacherId, history } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });

    try {
        const systemPrompt = PROMPTS[role] || PROMPTS.student;
        const tools = getToolsForRole(role || 'student');

        // Inject user identity context so AI knows WHO is asking
        let identityHint = '';
        if (role === 'student' && studentId) identityHint = `\n[معرّف الطالب: ${studentId}]`;
        else if (role === 'teacher' && (teacherId || studentId)) identityHint = `\n[معرّف المعلم: ${teacherId || studentId}]`;

        // Build messages
        const messages = [
            { role: 'system', content: systemPrompt + identityHint }
        ];

        // Add history (last 12)
        if (history && Array.isArray(history)) {
            for (const h of history.slice(-12)) {
                messages.push({
                    role: h.role === 'user' ? 'user' : 'assistant',
                    content: h.text
                });
            }
        }

        messages.push({ role: 'user', content: message });

        console.log(`🤖 [${role}] "${message.substring(0, 60)}" | Tools: ${tools.length}`);

        // ── Function Calling Loop (max 3 rounds) ──
        let finalResponse = null;

        for (let round = 0; round < 3; round++) {
            const result = await callGroq(messages, round === 0 ? tools : tools);
            if (!result.success) {
                return res.status(500).json({ error: 'Groq API error', details: result.error });
            }

            const choice = result.data.choices?.[0];
            const msg = choice?.message;

            if (!msg) {
                return res.status(500).json({ error: 'Empty response from AI' });
            }

            // If AI wants to call tools
            if (msg.tool_calls && msg.tool_calls.length > 0) {
                console.log(`🔧 Round ${round + 1}: ${msg.tool_calls.length} tool call(s): ${msg.tool_calls.map(t => t.function.name).join(', ')}`);

                // Add assistant message with tool calls
                messages.push(msg);

                // Execute each tool call
                for (const toolCall of msg.tool_calls) {
                    const fn = toolCall.function;
                    const handler_fn = TOOL_HANDLERS[fn.name];

                    let toolResult;
                    if (handler_fn) {
                        let args = {};
                        try { args = JSON.parse(fn.arguments || '{}') || {}; } catch { args = {}; }

                        // Auto-inject IDs the AI might not have (only for non-academy tools)
                        if (!fn.name.startsWith('get_academy')) {
                            if (fn.name.includes('student') && !args.student_id && studentId) args.student_id = studentId;
                            if (fn.name.includes('attendance') && !args.student_id && studentId) args.student_id = studentId;
                            if (fn.name.includes('scores') && !args.student_id && studentId) args.student_id = studentId;
                            if (fn.name.includes('halaqa') && !args.teacher_id && (teacherId || studentId)) args.teacher_id = teacherId || studentId;
                            if (fn.name.includes('alert') && !args.teacher_id && (teacherId || studentId)) args.teacher_id = teacherId || studentId;
                        }

                        toolResult = await handler_fn(args);
                    } else {
                        toolResult = JSON.stringify({ error: `Unknown tool: ${fn.name}` });
                    }

                    messages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: toolResult,
                    });
                }

                // Continue loop — Groq will process tool results
                continue;
            }

            // AI returned a final text response
            finalResponse = msg.content || '';
            break;
        }

        if (!finalResponse) {
            finalResponse = '{"reply": "عذراً، حدث خطأ. حاول مرة أخرى."}';
        }

        // Parse JSON response
        let parsed;
        try {
            parsed = JSON.parse(finalResponse);
        } catch {
            // If AI didn't return JSON, wrap it
            parsed = { reply: finalResponse };
        }

        return res.status(200).json({
            success: true,
            reply: parsed.reply || finalResponse,
        });

    } catch (error) {
        console.error('AI Chat error:', error);
        return res.status(500).json({ error: error.message });
    }
}
