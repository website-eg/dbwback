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
        const snapshot = await db.collection("students")
            .where("nationalId", "==", nationalId)
            .limit(1)
            .get();

        if (snapshot.empty) {
            return res.status(404).json({
                error: "الرقم القومي غير مسجل لدينا"
            });
        }

        const studentDoc = snapshot.docs[0];
        const student = studentDoc.data();

        // التحقق من وجود الكود على الأقل
        if (!student.code) {
            return res.status(400).json({
                error: "بيانات الدخول غير مكتملة، يرجى مراجعة الإدارة"
            });
        }

        // =====================================================
        // 🔐 تغيير كلمة المرور (لو newPassword موجود)
        // =====================================================
        if (newPassword) {
            if (newPassword.length < 6) {
                return res.status(400).json({
                    error: "كلمة المرور يجب أن تكون 6 أحرف على الأقل"
                });
            }

            const email = `${student.code}@bar-parents.com`;
            let userRecord;
            try {
                userRecord = await admin.auth().getUserByEmail(email);
            } catch (e) {
                return res.status(404).json({
                    error: "الحساب غير موجود في نظام المصادقة"
                });
            }

            // تغيير في Firebase Auth
            await admin.auth().updateUser(userRecord.uid, { password: newPassword });

            // تحديث في Firestore
            await studentDoc.ref.update({ password: newPassword });

            return res.status(200).json({
                success: true,
                message: "تم تغيير كلمة المرور بنجاح",
                code: student.code
            });
        }

        // =====================================================
        // 📋 جلب بيانات الدخول (السلوك الأصلي)
        // =====================================================
        let loginToken = null;
        const tokenSnapshot = await db.collection("login_tokens")
            .where("studentId", "==", studentDoc.id)
            .where("permanent", "==", true)
            .limit(1)
            .get();

        if (!tokenSnapshot.empty) {
            loginToken = tokenSnapshot.docs[0].id;
        } else {
            loginToken = crypto.randomBytes(24).toString("base64url");

            await db.collection("login_tokens").doc(loginToken).set({
                studentId: studentDoc.id,
                studentName: student.fullName || "طالب",
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                expiresAt: null,
                permanent: true,
                used: false,
                usedAt: null,
                createdBy: "nid-lookup"
            });

            await db.collection("students").doc(studentDoc.id).update({
                lastLoginToken: loginToken,
                lastTokenCreatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
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

