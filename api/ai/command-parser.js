// api/command-parser.js
import fetch from "node-fetch";

/* 🛡️ القوانين التنظيمية للأكاديمية */
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
  // 1. إعدادات رؤوس CORS لضمان قبول الطلب من نيتليفاى
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "https://darbw.netlify.app");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,OPTIONS,PATCH,DELETE,POST,PUT"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization"
  );

  // 2. معالجة طلب OPTIONS (Preflight) - حل مشكلة الـ CORS النهائية
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { text, adminName = "إدارة الأكاديمية", history = [] } = req.body;

  if (!text) return res.status(400).json({ error: "الأمر فارغ" });

  try {
    // 3. معالجة الذاكرة (Context) لآخر 6 رسائل
    const chatHistory = history.slice(-6).map((msg) => ({
      role: msg.role === "user" ? "user" : "assistant",
      content:
        typeof msg.content === "string"
          ? msg.content
          : JSON.stringify(msg.content),
    }));

    // 4. إعداد الأوامر والقوانين للذكاء الاصطناعي
    const systemPrompt = {
      role: "system",
      content: `أنت المساعد الإداري لـ "أكاديمية بر الوالدين". حول الأوامر لـ JSON فقط.
🛡️ لائحة الأكاديمية:
- الاستئذان: ${ACADEMY_POLICY.attendance.maxExcusePerMonth}/شهر.
- الغياب: ${ACADEMY_POLICY.attendance.maxAbsenceLimit} حصة = احتياطي.
- القبول: درجة ≥ ${ACADEMY_POLICY.admission.minExamScore}٪.
🎯 الأوامر: mark_absent, send_report, reset_password, move_to_reserve, notify_parent, delete_user, update_email.
رد بصيغة JSON فقط: {"action": "...", "data": {...}, "warning": "..."}`,
    };

    // 5. الاتصال بـ Groq API باستخدام المفتاح السري المخرن في Vercel
    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          temperature: 0.1,
          messages: [
            systemPrompt,
            ...chatHistory,
            { role: "user", content: `الأدمن ${adminName} يقول: ${text}` },
          ],
        }),
      }
    );

    const data = await response.json();
    let content = data?.choices?.[0]?.message?.content;

    if (!content) throw new Error("لم يتم استلام رد من الذكاء الاصطناعي");

    // 6. تنظيف الرد من علامات Markdown لضمان صحة الـ JSON
    let cleanContent = content.trim();
    if (cleanContent.startsWith("```")) {
      cleanContent = cleanContent
        .replace(/^```json\n?/, "")
        .replace(/\n?```$/, "")
        .trim();
    }

    res.status(200).json(JSON.parse(cleanContent));
  } catch (error) {
    console.error("AI Parser Error:", error);
    res.status(500).json({
      action: "error",
      warning: "حدث خطأ فني أثناء تحليل الأمر، يرجى المحاولة مرة أخرى.",
    });
  }
}
