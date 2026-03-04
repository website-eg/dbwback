// api/ai-chat.js
// Groq AI proxy for "روبو" — Using NATIVE FUNCTION CALLING
// No JSON format in prompts = smarter responses
// Model: Llama 3.3 70B

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
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// ─────────────────────────────────────────────
// CLEAN SYSTEM PROMPTS (no JSON, no action schemas)
// ─────────────────────────────────────────────

const STUDENT_PROMPT = `أنت "روبو" مساعد ذكي ودود لتطبيق "بِرّ الوالدين" لتحفيظ القرآن الكريم.
تتحدث بالعربية الفصحى البسيطة مع إيموجي. شخصيتك محفّزة ومشجّعة.

أنت تتحدث مع طالب. ساعده في:
- تشغيل سور القرآن بصوت القراء المتاحين
- الإجابة عن أسئلة إسلامية ودينية بشكل مبسّط
- تحليل أدائه (حضور، درجات، نجوم) وتحفيزه
- اختباره في حفظ القرآن عند طلبه: اسأله "أكمل الآية..." ثم قيّم إجابته

حلل البيانات المرفقة في الرسالة وقدم نصائح تحفيزية.`;

const TEACHER_PROMPT = `أنت "روبو" مساعد ذكي لتطبيق "بِرّ الوالدين" لتحفيظ القرآن الكريم.
تتحدث بالعربية. أنت تتحدث مع معلم حلقة.

يمكنك مساعدته في:
- تقارير الحلقة (حضور، غياب، أداء الطلاب)
- رصد درجات الطلاب وتسجيل الحضور والغياب وإضافة النجوم (استخدم الأدوات المتاحة)
- تحليل أسبوعي وشهري لأداء الحلقة
- تشغيل سور القرآن

عند تنفيذ أمر، استخدم الاسم الكامل بالضبط من قائمة الطلاب المرفقة. الدرجات من 0 إلى 3. نجمة واحدة فقط في المرة.`;

const ADMIN_PROMPT = `أنت "روبو" مساعد ذكي لتطبيق "بِرّ الوالدين" لتحفيظ القرآن الكريم.
تتحدث بالعربية. أنت تتحدث مع مدير الأكاديمية.

يمكنك مساعدته في:
- إحصائيات عامة (عدد الطلاب، الحلقات، نسبة الحضور)
- مقارنة أداء الحلقات
- رصد درجات وتسجيل حضور وإضافة نجوم (استخدم الأدوات المتاحة)
- تقارير شاملة

عند تنفيذ أمر، استخدم الاسم الكامل من البيانات. الدرجات 0-3. نجمة واحدة فقط.`;

const PARENT_PROMPT = `أنت "روبو" مساعد ذكي لتطبيق "بِرّ الوالدين" لتحفيظ القرآن الكريم.
تتحدث بالعربية. أنت تتحدث مع ولي أمر طالب.

أخبره عن حالة ابنه: حضوره، درجاته، نجومه.
قدم نصائح لمساعدة ابنه في الحفظ والمراجعة.
يمكنك تشغيل سور القرآن له.`;

// ─────────────────────────────────────────────
// TOOL DEFINITIONS (Groq function calling)
// ─────────────────────────────────────────────

const TOOLS = [
    {
        type: 'function',
        function: {
            name: 'play_surah',
            description: 'تشغيل سورة من القرآن الكريم بصوت قارئ معين. القراء المتاحون: العفاسي=7، عبدالباسط=1، الحصري=3، المنشاوي=5، الشريم=19',
            parameters: {
                type: 'object',
                properties: {
                    surah: { type: 'integer', description: 'رقم السورة (1-114). مثال: الفاتحة=1، البقرة=2، يس=36، الملك=67، الرحمن=55' },
                    reciterId: { type: 'integer', description: 'رقم القارئ: العفاسي=7، عبدالباسط=1، الحصري=3، المنشاوي=5، الشريم=19', default: 7 },
                },
                required: ['surah'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'record_progress',
            description: 'رصد درجات طالب. يستخدمه المعلم أو الأدمن لتسجيل الدرجات اليومية',
            parameters: {
                type: 'object',
                properties: {
                    studentName: { type: 'string', description: 'الاسم الكامل للطالب بالضبط كما في قائمة الطلاب' },
                    lessonScore: { type: 'integer', description: 'درجة الدرس (0-3)', minimum: 0, maximum: 3 },
                    revisionScore: { type: 'integer', description: 'درجة المراجعة (0-3)', minimum: 0, maximum: 3 },
                    tilawaScore: { type: 'integer', description: 'درجة التلاوة (0-3)', minimum: 0, maximum: 3 },
                    homeworkScore: { type: 'integer', description: 'درجة الواجب (0-3)', minimum: 0, maximum: 3 },
                    notes: { type: 'string', description: 'ملاحظات اختيارية' },
                },
                required: ['studentName', 'lessonScore', 'revisionScore', 'tilawaScore', 'homeworkScore'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'record_attendance',
            description: 'تسجيل حضور أو غياب أو إذن لطالب',
            parameters: {
                type: 'object',
                properties: {
                    studentName: { type: 'string', description: 'الاسم الكامل للطالب' },
                    status: { type: 'string', enum: ['present', 'absent', 'excused'], description: 'الحالة: present=حاضر، absent=غائب، excused=إذن' },
                },
                required: ['studentName', 'status'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'add_star',
            description: 'إضافة نجمة واحدة لطالب متميّز',
            parameters: {
                type: 'object',
                properties: {
                    studentName: { type: 'string', description: 'الاسم الكامل للطالب' },
                },
                required: ['studentName'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'bulk_attendance',
            description: 'تسجيل حضور أو غياب لمجموعة طلاب دفعة واحدة',
            parameters: {
                type: 'object',
                properties: {
                    studentNames: { type: 'array', items: { type: 'string' }, description: 'قائمة أسماء الطلاب الكاملة' },
                    status: { type: 'string', enum: ['present', 'absent'], description: 'الحالة للجميع' },
                },
                required: ['studentNames', 'status'],
            },
        },
    },
];

// Filter tools by role
function getToolsForRole(role) {
    if (role === 'student' || role === 'parent') {
        return TOOLS.filter(t => t.function.name === 'play_surah');
    }
    return TOOLS; // teacher + admin get all
}

// ─────────────────────────────────────────────
// TOOL EXECUTORS
// ─────────────────────────────────────────────

function getTodayStr() {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
}

async function findStudentByName(name, halaqaId) {
    if (!name) return null;

    let snap = await db.collection('students').where('fullName', '==', name).limit(1).get();
    if (!snap.empty) return { id: snap.docs[0].id, data: snap.docs[0].data() };

    // Fuzzy within halaqa
    if (halaqaId) {
        snap = await db.collection('students').where('halaqaId', '==', halaqaId).get();
        for (const doc of snap.docs) {
            const fn = doc.data().fullName || '';
            if (fn.includes(name) || name.includes(fn)) return { id: doc.id, data: doc.data() };
        }
    }

    // Global fuzzy
    snap = await db.collection('students').get();
    for (const doc of snap.docs) {
        const fn = doc.data().fullName || '';
        if (fn.includes(name) || name.includes(fn)) return { id: doc.id, data: doc.data() };
    }
    return null;
}

async function logAction(action, params, executorId, result) {
    try {
        await db.collection('robo_action_log').add({
            action, params, executorId,
            success: result.success,
            message: result.message || result.error || '',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            date: getTodayStr(),
        });
    } catch (e) { console.error('Log error:', e); }
}

async function executeTool(toolName, args, halaqaId, executorId) {
    const today = getTodayStr();

    switch (toolName) {
        case 'play_surah':
            return { success: true, message: `جاري تشغيل السورة 🎧`, surah: args.surah, reciterId: args.reciterId || 7 };

        case 'record_progress': {
            const student = await findStudentByName(args.studentName, halaqaId);
            if (!student) return { success: false, message: `لم أجد طالب باسم "${args.studentName}"` };

            const scores = { lessonScore: args.lessonScore, revisionScore: args.revisionScore, tilawaScore: args.tilawaScore, homeworkScore: args.homeworkScore };
            for (const [k, v] of Object.entries(scores)) {
                if (v < 0 || v > 3) return { success: false, message: `الدرجة ${v} خارج النطاق (0-3)` };
            }

            const docId = `${today}_${student.id}`;
            await db.collection('attendance').doc(docId).set({
                studentId: student.id, halaqaId: student.data.halaqaId || 'unknown',
                halaqaName: student.data.halaqaName || '', studentName: student.data.fullName,
                date: today, status: 'present', recordedBy: executorId || 'robo_ai',
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });

            await db.collection('progress').doc(docId).set({
                studentId: student.id, halaqaId: student.data.halaqaId || 'unknown',
                date: today, status: 'present', recordedBy: executorId || 'robo_ai',
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                ...scores, hasStar: false,
                ...(args.notes ? { notes: args.notes } : {}),
            }, { merge: true });

            const total = scores.lessonScore + scores.revisionScore + scores.tilawaScore + scores.homeworkScore;
            const result = { success: true, message: `✅ تم رصد درجات ${student.data.fullName} (${total}/12)` };
            await logAction('record_progress', args, executorId, result);
            return result;
        }

        case 'record_attendance': {
            const student = await findStudentByName(args.studentName, halaqaId);
            if (!student) return { success: false, message: `لم أجد طالب باسم "${args.studentName}"` };

            const docId = `${today}_${student.id}`;
            await db.collection('attendance').doc(docId).set({
                studentId: student.id, halaqaId: student.data.halaqaId || 'unknown',
                halaqaName: student.data.halaqaName || '', studentName: student.data.fullName,
                date: today, status: args.status, recordedBy: executorId || 'robo_ai',
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });

            const label = args.status === 'present' ? 'حضور ✅' : args.status === 'absent' ? 'غياب ❌' : 'إذن 📋';
            const result = { success: true, message: `تم تسجيل ${label} لـ ${student.data.fullName}` };
            await logAction('record_attendance', args, executorId, result);
            return result;
        }

        case 'add_star': {
            const student = await findStudentByName(args.studentName, halaqaId);
            if (!student) return { success: false, message: `لم أجد طالب باسم "${args.studentName}"` };

            await db.collection('students').doc(student.id).update({
                stars: admin.firestore.FieldValue.increment(1),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            const result = { success: true, message: `⭐ تم إضافة نجمة لـ ${student.data.fullName}` };
            await logAction('add_star', args, executorId, result);
            return result;
        }

        case 'bulk_attendance': {
            const names = args.studentNames || [];
            const status = args.status || 'present';
            let ok = 0, failed = [];

            for (const name of names) {
                const student = await findStudentByName(name, halaqaId);
                if (!student) { failed.push(name); continue; }
                const docId = `${today}_${student.id}`;
                await db.collection('attendance').doc(docId).set({
                    studentId: student.id, halaqaId: student.data.halaqaId || 'unknown',
                    halaqaName: student.data.halaqaName || '', studentName: student.data.fullName,
                    date: today, status, recordedBy: executorId || 'robo_ai',
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                }, { merge: true });
                ok++;
            }

            let msg = `✅ تم تسجيل ${status === 'present' ? 'حضور' : 'غياب'} ${ok} طالب`;
            if (failed.length > 0) msg += ` | لم أجد: ${failed.join('، ')}`;
            const result = { success: true, message: msg };
            await logAction('bulk_attendance', args, executorId, result);
            return result;
        }

        default:
            return { success: false, message: `أداة غير معروفة: ${toolName}` };
    }
}

// ─────────────────────────────────────────────
// DATA FETCHERS (context as separate message)
// ─────────────────────────────────────────────

function getMonthRange() {
    const now = new Date();
    const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, '0');
    const start = `${y}-${m}-01`;
    const endDate = new Date(y, now.getMonth() + 1, 0);
    const end = `${y}-${m}-${String(endDate.getDate()).padStart(2, '0')}`;
    return { start, end, label: `${m}/${y}` };
}

async function fetchStudentContext(studentId) {
    if (!studentId) return '';
    const today = getTodayStr();
    const { start, end, label } = getMonthRange();

    try {
        const [studentDoc, attSnap, progSnap] = await Promise.all([
            db.collection('students').doc(studentId).get(),
            db.collection('attendance').where('studentId', '==', studentId).where('date', '>=', start).where('date', '<=', end).get(),
            db.collection('progress').where('studentId', '==', studentId).where('date', '>=', start).where('date', '<=', end).get(),
        ]);

        let ctx = '\n--- بيانات الطالب ---';
        if (studentDoc.exists) {
            const s = studentDoc.data();
            ctx += `\nالاسم: ${s.fullName || '?'} | الحلقة: ${s.halaqaName || '?'} | النجوم: ${s.stars || 0} ⭐`;
            if (s.currentLevel) ctx += ` | مستوى القاعدة: ${s.currentLevel}`;
        }

        let present = 0, absent = 0, excused = 0;
        attSnap.forEach(doc => {
            const d = doc.data();
            if (d.status === 'present' || d.status === 'sard') present++;
            else if (d.status === 'absent') absent++;
            else if (d.status === 'excused') excused++;
        });
        ctx += `\nحضور شهر ${label}: حضور=${present} غياب=${absent} أعذار=${excused}`;

        const progDocs = [];
        progSnap.forEach(doc => progDocs.push(doc.data()));
        progDocs.sort((a, b) => b.date.localeCompare(a.date));

        if (progDocs.length > 0) {
            ctx += '\nآخر الدرجات:';
            for (const p of progDocs.slice(0, 5)) {
                ctx += `\n${p.date}: درس=${p.lessonScore || 0} مراجعة=${p.revisionScore || 0} تلاوة=${p.tilawaScore || 0} واجب=${p.homeworkScore || 0}${p.hasStar ? ' ⭐' : ''}`;
            }
        }
        return ctx;
    } catch (e) {
        console.error('Student context error:', e);
        return '';
    }
}

async function fetchTeacherContext(teacherId) {
    if (!teacherId) return { context: '', halaqaId: null };
    const today = getTodayStr();
    const { start, end, label } = getMonthRange();

    try {
        const teacherDoc = await db.collection('users').doc(teacherId).get();
        if (!teacherDoc.exists) return { context: '', halaqaId: null };

        const teacher = teacherDoc.data();
        const halaqaId = teacher.halaqaId;
        if (!halaqaId) return { context: '(المعلم غير مربوط بحلقة)', halaqaId: null };

        const [studentsSnap, todayAttSnap, monthAttSnap] = await Promise.all([
            db.collection('students').where('halaqaId', '==', halaqaId).get(),
            db.collection('attendance').where('halaqaId', '==', halaqaId).where('date', '==', today).get(),
            db.collection('attendance').where('halaqaId', '==', halaqaId).where('date', '>=', start).where('date', '<=', end).get(),
        ]);

        let ctx = `\n--- بيانات الحلقة ---`;
        ctx += `\nالمعلم: ${teacher.name || teacher.displayName || '?'} | الحلقة: ${teacher.halaqaName || halaqaId} | عدد الطلاب: ${studentsSnap.size}`;

        const studentNames = [];
        studentsSnap.forEach(doc => studentNames.push(doc.data().fullName || '?'));
        ctx += `\nالطلاب: ${studentNames.join('، ')}`;

        const todayMap = {};
        todayAttSnap.forEach(doc => { todayMap[doc.data().studentId] = doc.data().status; });

        const absentToday = [], presentToday = [], notRecorded = [];
        studentsSnap.forEach(doc => {
            const s = doc.data();
            const st = todayMap[doc.id];
            if (st === 'absent') absentToday.push(s.fullName);
            else if (st === 'present' || st === 'sard') presentToday.push(s.fullName);
            else notRecorded.push(s.fullName);
        });

        ctx += `\n\nاليوم (${today}): ${presentToday.length} حاضر، ${absentToday.length} غائب، ${notRecorded.length} لم يُسجّل`;
        if (absentToday.length > 0) ctx += `\nالغائبون: ${absentToday.join('، ')}`;
        if (notRecorded.length > 0) ctx += `\nلم يُرصد: ${notRecorded.join('، ')}`;

        // Most absent this month
        const absMap = {};
        monthAttSnap.forEach(doc => {
            const d = doc.data();
            if (d.status === 'absent') absMap[d.studentId] = (absMap[d.studentId] || 0) + 1;
        });
        const topAbsent = Object.entries(absMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
        if (topAbsent.length > 0) {
            ctx += `\n\nأكثر غياباً هذا الشهر:`;
            for (const [sid, cnt] of topAbsent) {
                const s = studentsSnap.docs.find(d => d.id === sid);
                ctx += `\n${s ? s.data().fullName : sid}: ${cnt} أيام`;
            }
        }

        return { context: ctx, halaqaId };
    } catch (e) {
        console.error('Teacher context error:', e);
        return { context: '', halaqaId: null };
    }
}

async function fetchAdminContext() {
    const today = getTodayStr();
    try {
        const [studentsSnap, halaqatSnap, todayAttSnap] = await Promise.all([
            db.collection('students').get(),
            db.collection('halaqat').get(),
            db.collection('attendance').where('date', '==', today).get(),
        ]);

        let ctx = `\n--- إحصائيات الأكاديمية ---`;
        let main = 0, reserve = 0;
        const allNames = [];
        studentsSnap.forEach(doc => {
            const d = doc.data();
            if (d.type === 'reserve') reserve++; else main++;
            allNames.push(d.fullName || '?');
        });
        ctx += `\nطلاب: ${studentsSnap.size} (أساسي: ${main}, احتياط: ${reserve}) | حلقات: ${halaqatSnap.size}`;
        ctx += `\nأسماء الطلاب: ${allNames.join('، ')}`;

        let p = 0, a = 0, e = 0;
        const hAbsent = {};
        todayAttSnap.forEach(doc => {
            const d = doc.data();
            if (d.status === 'present' || d.status === 'sard') p++;
            else if (d.status === 'absent') { a++; const h = d.halaqaName || '?'; hAbsent[h] = (hAbsent[h] || 0) + 1; }
            else if (d.status === 'excused') e++;
        });
        const total = p + a + e;
        ctx += `\n\nحضور اليوم: ${p} حاضر، ${a} غائب، ${e} إذن (نسبة: ${total > 0 ? Math.round(p / total * 100) : 0}%)`;

        if (Object.keys(hAbsent).length > 0) {
            ctx += `\nغياب حسب الحلقة:`;
            for (const [h, c] of Object.entries(hAbsent).sort((a, b) => b[1] - a[1])) ctx += ` ${h}:${c}`;
        }

        return ctx;
    } catch (err) {
        console.error('Admin context error:', err);
        return '';
    }
}

// ─────────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────────

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!GROQ_API_KEY) return res.status(500).json({ error: 'GROQ_API_KEY not set.' });

    const { message, role, studentId, teacherId, history, confirmAction } = req.body;

    // ── Handle confirmation of pending tool call ──
    if (confirmAction) {
        try {
            let halaqaId = null;
            if (teacherId) {
                const td = await db.collection('users').doc(teacherId).get();
                if (td.exists) halaqaId = td.data().halaqaId;
            }
            const result = await executeTool(confirmAction.toolName, confirmAction.args, halaqaId, teacherId || 'robo_ai');
            return res.status(200).json({
                success: true,
                reply: result.message,
                actionResult: result,
                surah: result.surah || null,
                reciterId: result.reciterId || null,
            });
        } catch (e) {
            return res.status(500).json({ success: false, reply: `خطأ: ${e.message}` });
        }
    }

    if (!message) return res.status(400).json({ error: 'Message is required' });

    try {
        let systemPrompt, context = '', halaqaId = null;

        switch (role) {
            case 'teacher': {
                systemPrompt = TEACHER_PROMPT;
                const r = await fetchTeacherContext(teacherId || studentId);
                context = r.context; halaqaId = r.halaqaId;
                break;
            }
            case 'admin':
                systemPrompt = ADMIN_PROMPT;
                context = await fetchAdminContext();
                break;
            case 'parent':
                systemPrompt = PARENT_PROMPT;
                context = await fetchStudentContext(studentId);
                break;
            default:
                systemPrompt = STUDENT_PROMPT;
                context = await fetchStudentContext(studentId);
                break;
        }

        // Build messages — context goes in a separate system message
        const messages = [
            { role: 'system', content: systemPrompt },
        ];

        if (context) {
            messages.push({ role: 'system', content: `بيانات حقيقية من قاعدة البيانات:\n${context}` });
        }

        if (history && Array.isArray(history)) {
            for (const h of history.slice(-8)) {
                messages.push({ role: h.role === 'user' ? 'user' : 'assistant', content: h.text });
            }
        }

        messages.push({ role: 'user', content: message });

        // Call Groq with TOOLS (no response_format json!)
        const tools = getToolsForRole(role);
        const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages,
                tools,
                tool_choice: 'auto',
                temperature: 0.7,
                max_tokens: 1024,
            }),
        });

        const groqData = await groqRes.json();
        if (!groqRes.ok) {
            console.error('Groq error:', JSON.stringify(groqData));
            return res.status(500).json({ error: 'Groq API error', details: groqData.error?.message });
        }

        const choice = groqData.choices?.[0];
        const responseMsg = choice?.message;

        // ── MODEL WANTS TO CALL A TOOL ──
        if (responseMsg?.tool_calls && responseMsg.tool_calls.length > 0) {
            const toolCall = responseMsg.tool_calls[0];
            const toolName = toolCall.function.name;
            let toolArgs;
            try { toolArgs = JSON.parse(toolCall.function.arguments); } catch { toolArgs = {}; }

            // play_surah: execute immediately (no confirmation needed)
            if (toolName === 'play_surah') {
                return res.status(200).json({
                    success: true,
                    reply: `جاري تشغيل السورة 🎧`,
                    action: 'play_surah',
                    surah: toolArgs.surah,
                    reciterId: toolArgs.reciterId || 7,
                });
            }

            // Other actions: send to Flutter for confirmation
            const actionLabels = {
                record_progress: `رصد درجات ${toolArgs.studentName}: درس=${toolArgs.lessonScore} مراجعة=${toolArgs.revisionScore} تلاوة=${toolArgs.tilawaScore} واجب=${toolArgs.homeworkScore}`,
                record_attendance: `تسجيل ${toolArgs.status === 'present' ? 'حضور' : toolArgs.status === 'absent' ? 'غياب' : 'إذن'} لـ ${toolArgs.studentName}`,
                add_star: `إضافة نجمة لـ ${toolArgs.studentName}`,
                bulk_attendance: `تسجيل ${toolArgs.status === 'present' ? 'حضور' : 'غياب'} ${toolArgs.studentNames?.length || 0} طالب`,
            };

            return res.status(200).json({
                success: true,
                reply: `${actionLabels[toolName] || toolName}\n\nهل تريد التنفيذ؟`,
                pendingAction: { toolName, args: toolArgs },
            });
        }

        // ── NORMAL TEXT RESPONSE ──
        return res.status(200).json({
            success: true,
            reply: responseMsg?.content || 'عذراً، لم أفهم طلبك.',
        });

    } catch (error) {
        console.error('AI Chat error:', error);
        return res.status(500).json({ error: error.message });
    }
}
