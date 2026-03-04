// api/ai-chat.js
// Groq AI proxy for "روبو" — Multi-role assistant (Student, Teacher, Admin)
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
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// ─────────────────────────────────────────────
// SYSTEM PROMPTS
// ─────────────────────────────────────────────

const BASE_PROMPT = `أنت "روبو" — مساعد ذكي لتطبيق "بِرّ الوالدين" لتحفيظ القرآن الكريم.
شخصيتك ودودة ومحفزة. تتحدث بالعربية الفصحى البسيطة مع إيموجي.

القراء المتاحون:
- العفاسي (id: 7)، عبدالباسط (id: 1)، الحصري (id: 3)، المنشاوي (id: 5)، سعود الشريم (id: 19)

أسماء السور: الفاتحة=1، البقرة=2، آل عمران=3، النساء=4، المائدة=5، الأنعام=6، الأعراف=7، الأنفال=8، التوبة=9، يونس=10، هود=11، يوسف=12، الرعد=13، إبراهيم=14، الحجر=15، النحل=16، الإسراء=17، الكهف=18، مريم=19، طه=20، الأنبياء=21، الحج=22، المؤمنون=23، النور=24، الفرقان=25، الشعراء=26، النمل=27، القصص=28، العنكبوت=29، الروم=30، لقمان=31، السجدة=32، الأحزاب=33، سبأ=34، فاطر=35، يس=36، الصافات=37، ص=38، الزمر=39، غافر=40، فصلت=41، الشورى=42، الزخرف=43، الدخان=44، الجاثية=45، الأحقاف=46، محمد=47، الفتح=48، الحجرات=49، ق=50، الذاريات=51، الطور=52، النجم=53، القمر=54، الرحمن=55، الواقعة=56، الحديد=57، المجادلة=58، الحشر=59، الممتحنة=60، الصف=61، الجمعة=62، المنافقون=63، التغابن=64، الطلاق=65، التحريم=66، الملك=67، القلم=68، الحاقة=69، المعارج=70، نوح=71، الجن=72، المزمل=73، المدثر=74، القيامة=75، الإنسان=76، المرسلات=77، النبأ=78، النازعات=79، عبس=80، التكوير=81، الانفطار=82، المطففين=83، الانشقاق=84، البروج=85، الطارق=86، الأعلى=87، الغاشية=88، الفجر=89، البلد=90، الشمس=91، الليل=92، الضحى=93، الشرح=94، التين=95، العلق=96، القدر=97، البينة=98، الزلزلة=99، العاديات=100، القارعة=101، التكاثر=102، العصر=103، الهمزة=104، الفيل=105، قريش=106، الماعون=107، الكوثر=108، الكافرون=109، النصر=110، المسد=111، الإخلاص=112، الفلق=113، الناس=114

عند تشغيل سورة أرجع: {"reply": "جاري تشغيل سورة X 🎧", "action": "play_surah", "surah": رقم, "reciterId": رقم}
للردود العادية: {"reply": "نص الرد"}
دائماً أرجع JSON صالح فقط.`;

const STUDENT_PROMPT = `${BASE_PROMPT}

أنت تتحدث مع **طالب**. مهامك:
1. تشغيل سور القرآن بصوت أي قارئ
2. الإجابة عن أسئلة إسلامية ودينية
3. تحليل بيانات الطالب (حضور، درجات، نجوم) وتقديم نصائح تحفيزية
4. شرح كيفية استخدام التطبيق
5. التحفيز والتشجيع بناءً على مستوى الأداء

عندما يسأل عن أدائه أو درجاته أو حضوره، حلل البيانات المرفقة وأعطه ملخصاً تحفيزياً.
إذا كان أداؤه ممتازاً شجعه، إذا كان ضعيفاً حفّزه بلطف.`;

const TEACHER_PROMPT = `${BASE_PROMPT}

أنت تتحدث مع **معلم**. مهامك:
1. تقديم تقارير عن طلاب الحلقة (حضور، غياب، أداء)
2. الإجابة عن "مين متغيب اليوم؟" بقائمة أسماء
3. تقديم تقرير أداء لطالب محدد عند السؤال عنه بالاسم
4. اقتراح طلاب يحتاجون متابعة (كثيري الغياب أو ضعاف الدرجات)
5. تقديم إحصائيات الحلقة الشهرية
6. تشغيل سور القرآن

عند الإجابة عن تقارير، استخدم البيانات المرفقة. كن دقيقاً بالأرقام.
عند ذكر قائمة أسماء رقّمها.`;

const ADMIN_PROMPT = `${BASE_PROMPT}

أنت تتحدث مع **مدير الأكاديمية**. مهامك:
1. تقديم إحصائيات عامة (عدد الطلاب، الحلقات، نسبة الحضور)
2. مقارنة أداء الحلقات
3. عرض التنبيهات الأخيرة (نقل، ترقية)
4. عرض قائمة الغياب اليومية
5. الإجابة عن أسئلة إدارية
6. تشغيل سور القرآن

استخدم البيانات المرفقة لتقديم إجابات دقيقة مع أرقام.
عند المقارنة استخدم جداول نصية بسيطة.`;

// ─────────────────────────────────────────────
// DATA FETCHERS
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

    const today = getTodayStr();
    const { start, end, label } = getMonthRange();

    try {
        // Parallel fetches for speed
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

        // Attendance stats
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

        // Last 5 progress entries
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
    if (!teacherId) return '';

    const today = getTodayStr();
    const { start, end, label } = getMonthRange();

    try {
        // Get teacher's halaqa
        const teacherDoc = await db.collection('users').doc(teacherId).get();
        if (!teacherDoc.exists) return '\n(المعلم غير موجود)';

        const teacher = teacherDoc.data();
        const halaqaId = teacher.halaqaId;
        if (!halaqaId) return '\n(المعلم غير مربوط بحلقة)';

        // Parallel fetches
        const [studentsSnap, todayAttSnap, monthAttSnap] = await Promise.all([
            db.collection('students').where('halaqaId', '==', halaqaId).get(),
            db.collection('attendance').where('halaqaId', '==', halaqaId).where('date', '==', today).get(),
            db.collection('attendance').where('halaqaId', '==', halaqaId).where('date', '>=', start).where('date', '<=', end).get(),
        ]);

        let ctx = '\n--- بيانات الحلقة ---';
        ctx += `\nاسم المعلم: ${teacher.name || teacher.displayName || 'غير معروف'}`;
        ctx += `\nالحلقة: ${teacher.halaqaName || halaqaId}`;
        ctx += `\nعدد الطلاب: ${studentsSnap.size}`;

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

        // Monthly stats per student
        const monthlyStats = {};
        monthAttSnap.forEach(doc => {
            const d = doc.data();
            if (!monthlyStats[d.studentId]) monthlyStats[d.studentId] = { present: 0, absent: 0, excused: 0, name: d.studentName || '' };
            if (d.status === 'present' || d.status === 'sard') monthlyStats[d.studentId].present++;
            else if (d.status === 'absent') monthlyStats[d.studentId].absent++;
            else if (d.status === 'excused') monthlyStats[d.studentId].excused++;
        });

        // Find most absent and best students
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

        return ctx;
    } catch (e) {
        console.error('Teacher context error:', e);
        return '\n(فشل جلب بيانات المعلم)';
    }
}

async function fetchAdminContext() {
    const today = getTodayStr();
    const { start, end, label } = getMonthRange();

    try {
        const [studentsSnap, halaqatSnap, todayAttSnap, demotionSnap] = await Promise.all([
            db.collection('students').get(),
            db.collection('halaqat').get(),
            db.collection('attendance').where('date', '==', today).get(),
            db.collection('demotion_alerts').orderBy('createdAt', 'desc').limit(10).get(),
        ]);

        let ctx = '\n--- إحصائيات الأكاديمية ---';

        // Student counts
        let mainCount = 0, reserveCount = 0;
        studentsSnap.forEach(doc => {
            const t = doc.data().type;
            if (t === 'reserve') reserveCount++;
            else mainCount++;
        });
        ctx += `\nإجمالي الطلاب: ${studentsSnap.size} (أساسي: ${mainCount}، احتياط: ${reserveCount})`;
        ctx += `\nعدد الحلقات: ${halaqatSnap.size}`;

        // Today attendance
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

        // Halaqa comparison by absence
        if (Object.keys(halaqaAbsent).length > 0) {
            ctx += `\n\nالغياب حسب الحلقة:`;
            Object.entries(halaqaAbsent)
                .sort((a, b) => b[1] - a[1])
                .forEach(([name, count]) => ctx += `\n- ${name}: ${count} غائب`);
        }

        // Recent demotions
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

    if (!GROQ_API_KEY) {
        return res.status(500).json({ error: 'GROQ_API_KEY not set. Add it in Vercel env vars.' });
    }

    const { message, role, studentId, teacherId, history } = req.body;

    if (!message) {
        return res.status(400).json({ error: 'Message is required' });
    }

    try {
        // Select system prompt & build context based on role
        let systemPrompt;
        let context = '';

        switch (role) {
            case 'teacher':
                systemPrompt = TEACHER_PROMPT;
                context = await fetchTeacherContext(teacherId || studentId);
                break;
            case 'admin':
                systemPrompt = ADMIN_PROMPT;
                context = await fetchAdminContext();
                break;
            case 'student':
            default:
                systemPrompt = STUDENT_PROMPT;
                context = await fetchStudentContext(studentId);
                break;
        }

        // Build messages for Groq
        const messages = [
            { role: 'system', content: systemPrompt }
        ];

        // Add history
        if (history && Array.isArray(history)) {
            for (const h of history.slice(-6)) {
                messages.push({
                    role: h.role === 'user' ? 'user' : 'assistant',
                    content: h.text
                });
            }
        }

        // Add current message with context
        messages.push({
            role: 'user',
            content: message + context
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

        // Parse AI response
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
