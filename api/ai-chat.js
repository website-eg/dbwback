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

## قواعد مهمة:
- البيانات الحقيقية مرفقة في رسالة النظام. حللها وقدم نصائح تحفيزية.
- الأداة الوحيدة المتاحة لك هي play_surah لتشغيل القرآن.
- لا تخترع بيانات أو درجات. استخدم فقط البيانات المرفقة.
- إذا لم تجد بيانات، قل "لم أجد بيانات" بدلاً من اختراعها.

## أمثلة:
- الطالب: "كيف أدائي؟" → حلل البيانات المرفقة وأجب بنص عادي. لا تستدعي أداة.
- الطالب: "شغل سورة البقرة" → استدعِ play_surah مع surah=2.
- الطالب: "كم نجومي؟" → اقرأ عدد النجوم من البيانات المرفقة وأجب بنص.`;

const TEACHER_PROMPT = `أنت "روبو" مساعد ذكي لتطبيق "بِرّ الوالدين" لتحفيظ القرآن الكريم.
تتحدث بالعربية مع إيموجي. أنت تتحدث مع معلم حلقة.

## القاعدة الذهبية — متى تستدعي أداة ومتى لا:

### ❌ لا تستدعِ أي أداة في هذه الحالات:
- أي سؤال استفهامي: "مين متغيب؟"، "كم الحضور؟"، "أعطني تقرير"، "كيف أداء فلان؟"
- طلب عام بدون أسماء محددة: "سجل حضور"، "ارصد درجات"
- طلب معلومات أو إحصائيات
→ في كل هذه الحالات: اقرأ البيانات المرفقة في رسالة النظام وأجب بنص عادي.

### ✅ استدعِ الأداة فقط في هذه الحالات:
- المستخدم ذكر اسم طالب حقيقي بوضوح + الإجراء المطلوب
- مثال: "سجل حضور أحمد محمد" → record_attendance
- مثال: "ارصد درجات يوسف: درس 3 مراجعة 2 تلاوة 3 واجب 1" → record_progress

### ⚠️ قواعد صارمة:
- لا تخترع أسماء طلاب أو درجات. استخدم فقط ما يذكره المستخدم حرفياً.
- إذا المستخدم لم يذكر كل الدرجات الأربع (درس، مراجعة، تلاوة، واجب) → اسأله عن الناقص.
- إذا قال اسم غير واضح أو مختصر → اسأله: "تقصد [الاسم الكامل]؟" بناءً على قائمة الطلاب المرفقة.
- الدرجات من 0 إلى 3 فقط. نجمة واحدة فقط في المرة.
- إذا قال "سجل حضور الكل" بدون أسماء → اسأله أن يحدد الأسماء.

## أمثلة:
- المعلم: "مين متغيب اليوم؟" → أجب من البيانات المرفقة بنص. لا تستدعِ أداة.
- المعلم: "سجل حضور" → اسأل: "حضور مَن؟ أعطني الأسماء."
- المعلم: "سجل حضور أحمد ويوسف" → استدعِ bulk_attendance.
- المعلم: "أعطني تقرير اليوم" → اقرأ البيانات وقدم تقرير نصي. لا أداة.
- المعلم: "ارصد درجات أحمد 3 2 3 1" → استدعِ record_progress.`;

const ADMIN_PROMPT = `أنت "روبو" مساعد ذكي لتطبيق "بِرّ الوالدين" لتحفيظ القرآن الكريم.
تتحدث بالعربية مع إيموجي. أنت تتحدث مع مدير الأكاديمية.

## القاعدة الذهبية — متى تستدعي أداة ومتى لا:

### ❌ لا تستدعِ أي أداة في هذه الحالات:
- أي سؤال عن إحصائيات أو تقارير أو غياب أو حضور
- طلب عام بدون أسماء محددة
→ اقرأ البيانات المرفقة في رسالة النظام وأجب بنص.

### ✅ استدعِ الأداة فقط عندما:
- يذكر اسم طالب حقيقي + إجراء محدد (حضور/غياب/درجات/نجمة)

### ⚠️ قواعد صارمة:
- لا تخترع بيانات. البيانات الحقيقية مرفقة فقط.
- إذا المستخدم لم يحدد أسماء → اسأله.
- الدرجات 0-3. نجمة واحدة فقط.

## أمثلة:
- المدير: "كم نسبة الحضور؟" → أجب من البيانات. لا أداة.
- المدير: "مين متغيب اليوم؟" → أجب من البيانات. لا أداة.
- المدير: "أضف نجمة لأحمد" → استدعِ add_star.`;

const PARENT_PROMPT = `أنت "روبو" مساعد ذكي لتطبيق "بِرّ الوالدين" لتحفيظ القرآن الكريم.
تتحدث بالعربية. أنت تتحدث مع ولي أمر طالب.

## مهامك:
- أخبره عن حالة ابنه: حضوره، درجاته، نجومه (من البيانات المرفقة).
- قدم نصائح لمساعدة ابنه في الحفظ والمراجعة.
- يمكنك تشغيل سور القرآن له (الأداة الوحيدة المتاحة: play_surah).

## قواعد:
- لا تخترع بيانات. استخدم فقط البيانات المرفقة.
- إذا سأل عن حالة ابنه → اقرأ البيانات وأجب. لا تستدعِ أداة.
- إذا طلب تشغيل سورة → استدعِ play_surah.`;

// ─────────────────────────────────────────────
// TOOL DEFINITIONS (Groq function calling)
// ─────────────────────────────────────────────

const TOOLS = [
    {
        type: 'function',
        function: {
            name: 'play_surah',
            description: 'تشغيل سورة من القرآن الكريم بصوت قارئ. القراء: العفاسي=7، عبدالباسط=1، الحصري=3، المنشاوي=5، الشريم=19. استدعِ هذه الأداة فقط عندما يطلب المستخدم تشغيل/سماع سورة. لا تستدعها للإجابة عن أسئلة.',
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
            description: 'رصد درجات طالب معيّن. شروط الاستدعاء: (1) المستخدم ذكر اسم طالب حقيقي (2) المستخدم حدد الدرجات الأربع. لا تستدعها إذا: السؤال استفهامي، أو لم يحدد اسم، أو لم يذكر درجات. لا تخترع درجات افتراضية.',
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
            description: 'تسجيل حضور أو غياب لطالب واحد بالاسم. استدعِ فقط عندما يقول المستخدم "سجل حضور/غياب [اسم]". لا تستدعها أبداً عند: سؤال "مين حاضر/متغيب؟" أو طلب تقرير أو إحصائيات. الأسئلة تُجاب من البيانات بدون أداة.',
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
            description: 'إضافة نجمة واحدة لطالب بالاسم. استدعِ فقط عندما يطلب المستخدم صراحة إضافة نجمة لطالب محدد بالاسم. لا تستدعها للسؤال عن نجوم الطالب.',
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
            description: 'تسجيل حضور أو غياب لمجموعة طلاب. شروط: المستخدم يجب أن يذكر أسماء طلاب محددة. لا تستدعها إذا: قال "سجل حضور الكل" بدون أسماء، أو سأل سؤال استفهامي. إذا لم يذكر أسماء → اسأله.',
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
    if (!name || name.trim().length < 2) return null;
    const cleanName = name.trim();

    // 1) Exact match (highest priority)
    let snap = await db.collection('students').where('fullName', '==', cleanName).limit(1).get();
    if (!snap.empty) return { id: snap.docs[0].id, data: snap.docs[0].data() };

    // 2) Fuzzy within halaqa (safer scope)
    if (halaqaId) {
        snap = await db.collection('students').where('halaqaId', '==', halaqaId).get();
        const matches = [];
        for (const doc of snap.docs) {
            const fn = doc.data().fullName || '';
            if (fn.includes(cleanName) || cleanName.includes(fn)) matches.push({ id: doc.id, data: doc.data() });
        }
        if (matches.length === 1) return matches[0];
        if (matches.length > 1) {
            return { ambiguous: true, names: matches.map(m => m.data.fullName) };
        }
    }

    // 3) Global fuzzy (last resort, with ambiguity check)
    snap = await db.collection('students').get();
    const globalMatches = [];
    for (const doc of snap.docs) {
        const fn = doc.data().fullName || '';
        if (fn.includes(cleanName) || cleanName.includes(fn)) globalMatches.push({ id: doc.id, data: doc.data() });
    }
    if (globalMatches.length === 1) return globalMatches[0];
    if (globalMatches.length > 1) {
        return { ambiguous: true, names: globalMatches.map(m => m.data.fullName) };
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

// Helper: check findStudentByName result for ambiguity
function handleStudentResult(result, studentName) {
    if (!result) return { error: true, message: `لم أجد طالب باسم "${studentName}"` };
    if (result.ambiguous) return { error: true, message: `وجدت أكثر من طالب يطابق "${studentName}": ${result.names.join('، ')}. حدد الاسم الكامل.` };
    return { error: false, student: result };
}

async function executeTool(toolName, args, halaqaId, executorId) {
    const today = getTodayStr();

    switch (toolName) {
        case 'play_surah':
            return { success: true, message: `جاري تشغيل السورة 🎧`, surah: args.surah, reciterId: args.reciterId || 7 };

        case 'record_progress': {
            const found = handleStudentResult(await findStudentByName(args.studentName, halaqaId), args.studentName);
            if (found.error) return { success: false, message: found.message };
            const student = found.student;

            const scores = { lessonScore: args.lessonScore, revisionScore: args.revisionScore, tilawaScore: args.tilawaScore, homeworkScore: args.homeworkScore };
            for (const [k, v] of Object.entries(scores)) {
                if (v === undefined || v === null) return { success: false, message: `الدرجة "${k}" غير محددة. يجب تحديد كل الدرجات الأربع.` };
                if (v < 0 || v > 3) return { success: false, message: `الدرجة ${v} خارج النطاق (0-3)` };
            }

            const docId = `${today}_${student.id}`;

            // Check for existing record today
            const existingProgress = await db.collection('progress').doc(docId).get();
            let updateNote = '';
            if (existingProgress.exists) {
                updateNote = ' (تم تحديث سجل موجود)';
            }

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
            const result = { success: true, message: `✅ تم رصد درجات ${student.data.fullName} (${total}/12)${updateNote}` };
            await logAction('record_progress', args, executorId, result);
            return result;
        }

        case 'record_attendance': {
            const found = handleStudentResult(await findStudentByName(args.studentName, halaqaId), args.studentName);
            if (found.error) return { success: false, message: found.message };
            const student = found.student;

            const docId = `${today}_${student.id}`;

            // Check existing attendance
            const existingAtt = await db.collection('attendance').doc(docId).get();
            let updateNote = '';
            if (existingAtt.exists) {
                const prev = existingAtt.data().status;
                if (prev === args.status) {
                    return { success: true, message: `${student.data.fullName} مسجّل ${args.status === 'present' ? 'حاضر' : args.status === 'absent' ? 'غائب' : 'إذن'} بالفعل اليوم ✓` };
                }
                updateNote = ` (تم تعديل من ${prev === 'present' ? 'حاضر' : prev === 'absent' ? 'غائب' : 'إذن'})`;
            }

            await db.collection('attendance').doc(docId).set({
                studentId: student.id, halaqaId: student.data.halaqaId || 'unknown',
                halaqaName: student.data.halaqaName || '', studentName: student.data.fullName,
                date: today, status: args.status, recordedBy: executorId || 'robo_ai',
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });

            const label = args.status === 'present' ? 'حضور ✅' : args.status === 'absent' ? 'غياب ❌' : 'إذن 📋';
            const result = { success: true, message: `تم تسجيل ${label} لـ ${student.data.fullName}${updateNote}` };
            await logAction('record_attendance', args, executorId, result);
            return result;
        }

        case 'add_star': {
            const found = handleStudentResult(await findStudentByName(args.studentName, halaqaId), args.studentName);
            if (found.error) return { success: false, message: found.message };
            const student = found.student;

            await db.collection('students').doc(student.id).update({
                stars: admin.firestore.FieldValue.increment(1),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            const result = { success: true, message: `⭐ تم إضافة نجمة لـ ${student.data.fullName} (المجموع: ${(student.data.stars || 0) + 1})` };
            await logAction('add_star', args, executorId, result);
            return result;
        }

        case 'bulk_attendance': {
            const names = args.studentNames || [];
            if (names.length === 0) return { success: false, message: 'لم تحدد أسماء طلاب.' };
            const status = args.status || 'present';
            let ok = 0, failed = [], ambiguous = [];

            for (const name of names) {
                const result = await findStudentByName(name, halaqaId);
                if (!result) { failed.push(name); continue; }
                if (result.ambiguous) { ambiguous.push(name); continue; }
                const student = result;
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
            if (ambiguous.length > 0) msg += ` | أسماء غامضة: ${ambiguous.join('، ')}`;
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

        const [studentsSnap, todayAttSnap, monthAttSnap, todayProgressSnap] = await Promise.all([
            db.collection('students').where('halaqaId', '==', halaqaId).get(),
            db.collection('attendance').where('halaqaId', '==', halaqaId).where('date', '==', today).get(),
            db.collection('attendance').where('halaqaId', '==', halaqaId).where('date', '>=', start).where('date', '<=', end).get(),
            db.collection('progress').where('halaqaId', '==', halaqaId).where('date', '==', today).get(),
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
        if (presentToday.length > 0) ctx += `\nالحاضرون: ${presentToday.join('، ')}`;
        if (absentToday.length > 0) ctx += `\nالغائبون: ${absentToday.join('، ')}`;
        if (notRecorded.length > 0) ctx += `\nلم يُسجّل حضورهم بعد: ${notRecorded.join('، ')}`;

        // Today's progress tracking
        const progressMap = {};
        todayProgressSnap.forEach(doc => { progressMap[doc.data().studentId] = doc.data(); });
        const noProgress = [];
        studentsSnap.forEach(doc => {
            if (!progressMap[doc.id]) noProgress.push(doc.data().fullName || '?');
        });
        if (noProgress.length > 0) {
            ctx += `\nلم تُرصد درجاتهم اليوم: ${noProgress.join('، ')}`;
        }
        // Show today's recorded scores
        const progEntries = Object.values(progressMap);
        if (progEntries.length > 0) {
            ctx += `\n\nدرجات اليوم المرصودة:`;
            for (const p of progEntries) {
                ctx += `\n${p.studentName || '?'}: درس=${p.lessonScore ?? '?'} مراجعة=${p.revisionScore ?? '?'} تلاوة=${p.tilawaScore ?? '?'} واجب=${p.homeworkScore ?? '?'}${p.hasStar ? ' ⭐' : ''}`;
            }
        }

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
        const halaqaMap = {};
        studentsSnap.forEach(doc => {
            const d = doc.data();
            if (d.type === 'reserve') reserve++; else main++;
            allNames.push(d.fullName || '?');
            const hName = d.halaqaName || 'غير محدد';
            if (!halaqaMap[hName]) halaqaMap[hName] = [];
            halaqaMap[hName].push(d.fullName || '?');
        });
        ctx += `\nطلاب: ${studentsSnap.size} (أساسي: ${main}, احتياط: ${reserve}) | حلقات: ${halaqatSnap.size}`;

        // Halaqat details
        const halaqaDetails = [];
        halaqatSnap.forEach(doc => {
            const h = doc.data();
            halaqaDetails.push({ name: h.name || doc.id, teacherName: h.teacherName || '?' });
        });
        if (halaqaDetails.length > 0) {
            ctx += `\n\nالحلقات:`;
            for (const h of halaqaDetails) {
                const studentCount = halaqaMap[h.name]?.length || 0;
                ctx += `\n${h.name} (المعلم: ${h.teacherName}, ${studentCount} طالب)`;
            }
        }

        ctx += `\n\nأسماء جميع الطلاب: ${allNames.join('، ')}`;

        let p = 0, a = 0, e = 0;
        const hAbsent = {};
        const absentNames = [];
        todayAttSnap.forEach(doc => {
            const d = doc.data();
            if (d.status === 'present' || d.status === 'sard') p++;
            else if (d.status === 'absent') { a++; absentNames.push(d.studentName || '?'); const h = d.halaqaName || '?'; hAbsent[h] = (hAbsent[h] || 0) + 1; }
            else if (d.status === 'excused') e++;
        });
        const total = p + a + e;
        ctx += `\n\nحضور اليوم: ${p} حاضر، ${a} غائب، ${e} إذن (نسبة: ${total > 0 ? Math.round(p / total * 100) : 0}%)`;
        if (absentNames.length > 0) ctx += `\nالغائبون اليوم: ${absentNames.join('، ')}`;

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
        // Lower temperature for data-sensitive roles (teacher/admin)
        const temp = (role === 'teacher' || role === 'admin') ? 0.3 : 0.7;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 25000); // 25s timeout

        let groqRes;
        try {
            groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
                body: JSON.stringify({
                    model: 'llama-3.3-70b-versatile',
                    messages,
                    tools,
                    tool_choice: 'auto',
                    temperature: temp,
                    max_tokens: 1024,
                }),
                signal: controller.signal,
            });
        } catch (fetchErr) {
            if (fetchErr.name === 'AbortError') {
                return res.status(504).json({ error: 'انتهت مهلة الاتصال بالخادم. حاول مرة أخرى.' });
            }
            throw fetchErr;
        } finally {
            clearTimeout(timeout);
        }

        const groqData = await groqRes.json();
        if (!groqRes.ok) {
            console.error('Groq error:', JSON.stringify(groqData));
            const friendlyMsg = groqData.error?.message?.includes('rate_limit') ? 'عدد الطلبات كبير. انتظر قليلاً وحاول مرة أخرى.' : 'حدث خطأ في الخادم الذكي. حاول مرة أخرى.';
            return res.status(500).json({ error: friendlyMsg, details: groqData.error?.message });
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
        return res.status(500).json({ error: 'عذراً، حدث خطأ غير متوقع. حاول مرة أخرى. 🔄' });
    }
}
