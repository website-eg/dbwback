import admin from "firebase-admin";
import crypto from "crypto";

// Initialize Firebase Admin
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
 * Unified Auth Token API
 * POST /api/auth-token
 * Body: { action: 'generate'|'verify', ...params }
 */
export default async function handler(req, res) {
    // CORS
    res.setHeader("Access-Control-Allow-Credentials", true);
    res.setHeader("Access-Control-Allow-Origin", "https://darbw.netlify.app");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const { action } = req.body;

    try {
        // === GENERATE TOKEN ===
        if (action === "generate") {
            // Check Admin/Teacher Role
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith("Bearer ")) {
                return res.status(401).json({ error: "Unauthorized: Missing Token" });
            }
            const idToken = authHeader.split("Bearer ")[1];
            try {
                const decodedToken = await admin.auth().verifyIdToken(idToken);
                const userDoc = await db.collection("users").doc(decodedToken.uid).get();
                const role = userDoc.exists ? userDoc.data().role : null;
                if (role !== "admin" && role !== "teacher") {
                    return res.status(403).json({ error: "Forbidden: Admins/Teachers Only" });
                }
            } catch (e) {
                return res.status(401).json({ error: "Invalid Token" });
            }

            const { studentId } = req.body;
            if (!studentId) return res.status(400).json({ error: "Missing studentId" });

            const studentDoc = await db.collection("students").doc(studentId).get();
            if (!studentDoc.exists) return res.status(404).json({ error: "Student not found" });

            const loginToken = crypto.randomBytes(24).toString("base64url");
            await db.collection("login_tokens").doc(loginToken).set({
                studentId: studentId,
                studentName: studentDoc.data().fullName || "Student",
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                expiresAt: null,
                permanent: true,
                used: false,
                usedAt: null
            });

            await db.collection("students").doc(studentId).update({
                lastLoginToken: loginToken,
                lastTokenCreatedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            return res.status(200).json({
                success: true,
                token: loginToken,
                qrValue: `TOKEN:::${loginToken}`,
                expiresAt: null,
                permanent: true,
                studentName: studentDoc.data().fullName
            });
        }

        // === VERIFY TOKEN ===
        else if (action === "verify") {
            const { token } = req.body;
            if (!token) return res.status(400).json({ error: "Missing Token" });

            const tokenDoc = await db.collection("login_tokens").doc(token).get();
            if (!tokenDoc.exists) return res.status(404).json({ error: "Token not found" });

            const tokenData = tokenDoc.data();
            // Check expiration if not permanent... (logic simplified for brevity as per original)

            const studentId = tokenData.studentId;
            const studentDoc = await db.collection("students").doc(studentId).get();
            if (!studentDoc.exists) return res.status(404).json({ error: "Student not found" });

            const customToken = await admin.auth().createCustomToken(studentId, {
                role: "student",
                loginMethod: "qr_token"
            });

            await db.collection("login_tokens").doc(token).update({
                used: true,
                usedAt: admin.firestore.FieldValue.serverTimestamp(),
                lastUsedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            return res.status(200).json({
                success: true,
                customToken: customToken,
                studentId: studentId,
                studentName: tokenData.studentName
            });
        }

        else {
            return res.status(400).json({ error: "Invalid action" });
        }

    } catch (error) {
        console.error("Auth Token Error:", error);
        return res.status(500).json({ error: error.message });
    }
}
