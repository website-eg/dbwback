import fetch from "node-fetch";

/* =========================================
  🛡️ القوانين التنظيمية للأكاديمية (الدستور الملزم)
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
  // 1. إعدادات CORS الشاملة لضمان الربط الآمن مع Netlify
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

  // معالجة طلب OPTIONS (Preflight)
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method Not Allowed" });

  const {
    text,
    role = "student",
    adminName = "إدارة الأكاديمية",
    history = [],
  } = req.body;

  if (!text) return res.status(400).json({ error: "الأمر فارغ" });

  try {
    // 2. بناء البرومبت المركزي (دمج اللوائح والأخلاقيات)
    const systemPrompt = {
      role: "system",
      content: `
أنت المساعد الإداري الرقمي الرسمي لـ "أكاديمية بر الوالدين لخدمة القرآن الكريم" 📖.
اسم المستخدم الحالي: ${adminName}.

❗ قوانين تقنية صارمة:
- الرد يجب أن يكون قالب JSON فقط. ممنوع أي نص خارج القالب.
- ضع ردك التربوي دائماً داخل حقل "warning" ويبدأ بـ: "أهلاً بك يا حامل القرآن 🤍".

🛑 الخطوط الحمراء والأخلاقيات (ملزمة):
1. منع العنف تماماً: يُمنع الضرب أو الإهانة أو التلفظ؛ المخالفة تعني الرفع الفوري للإدارة.
2. السرية: الالتزام بالسرية التامة ومنع نشر أي محتوى داخلي دون إذن.
3. القدوة: التحلي بالسمت القرآني، والجمع بين الحزم والرحمة.

⚖️ الانضباط الإداري:
- المواعيد: الالتزام التام بالحضور، ارتداء الزي المحتشم (يمنع الرياضي).
- الجوال: يمنع استخدامه أثناء الحلقات. الرصد يكون في نفس اليوم بدقة.
- العقوبات: المخالفات المتكررة تعرض المعلم للإيقاف الفوري.

🌱 شروط الاستمرار (للطلاب):
- الحضور: (س/ا/ع) عصراً. التأخير > 5 دقائق يؤثر على التقييم.
- الغياب: استئذان مرتين شهرياً فقط. انقطاع 12 حصة = تحويل للاحتياطي آلياً.
- المظهر: زي شرعي، قص أظافر، نظافة شخصية. يمنع الجوال واصطحاب الأطفال.

🎯 الأوامر المتاحة للتنفيذ:
mark_absent, send_report, reset_password, move_to_reserve, notify_parent, delete_user, update_email, chat.

الصيغة المطلوبة للرد:
{
  "action": "اسم_الأمر أو chat",
  "data": { ... الحقول المطلوبة ... },
  "warning": "أهلاً بك يا حامل القرآن 🤍 ... (ردك التربوي الموجه لـ ${role} هنا)"
}`,
    };

    // 3. معالجة الذاكرة (آخر 6 رسائل للسياق)
    const chatHistory = history.slice(-6).map((msg) => ({
      role: msg.role === "user" ? "user" : "assistant",
      content:
        typeof msg.content === "string"
          ? msg.content
          : JSON.stringify(msg.content),
    }));

    // 4. الاتصال بـ Groq API باستخدام المفتاح السري
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
            {
              role: "user",
              content: `المستخدم ${adminName} بصفتة ${role} يقول: ${text}`,
            },
          ],
        }),
      }
    );

    const data = await response.json();
    let content = data?.choices?.[0]?.message?.content;

    if (!content) throw new Error("لم يتم توليد رد");

    // 5. تنظيف الرد من علامات Markdown لضمان صحة الـ JSON
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
      warning:
        "أهلاً بك يا حامل القرآن 🤍\nحدث خطأ فني أثناء معالجة الأمر، يرجى المحاولة مرة أخرى.",
    });
  }
}
