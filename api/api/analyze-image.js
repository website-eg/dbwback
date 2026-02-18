// api/analyze-image.js - Using Google Gemini Vision

export default async function handler(req, res) {
    // 🔥 Robust CORS Handling
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Missing GEMINI_API_KEY" });

    try {
        const { imageBase64 } = req.body;

        if (!imageBase64) {
            return res.status(400).json({ error: "No image provided" });
        }

        // استخراج نوع الصورة والبيانات
        const matches = imageBase64.match(/^data:(.+);base64,(.+)$/);
        if (!matches) {
            return res.status(400).json({ error: "Invalid image format" });
        }

        const mimeType = matches[1];
        const base64Data = matches[2];

        const prompt = `Extract the following details from this image and return ONLY valid JSON:
- name (Full Arabic Name of the person)
- nationalId (14-digit Egyptian National ID if visible)
- birthDate (in YYYY-MM-DD format if visible)
- address (Full address if visible)

If a field is not visible or cannot be determined, use null.
Return ONLY this JSON format, no other text:
{"name": "...", "nationalId": "...", "birthDate": "...", "address": "..."}`;

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [
                        {
                            parts: [
                                { text: prompt },
                                {
                                    inline_data: {
                                        mime_type: mimeType,
                                        data: base64Data
                                    }
                                }
                            ]
                        }
                    ],
                    generationConfig: {
                        temperature: 0,
                        maxOutputTokens: 500
                    }
                })
            }
        );

        const data = await response.json();

        if (!response.ok) {
            console.error("Gemini Error:", data);
            return res.status(500).json({
                error: `Gemini Error: ${data.error?.message || JSON.stringify(data)}`
            });
        }

        // استخراج النص من الرد
        const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

        // محاولة استخراج JSON من النص
        const jsonMatch = textContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            return res.status(200).json(parsed);
        } else {
            return res.status(500).json({ error: "Could not parse AI response", raw: textContent });
        }

    } catch (error) {
        console.error("Vision Error:", error);
        res.status(500).json({
            error: `Vision Error: ${error.message || "Unknown Error"}`,
            details: error.toString()
        });
    }
}
