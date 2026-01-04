// api/tarteel-quick.js
// النظام العادي: Groq Whisper فقط للتحويل السريع مع مقارنة بسيطة

export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    if (!GROQ_API_KEY) return res.status(500).json({ error: 'Missing GROQ_API_KEY' });

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

        // 2. Create FormData for Groq Whisper API
        const formData = new FormData();
        const blob = new Blob([audioBuffer], { type: 'audio/webm' });
        formData.append('file', blob, 'audio.webm');
        formData.append('model', 'whisper-large-v3');
        formData.append('language', 'ar');
        formData.append('response_format', 'json');

        // 3. Call Groq Whisper API
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

        // 4. Simple word-level comparison
        const expectedWords = normalizeArabic(expected_text).split(/\s+/).filter(Boolean);
        const detectedWords = normalizeArabic(detected_text).split(/\s+/).filter(Boolean);

        let matches = 0;
        const minLen = Math.min(expectedWords.length, detectedWords.length);

        for (let i = 0; i < minLen; i++) {
            if (expectedWords[i] === detectedWords[i]) matches++;
        }

        const score = expectedWords.length > 0
            ? Math.round((matches / expectedWords.length) * 100)
            : 0;

        // 5. Return result
        res.status(200).json({
            status: score >= 80 ? 'success' : 'needs_improvement',
            score,
            detected_text,
            expected_text,
            mode: 'quick',
            message: score >= 80
                ? 'أحسنت! التلاوة صحيحة ✅'
                : `حاول مرة أخرى، النتيجة: ${score}%`
        });

    } catch (error) {
        console.error('Tarteel Quick Error:', error);
        res.status(500).json({
            error: error.message || 'خطأ في معالجة التلاوة',
            details: error.toString()
        });
    }
}

// تطبيع النص العربي (إزالة التشكيل والهمزات المختلفة)
function normalizeArabic(text) {
    return text
        .replace(/[\u064B-\u065F\u0670]/g, '') // إزالة التشكيل
        .replace(/[أإآ]/g, 'ا') // توحيد الألف
        .replace(/ة/g, 'ه') // التاء المربوطة
        .replace(/ى/g, 'ي') // الألف المقصورة
        .trim();
}
