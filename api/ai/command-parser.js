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
  // إعدادات CORS لضمان العمل مع Netlify
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "https://darbw.netlify.app");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method Not Allowed" });

  const { text, adminName = "إدارة الأكاديمية", history = [] } = req.body;

  if (!text) return res.status(400).json({ error: "الأمر فارغ" });

  try {
    // 1. تجهيز مصفوفة الرسائل مع الذاكرة (History)
    // نأخذ آخر 6 رسائل فقط للحفاظ على سرعة الرد واستهلاك التوكنز
    const chatHistory = history.slice(-6).map((msg) => ({
      role: msg.role === "user" ? "user" : "assistant",
      content:
        typeof msg.content === "string"
          ? msg.content
          : JSON.stringify(msg.content),
    }));

    const systemPrompt = {
      role: "system",
      content: `
أنت المساعد الإداري الذكي لـ "أكاديمية بر الوالدين". وظيفتك تحويل أوامر الإدارة إلى JSON منظم.

❗ قوانين تقنية صارمة:
- الرد يجب أن يكون قالب JSON فقط.
- ممنوع كتابة أي نص أو شرح خارج الـ JSON.
- إذا سألك المستخدم عن شيء لا تعرفه أو خارج الصلاحيات، استخدم action: "error".

🛡️ لائحة الأكاديمية:
- الاستئذان: بحد أقصى ${ACADEMY_POLICY.attendance.maxExcusePerMonth} شهرياً.
- الغياب: ${ACADEMY_POLICY.attendance.maxAbsenceLimit} حصة تؤدي للنقل للاحتياطي (move_to_reserve).
- القبول: يتطلب درجة ≥ ${ACADEMY_POLICY.admission.minExamScore}٪.

🎯 الأوامر المتاحة (Actions):
- mark_absent, send_report, reset_password, move_to_reserve, notify_parent, delete_user, update_email.

الصيغة المطلوبة:
{
  "action": "اسم_الأمر",
  "data": { ... الحقول المطلوبة ... },
  "requires_confirmation": true,
  "warning": "رسالة تأكيد أو توضيح باللغة العربية"
}`,
    };

    // 2. الاتصال بـ Groq API
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

    // 3. تنظيف الرد من علامات Markdown (مثل ```json ... ```)
    let cleanContent = content.trim();
    if (cleanContent.startsWith("```")) {
      cleanContent = cleanContent
        .replace(/^```json\n?/, "")
        .replace(/\n?```$/, "")
        .trim();
    }

    // 4. التأكد من صحة الـ JSON وإرساله
    const parsedResult = JSON.parse(cleanContent);
    res.status(200).json(parsedResult);
  } catch (error) {
    console.error("AI Parser Error:", error);
    res.status(500).json({
      action: "error",
      warning: "حدث خطأ فني، يرجى إعادة صياغة الأمر.",
    });
  }
}
