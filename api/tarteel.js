// api/tarteel.js
// Consolidated tarteel verification: quick and strict modes
// Usage: POST /api/tarteel with { mode: 'quick' | 'strict', audio_base64, expected_text }

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

    const mode = req.body?.mode || 'quick';

    try {
        const { audio_base64, expected_text } = req.body;
        if (!audio_base64 || !expected_text) {
            return res.status(400).json({ error: 'Missing audio_base64 or expected_text' });
        }

        // 1. Convert base64 to binary buffer
        const audioData = audio_base64.includes(',') ? audio_base64.split(',')[1] : audio_base64;
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
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` },
            body: formData
        });

        if (!whisperResponse.ok) {
            const errText = await whisperResponse.text();
            throw new Error(`Groq Whisper Error: ${whisperResponse.status} - ${errText}`);
        }

        const whisperData = await whisperResponse.json();
        const detected_text = whisperData.text?.trim() || '';

        // 3. Process based on mode
        if (mode === 'strict') {
            return await handleStrictMode(req, res, detected_text, expected_text);
        } else {
            return handleQuickMode(res, detected_text, expected_text);
        }

    } catch (error) {
        console.error('Tarteel Error:', error);
        res.status(500).json({ error: error.message || 'خطأ في معالجة التلاوة', details: error.toString() });
    }
}

// ==========================================
// QUICK MODE: Fuzzy word comparison
// ==========================================
function handleQuickMode(res, detected_text, expected_text) {
    const expectedWords = normalizeArabic(expected_text).split(/\s+/).filter(Boolean);
    const detectedWords = normalizeArabic(detected_text).split(/\s+/).filter(Boolean);

    let totalScore = 0;
    let matchedCount = 0;

    for (let i = 0; i < expectedWords.length; i++) {
        const expected = expectedWords[i];
        let bestMatch = 0;

        for (let j = Math.max(0, i - 2); j < Math.min(detectedWords.length, i + 3); j++) {
            const similarity = calculateSimilarity(expected, detectedWords[j]);
            bestMatch = Math.max(bestMatch, similarity);
        }

        if (bestMatch >= 0.6) matchedCount++;
        totalScore += bestMatch;
    }

    const score = expectedWords.length > 0 ? Math.round((totalScore / expectedWords.length) * 100) : 0;

    res.status(200).json({
        status: score >= 60 ? 'success' : 'needs_improvement',
        score,
        detected_text,
        expected_text,
        mode: 'quick',
        matched_words: matchedCount,
        total_words: expectedWords.length,
        message: score >= 60 ? 'أحسنت! التلاوة صحيحة ✅' : `حاول مرة أخرى، النتيجة: ${score}%`
    });
}

// ==========================================
// STRICT MODE: Gemini AI analysis
// ==========================================
async function handleStrictMode(req, res, detected_text, expected_text) {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) return res.status(500).json({ error: 'Missing GEMINI_API_KEY' });

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
                contents: [{ parts: [{ text: geminiPrompt }] }],
                generationConfig: { temperature: 0.3, maxOutputTokens: 512, responseMimeType: "application/json" }
            })
        }
    );

    if (!geminiResponse.ok) {
        const errText = await geminiResponse.text();
        throw new Error(`Gemini Error: ${geminiResponse.status} - ${errText}`);
    }

    const geminiData = await geminiResponse.json();
    let analysisText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

    const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
    let analysis = { score: 0, errors: [], tajweed_notes: '', feedback: '' };

    if (jsonMatch) {
        try { analysis = JSON.parse(jsonMatch[0]); } catch (e) { console.warn('Failed to parse Gemini JSON:', e); }
    }

    res.status(200).json({
        status: analysis.score >= 85 ? 'success' : 'needs_improvement',
        score: analysis.score,
        detected_text,
        expected_text,
        mode: 'strict',
        errors: analysis.errors || [],
        tajweed_notes: analysis.tajweed_notes || '',
        feedback: analysis.feedback || '',
        message: analysis.score >= 85 ? 'ممتاز! تلاوة صحيحة ودقيقة ✅' : `النتيجة: ${analysis.score}% - ${analysis.feedback || 'حاول مرة أخرى'}`
    });
}

// ==========================================
// Helpers
// ==========================================
function normalizeArabic(text) {
    return text
        .replace(/[\u064B-\u065F\u0670]/g, '')
        .replace(/[أإآ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي')
        .replace(/ء/g, '')
        .trim();
}

function calculateSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    if (str1 === str2) return 1;

    const len1 = str1.length;
    const len2 = str2.length;

    if (str1.includes(str2) || str2.includes(str1)) {
        return Math.min(len1, len2) / Math.max(len1, len2);
    }

    const matrix = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(0));
    for (let i = 0; i <= len1; i++) matrix[i][0] = i;
    for (let j = 0; j <= len2; j++) matrix[0][j] = j;

    for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
            const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
        }
    }

    return 1 - (matrix[len1][len2] / Math.max(len1, len2));
}
