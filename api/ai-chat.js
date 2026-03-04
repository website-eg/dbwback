// api/ai-chat.js
// Groq AI proxy for "روبو" — Multi-role assistant with ACTION EXECUTION
// Model: Llama 3.3 70B | Free tier: 30 RPM, 14,400/day

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

// ─────────────────────────────────────────────
// MULTI-KEY ROUND ROBIN (supports up to 10 keys)
// ─────────────────────────────────────────────
const GROQ_KEYS = [
    process.env.GROQ_API_KEY,
    process.env.GROQ_API_KEY_2,
    process.env.GROQ_API_KEY_3,
    process.env.GROQ_API_KEY_4,
    process.env.GROQ_API_KEY_5,
    process.env.GROQ_API_KEY_6,
    process.env.GROQ_API_KEY_7,
    process.env.GROQ_API_KEY_8,
    process.env.GROQ_API_KEY_9,
    process.env.GROQ_API_KEY_10,
].filter(Boolean);

let keyIndex = 0;
function getNextKey() {
    const key = GROQ_KEYS[keyIndex % GROQ_KEYS.length];
    keyIndex++;
    return key;
}

// ─────────────────────────────────────────────
// SYSTEM PROMPTS
// ─────────────────────────────────────────────

const BASE_PROMPT = `أنت "روبو" — مساعد ذكي لتطبيق "بِرّ الوالدين" لتحفيظ القرآن الكريم.
شخصيتك ودودة ومحفزة. تتحدث بالعربية الفصحى البسيطة مع إيموجي.

القراء المتاحون:
- العفاسي (id: 7)، عبدالباسط (id: 1)، الحصري (id: 3)، المنشاوي (id: 5)، سعود الشريم (id: 19)

أسماء السور: الفاتحة=1، البقرة=2، آل عمران=3، النساء=4، المائدة=5، الأنعام=6، الأعراف=7، الأنفال=8، التوبة=9، يونس=10، هود=11، يوسف=12، الرعد=13، إبراهيم=14، الحجر=15، النحل=16، الإسراء=17، الكهف=18، مريم=19، طه=20، الأنبياء=21، الحج=22، المؤمنون=23، النور=24، الفرقان=25، الشعراء=26، النمل=27، القصص=28، العنكبوت=29، الروم=30، لقمان=31، السجدة=32، الأحزاب=33، سبأ=34، فاطر=35، يس=36، الصافات=37، ص=38، الزمر=39، غافر=40، فصلت=41، الشورى=42، الزخرف=43، الدخان=44، الجاثية=45، الأحقاف=46، محمد=47، الفتح=48، الحجرات=49، ق=50، الذاريات=51، الطور=52، النجم=53، القمر=54، الرحمن=55، الواقعة=56، الحديد=57، المجادلة=58، الحشر=59، الممتحنة=60، الصف=61، الجمعة=62، المنافقون=63، التغابن=64، الطلاق=65، التحريم=66، الملك=67، القلم=68، الحاقة=69، المعارج=70، نوح=71، الجن=72، المزمل=73، المدثر=74، القيامة=75، الإنسان=76، المرسلات=77، النبأ=78، النازعات=79، عبس=80، التكوير=81، الانفطار=82، المطففين=83، الانشقاق=84، البروج=85، الطارق=86، الأعلى=87، الغاشية=88، الفجر=89، البلد=90، الشمس=91، الليل=92، الضحى=93، الشرح=94، التين=95، العلق=96، القدر=97، البينة=98، الزلزلة=99، العاديات=100، القارعة=101، التكاثر=102، العصر=103، الهمزة=104، الفيل=105، قريش=106، الماعون=107، الكوثر=108، الكافرون=109، النصر=110، المسد=111، الإخلاص=112، الفلق=113، الناس=114

دائماً أرجع JSON صالح فقط.`;

const STUDENT_PROMPT = `${BASE_PROMPT}

أنت تتحدث مع **طالب**. مهامك:
1. تشغيل سور القرآن بصوت أي قارئ
2. الإجابة عن أسئلة إسلامية ودينية
3. تحليل بيانات الطالب (حضور، درجات، نجوم) وتقديم نصائح تحفيزية
4. شرح كيفية استخدام التطبيق
5. التحفيز والتشجيع بناءً على مستوى الأداء

عندما يسأل عن أدائه أو درجاته أو حضوره، حلل البيانات المرفقة وأعطه ملخصاً تحفيزياً.

الأكشنات المتاحة:
- تشغيل سورة: {"reply": "جاري تشغيل سورة X 🎧", "action": "play_surah", "surah": رقم, "reciterId": رقم}
- ردود عادية: {"reply": "نص الرد"}`;

const TEACHER_PROMPT = `${BASE_PROMPT}

أنت تتحدث مع **معلم**. لديك صلاحية **تنفيذ أوامر** في قاعدة البيانات.

مهامك:
1. تقارير الحلقة (حضور، غياب، أداء)
2. **تنفيذ أوامر المعلم** مثل رصد درجات، تسجيل حضور/غياب، إضافة نجوم
3. تشغيل سور القرآن

### الأكشنات المتاحة (أرجع هذا JSON عند طلب تنفيذ أمر):

1. **رصد درجات طالب:**
{"reply": "تم رصد درجات [اسم] ✅", "action": "record_progress", "params": {"studentName": "اسم الطالب كما هو في البيانات", "lessonScore": 0-10, "revisionScore": 0-10, "tilawaScore": 0-10, "homeworkScore": 0-10, "notes": "ملاحظات اختيارية"}}

2. **تسجيل حضور/غياب طالب:**
{"reply": "تم تسجيل حضور [اسم] ✅", "action": "record_attendance", "params": {"studentName": "اسم الطالب", "status": "present أو absent أو excused"}}

3. **إضافة نجوم لطالب:**
{"reply": "تم إضافة X نجوم ل[اسم] ⭐", "action": "add_stars", "params": {"studentName": "اسم الطالب", "count": عدد}}

4. **تسجيل حضور مجموعة طلاب:**
{"reply": "تم تسجيل حضور X طالب ✅", "action": "bulk_attendance", "params": {"status": "present أو absent", "studentNames": ["اسم1", "اسم2"]}}

5. **تشغيل سورة:**
{"reply": "جاري تشغيل سورة X 🎧", "action": "play_surah", "surah": رقم, "reciterId": رقم}

6. **ردود عادية (بدون تنفيذ):**
{"reply": "نص الرد"}

### قواعد مهمة:
- عند رصد الدرجات، استخدم **الاسم الكامل بالضبط** كما هو في بيانات الطلاب المرفقة.
- إذا لم تجد الطالب في البيانات، اسأل المعلم عن الاسم الصحيح. لا تخمن.
- الدرجات من 0 إلى 10 لكل مادة. إذا أعطاك المعلم رقم أكبر من 3 أو سالب، نبّهه واسأله "هل تقصد X؟" ولا تنفذ الأمر.
- إذا لم يحدد المعلم درجة مادة معينة، اتركها 0.
- عند تسجيل الحضور بدون تحديد الحالة، افترض "present".
- النجوم: الحد الأقصى 1 نجوم في المرة الواحدة. إذا طلب أكثر نبّهه.
- تأكد من مطابقة الاسم بالضبط مع قائمة الطلاب.`;

const ADMIN_PROMPT = `${BASE_PROMPT}

أنت تتحدث مع **مدير الأكاديمية**. لديك كل صلاحيات المعلم بالإضافة لصلاحيات إدارية.

مهامك:
1. تقديم إحصائيات عامة (عدد الطلاب، الحلقات، نسبة الحضور)
2. مقارنة أداء الحلقات
3. **تنفيذ أوامر** مثل رصد درجات، تسجيل حضور/غياب، إضافة نجوم
4. تشغيل سور القرآن

### الأكشنات المتاحة (نفس أكشنات المعلم بالضبط):

1. **رصد درجات طالب:**
{"reply": "تم رصد درجات [اسم] ✅", "action": "record_progress", "params": {"studentName": "اسم الطالب", "lessonScore": 0-10, "revisionScore": 0-10, "tilawaScore": 0-10, "homeworkScore": 0-10, "notes": "ملاحظات اختيارية"}}

2. **تسجيل حضور/غياب:**
{"reply": "تم تسجيل حضور [اسم] ✅", "action": "record_attendance", "params": {"studentName": "اسم الطالب", "status": "present أو absent أو excused"}}

3. **إضافة نجوم:**
{"reply": "تم إضافة X نجوم ⭐", "action": "add_stars", "params": {"studentName": "اسم الطالب", "count": عدد}}

4. **حضور جماعي:**
{"reply": "تم تسجيل حضور X طالب ✅", "action": "bulk_attendance", "params": {"status": "present", "studentNames": ["اسم1", "اسم2"]}}

5. **تشغيل سورة:**
{"reply": "جاري تشغيل سورة X 🎧", "action": "play_surah", "surah": رقم, "reciterId": رقم}

6. **ردود عادية:**
{"reply": "نص الرد"}

### قواعد مهمة:
- استخدم الاسم الكامل بالضبط كما في البيانات.
- إذا لم تجد الطالب، اسأل عن الاسم الصحيح.
- الدرجات من 0 إلى 3. إذا أعطاك رقم أكبر من 3 أو سالب، نبّهه ولا تنفذ.
- النجوم: الحد الأقصى 1 في المرة. إذا طلب أكثر نبّهه.`;

// ─────────────────────────────────────────────
// ACTION EXECUTOR
// ─────────────────────────────────────────────

async function findStudentByName(name, halaqaId) {
    // Try exact match first
    let snap = await db.collection('students')
        .where('fullName', '==', name)
        .limit(1)
        .get();

    if (!snap.empty) return { id: snap.docs[0].id, data: snap.docs[0].data() };

    // Try within halaqa if provided
    if (halaqaId) {
        snap = await db.collection('students')
            .where('halaqaId', '==', halaqaId)
            .get();

        // Fuzzy match: check if name contains or is contained
        for (const doc of snap.docs) {
            const fullName = doc.data().fullName || '';
            if (fullName.includes(name) || name.includes(fullName)) {
                return { id: doc.id, data: doc.data() };
            }
        }
    }

    // Global fuzzy
    snap = await db.collection('students').get();
    for (const doc of snap.docs) {
        const fullName = doc.data().fullName || '';
        if (fullName.includes(name) || name.includes(fullName)) {
            return { id: doc.id, data: doc.data() };
        }
    }

    return null;
}

function getTodayStr() {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
}

async function executeAction(action, params, halaqaId, executorId) {
    const today = getTodayStr();

    switch (action) {
        case 'record_progress': {
            const student = await findStudentByName(params.studentName, halaqaId);
            if (!student) return { success: false, error: `لم أجد طالب باسم "${params.studentName}"` };

            const docId = `${today}_${student.id}`;

            // Validate scores (0-10 range)
            const scoreFields = ['lessonScore', 'revisionScore', 'tilawaScore', 'homeworkScore'];
            const scoreLabels = { lessonScore: 'الدرس', revisionScore: 'المراجعة', tilawaScore: 'التلاوة', homeworkScore: 'الواجب' };
            let warnings = [];

            for (const field of scoreFields) {
                const val = Number(params[field]) || 0;
                if (val < 0 || val > 3) {
                    warnings.push(`${scoreLabels[field]}: ${val} (يجب أن تكون بين 0 و 3)`);
                }
            }

            if (warnings.length > 0) {
                return {
                    success: false,
                    error: `⚠️ درجات خارج النطاق:\n${warnings.join('\n')}\n\nالدرجات يجب أن تكون من 0 إلى 3. أعد المحاولة بأرقام صحيحة.`
                };
            }

            // Save attendance as present
            await db.collection('attendance').doc(docId).set({
                studentId: student.id,
                halaqaId: student.data.halaqaId || 'unknown',
                halaqaName: student.data.halaqaName || '',
                studentName: student.data.fullName,
                date: today,
                status: 'present',
                recordedBy: executorId || 'robo_ai',
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });

            // Save progress
            const progressData = {
                studentId: student.id,
                halaqaId: student.data.halaqaId || 'unknown',
                date: today,
                status: 'present',
                recordedBy: executorId || 'robo_ai',
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                lessonScore: Number(params.lessonScore) || 0,
                revisionScore: Number(params.revisionScore) || 0,
                tilawaScore: Number(params.tilawaScore) || 0,
                homeworkScore: Number(params.homeworkScore) || 0,
                hasStar: params.hasStar || false,
            };
            if (params.notes) progressData.notes = params.notes;

            await db.collection('progress').doc(docId).set(progressData, { merge: true });

            const total = progressData.lessonScore + progressData.revisionScore + progressData.tilawaScore + progressData.homeworkScore;
            return {
                success: true,
                message: `تم رصد درجات ${student.data.fullName} (${total}/40) ✅`,
                studentName: student.data.fullName,
            };
        }

        case 'record_attendance': {
            const student = await findStudentByName(params.studentName, halaqaId);
            if (!student) return { success: false, error: `لم أجد طالب باسم "${params.studentName}"` };

            const docId = `${today}_${student.id}`;
            const status = params.status || 'present';

            await db.collection('attendance').doc(docId).set({
                studentId: student.id,
                halaqaId: student.data.halaqaId || 'unknown',
                halaqaName: student.data.halaqaName || '',
                studentName: student.data.fullName,
                date: today,
                status: status,
                recordedBy: executorId || 'robo_ai',
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });

            const statusLabel = status === 'present' ? 'حضور ✅' : status === 'absent' ? 'غياب ❌' : 'إذن 📋';
            return {
                success: true,
                message: `تم تسجيل ${statusLabel} لـ ${student.data.fullName}`,
                studentName: student.data.fullName,
            };
        }

        case 'add_stars': {
            const student = await findStudentByName(params.studentName, halaqaId);
            if (!student) return { success: false, error: `لم أجد طالب باسم "${params.studentName}"` };

            const rawCount = Number(params.count) || 1;
            if (rawCount < 1 || rawCount > 1) {
                return { success: false, error: `⚠️ الحد الأقصى للنجوم هو 1 في المرة الواحدة.` };
            }
            const count = rawCount;

            await db.collection('students').doc(student.id).update({
                stars: admin.firestore.FieldValue.increment(count),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            return {
                success: true,
                message: `تم إضافة ${count} نجمة لـ ${student.data.fullName} ⭐`,
                studentName: student.data.fullName,
            };
        }

        case 'bulk_attendance': {
            const names = params.studentNames || [];
            const status = params.status || 'present';
            let successCount = 0;
            let failedNames = [];

            for (const name of names) {
                const student = await findStudentByName(name, halaqaId);
                if (!student) {
                    failedNames.push(name);
                    continue;
                }

                const docId = `${today}_${student.id}`;
                await db.collection('attendance').doc(docId).set({
                    studentId: student.id,
                    halaqaId: student.data.halaqaId || 'unknown',
                    halaqaName: student.data.halaqaName || '',
                    studentName: student.data.fullName,
                    date: today,
                    status: status,
                    recordedBy: executorId || 'robo_ai',
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                }, { merge: true });
                successCount++;
            }

            let msg = `تم تسجيل ${status === 'present' ? 'حضور' : 'غياب'} ${successCount} طالب ✅`;
            if (failedNames.length > 0) {
                msg += `\n⚠️ لم أجد: ${failedNames.join('، ')}`;
            }
            return { success: true, message: msg };
        }

        default:
            return { success: false, error: `أكشن غير معروف: ${action}` };
    }
}

// ─────────────────────────────────────────────
// DATA FETCHERS
// ─────────────────────────────────────────────

function getMonthRange() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const start = `${year}-${month}-01`;
    const endDate = new Date(year, now.getMonth() + 1, 0);
    const end = `${year}-${month}-${String(endDate.getDate()).padStart(2, '0')}`;
    return { start, end, label: `${month}/${year}` };
}

async function fetchStudentContext(studentId) {
    if (!studentId) return '';

    const today = getTodayStr();
    const { start, end, label } = getMonthRange();

    try {
        const [studentDoc, attSnap, progSnap] = await Promise.all([
            db.collection('students').doc(studentId).get(),
            db.collection('attendance')
                .where('studentId', '==', studentId)
                .where('date', '>=', start)
                .where('date', '<=', end)
                .get(),
            db.collection('progress')
                .where('studentId', '==', studentId)
                .where('date', '>=', start)
                .where('date', '<=', end)
                .get(),
        ]);

        let ctx = '\n--- بيانات الطالب ---';

        if (studentDoc.exists) {
            const s = studentDoc.data();
            ctx += `\nالاسم: ${s.fullName || 'غير معروف'}`;
            ctx += `\nالحلقة: ${s.halaqaName || 'غير محدد'}`;
            ctx += `\nالنوع: ${s.type === 'reserve' ? 'احتياط' : 'أساسي'}`;
            ctx += `\nالنجوم: ${s.stars || 0} ⭐`;
            if (s.currentLevel) ctx += `\nمستوى القاعدة: ${s.currentLevel}`;
        }

        let present = 0, absent = 0, excused = 0;
        let todayStatus = 'لم يُسجّل بعد';
        attSnap.forEach(doc => {
            const d = doc.data();
            if (d.status === 'present' || d.status === 'sard') present++;
            else if (d.status === 'absent') absent++;
            else if (d.status === 'excused') excused++;
            if (d.date === today) todayStatus = d.status === 'present' ? 'حاضر ✅' : d.status === 'absent' ? 'غائب ❌' : 'إذن 📋';
        });
        ctx += `\n\nحضور شهر ${label}: حضور=${present}، غياب=${absent}، أعذار=${excused}`;
        ctx += `\nحالة اليوم: ${todayStatus}`;

        const progDocs = [];
        progSnap.forEach(doc => progDocs.push(doc.data()));
        progDocs.sort((a, b) => b.date.localeCompare(a.date));

        if (progDocs.length > 0) {
            ctx += `\n\nآخر الدرجات:`;
            for (const p of progDocs.slice(0, 5)) {
                const total = (Number(p.lessonScore || 0) + Number(p.revisionScore || 0) +
                    Number(p.tilawaScore || 0) + Number(p.homeworkScore || 0));
                ctx += `\n- ${p.date}: مجموع=${total}/40 (درس=${p.lessonScore || 0}، مراجعة=${p.revisionScore || 0}، تلاوة=${p.tilawaScore || 0}، واجب=${p.homeworkScore || 0})${p.hasStar ? ' ⭐' : ''}`;
            }
        }

        return ctx;
    } catch (e) {
        console.error('Student context error:', e);
        return '\n(فشل جلب بيانات الطالب)';
    }
}

async function fetchTeacherContext(teacherId) {
    if (!teacherId) return { context: '', halaqaId: null };

    const today = getTodayStr();
    const { start, end, label } = getMonthRange();

    try {
        const teacherDoc = await db.collection('users').doc(teacherId).get();
        if (!teacherDoc.exists) return { context: '\n(المعلم غير موجود)', halaqaId: null };

        const teacher = teacherDoc.data();
        const halaqaId = teacher.halaqaId;
        if (!halaqaId) return { context: '\n(المعلم غير مربوط بحلقة)', halaqaId: null };

        const [studentsSnap, todayAttSnap, monthAttSnap] = await Promise.all([
            db.collection('students').where('halaqaId', '==', halaqaId).get(),
            db.collection('attendance').where('halaqaId', '==', halaqaId).where('date', '==', today).get(),
            db.collection('attendance').where('halaqaId', '==', halaqaId).where('date', '>=', start).where('date', '<=', end).get(),
        ]);

        let ctx = '\n--- بيانات الحلقة ---';
        ctx += `\nاسم المعلم: ${teacher.name || teacher.displayName || 'غير معروف'}`;
        ctx += `\nالحلقة: ${teacher.halaqaName || halaqaId}`;
        ctx += `\nعدد الطلاب: ${studentsSnap.size}`;

        // List ALL students with their names (for name matching)
        ctx += `\n\nقائمة الطلاب:`;
        const studentsList = [];
        studentsSnap.forEach(doc => {
            const s = doc.data();
            studentsList.push(s.fullName || 'بدون اسم');
        });
        ctx += '\n' + studentsList.join('، ');

        // Today's attendance
        const todayStatuses = {};
        todayAttSnap.forEach(doc => {
            const d = doc.data();
            todayStatuses[d.studentId] = d.status;
        });

        const absentToday = [];
        const presentToday = [];
        studentsSnap.forEach(doc => {
            const s = doc.data();
            const status = todayStatuses[doc.id];
            if (status === 'absent') absentToday.push(s.fullName || 'بدون اسم');
            else if (status === 'present' || status === 'sard') presentToday.push(s.fullName);
        });

        ctx += `\n\nحضور اليوم (${today}): ${presentToday.length} حاضر، ${absentToday.length} غائب من ${studentsSnap.size}`;
        if (absentToday.length > 0) {
            ctx += `\nالغائبون اليوم: ${absentToday.join('، ')}`;
        }

        // Monthly stats
        const monthlyStats = {};
        monthAttSnap.forEach(doc => {
            const d = doc.data();
            if (!monthlyStats[d.studentId]) monthlyStats[d.studentId] = { present: 0, absent: 0, excused: 0, name: d.studentName || '' };
            if (d.status === 'present' || d.status === 'sard') monthlyStats[d.studentId].present++;
            else if (d.status === 'absent') monthlyStats[d.studentId].absent++;
            else if (d.status === 'excused') monthlyStats[d.studentId].excused++;
        });

        const sorted = Object.entries(monthlyStats).sort((a, b) => b[1].absent - a[1].absent);
        const mostAbsent = sorted.filter(([, s]) => s.absent >= 2).slice(0, 5);
        const bestStudents = sorted.filter(([, s]) => s.present >= 5 && s.absent === 0).slice(0, 5);

        if (mostAbsent.length > 0) {
            ctx += `\n\nأكثر الطلاب غياباً هذا الشهر:`;
            mostAbsent.forEach(([, s]) => ctx += `\n- ${s.name}: ${s.absent} أيام غياب`);
        }
        if (bestStudents.length > 0) {
            ctx += `\n\nالطلاب المتميزون (بدون غياب):`;
            bestStudents.forEach(([, s]) => ctx += `\n- ${s.name}: ${s.present} أيام حضور`);
        }

        return { context: ctx, halaqaId };
    } catch (e) {
        console.error('Teacher context error:', e);
        return { context: '\n(فشل جلب بيانات المعلم)', halaqaId: null };
    }
}

async function fetchAdminContext() {
    const today = getTodayStr();

    try {
        const queries = [
            db.collection('students').get(),
            db.collection('halaqat').get(),
            db.collection('attendance').where('date', '==', today).get(),
        ];

        const [studentsSnap, halaqatSnap, todayAttSnap] = await Promise.all(queries);

        // demotion_alerts might not have the index, wrap separately
        let demotionSnap = { empty: true, forEach: () => { } };
        try {
            demotionSnap = await db.collection('demotion_alerts').orderBy('createdAt', 'desc').limit(10).get();
        } catch (e) {
            console.log('demotion_alerts query failed (index may be missing):', e.message);
        }

        let ctx = '\n--- إحصائيات الأكاديمية ---';

        let mainCount = 0, reserveCount = 0;
        const allStudentNames = [];
        studentsSnap.forEach(doc => {
            const d = doc.data();
            if (d.type === 'reserve') reserveCount++;
            else mainCount++;
            allStudentNames.push(d.fullName || 'بدون اسم');
        });
        ctx += `\nإجمالي الطلاب: ${studentsSnap.size} (أساسي: ${mainCount}، احتياط: ${reserveCount})`;
        ctx += `\nعدد الحلقات: ${halaqatSnap.size}`;

        // Include all student names for action matching
        ctx += `\n\nقائمة الطلاب: ${allStudentNames.join('، ')}`;

        let todayPresent = 0, todayAbsent = 0, todayExcused = 0;
        const halaqaAbsent = {};
        todayAttSnap.forEach(doc => {
            const d = doc.data();
            if (d.status === 'present' || d.status === 'sard') todayPresent++;
            else if (d.status === 'absent') {
                todayAbsent++;
                const h = d.halaqaName || 'غير محدد';
                halaqaAbsent[h] = (halaqaAbsent[h] || 0) + 1;
            }
            else if (d.status === 'excused') todayExcused++;
        });

        const totalRecorded = todayPresent + todayAbsent + todayExcused;
        const attendanceRate = totalRecorded > 0 ? Math.round((todayPresent / totalRecorded) * 100) : 0;
        ctx += `\n\nحضور اليوم (${today}): ${todayPresent} حاضر، ${todayAbsent} غائب، ${todayExcused} إذن`;
        ctx += `\nنسبة الحضور: ${attendanceRate}%`;

        if (Object.keys(halaqaAbsent).length > 0) {
            ctx += `\n\nالغياب حسب الحلقة:`;
            Object.entries(halaqaAbsent)
                .sort((a, b) => b[1] - a[1])
                .forEach(([name, count]) => ctx += `\n- ${name}: ${count} غائب`);
        }

        if (!demotionSnap.empty) {
            ctx += `\n\nآخر حالات النقل للاحتياط:`;
            demotionSnap.forEach(doc => {
                const d = doc.data();
                ctx += `\n- ${d.studentName || 'غير معروف'}: ${d.reason || 'بدون سبب'}`;
            });
        }

        return ctx;
    } catch (e) {
        console.error('Admin context error:', e);
        return '\n(فشل جلب إحصائيات الأكاديمية)';
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

    if (!GROQ_KEYS.length) {
        return res.status(500).json({ error: 'No GROQ API keys configured.' });
    }

    const { message, role, studentId, teacherId, history } = req.body;

    if (!message) {
        return res.status(400).json({ error: 'Message is required' });
    }

    try {
        let systemPrompt;
        let context = '';
        let halaqaId = null;

        switch (role) {
            case 'teacher': {
                systemPrompt = TEACHER_PROMPT;
                console.log('Fetching teacher context for:', teacherId || studentId);
                const result = await fetchTeacherContext(teacherId || studentId);
                context = result.context;
                halaqaId = result.halaqaId;
                console.log('Teacher context length:', context.length, 'halaqaId:', halaqaId);
                break;
            }
            case 'admin': {
                systemPrompt = ADMIN_PROMPT;
                console.log('Fetching admin context...');
                context = await fetchAdminContext();
                console.log('Admin context length:', context.length);
                break;
            }
            case 'student':
            default: {
                systemPrompt = STUDENT_PROMPT;
                console.log('Fetching student context for:', studentId);
                context = await fetchStudentContext(studentId);
                console.log('Student context length:', context.length);
                break;
            }
        }

        // Build messages for Groq
        const messages = [
            { role: 'system', content: systemPrompt }
        ];

        if (history && Array.isArray(history)) {
            for (const h of history.slice(-6)) {
                messages.push({
                    role: h.role === 'user' ? 'user' : 'assistant',
                    content: h.text
                });
            }
        }

        messages.push({
            role: 'user',
            content: message + context
        });

        // Call Groq API with round-robin + retry on 429
        let groqRes, groqData;
        const maxRetries = Math.min(GROQ_KEYS.length, 3);

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            const apiKey = getNextKey();

            groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model: 'llama-3.1-8b-instant',
                    messages,
                    temperature: 0.7,
                    max_tokens: 1024,
                    response_format: { type: 'json_object' },
                })
            });

            groqData = await groqRes.json();

            // If rate limited (429), try next key
            if (groqRes.status === 429 && attempt < maxRetries - 1) {
                console.log(`Key ${attempt + 1} rate limited, trying next...`);
                continue;
            }
            break;
        }

        if (!groqRes.ok) {
            console.error('Groq error:', JSON.stringify(groqData));
            return res.status(500).json({ error: 'Groq API error', details: groqData.error?.message });
        }

        const rawText = groqData.choices?.[0]?.message?.content || '{}';

        let parsed;
        try {
            parsed = JSON.parse(rawText);
        } catch {
            parsed = { reply: rawText };
        }

        // ── Execute action if present (teacher/admin only) ──
        let actionResult = null;
        const executableActions = ['record_progress', 'record_attendance', 'add_stars', 'bulk_attendance'];

        if (parsed.action && executableActions.includes(parsed.action) && (role === 'teacher' || role === 'admin')) {
            try {
                actionResult = await executeAction(
                    parsed.action,
                    parsed.params || {},
                    halaqaId,
                    teacherId || studentId || 'robo_ai'
                );

                // Override reply with actual result
                if (actionResult.success) {
                    parsed.reply = actionResult.message;
                } else {
                    parsed.reply = `⚠️ ${actionResult.error}`;
                }
            } catch (e) {
                console.error('Action execution error:', e);
                parsed.reply = `⚠️ حدث خطأ أثناء تنفيذ الأمر: ${e.message}`;
                actionResult = { success: false, error: e.message };
            }
        }

        return res.status(200).json({
            success: true,
            reply: parsed.reply || 'عذراً، لم أفهم طلبك.',
            action: parsed.action || null,
            actionResult: actionResult,
            surah: parsed.surah || null,
            reciterId: parsed.reciterId || null,
        });

    } catch (error) {
        console.error('AI Chat error:', error);
        return res.status(500).json({ error: error.message });
    }
}

// Vercel: increase timeout to 30s (free tier max)
export const config = {
    maxDuration: 30,
};
