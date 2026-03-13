// api/get-credentials-by-nid.js
// ✅ Migrated to Supabase (data + auth). No Firebase dependency.

import crypto from "crypto";
import { getSupabaseAdmin } from "./_utils/auth-admin.js";

const supabase = getSupabaseAdmin();

/**
 * API للحصول على بيانات الدخول بالرقم القومي + تغيير كلمة المرور
 * POST /api/get-credentials-by-nid
 * Body: { nationalId: string }                    ← جلب البيانات
 * Body: { nationalId: string, newPassword: string } ← تغيير كلمة المرور
 */
export default async function handler(req, res) {
    // CORS
    res.setHeader("Access-Control-Allow-Credentials", true);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    const { nationalId, newPassword } = req.body;

    // التحقق من صحة الرقم القومي
    if (!nationalId || nationalId.length !== 14 || !/^\d{14}$/.test(nationalId)) {
        return res.status(400).json({
            error: "الرقم القومي يجب أن يتكون من 14 رقم"
        });
    }

    try {
        // البحث عن الطالب بالرقم القومي
        const { data: student, error: studentError } = await supabase
            .from('students')
            .select('*')
            .eq('nationalId', nationalId)
            .limit(1)
            .maybeSingle();

        if (studentError || !student) {
            return res.status(404).json({
                error: "الرقم القومي غير مسجل لدينا"
            });
        }

        // التحقق من وجود الكود
        if (!student.code) {
            return res.status(400).json({
                error: "بيانات الدخول غير مكتملة، يرجى مراجعة الإدارة"
            });
        }

        // =====================================================
        // 🔐 تغيير كلمة المرور
        // =====================================================
        if (newPassword) {
            if (newPassword.length < 6) {
                return res.status(400).json({
                    error: "كلمة المرور يجب أن تكون 6 أحرف على الأقل"
                });
            }

            const email = `${student.code}@bar-parents.com`;

            // Find user in Supabase Auth by email
            const { data: usersList } = await supabase.auth.admin.listUsers({ perPage: 1000 });
            let authUser = usersList?.users?.find(u => u.email === email);

            // Auto-create auth account if it doesn't exist
            if (!authUser) {
                const { data: newAuthUser, error: createError } = await supabase.auth.admin.createUser({
                    email,
                    password: newPassword,
                    email_confirm: true,
                    user_metadata: { name: student.fullName || 'طالب' }
                });
                if (createError) throw new Error(createError.message);
                authUser = newAuthUser.user;

                // Create/update users table entry
                await supabase.from('users').upsert({
                    id: authUser.id,
                    fullName: student.fullName || '',
                    code: student.code,
                    role: 'student',
                    email: email,
                    createdAt: new Date().toISOString(),
                });

                // Link student to auth account
                await supabase.from('students').update({ uid: authUser.id }).eq('id', student.id);
            }

            // Update password in Supabase Auth
            const { error: updateError } = await supabase.auth.admin.updateUserById(authUser.id, {
                password: newPassword
            });
            if (updateError) throw new Error(updateError.message);

            // Update in students table
            await supabase.from('students').update({ password: newPassword }).eq('id', student.id);

            return res.status(200).json({
                success: true,
                message: "تم تغيير كلمة المرور بنجاح",
                code: student.code
            });
        }

        // =====================================================
        // 📋 جلب بيانات الدخول
        // =====================================================
        let loginToken = null;

        // Check for existing permanent token
        const { data: existingTokens } = await supabase
            .from('login_tokens')
            .select('id')
            .eq('studentId', student.id)
            .eq('permanent', true)
            .limit(1);

        if (existingTokens && existingTokens.length > 0) {
            loginToken = existingTokens[0].id;
        } else {
            loginToken = crypto.randomBytes(24).toString("base64url");

            await supabase.from('login_tokens').insert({
                id: loginToken,
                studentId: student.id,
                studentName: student.fullName || "طالب",
                createdAt: new Date().toISOString(),
                expiresAt: null,
                permanent: true,
                used: false,
                usedAt: null,
                createdBy: "nid-lookup"
            });

            await supabase.from('students').update({
                lastLoginToken: loginToken,
                lastTokenCreatedAt: new Date().toISOString()
            }).eq('id', student.id);
        }

        return res.status(200).json({
            success: true,
            data: {
                name: student.fullName || "",
                code: student.code,
                password: student.password || null,
                token: loginToken
            }
        });

    } catch (error) {
        console.error("Get Credentials Error:", error);
        return res.status(500).json({
            error: "حدث خطأ غير متوقع، يرجى المحاولة مرة أخرى"
        });
    }
}
