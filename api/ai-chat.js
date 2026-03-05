// api/ai-chat.js
// Groq AI proxy for "روبو" — Multi-role assistant (Student, Teacher, Admin)
// Model: Llama 3.3 70B | Free tier: 30 RPM, 14,400/day
//
// ⚡ OPTIMIZATIONS:
// 1. Smart Context: Only fetches Firestore when message is about data (attendance/scores)
// 2. In-Memory Cache: 5-min TTL prevents repeated queries
// → Reduces Firestore reads by ~90%

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
// SYSTEM PROMPTS
// ─────────────────────────────────────────────

const BASE_PROMPT = `أنت "روبو" — مساعد ذكي لتطبيق "بِرّ الوالدين" لتحفيظ القرآن الكريم.
شخصيتك ودودة ومحفزة. تتحدث بالعربية الفصحى البسيطة مع إيموجي.

⚠️ قواعد مهمة جداً:
- أجب بشكل مباشر وطبيعي كأنك صديق. لا تقل "لقد قمت بتحليل بياناتك" أو "بناءً على تحليل البيانات".
- إذا سألك أحد "كم غبت؟" أجب مباشرة: "غبت 3 أيام هذا الشهر" وليس "لقد قمت بمراجعة سجل حضورك ووجدت أنك..."
- كن مختصراً. لا تكرر السؤال ولا تشرح ما ستفعله. أجب فوراً.
- لا تذكر أبداً أن هناك "بيانات مرفقة" أو "بيانات مُدخلة". تصرف وكأنك تعرف هذه المعلومات بنفسك.
- استخدم أرقام محددة من البيانات المتاحة بدل الكلام العام.

القراء المتاحون:
- العفاسي (id: 7)، عبدالباسط (id: 1)، الحصري (id: 3)، المنشاوي (id: 5)، سعود الشريم (id: 19)

أسماء السور: الفاتحة=1، البقرة=2، آل عمران=3، النساء=4، المائدة=5، الأنعام=6، الأعراف=7، الأنفال=8، التوبة=9، يونس=10، هود=11، يوسف=12، الرعد=13، إبراهيم=14، الحجر=15، النحل=16، الإسراء=17، الكهف=18، مريم=19، طه=20، الأنبياء=21، الحج=22، المؤمنون=23، النور=24، الفرقان=25، الشعراء=26، النمل=27، القصص=28، العنكبوت=29، الروم=30، لقمان=31، السجدة=32، الأحزاب=33، سبأ=34، فاطر=35، يس=36، الصافات=37، ص=38، الزمر=39، غافر=40، فصلت=41، الشورى=42، الزخرف=43، الدخان=44، الجاثية=45، الأحقاف=46، محمد=47، الفتح=48، الحجرات=49، ق=50، الذاريات=51، الطور=52، النجم=53، القمر=54، الرحمن=55، الواقعة=56، الحديد=57، المجادلة=58، الحشر=59، الممتحنة=60، الصف=61، الجمعة=62، المنافقون=63، التغابن=64، الطلاق=65، التحريم=66، الملك=67، القلم=68، الحاقة=69، المعارج=70، نوح=71، الجن=72، المزمل=73، المدثر=74، القيامة=75، الإنسان=76، المرسلات=77، النبأ=78، النازعات=79، عبس=80، التكوير=81، الانفطار=82، المطففين=83، الانشقاق=84، البروج=85، الطارق=86، الأعلى=87، الغاشية=88، الفجر=89، البلد=90، الشمس=91، الليل=92، الضحى=93، الشرح=94، التين=95، العلق=96، القدر=97، البينة=98، الزلزلة=99، العاديات=100، القارعة=101، التكاثر=102، العصر=103، الهمزة=104، الفيل=105، قريش=106، الماعون=107، الكوثر=108، الكافرون=109، النصر=110، المسد=111، الإخلاص=112، الفلق=113، الناس=114

عند تشغيل سورة أرجع: {"reply": "جاري تشغيل سورة X 🎧", "action": "play_surah", "surah": رقم, "reciterId": رقم}
للردود العادية: {"reply": "نص الرد"}
دائماً أرجع JSON صالح فقط.`;

const STUDENT_PROMPT = `${BASE_PROMPT}

أنت تتحدث مع **طالب** اسمه موجود في البيانات. نادِه باسمه الأول.

⚠️ أنت تقدم معلومات فقط. لا تشغّل سور ولا تفتح مصحف ولا تنفذ أي مهام. فقط أجب عن الأسئلة.
لا تُرجع أبداً action أو play_surah للطالب.

ماذا تفعل:
- "كم غبت؟" ← أعطه الرقم مباشرة مع تعليق بسيط. مثال: "غبت 3 أيام هذا الشهر. حاول تحافظ على حضورك! 💪"
- "كم نجومي؟" ← "عندك 12 نجمة ⭐ ما شاء الله!"
- "كيف أدائي؟" ← ملخص قصير بالأرقام (حضور + درجات + نجوم) في 2-3 سطور
- أسئلة دينية ← أجب بوضوح
- "شغل سورة" ← "هذه الخاصية غير متاحة حالياً، لكن تقدر تفتح المصحف من الشاشة الرئيسية 📖"

لا تطوّل. السؤال البسيط له جواب بسيط. إذا لم تكن بيانات متاحة قل "ما عندي بياناتك حالياً، جرب لاحقاً".`;

const TEACHER_PROMPT = `${BASE_PROMPT}

أنت تتحدث مع **معلم** وتساعده في إدارة حلقته. نادِه "يا شيخ" أو باسمه.

📋 مهامك الرئيسية:
- "مين متغيب؟" ← اذكر الأسماء مباشرة كقائمة مرقمة
- "كم طالب حاضر؟" ← الرقم فوراً
- "تقرير الحلقة" ← حضور اليوم + أكثر الغائبين + درجات الاختبارات + سلوك
- "تقرير عن أحمد" ← كل بيانات الطالب المتاحة
- "مين يحتاج متابعة؟" ← الطلاب الضعاف أو كثيري الغياب
- أسئلة دينية ← أجب بوضوح

⚠️ كن مساعداً ذكياً:
- إذا لاحظت طالب غاب كثيراً ← نبّه المعلم تلقائياً: "تنبيه: الطالب X غاب 4 مرات هذا الشهر"
- إذا لاحظت طالب درجاته تنزل ← "لاحظت أن درجات Y تراجعت"
- إذا المعلم لم يحضّر اليوم ← "ملاحظة: لم يتم تسجيل حضور اليوم بعد"
- استخدم أرقام محددة دائماً. لا تقل "بعض الطلاب" بل اذكر العدد.

إذا لم تكن بيانات متاحة قل ذلك بصراحة.`;

const ADMIN_PROMPT = `${BASE_PROMPT}

أنت تتحدث مع **مدير الأكاديمية** وتساعده في الإدارة. ردودك مختصرة ودقيقة.

📋 مهامك:
- "كم طالب عندنا؟" ← الرقم مباشرة + أساسي/احتياط
- "نسبة الحضور" ← النسبة + حاضرين + غائبين
- "مقارنة الحلقات" ← ترتيب الحلقات بالحضور والدرجات
- "التنبيهات" ← آخر حالات النقل + أي مشاكل
- "مين يحتاج متابعة؟" ← الطلاب الأكثر غياباً + الحلقات المتأخرة
- أسئلة دينية ← أجب بوضوح

⚠️ كن مستشاراً ذكياً:
- إذا لاحظت حلقة لم تحضّر اليوم ← "تنبيه: حلقة X لم تسجل حضور اليوم"
- إذا لاحظت طالب غاب كثيراً ← نبّه: "الطالب Y غاب 5 مرات — يحتاج تواصل"
- إذا حلقة أداؤها ضعيف ← "حلقة Z أقل حلقة في الدرجات هذا الشهر"
- أرقام دقيقة دائماً. لا مقدمات.

إذا لم تكن بيانات متاحة قل ذلك بصراحة.`;

// ─────────────────────────────────────────────
// IN-MEMORY CACHE (5-min TTL)
// ─────────────────────────────────────────────

const _cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCached(key) {
    const entry = _cache.get(key);
    if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
    _cache.delete(key);
    return null;
}

function setCache(key, data) {
    _cache.set(key, { data, ts: Date.now() });
    // Cleanup: keep max 50 entries
    if (_cache.size > 50) {
        const oldest = [..._cache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
        if (oldest) _cache.delete(oldest[0]);
    }
}

// ─────────────────────────────────────────────
// SMART CONTEXT DETECTION
// Only fetch Firestore when message asks for data
// ─────────────────────────────────────────────

const DATA_KEYWORDS = [
    'حضور', 'غياب', 'غائب', 'حاضر', 'متغيب', 'أداء', 'أدائي', 'درجات', 'درجاتي',
    'نجوم', 'نجومي', 'نجمة', 'مستوى', 'مستواي', 'تقرير', 'تقريري', 'إحصائيات',
    'الحلقة', 'الطلاب', 'المتميز', 'متابعة', 'كم', 'عدد', 'نسبة', 'مقارنة',
    'سجل', 'بيانات', 'نقل', 'احتياط', 'ترقية',
    'أفضل', 'أسوأ', 'أضعف', 'شهر', 'اليوم', 'حالة', 'حالتي',
    'اختبار', 'امتحان', 'سلوك', 'شهادة', 'سرد', 'تحضير', 'واجب',
    'تنبيه', 'مشكلة', 'ملاحظة', 'تحفيز', 'تكريم', 'مين', 'من',
    'حلقة', 'معلم', 'شيخ', 'طالب', 'أحمد', 'محمد'
];

function needsDataContext(message) {
    const lower = message.toLowerCase();
    return DATA_KEYWORDS.some(kw => lower.includes(kw));
}

// ─────────────────────────────────────────────
// DATA FETCHERS (with cache)
// ─────────────────────────────────────────────

function getTodayStr() {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
}

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

    const cacheKey = `student_${studentId}`;
    const cached = getCached(cacheKey);
    if (cached) { console.log('📦 Cache hit: student'); return cached; }

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

        setCache(cacheKey, ctx);
        return ctx;
    } catch (e) {
        console.error('Student context error:', e);
        return '\n(فشل جلب بيانات الطالب)';
    }
}

async function fetchTeacherContext(teacherId) {
    if (!teacherId) return '';

    const cacheKey = `teacher_${teacherId}`;
    const cached = getCached(cacheKey);
    if (cached) { console.log('📦 Cache hit: teacher'); return cached; }

    const today = getTodayStr();
    const { start, end, label } = getMonthRange();

    try {
        const teacherDoc = await db.collection('users').doc(teacherId).get();
        if (!teacherDoc.exists) return '\n(المعلم غير موجود)';

        const teacher = teacherDoc.data();
        const halaqaId = teacher.halaqaId;
        if (!halaqaId) return '\n(المعلم غير مربوط بحلقة)';

        // Fetch all data in parallel
        const [studentsSnap, todayAttSnap, monthAttSnap, examsSnap, behaviorSnap, progressSnap] = await Promise.all([
            db.collection('students').where('halaqaId', '==', halaqaId).get(),
            db.collection('attendance').where('halaqaId', '==', halaqaId).where('date', '==', today).get(),
            db.collection('attendance').where('halaqaId', '==', halaqaId).where('date', '>=', start).where('date', '<=', end).get(),
            db.collection('exams').where('monthKey', '==', `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`).get(),
            db.collection('behavior_records').orderBy('createdAt', 'desc').limit(20).get(),
            db.collection('progress').where('halaqaId', '==', halaqaId).where('date', '>=', start).where('date', '<=', end).get(),
        ]);

        // Map student IDs to names
        const studentMap = {};
        studentsSnap.forEach(doc => { studentMap[doc.id] = doc.data().fullName || doc.data().name || 'بدون اسم'; });
        const halaqaStudentIds = new Set(Object.keys(studentMap));

        let ctx = '\n--- بيانات الحلقة ---';
        ctx += `\nاسم المعلم: ${teacher.name || teacher.displayName || 'غير معروف'}`;
        ctx += `\nالحلقة: ${teacher.halaqaName || halaqaId}`;
        ctx += `\nعدد الطلاب: ${studentsSnap.size}`;

        // === TODAY ATTENDANCE ===
        const todayStatuses = {};
        todayAttSnap.forEach(doc => { todayStatuses[doc.data().studentId] = doc.data().status; });

        const absentToday = [], presentToday = [], notRecorded = [];
        studentsSnap.forEach(doc => {
            const s = doc.data();
            const name = s.fullName || s.name || 'بدون اسم';
            const status = todayStatuses[doc.id];
            if (status === 'absent') absentToday.push(name);
            else if (status === 'present' || status === 'sard') presentToday.push(name);
            else notRecorded.push(name);
        });

        ctx += `\n\nحضور اليوم (${today}): ${presentToday.length} حاضر، ${absentToday.length} غائب`;
        if (notRecorded.length > 0) ctx += `، ${notRecorded.length} لم يُسجَّل`;
        if (absentToday.length > 0) ctx += `\nالغائبون اليوم: ${absentToday.join('، ')}`;

        // === MONTHLY ATTENDANCE ===
        const monthlyStats = {};
        monthAttSnap.forEach(doc => {
            const d = doc.data();
            if (!halaqaStudentIds.has(d.studentId)) return;
            if (!monthlyStats[d.studentId]) monthlyStats[d.studentId] = { present: 0, absent: 0, excused: 0, name: studentMap[d.studentId] || '' };
            if (d.status === 'present' || d.status === 'sard') monthlyStats[d.studentId].present++;
            else if (d.status === 'absent') monthlyStats[d.studentId].absent++;
            else if (d.status === 'excused') monthlyStats[d.studentId].excused++;
        });

        const sorted = Object.entries(monthlyStats).sort((a, b) => b[1].absent - a[1].absent);
        const mostAbsent = sorted.filter(([, s]) => s.absent >= 2).slice(0, 5);
        const bestStudents = sorted.filter(([, s]) => s.present >= 5 && s.absent === 0).slice(0, 5);

        if (mostAbsent.length > 0) {
            ctx += `\n\nأكثر الطلاب غياباً (${label}):`;
            mostAbsent.forEach(([, s]) => ctx += `\n- ${s.name}: ${s.absent} أيام غياب`);
        }
        if (bestStudents.length > 0) {
            ctx += `\nالمتميزون:`;
            bestStudents.forEach(([, s]) => ctx += `\n- ${s.name}: ${s.present} أيام حضور متواصل`);
        }

        // === EXAMS (this month, this halaqa's students) ===
        const halaqaExams = [];
        examsSnap.forEach(doc => {
            const d = doc.data();
            if (halaqaStudentIds.has(d.studentId)) halaqaExams.push(d);
        });
        if (halaqaExams.length > 0) {
            ctx += `\n\nاختبارات الشهر (${halaqaExams.length} اختبار):`;
            halaqaExams.slice(0, 10).forEach(e => {
                ctx += `\n- ${studentMap[e.studentId] || '?'}: ${e.type === 'quran-oral' ? 'شفهي' : e.type === 'tajweed-written' ? 'تحريري تجويد' : 'قاعدة'} = ${e.score}/50`;
            });
        }

        // === BEHAVIOR (this halaqa only) ===
        const halaqaBehavior = [];
        behaviorSnap.forEach(doc => {
            const d = doc.data();
            if (halaqaStudentIds.has(d.studentId)) halaqaBehavior.push(d);
        });
        if (halaqaBehavior.length > 0) {
            ctx += `\n\nآخر سجلات السلوك:`;
            halaqaBehavior.slice(0, 5).forEach(b => {
                ctx += `\n- ${b.studentName}: ${b.isPositive ? '👍' : '👎'} ${b.category}${b.note ? ' — ' + b.note : ''}`;
            });
        }

        // === DAILY PROGRESS (latest per student) ===
        const latestProgress = {};
        progressSnap.forEach(doc => {
            const d = doc.data();
            if (!latestProgress[d.studentId] || d.date > latestProgress[d.studentId].date) {
                latestProgress[d.studentId] = d;
            }
        });
        const progEntries = Object.entries(latestProgress);
        if (progEntries.length > 0) {
            ctx += `\n\nآخر درجات يومية:`;
            progEntries.slice(0, 10).forEach(([sid, p]) => {
                const total = (Number(p.lessonScore || 0) + Number(p.revisionScore || 0) + Number(p.tilawaScore || 0) + Number(p.homeworkScore || 0));
                ctx += `\n- ${studentMap[sid] || '?'} (${p.date}): ${total}/40${p.hasStar ? ' ⭐' : ''}`;
            });
        }

        // === SMART ALERTS ===
        const alerts = [];
        if (notRecorded.length === studentsSnap.size && studentsSnap.size > 0) {
            alerts.push('⚠️ لم يتم تسجيل حضور أي طالب اليوم!');
        }
        mostAbsent.forEach(([, s]) => {
            if (s.absent >= 4) alerts.push(`🔴 ${s.name} غاب ${s.absent} مرات هذا الشهر — يحتاج تواصل عاجل`);
        });
        if (alerts.length > 0) {
            ctx += `\n\n🚨 تنبيهات ذكية:`;
            alerts.forEach(a => ctx += `\n${a}`);
        }

        setCache(cacheKey, ctx);
        return ctx;
    } catch (e) {
        console.error('Teacher context error:', e);
        return '\n(فشل جلب بيانات المعلم)';
    }
}

async function fetchAdminContext() {
    const cacheKey = `admin_global`;
    const cached = getCached(cacheKey);
    if (cached) { console.log('📦 Cache hit: admin'); return cached; }

    const today = getTodayStr();
    const { start, end, label } = getMonthRange();

    try {
        const [studentsSnap, halaqatSnap, todayAttSnap, monthAttSnap, demotionSnap, examsSnap, behaviorSnap] = await Promise.all([
            db.collection('students').get(),
            db.collection('halaqat').get(),
            db.collection('attendance').where('date', '==', today).get(),
            db.collection('attendance').where('date', '>=', start).where('date', '<=', end).get(),
            db.collection('demotion_alerts').orderBy('createdAt', 'desc').limit(10).get(),
            db.collection('exams').where('monthKey', '==', `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`).get(),
            db.collection('behavior_records').orderBy('createdAt', 'desc').limit(15).get(),
        ]);

        let ctx = '\n--- إحصائيات الأكاديمية ---';

        // === STUDENTS ===
        let mainCount = 0, reserveCount = 0;
        const studentMap = {};
        const studentHalaqaMap = {};
        studentsSnap.forEach(doc => {
            const d = doc.data();
            studentMap[doc.id] = d.fullName || d.name || '?';
            studentHalaqaMap[doc.id] = d.halaqaId || '';
            if (d.type === 'reserve') reserveCount++;
            else mainCount++;
        });
        ctx += `\nإجمالي الطلاب: ${studentsSnap.size} (أساسي: ${mainCount}، احتياط: ${reserveCount})`;

        // === HALAQAT ===
        const halaqaNames = {};
        halaqatSnap.forEach(doc => { halaqaNames[doc.id] = doc.data().name || doc.id; });
        ctx += `\nعدد الحلقات: ${halaqatSnap.size} (${Object.values(halaqaNames).join('، ')})`;

        // === TODAY ATTENDANCE ===
        let todayPresent = 0, todayAbsent = 0, todayExcused = 0;
        const halaqaToday = {}; // halaqaName -> { present, absent }
        const recordedHalaqas = new Set();
        todayAttSnap.forEach(doc => {
            const d = doc.data();
            const hName = d.halaqaName || 'غير محدد';
            recordedHalaqas.add(d.halaqaId || hName);
            if (!halaqaToday[hName]) halaqaToday[hName] = { present: 0, absent: 0 };
            if (d.status === 'present' || d.status === 'sard') { todayPresent++; halaqaToday[hName].present++; }
            else if (d.status === 'absent') { todayAbsent++; halaqaToday[hName].absent++; }
            else if (d.status === 'excused') todayExcused++;
        });

        const totalRecorded = todayPresent + todayAbsent + todayExcused;
        const attendanceRate = totalRecorded > 0 ? Math.round((todayPresent / totalRecorded) * 100) : 0;
        ctx += `\n\nحضور اليوم (${today}): ${todayPresent} حاضر، ${todayAbsent} غائب، ${todayExcused} إذن`;
        ctx += `\nنسبة الحضور: ${attendanceRate}%`;

        // === HALAQA COMPARISON ===
        if (Object.keys(halaqaToday).length > 0) {
            ctx += `\n\nمقارنة الحلقات اليوم:`;
            Object.entries(halaqaToday)
                .sort((a, b) => b[1].absent - a[1].absent)
                .forEach(([name, s]) => {
                    const total = s.present + s.absent;
                    const rate = total > 0 ? Math.round((s.present / total) * 100) : 0;
                    ctx += `\n- ${name}: ${s.present}/${total} (${rate}%)`;
                });
        }

        // === MONTHLY TOP ABSENTEES ===
        const monthlyAbs = {};
        monthAttSnap.forEach(doc => {
            const d = doc.data();
            if (d.status === 'absent') {
                if (!monthlyAbs[d.studentId]) monthlyAbs[d.studentId] = 0;
                monthlyAbs[d.studentId]++;
            }
        });
        const topAbsent = Object.entries(monthlyAbs).sort((a, b) => b[1] - a[1]).slice(0, 8);
        if (topAbsent.length > 0) {
            ctx += `\n\nأكثر الطلاب غياباً (${label}):`;
            topAbsent.forEach(([sid, count]) => ctx += `\n- ${studentMap[sid] || '?'}: ${count} أيام`);
        }

        // === EXAMS ===
        if (!examsSnap.empty) {
            const examsByType = {};
            examsSnap.forEach(doc => {
                const d = doc.data();
                const type = d.type === 'quran-oral' ? 'شفهي' : d.type === 'tajweed-written' ? 'تحريري' : 'قاعدة';
                if (!examsByType[type]) examsByType[type] = { count: 0, totalScore: 0 };
                examsByType[type].count++;
                examsByType[type].totalScore += Number(d.score || 0);
            });
            ctx += `\n\nاختبارات الشهر:`;
            Object.entries(examsByType).forEach(([type, s]) => {
                ctx += `\n- ${type}: ${s.count} اختبار، متوسط ${Math.round(s.totalScore / s.count)}/50`;
            });
        }

        // === BEHAVIOR ===
        if (!behaviorSnap.empty) {
            let positive = 0, negative = 0;
            behaviorSnap.forEach(doc => { if (doc.data().isPositive) positive++; else negative++; });
            ctx += `\n\nالسلوك (آخر 15): 👍 ${positive} إيجابي، 👎 ${negative} سلبي`;
        }

        // === DEMOTIONS ===
        if (!demotionSnap.empty) {
            ctx += `\n\nآخر حالات النقل للاحتياط:`;
            demotionSnap.forEach(doc => {
                const d = doc.data();
                ctx += `\n- ${d.studentName || '?'}: ${d.reason || 'بدون سبب'}`;
            });
        }

        // === SMART ALERTS ===
        const alerts = [];
        const unrecordedHalaqas = Object.entries(halaqaNames).filter(([id]) => !recordedHalaqas.has(id));
        if (unrecordedHalaqas.length > 0) {
            alerts.push(`⚠️ حلقات لم تسجّل حضور اليوم: ${unrecordedHalaqas.map(([, n]) => n).join('، ')}`);
        }
        topAbsent.forEach(([sid, count]) => {
            if (count >= 5) alerts.push(`🔴 ${studentMap[sid] || '?'} غاب ${count} مرات — يحتاج تدخل إداري`);
        });
        if (attendanceRate < 60 && totalRecorded > 0) {
            alerts.push(`⚠️ نسبة الحضور منخفضة جداً: ${attendanceRate}%`);
        }
        if (alerts.length > 0) {
            ctx += `\n\n🚨 تنبيهات ذكية:`;
            alerts.forEach(a => ctx += `\n${a}`);
        }

        setCache(cacheKey, ctx);
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

    if (!GROQ_API_KEY) {
        return res.status(500).json({ error: 'GROQ_API_KEY not set. Add it in Vercel env vars.' });
    }

    const { message, role, studentId, teacherId, history } = req.body;

    if (!message) {
        return res.status(400).json({ error: 'Message is required' });
    }

    try {
        let systemPrompt;
        let context = '';

        // ⚡ SMART: Only fetch Firestore when message asks about data
        const shouldFetchData = needsDataContext(message);
        console.log(`🤖 Role: ${role} | NeedsData: ${shouldFetchData} | Msg: "${message.substring(0, 50)}..."`);

        switch (role) {
            case 'teacher':
                systemPrompt = TEACHER_PROMPT;
                if (shouldFetchData) context = await fetchTeacherContext(teacherId || studentId);
                break;
            case 'admin':
                systemPrompt = ADMIN_PROMPT;
                if (shouldFetchData) context = await fetchAdminContext();
                break;
            case 'student':
            default:
                systemPrompt = STUDENT_PROMPT;
                if (shouldFetchData) context = await fetchStudentContext(studentId);
                break;
        }

        // Build messages for Groq
        const messages = [
            { role: 'system', content: systemPrompt }
        ];

        // Add history (last 6 messages)
        if (history && Array.isArray(history)) {
            for (const h of history.slice(-6)) {
                messages.push({
                    role: h.role === 'user' ? 'user' : 'assistant',
                    content: h.text
                });
            }
        }

        // Add current message with context (if any)
        messages.push({
            role: 'user',
            content: context ? message + context : message
        });

        // Call Groq API
        const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${GROQ_API_KEY}`,
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages,
                temperature: 0.7,
                max_tokens: 1024,
                response_format: { type: 'json_object' },
            })
        });

        const groqData = await groqRes.json();

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

        return res.status(200).json({
            success: true,
            reply: parsed.reply || 'عذراً، لم أفهم طلبك. حاول مرة أخرى.',
            action: parsed.action || null,
            surah: parsed.surah || null,
            reciterId: parsed.reciterId || null,
        });

    } catch (error) {
        console.error('AI Chat error:', error);
        return res.status(500).json({ error: error.message });
    }
}
