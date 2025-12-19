// api/command-parser.js
import { Groq } from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY, // تأكد من مطابقة الاسم في Vercel
});

export default async function handler(req, res) {
  // 1. تأكد من أن الطلب من نوع POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "الطريقة غير مسموح بها" });
  }

  try {
    const { prompt, context } = req.body;

    // 2. التحقق من وجود المدخلات
    if (!prompt) {
      return res.status(400).json({ error: "الطلب فارغ" });
    }

    // 3. استدعاء GROQ مع معالجة الوقت المستغرق
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "أنت مساعد إداري لأكاديمية قرآنية. حلل الأوامر بدقة.",
        },
        {
          role: "user",
          content: `السياق: ${JSON.stringify(context)}\nالأمر: ${prompt}`,
        },
      ],
      model: "mixtral-8x7b-32768",
    });

    const result = chatCompletion.choices[0]?.message?.content || "";

    // 4. إرسال استجابة JSON صحيحة دائماً
    return res.status(200).json({ result: result });
  } catch (error) {
    console.error("API Error:", error);
    // منع انهيار الخادم وإرسال خطأ بصيغة JSON
    return res.status(500).json({
      error: "حدث خطأ داخلي في الخادم",
      details: error.message,
    });
  }
}
