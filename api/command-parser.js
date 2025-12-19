import fetch from "node-fetch";

export default async function handler(req, res) {
  // إعدادات الوصول (CORS)
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "https://darbw.netlify.app");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const { text, adminName, history = [] } = req.body;

  // التحقق من وصول البيانات
  if (!text) {
    return res.status(400).json({ error: "خطأ: لم يتم استلام نص الأمر (text)" });
  }

  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error("Missing GROQ_API_KEY in Vercel settings");
    }

    // الاتصال بذكاء Groq الاصطناعي
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
            content: `أنت مساعد إداري في أكاديمية بر الوالدين لخدمة القرآن. اسمك "مساعد بر". المدير الحالي هو: ${adminName}. يجب أن يكون ردك وقوراً وباللغة العربية الفصحى. إذا كان الطلب أمراً إدارياً، رد بصيغة JSON تحتوي على action و data و warning.` 
          },
          ...history.slice(-5),
          { role: "user", content: text }
        ],
        temperature: 0.2
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error?.message || "خطأ في الاتصال بـ Groq");
    }

    const aiMsg = data.choices[0]?.message?.content || "";

    // استخراج الـ JSON من رد الذكاء الاصطناعي إذا وُجد
    let finalJson;
    try {
      const match = aiMsg.match(/\{.*\}/s);
      finalJson = match ? JSON.parse(match[0]) : { action: "chat", warning: aiMsg };
    } catch (e) {
      finalJson = { action: "chat", warning: aiMsg };
    }

    return res.status(200).json(finalJson);

  } catch (error) {
    console.error("Backend Error:", error);
    return res.status(500).json({ 
      action: "error", 
      warning: "عذراً، حدث خطأ داخلي في السيرفر. يرجى التأكد من إعدادات Vercel." 
    });
  }
}