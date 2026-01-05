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

        // 4. Fuzzy word-level comparison using Levenshtein distance
        const expectedWords = normalizeArabic(expected_text).split(/\s+/).filter(Boolean);
        const detectedWords = normalizeArabic(detected_text).split(/\s+/).filter(Boolean);

        let totalScore = 0;
        let matchedCount = 0;

        // Compare each expected word with best matching detected word
        for (let i = 0; i < expectedWords.length; i++) {
            const expected = expectedWords[i];
            let bestMatch = 0;

            // Look for best match in nearby words (±2 positions)
            for (let j = Math.max(0, i - 2); j < Math.min(detectedWords.length, i + 3); j++) {
                const similarity = calculateSimilarity(expected, detectedWords[j]);
                bestMatch = Math.max(bestMatch, similarity);
            }

            if (bestMatch >= 0.6) { // 60% similarity = match
                matchedCount++;
            }
            totalScore += bestMatch;
        }

        const score = expectedWords.length > 0
            ? Math.round((totalScore / expectedWords.length) * 100)
            : 0;

        // 5. Return result (lowered threshold to 60%)
        res.status(200).json({
            status: score >= 60 ? 'success' : 'needs_improvement',
            score,
            detected_text,
            expected_text,
            mode: 'quick',
            matched_words: matchedCount,
            total_words: expectedWords.length,
            message: score >= 60
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
        .replace(/ء/g, '')  // إزالة الهمزة
        .trim();
}

// حساب التشابه باستخدام Levenshtein Distance
function calculateSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    if (str1 === str2) return 1;

    const len1 = str1.length;
    const len2 = str2.length;

    // Quick check for containment
    if (str1.includes(str2) || str2.includes(str1)) {
        return Math.min(len1, len2) / Math.max(len1, len2);
    }

    // Levenshtein distance
    const matrix = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(0));

    for (let i = 0; i <= len1; i++) matrix[i][0] = i;
    for (let j = 0; j <= len2; j++) matrix[0][j] = j;

    for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
            const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost
            );
        }
    }

    const distance = matrix[len1][len2];
    return 1 - (distance / Math.max(len1, len2));
}

