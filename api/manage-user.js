import { verifyAdminRole, getSupabaseAdmin } from "./_utils/auth-admin.js";

/**
 * Unified User Management API for Supabase
 * POST /api/manage-user
 * Body: { action: 'delete'|'updateEmail'|'resetPassword', ...params }
 */
export default async function handler(req, res) {
    // 1. CORS Headers - ALWAYS FIRST
    // 1. CORS Headers - ALWAYS FIRST
    const allowedOrigins = [
        "https://darbw.netlify.app",
        "http://localhost:8080",
        "http://localhost:5173"
    ];
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
    } else {
        res.setHeader("Access-Control-Allow-Origin", "https://darbw.netlify.app"); // Fallback
    }
    res.setHeader("Access-Control-Allow-Credentials", true);
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    // 2. Handle OPTIONS
    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    try {
        const supabase = getSupabaseAdmin();

        // 🛡️ Security Check
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({ error: "Unauthorized: Missing Token" });
        }

        const token = authHeader.split("Bearer ")[1];

        // Verify token first to get UID
        const { data: { user }, error: verifyError } = await supabase.auth.getUser(token);
        if (verifyError || !user) {
            return res.status(401).json({ error: "Invalid Token" });
        }

        const decodedUid = user.id;

        const isAuthorized = await verifyAdminRole(token); // Checks if user is an admin or teacher in DB

        const { action, uid } = req.body;
        if (action !== 'createUser' && !uid) {
            return res.status(400).json({ error: "Missing User ID (uid)" });
        }

        // Authorization Logic
        let authorized = false;
        if (isAuthorized) {
            authorized = true; // Admin/Teacher can do anything
        } else if (action === 'resetPassword' && decodedUid === uid) {
            authorized = true; // User can reset own password
        } else if (action === 'updateEmail' && decodedUid === uid) {
            // Let a user update their own email if needed (for code changes)
            authorized = true;
        }

        if (!authorized) {
            return res.status(403).json({ error: "Forbidden: Unauthorized Action" });
        }

        // === CREATE USER ===
        if (action === "createUser") {
            if (!isAuthorized) return res.status(403).json({ error: "Forbidden: Admins Only" });

            const { email, password, fullName } = req.body;
            if (!email || !password) return res.status(400).json({ error: "Missing email or password" });

            const { data, error } = await supabase.auth.admin.createUser({
                email,
                password,
                email_confirm: true,
                user_metadata: { name: fullName }
            });

            if (error) throw new Error(error.message);

            return res.status(200).json({ success: true, uid: data.user.id });
        }

        // === DELETE USER ===
        if (action === "delete") {
            if (!isAuthorized) return res.status(403).json({ error: "Forbidden: Admins Only" });

            const { error } = await supabase.auth.admin.deleteUser(uid);
            if (error) throw new Error(error.message);

            // Note: Since we use ON DELETE CASCADE in PostgreSQL for most tables (students, behavior, progress),
            // deleting from public.users / auth.users will automatically clean up related data.
            // But if users is not tied directly to auth.users deletion natively by trigger, we should delete from public.users
            await supabase.from('users').delete().eq('id', uid);
            await supabase.from('students').delete().eq('id', uid); // just to be safe

            return res.status(200).json({ success: true, message: "User deleted" });
        }

        // === UPDATE EMAIL ===
        if (action === "updateEmail") {
            // Note: Only Admins can force an email change for another user.
            if (!isAuthorized && decodedUid !== uid) return res.status(403).json({ error: "Forbidden" });

            const { newEmail } = req.body;
            if (!newEmail) return res.status(400).json({ error: "Missing newEmail" });

            const { error } = await supabase.auth.admin.updateUserById(uid, { email: newEmail });
            if (error) throw new Error(error.message);

            await supabase.from('users').update({ email: newEmail }).eq('id', uid);

            return res.status(200).json({ success: true, message: "Email updated" });
        }

        // === RESET PASSWORD ===
        if (action === "resetPassword") {
            const { newPassword } = req.body;
            if (!newPassword || newPassword.length < 6) {
                return res.status(400).json({ error: "Password must be at least 6 chars" });
            }
            const { error } = await supabase.auth.admin.updateUserById(uid, { password: newPassword });
            if (error) throw new Error(error.message);

            await supabase.from('users').update({ password: newPassword }).eq('id', uid);

            return res.status(200).json({ success: true, message: "Password updated" });
        }

        return res.status(400).json({ error: "Invalid Action" });

    } catch (error) {
        console.error("Manage User Error:", error);
        return res.status(500).json({ error: "Server Error: " + error.message });
    }
}
