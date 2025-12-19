import fetch from "node-fetch";

/* =========================================
   🛡️ القوانين التنظيمية للأكاديمية (ملزمة)
========================================= */
const ACADEMY_POLICY = {
  attendance: {
    maxExcusePerMonth: 2, //
    maxAbsenceLimit: 12, //
    autoAction: "move_to_reserve", // الإجراء التلقائي عند تجاوز الغياب
  },
  admission: {
    minExamScore: 90, // الحد الأدنى للقبول 90%
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { text, adminName = "إدارة الأكاديمية" } = req.body;

  if (!text) {
    return res.status(400).json({ error: "الأمر فارغ" });
  }

  try {
    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`, // يُقرأ من Vercel بأمان
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          temperature: 0.1, // تقليل العشوائية لضمان دقة الـ JSON
          messages: [
            {
              role: "system",
              content: `
أنت المساعد الذكي لـ "أكاديمية بر الوالدين". وظيفتك هي صياغة قرارات الإدارة في قالب JSON برمجى.

❗ قواعد صارمة:
1. الرد يجب أن يكون JSON فقط.
2. ممنوع أي نص، شرح، أو اعتذار خارج القالب.
3. إذا كان الأمر غير مفهوم، استخدم action: "error".

🛡️ لائحة الأكاديمية الملزمة:
- الحد الأقصى للاستئذان: ${ACADEMY_POLICY.attendance.maxExcusePerMonth} شهرياً.
- الغياب المتكرر (${ACADEMY_POLICY.attendance.maxAbsenceLimit} حصة) يؤدي للنقل للاحتياطي (move_to_reserve).
- القبول يتطلب درجة امتحانية ≥ ${ACADEMY_POLICY.admission.minExamScore}٪.

🎯 الأوامر المسموحة (Actions):
- mark_absent: لرصد غياب طالب معين.
- send_report: لإرسال تقارير الأداء.
- reset_password: لتصفير كلمة مرور مستخدم.
- move_to_reserve: لنقل طالب من الأساسي للاحتياطي.
- notify_parent: لإرسال إشعار فوري لولي الأمر.
- delete_user: لحذف حساب نهائياً.
- update_email: لتغيير البريد الإلكتروني.

الصيغة المطلوبة:
{
  "action": "اسم_الأمر",
  "data": { "studentId": "...", "reason": "...", "newPassword": "..." },
  "requires_confirmation": true,
  "warning": "رسالة توضيحية للأدمن"
}
`,
            },
            {
              role: "user",
              content: `الأدمن ${adminName} يقول: ${text}`,
            },
          ],
        }),
      }
    );

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;

    // التأكد من أن الرد يبدأ بـ { لضمان أنه JSON صحيح
    if (!content || !content.trim().startsWith("{")) {
      throw new Error("الذكاء الاصطناعي لم يولد JSON صحيحاً");
    }

    res.status(200).json(JSON.parse(content));
  } catch (error) {
    console.error("AI Parser Error:", error);
    res.status(500).json({
      action: "error",
      warning: "حدث خطأ أثناء معالجة الأمر ذكياً، يرجى المحاولة بصياغة أخرى.",
    });
  }
}
