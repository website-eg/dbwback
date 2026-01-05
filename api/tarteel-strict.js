// api/tarteel-strict.js
// النظام الصارم: Groq Whisper للتحويل + Gemini Flash للتحليل الذكي

export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

    if (!GROQ_API_KEY) return res.status(500).json({ error: 'Missing GROQ_API_KEY' });
    if (!GEMINI_API_KEY) return res.status(500).json({ error: 'Missing GEMINI_API_KEY' });

    try {
        const { audio_base64, expected_text } = req.body;
        if (!audio_base64 || !expected_text) {
            return res.status(400).json({ error: 'Missing audio_base64 or expected_text' });
        }

        // 1. Convert base64 to binary buffer
        const audioData = audio_base64.includes(',')
            ? audio_base64.split(',')[1]
            : audio_base64;
        const audioBuffer = Buffer.from(audioData, 'base64');

        // 2. Call Groq Whisper API for STT
        const formData = new FormData();
        const blob = new Blob([audioBuffer], { type: 'audio/webm' });
        formData.append('file', blob, 'audio.webm');
        formData.append('model', 'whisper-large-v3');
        formData.append('language', 'ar');
        formData.append('response_format', 'json');

        const whisperResponse = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
            },
            body: formData
        });

        if (!whisperResponse.ok) {
            const errText = await whisperResponse.text();
            throw new Error(`Groq Whisper Error: ${whisperResponse.status} - ${errText}`);
        }

        const whisperData = await whisperResponse.json();
        const detected_text = whisperData.text?.trim() || '';

        // 3. Call Gemini Flash for intelligent comparison
        const geminiPrompt = `قارن بين النصين التالين بدقة:
المتوقع: "${expected_text}"
المكتشف: "${detected_text}"

أعطني النتيجة بصيغة JSON فقط:
{
  "score": نسبة مئوية (رقم),
  "errors": [{"wrong": "الخاطئة", "correct": "الصحيحة", "position": رقم}],
  "tajweed_notes": "ملاحظة مختصرة جداً",
  "feedback": "رسالة تشجيعية مختصرة"
}`;

        const geminiResponse = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [{ text: geminiPrompt }]
                    }],
                    generationConfig: {
                        temperature: 0.3,
                        maxOutputTokens: 512, // Reduced to prevent timeout
                        responseMimeType: "application/json"
                    }
                })
            }
        );

        if (!geminiResponse.ok) {
            const errText = await geminiResponse.text();
            throw new Error(`Gemini Error: ${geminiResponse.status} - ${errText}`);
        }

        const geminiData = await geminiResponse.json();
        let analysisText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

        // Extract JSON from response (handle markdown code blocks)
        const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
        let analysis = { score: 0, errors: [], tajweed_notes: '', feedback: '' };

        if (jsonMatch) {
            try {
                analysis = JSON.parse(jsonMatch[0]);
            } catch (e) {
                console.warn('Failed to parse Gemini JSON:', e);
            }
        }

        // 4. Return comprehensive result
        res.status(200).json({
            status: analysis.score >= 85 ? 'success' : 'needs_improvement',
            score: analysis.score,
            detected_text,
            expected_text,
            mode: 'strict',
            errors: analysis.errors || [],
            tajweed_notes: analysis.tajweed_notes || '',
            feedback: analysis.feedback || '',
            message: analysis.score >= 85
                ? 'ممتاز! تلاوة صحيحة ودقيقة ✅'
                : `النتيجة: ${analysis.score}% - ${analysis.feedback || 'حاول مرة أخرى'}`
        });

    } catch (error) {
        console.error('Tarteel Strict Error:', error);
        res.status(500).json({
            error: error.message || 'خطأ في معالجة التلاوة',
            details: error.toString()
        });
    }
}
