import fetch from "node-fetch";

/* =========================================
   🛡️ القوانين التنظيمية للأكاديمية (ملزمة)
========================================= */
const ACADEMY_POLICY = {
  attendance: {
    maxExcusePerMonth: 2,
    maxAbsenceLimit: 12,
    autoAction: "move_to_reserve",
  },
  admission: {
    minExamScore: 90,
  },
};

export default async function handler(req, res) {
  // 1. إعدادات CORS الشاملة
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "https://darbw.netlify.app");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization"
  );

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const { text, role = "student", adminName = "إدارة الأكاديمية", history = [] } = req.body;

  if (!text) return res.status(400).json({ error: "الأمر فارغ" });

  try {
    // 2. بناء البرومبت المركزي المدمج
    const basePrompt = `
أنت المساعد الإداري الرقمي الرسمي لـ "أكاديمية بر الوالدين لخدمة القرآن الكريم" 📖.
اسم المستخدم الحالي: ${adminName}.

❗ قوانين تقنية صارمة:
- الرد يجب أن يكون قالب JSON فقط.
- ممنوع أي نص خارج القالب.
- ضع تحيتك وردك التربوي دائماً داخل حقل "warning".
- ابدأ النص داخل "warning" دائماً بـ: "أهلاً بك يا حامل القرآن 🤍".

🛑 الخطوط الحمراء والأخلاقيات:
1. منع العنف تماماً: يُمنع الضرب أو الإهانة؛ المخالفة تعني الرفع الفوري للإدارة.
2. السرية: منع نشر أي محتوى داخلي.
3. القدوة: الجمع بين الحزم والرحمة.

⚖️ اللوائح (للمعلمين): الانضباط بالمواعيد، الزي المحتشم، ومنع الجوال. الرصد في نفس اليوم.
🌱 شروط الاستمرار (للطلاب): حضور (س/ا/ع)، تأخير > 5د يؤثر على التقييم، غياب 12 حصة = احتياطي آلياً.
👨‍👩‍👧 مسؤوليات ولي الأمر: المتابعة الرقمية والمنزلية والالتزام بالزي الشرعي للأبناء.

🎯 الأوامر المتاحة للتنفيذ البرمجي:
mark_absent, send_report, reset_password, move_to_reserve, notify_parent, delete_user, update_email.

الصيغة المطلوبة:
{
  "action": "اسم_الأمر أو chat",
  "data": { ... },
  "warning": "أهلاً بك يا حامل القرآن 🤍 ... (ردك هنا)"
}`;

    const rolePrompts = {
      admin: "أنت تخاطب إدارة الأكاديمية 👔: ركز على القرارات الرسمية والحلول التنظيمية.",
      teacher: "أنت تخاطب المعلّم 🧑‍🏫: ركز على الأمانة في الرصد والسمت التربوي.",
      student: "أنت تخاطب طالب قرآن 🌱: ركز على التشجيع اللطيف وفضل القرآن.",
      parent: "أنت تخاطب ولي الأمر 👨‍👩‍👧: ركز على الطمأنينة والوضوح الإداري."
    };

    // 3. تجهيز الذاكرة (آخر 6 رسائل)
    const chatHistory = history.slice(-6).map((msg) => ({
      role: msg.role === "user" ? "user" : "assistant",
      content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
    }));

    // 4. الاتصال بـ Groq API
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        temperature: 0.2, // درجة حرارة منخفضة لضمان الالتزام بالـ JSON واللوائح
        messages: [
          { role: "system", content: `${basePrompt}\n${rolePrompts[role] || ""}` },
          ...chatHistory,
          { role: "user", content: `المستخدم ${adminName} يقول: ${text}` },
        ],
      }),
    });

    const data = await response.json();
    let content = data?.choices?.[0]?.message?.content;

    if (!content) throw new Error("فشل توليد الرد");

    // 5. تنظيف الرد وإرساله
    let cleanContent = content.trim();
    if (cleanContent.startsWith("```")) {
      cleanContent = cleanContent.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();
    }

    res.status(200).json(JSON.parse(cleanContent));
  } catch (error) {
    console.error("AI Parser Error:", error);
    res.status(500).json({
      action: "error",
      warning: "أهلاً بك يا حامل القرآن 🤍\nحدث خطأ فني أثناء معالجة الأمر، يرجى المحاولة مرة أخرى."
    });
  }
}