import Groq from "groq-sdk";

export default async function handler(req, res) {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Missing API Key" });

    const groq = new Groq({ apiKey });

    try {
        const { imageBase64 } = req.body;

        if (!imageBase64) {
            return res.status(400).json({ error: "No image provided" });
        }

        const chatCompletion = await groq.chat.completions.create({
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: `extract the following details from the image in JSON format ONLY:
              - name (Full Arabic Name)
              - nationalId (14 digits)
              - birthDate (YYYY-MM-DD from the ID)
              - address (Full address if available)
              
              If a field is not visible, return null. 
              Output format: { "name": "...", "nationalId": "...", "birthDate": "...", "address": "..." }`,
                        },
                        {
                            type: "image_url",
                            image_url: {
                                url: imageBase64,
                            },
                        },
                    ],
                },
            ],
            model: "llama-3.2-11b-vision-preview",
            temperature: 0,
            stream: false,
            response_format: { type: "json_object" },
        });

        const content = chatCompletion.choices[0].message.content;
        res.status(200).json(JSON.parse(content));
    } catch (error) {
        console.error("AI Vision Error:", error);
        res.status(500).json({
            error: `Vision Error: ${error.message || "Unknown Error"}`,
            details: error.toString()
        });
    }
}
