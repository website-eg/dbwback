import admin from "firebase-admin";
import crypto from "crypto";

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
 * API لتوليد Login Token للطالب
 * POST /api/generate-login-token
 * Body: { studentId: string }
 * 
 * يُستخدم من قبل الأدمن لتوليد QR Code للطالب
 */
export default async function handler(req, res) {
    // CORS
    res.setHeader("Access-Control-Allow-Credentials", true);
    res.setHeader("Access-Control-Allow-Origin", "https://darbw.netlify.app");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    // 🛡️ التحقق من صلاحية الأدمن/المعلم
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "غير مصرح: يجب إرسال التوكن" });
    }

    try {
        const idToken = authHeader.split("Bearer ")[1];
        const decodedToken = await admin.auth().verifyIdToken(idToken);

        // التحقق من الدور
        const userDoc = await db.collection("users").doc(decodedToken.uid).get();
        if (!userDoc.exists) {
            return res.status(403).json({ error: "المستخدم غير موجود" });
        }

        const role = userDoc.data().role;
        if (role !== "admin" && role !== "teacher") {
            return res.status(403).json({ error: "هذا الإجراء للمشرفين والمعلمين فقط" });
        }
    } catch (error) {
        return res.status(401).json({ error: "توكن غير صالح" });
    }

    // استخراج معرف الطالب
    const { studentId } = req.body;
    if (!studentId) {
        return res.status(400).json({ error: "مطلوب معرف الطالب (studentId)" });
    }

    try {
        // التحقق من وجود الطالب
        const studentDoc = await db.collection("students").doc(studentId).get();
        if (!studentDoc.exists) {
            return res.status(404).json({ error: "الطالب غير موجود" });
        }

        const studentData = studentDoc.data();

        // توليد Token فريد (32 حرف)
        const loginToken = crypto.randomBytes(24).toString("base64url");

        // 🔐 Token دائم - لا ينتهي
        const expiresAt = null; // دائم

        // حفظ Token في Firestore
        await db.collection("login_tokens").doc(loginToken).set({
            studentId: studentId,
            studentName: studentData.fullName || "طالب",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            expiresAt: expiresAt, // null = دائم
            permanent: true, // علامة أنه دائم
            used: false,
            usedAt: null
        });

        // تحديث سجل الطالب بآخر Token
        await db.collection("students").doc(studentId).update({
            lastLoginToken: loginToken,
            lastTokenCreatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // إرجاع Token للعرض في QR
        return res.status(200).json({
            success: true,
            token: loginToken,
            qrValue: `TOKEN:::${loginToken}`,
            expiresAt: null, // دائم - لا ينتهي
            permanent: true,
            studentName: studentData.fullName
        });

    } catch (error) {
        console.error("Generate Token Error:", error);
        return res.status(500).json({ error: "فشل توليد Token: " + error.message });
    }
}
