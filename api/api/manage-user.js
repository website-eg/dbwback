import admin from "firebase-admin";
import { verifyAdminRole } from "./_utils/auth-admin.js";

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
}

/**
 * Unified User Management API
 * POST /api/manage-user
 * Body: { action: 'delete'|'updateEmail'|'resetPassword', ...params }
 */
export default async function handler(req, res) {
    // 1. CORS Headers - ALWAYS FIRST
    res.setHeader("Access-Control-Allow-Credentials", true);
    res.setHeader("Access-Control-Allow-Origin", "https://darbw.netlify.app");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    // 2. Handle OPTIONS
    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    try {
        // 4. Init Firebase (Lazy)
        initFirebase();

        // 🛡️ Security Check
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({ error: "Unauthorized: Missing Token" });
        }

        const token = authHeader.split("Bearer ")[1];

        // Verify token first to get UID
        let decodedToken;
        try {
            decodedToken = await admin.auth().verifyIdToken(token);
        } catch (e) {
            return res.status(401).json({ error: "Invalid Token" });
        }

        const isAuthorized = await verifyAdminRole(token); // Checks if user is actually an admin in DB

        const { action, uid } = req.body;
        if (!uid) return res.status(400).json({ error: "Missing User ID (uid)" });

        // Authorization Logic
        let authorized = false;
        if (isAuthorized) {
            authorized = true; // Admin can do anything
        } else if (action === 'resetPassword' && decodedToken.uid === uid) {
            authorized = true; // User can reset own password
        }

        if (!authorized) {
            return res.status(403).json({ error: "Forbidden: Unauthorized Action" });
        }

        // === DELETE USER ===
        if (action === "delete") {
            if (!isAuthorized) return res.status(403).json({ error: "Forbidden: Admins Only" });

            await admin.auth().deleteUser(uid);
            return res.status(200).json({ success: true, message: "User deleted" });
        }

        // === UPDATE EMAIL ===
        if (action === "updateEmail") {
            if (!isAuthorized) return res.status(403).json({ error: "Forbidden: Admins Only" });

            const { newEmail } = req.body;
            if (!newEmail) return res.status(400).json({ error: "Missing newEmail" });

            await admin.auth().updateUser(uid, { email: newEmail });
            return res.status(200).json({ success: true, message: "Email updated" });
        }

        // === RESET PASSWORD ===
        if (action === "resetPassword") {
            const { newPassword } = req.body;
            if (!newPassword || newPassword.length < 6) {
                return res.status(400).json({ error: "Password must be at least 6 chars" });
            }
            await admin.auth().updateUser(uid, { password: newPassword });
            return res.status(200).json({ success: true, message: "Password updated" });
        }

        return res.status(400).json({ error: "Invalid Action" });

    } catch (error) {
        console.error("Manage User Error:", error);
        return res.status(500).json({ error: "Server Error: " + error.message });
    }
}
