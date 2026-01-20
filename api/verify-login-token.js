import admin from "firebase-admin";

// تهيئة Firebase Admin
if (!admin.apps.length) {
    if (!process.env.FIREBASE_PRIVATE_KEY) {
        throw new Error("Missing FIREBASE_PRIVATE_KEY");
    }
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
        }),
    });
}

const db = admin.firestore();

/**
 * API للتحقق من Login Token وتسجيل الدخول
 * POST /api/verify-login-token
 * Body: { token: string }
 * 
 * يُستخدم من صفحة تسجيل الدخول عند مسح QR Code
 */
export default async function handler(req, res) {
    // CORS
    res.setHeader("Access-Control-Allow-Credentials", true);
    res.setHeader("Access-Control-Allow-Origin", "https://darbw.netlify.app");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    const { token } = req.body;
    if (!token) {
        return res.status(400).json({ error: "مطلوب Token" });
    }

    try {
        // جلب Token من Firestore
        const tokenDoc = await db.collection("login_tokens").doc(token).get();

        if (!tokenDoc.exists) {
            return res.status(404).json({ error: "Token غير موجود أو منتهي الصلاحية" });
        }

        const tokenData = tokenDoc.data();

        // التحقق من الصلاحية (فقط إذا كان التوكن غير دائم)
        if (tokenData.expiresAt && !tokenData.permanent) {
            const now = new Date();
            const expiresAt = tokenData.expiresAt?.toDate ? tokenData.expiresAt.toDate() : new Date(tokenData.expiresAt);

            if (now > expiresAt) {
                // حذف Token المنتهي
                await db.collection("login_tokens").doc(token).delete();
                return res.status(410).json({ error: "Token منتهي الصلاحية" });
            }
        }

        // ✅ Token دائم ومتعدد الاستخدام - لا نتحقق من used   // }

        // التحقق من وجود الطالب
        const studentId = tokenData.studentId;
        const studentDoc = await db.collection("students").doc(studentId).get();

        if (!studentDoc.exists) {
            return res.status(404).json({ error: "الطالب غير موجود" });
        }

        // 🔐 توليد Firebase Custom Token للدخول
        const customToken = await admin.auth().createCustomToken(studentId, {
            role: "student",
            loginMethod: "qr_token"
        });

        // تحديث حالة Token (تم الاستخدام)
        await db.collection("login_tokens").doc(token).update({
            used: true,
            usedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastUsedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // إرجاع Custom Token
        return res.status(200).json({
            success: true,
            customToken: customToken,
            studentId: studentId,
            studentName: tokenData.studentName
        });

    } catch (error) {
        console.error("Verify Token Error:", error);
        return res.status(500).json({ error: "فشل التحقق: " + error.message });
    }
}
