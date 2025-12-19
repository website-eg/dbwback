import fetch from "node-fetch";

export default async function handler(req, res) {
  // إعدادات CORS للسماح لموقع نيتليفاى بالوصول
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "https://darbw.netlify.app");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  
  try {
    const { text, adminName, history = [] } = req.body;

    if (!text) {
      return res.status(400).json({ action: "error", warning: "لم يصل نص الأمر للسيرفر" });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ action: "error", warning: "مفتاح GROQ_API_KEY مفقود في إعدادات Vercel" });
    }

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { 
            role: "system", 
            content: `أنت مساعد إداري في أكاديمية بر الوالدين. المدير: ${adminName}. رد بوقار وباللغة العربية. إذا كان أمراً إدارياً، استخدم صيغة JSON.` 
          },
          ...history.slice(-5),
          { role: "user", content: text }
        ],
        temperature: 0.2
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error?.message || "خطأ من مزود الذكاء الاصطناعي");
    }

    const aiMsg = data.choices[0]?.message?.content || "";
    
    // محاولة استخراج JSON من رد الذكاء الاصطناعي
    let finalJson;
    try {
      const match = aiMsg.match(/\{.*\}/s);
      finalJson = match ? JSON.parse(match[0]) : { action: "chat", warning: aiMsg };
    } catch (e) {
      finalJson = { action: "chat", warning: aiMsg };
    }

    return res.status(200).json(finalJson);

  } catch (error) {
    console.error("Vercel Function Error:", error);
    return res.status(200).json({ 
      action: "error", 
      warning: "حدث خطأ في معالجة الأمر. تأكد من أن مفتاح GROQ_API_KEY صحيح في Vercel." 
    });
  }
}