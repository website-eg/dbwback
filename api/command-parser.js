import Groq from "groq-sdk";

export default async function handler(req, res) {
  // 1. التأكد من أن الطلب من نوع POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "الطريقة غير مسموح بها" });
  }

  // 2. استدعاء مفتاح الأمان من بيئة العمل (Environment Variables)
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "مفتاح API غير معرف في السيرفر" });
  }

  const groq = new Groq({ apiKey });

  try {
    const { messages, systemPrompt } = req.body;

    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      temperature: 0.2, // درجة ذكاء ثابتة ومنضبطة للأكاديمية
    });

    const result = response.choices[0].message.content;

    // إرجاع النتيجة كـ JSON
    res.status(200).json({ content: result });
  } catch (error) {
    console.error("Server Error:", error);
    res.status(500).json({ error: "فشل السيرفر في معالجة الأمر" });
  }
}
