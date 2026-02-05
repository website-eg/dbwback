import admin from "firebase-admin";
import { verifyAdminRole } from "./_utils/auth-admin.js";

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

/**
 * Unified User Management API
 * POST /api/manage-user
 * Body: { action: 'delete'|'updateEmail'|'resetPassword', ...params }
 */
export default async function handler(req, res) {
    // CORS
    res.setHeader("Access-Control-Allow-Credentials", true);
    res.setHeader("Access-Control-Allow-Origin", "https://darbw.netlify.app");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    // 🛡️ Security Check
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Unauthorized: Missing Token" });
    }

    const token = authHeader.split("Bearer ")[1];
    const isAuthorized = await verifyAdminRole(token);
    if (!isAuthorized) {
        return res.status(403).json({ error: "Forbidden: Admins Only" });
    }

    const { action, uid } = req.body;
    if (!uid) return res.status(400).json({ error: "Missing User ID (uid)" });

    try {
        if (action === "delete") {
            await admin.auth().deleteUser(uid);
            return res.status(200).json({ success: true, message: "User deleted successfully" });
        }

        else if (action === "updateEmail") {
            const { newEmail } = req.body;
            if (!newEmail) return res.status(400).json({ error: "Missing newEmail" });

            await admin.auth().updateUser(uid, { email: newEmail });
            await admin.firestore().collection('users').doc(uid).update({ email: newEmail });
            return res.status(200).json({ success: true, message: "Email updated" });
        }

        else if (action === "resetPassword") {
            const { newPassword } = req.body;
            if (!newPassword || newPassword.length < 6) {
                return res.status(400).json({ error: "Invalid newPassword (min 6 chars)" });
            }
            await admin.auth().updateUser(uid, { password: newPassword });
            return res.status(200).json({ success: true, message: "Password reset successfully" });
        }

        else {
            return res.status(400).json({ error: "Invalid action" });
        }

    } catch (error) {
        console.error("Manage User Error:", error);
        return res.status(500).json({ error: error.message });
    }
}
