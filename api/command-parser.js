import fetch from "node-fetch";

/**
 * 🛡️ الدستور الإداري والأخلاقي للأكاديمية
 */
const ACADEMY_POLICY = {
  attendance: {
    maxExcusePerMonth: 2,
    maxAbsenceLimit: 12,
    autoAction: "move_to_reserve",
  },
  admission: { minExamScore: 90 },
};

export default async function handler(req, res) {
  // إعدادات CORS للربط مع Netlify
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "https://darbw.netlify.app");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method Not Allowed" });

  const {
    text,
    role = "student",
    adminName = "إدارة الأكاديمية",
    history = [],
  } = req.body;

  try {
    const systemPrompt = {
      role: "system",
      content: `
أنت المساعد الإداري لـ "أكاديمية بر الوالدين". حول الأوامر لـ JSON فقط.
اسم المستخدم: ${adminName}. الرتبة: ${role}.

❗ قواعد صارمة:
- ابدأ الرد في حقل "warning" بـ: "أهلاً بك يا حامل القرآن 🤍".
- الرد يجب أن يكون JSON فقط: {"action": "...", "data": {...}, "warning": "..."}.

🛑 الخطوط الحمراء: 1. منع العنف تماماً (لا ضرب ولا إهانة). 2. السرية التامة. 3. القدوة الحسنة.
⚖️ الانضباط: الالتزام بالمواعيد، الزي المحتشم، ومنع الجوال أثناء الحلقات. الرصد يومي.
🌱 شروط الاستمرار: حضور (س/ا/ع)، تأخير > 5د يؤثر على التقييم، غياب 12 حصة = احتياطي آلياً.
👨‍👩‍👧 مسؤوليات ولي الأمر: المتابعة الرقمية والمنزلية والالتزام بالزي الشرعي للأبناء.

🎯 الأوامر المتاحة: mark_absent, send_report, reset_password, move_to_reserve, notify_parent, delete_user, update_email, chat.`,
    };

    const chatHistory = history.slice(-6).map((msg) => ({
      role: msg.role === "user" ? "user" : "assistant",
      content:
        typeof msg.content === "string"
          ? msg.content
          : JSON.stringify(msg.content),
    }));

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
          temperature: 0.2,
          messages: [
            systemPrompt,
            ...chatHistory,
            { role: "user", content: text },
          ],
        }),
      }
    );

    const data = await response.json();
    let content = data?.choices?.[0]?.message?.content || "";

    // تنظيف الـ JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const cleanContent = jsonMatch ? jsonMatch[0] : content;

    res.status(200).json(JSON.parse(cleanContent));
  } catch (error) {
    res
      .status(500)
      .json({
        action: "error",
        warning: "أهلاً بك يا حامل القرآن 🤍\nحدث خطأ في تحليل الطلب.",
      });
  }
}
