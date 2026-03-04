import admin from "firebase-admin";
import crypto from "crypto";

// Helper for Lazy Initialization
function initFirebase() {
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
    return admin.firestore();
}

/**
 * Unified Auth Token API
 * POST /api/auth-token
 * Body: { action: 'generate'|'verify', ...params }
 */
export default async function handler(req, res) {
    // 1. CORS Headers - ALWAYS FIRST
    res.setHeader("Access-Control-Allow-Credentials", true);
    res.setHeader("Access-Control-Allow-Origin", "https://darbw.netlify.app"); // Or req.headers.origin
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    // 2. Handle OPTIONS
    if (req.method === "OPTIONS") return res.status(200).end();

    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    try {
        // 4. Init Firebase (Lazy)
        const db = initFirebase();

        const { action } = req.body;

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
                return res.status(401).json({ error: "Invalid Auth Token" });
            }

            const { studentId } = req.body;
            if (!studentId) return res.status(400).json({ error: "Missing studentId" });

            // Generate Secure Token
            const token = crypto.randomBytes(32).toString("hex");

            // Save to Student Doc
            await db.collection("students").doc(studentId).update({
                lastLoginToken: token,
                tokenCreatedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            return res.status(200).json({ success: true, token });
        }

        // === VERIFY TOKEN ===
        if (action === "verify") {
            const { token } = req.body;
            if (!token) return res.status(400).json({ error: "Missing Token" });

            const snapshot = await db.collection("students")
                .where("lastLoginToken", "==", token)
                .limit(1)
                .get();

            if (snapshot.empty) {
                return res.status(400).json({ success: false, error: "Invalid Token" });
            }

            const studentDoc = snapshot.docs[0];
            const studentData = studentDoc.data();
            const uid = studentDoc.id;

            // Generate Custom Token for Firebase Auth
            const customToken = await admin.auth().createCustomToken(uid);

            return res.status(200).json({ success: true, customToken, uid });
        }

        return res.status(400).json({ error: "Invalid Action" });

    } catch (error) {
        console.error("Auth Token Error:", error);
        // Important: Return JSON error so frontend handles it gracefully
        return res.status(500).json({ error: "Server Error: " + error.message });
    }
}
