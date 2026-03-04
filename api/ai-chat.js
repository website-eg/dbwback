// api/ai-chat.js
// Gemini AI proxy for "روبو" assistant
// Receives user message + role, returns AI response with optional actions

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

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const SYSTEM_PROMPT = `أنت "روبو" — مساعد ذكي لتطبيق "بِرّ الوالدين" لتحفيظ القرآن الكريم.

دورك:
- مساعدة الطلاب والمعلمين والأدمن
- الرد بلغة عربية واضحة وودودة
- تنفيذ الأوامر عبر إرجاع JSON عند الحاجة

القدرات المتاحة:
1. تشغيل سورة من القرآن الكريم (يمكنك تحديد رقم السورة والقارئ)
2. الإجابة عن أسئلة إسلامية
3. تقديم معلومات عن الحضور والغياب (إذا تم تزويدك بالبيانات)
4. المحادثة العامة

القراء المتاحون:
- العفاسي (id: 7)
- عبدالباسط عبدالصمد (id: 1)
- الحصري (id: 3)
- المنشاوي (id: 5)
- سعود الشريم (id: 19)

أسماء السور: الفاتحة=1، البقرة=2، آل عمران=3، النساء=4، المائدة=5، الأنعام=6، الأعراف=7، الأنفال=8، التوبة=9، يونس=10، هود=11، يوسف=12، الرعد=13، إبراهيم=14، الحجر=15، النحل=16، الإسراء=17، الكهف=18، مريم=19، طه=20، الأنبياء=21، الحج=22، المؤمنون=23، النور=24، الفرقان=25، الشعراء=26، النمل=27، القصص=28، العنكبوت=29، الروم=30، لقمان=31، السجدة=32، الأحزاب=33، سبأ=34، فاطر=35، يس=36، الصافات=37، ص=38، الزمر=39، غافر=40، فصلت=41، الشورى=42، الزخرف=43، الدخان=44، الجاثية=45، الأحقاف=46، محمد=47، الفتح=48، الحجرات=49، ق=50، الذاريات=51، الطور=52، النجم=53، القمر=54، الرحمن=55، الواقعة=56، الحديد=57، المجادلة=58، الحشر=59، الممتحنة=60، الصف=61، الجمعة=62، المنافقون=63، التغابن=64، الطلاق=65، التحريم=66، الملك=67، القلم=68، الحاقة=69، المعارج=70، نوح=71، الجن=72، المزمل=73، المدثر=74، القيامة=75، الإنسان=76، المرسلات=77، النبأ=78، النازعات=79، عبس=80، التكوير=81، الانفطار=82، المطففين=83، الانشقاق=84، البروج=85، الطارق=86، الأعلى=87، الغاشية=88، الفجر=89، البلد=90، الشمس=91، الليل=92، الضحى=93، الشرح=94، التين=95، العلق=96، القدر=97، البينة=98، الزلزلة=99، العاديات=100، القارعة=101، التكاثر=102، العصر=103، الهمزة=104، الفيل=105، قريش=106، الماعون=107، الكوثر=108، الكافرون=109، النصر=110، المسد=111، الإخلاص=112، الفلق=113، الناس=114

عندما يطلب المستخدم تشغيل سورة، أرجع الرد بهذا الشكل JSON:
{"reply": "جاري تشغيل سورة الكهف بصوت العفاسي 🎧", "action": "play_surah", "surah": 18, "reciterId": 7}

عندما يطلب معلومات عن حضوره وتوجد بيانات، حللها وأجب.

إذا كان السؤال عام أو لا يتطلب إجراء، أجب برد JSON:
{"reply": "نص الرد هنا"}

دائماً أرجع JSON صالح فقط، بدون أي نص إضافي خارج JSON.
`;

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    if (!GEMINI_API_KEY) {
        return res.status(500).json({ error: 'GEMINI_API_KEY not set' });
    }

    const { message, role, studentId, history } = req.body;

    if (!message) {
        return res.status(400).json({ error: 'Message is required' });
    }

    try {
        // Build context based on role
        let context = '';

        if (studentId && role === 'student') {
            // Fetch student attendance data for context
            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const startOfMonth = `${year}-${month}-01`;

            const attSnap = await db.collection('attendance')
                .where('studentId', '==', studentId)
                .where('date', '>=', startOfMonth)
                .get();

            let absent = 0, excused = 0, present = 0;
            attSnap.forEach(doc => {
                const s = doc.data().status;
                if (s === 'absent') absent++;
                else if (s === 'excused') excused++;
                else if (s === 'present' || s === 'sard') present++;
            });

            context = `\nبيانات الطالب هذا الشهر: حضور=${present}، غياب=${absent}، أعذار=${excused}`;
        }

        // Build messages for Gemini
        const contents = [];

        // Add history if provided
        if (history && Array.isArray(history)) {
            for (const h of history.slice(-6)) { // Last 6 messages for context
                contents.push({
                    role: h.role === 'user' ? 'user' : 'model',
                    parts: [{ text: h.text }]
                });
            }
        }

        // Add current message
        contents.push({
            role: 'user',
            parts: [{ text: message + context }]
        });

        // Call Gemini API
        const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    system_instruction: {
                        parts: [{ text: SYSTEM_PROMPT }]
                    },
                    contents,
                    generationConfig: {
                        temperature: 0.7,
                        topP: 0.9,
                        maxOutputTokens: 1024,
                        responseMimeType: "application/json",
                    }
                })
            }
        );

        const geminiData = await geminiRes.json();

        if (!geminiRes.ok) {
            console.error('Gemini error:', JSON.stringify(geminiData));
            return res.status(500).json({ error: 'Gemini API error', details: geminiData.error?.message });
        }

        const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

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
