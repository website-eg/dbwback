import fetch from "node-fetch";

export default async function handler(req, res) {
  // 1. إعدادات CORS للسماح لنيتليفاى بالوصول
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "https://darbw.netlify.app");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  // 2. استخراج البيانات (تأكدنا من مطابقة المسميات مع الفرونت إند)
  const { text, adminName, history = [] } = req.body;

  if (!text) {
    return res.status(400).json({ error: "الطلب فارغ، لم يتم استلام حقل text" });
  }

  try {
    // 3. التحقق من وجود مفتاح API
    if (!process.env.GROQ_API_KEY) {
      throw new Error("GROQ_API_KEY is missing in Vercel Environment Variables");
    }

    // 4. الاتصال بـ Groq API مباشرة لضمان أقصى سرعة
    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: `أنت مساعد إداري لأكاديمية بر الوالدين. اسم الإداري: ${adminName}. رد بوقار وأدب وبصيغة JSON فقط.` },
          ...history.slice(-6),
          { role: "user", content: text }
        ],
        temperature: 0.2
      })
    });

    const aiData = await groqResponse.json();
    
    // فحص هل رد Groq سليم؟
    if (!groqResponse.ok) {
      throw new Error(aiData.error?.message || "فشل الاتصال بـ Groq");
    }

    const aiContent = aiData.choices[0]?.message?.content || "";

    // محاولة استخراج JSON من رد الذكاء الاصطناعي
    let finalResponse;
    try {
      const jsonMatch = aiContent.match(/\{.*\}/s);
      finalResponse = jsonMatch ? JSON.parse(jsonMatch[0]) : { action: "chat", warning: aiContent };
    } catch (e) {
      finalResponse = { action: "chat", warning: aiContent };
    }

    return res.status(200).json(finalResponse);

  } catch (error) {
    console.error("Critical API Error:", error);
    return res.status(500).json({ 
      action: "error", 
      warning: "عذراً، حدث خطأ فني في السيرفر. تأكد من إعدادات المفاتيح البرمجية.",
      details: error.message 
    });
  }
}