import { verifyAdminRole, getSupabaseAdmin } from "./_utils/auth-admin.js";
import crypto from "crypto";

/**
 * Unified Auth Token API (Migrated to Supabase)
 * POST /api/auth-token
 * Body: { action: 'generate'|'verify', ...params }
 */
export default async function handler(req, res) {
    // 1. CORS Headers
    res.setHeader("Access-Control-Allow-Credentials", true);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    // 2. Handle OPTIONS
    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    try {
        const supabase = getSupabaseAdmin();
        const { action } = req.body;

        // === GENERATE TOKEN ===
        if (action === "generate") {
            // Check Admin/Teacher Role
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith("Bearer ")) {
                return res.status(401).json({ error: "Unauthorized: Missing Token" });
            }
            const idToken = authHeader.split("Bearer ")[1];

            const isAuthorized = await verifyAdminRole(idToken);
            if (!isAuthorized) {
                return res.status(403).json({ error: "Forbidden: Admins/Teachers Only" });
            }

            const { studentId } = req.body;
            if (!studentId) return res.status(400).json({ error: "Missing studentId" });

            // Generate Secure Token
            const token = crypto.randomBytes(32).toString("hex");

            // Save to login_tokens table
            const { error: tokenErr } = await supabase.from('login_tokens').upsert({
                id: `token_${studentId}`,
                studentId: studentId,
                permanent: false,
                used: false,
                createdBy: 'admin',
                createdAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24h
            });

            // Also store on student record for quick lookup
            const { error: studentErr } = await supabase
                .from('students')
                .update({
                    lastLoginToken: token,
                    tokenCreatedAt: new Date().toISOString(),
                })
                .eq('id', studentId);

            if (tokenErr) console.warn("Token insert error:", tokenErr.message);
            if (studentErr) console.warn("Student update error:", studentErr.message);

            return res.status(200).json({ success: true, token });
        }

        // === VERIFY TOKEN ===
        if (action === "verify") {
            const { token } = req.body;
            if (!token) return res.status(400).json({ error: "Missing Token" });

            // Search for student with this token
            const { data: students, error: searchErr } = await supabase
                .from('students')
                .select('id, fullName')
                .eq('lastLoginToken', token)
                .limit(1);

            if (searchErr || !students || students.length === 0) {
                return res.status(400).json({ success: false, error: "Invalid Token" });
            }

            const student = students[0];
            const uid = student.id;

            // Get the user's email for Supabase auth sign-in
            const { data: userData } = await supabase
                .from('users')
                .select('email, password')
                .eq('id', uid)
                .maybeSingle();

            if (!userData) {
                return res.status(400).json({ success: false, error: "User not found" });
            }

            return res.status(200).json({
                success: true,
                uid,
                email: userData.email,
                password: userData.password,
            });
        }

        return res.status(400).json({ error: "Invalid Action" });

    } catch (error) {
        console.error("Auth Token Error:", error);
        return res.status(500).json({ error: "Server Error: " + error.message });
    }
}
