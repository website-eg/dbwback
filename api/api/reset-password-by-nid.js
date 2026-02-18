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
 * API لتغيير كلمة المرور بالرقم القومي
 * POST /api/reset-password-by-nid
 * Body: { nationalId: string, newPassword: string }
 * 
 * يتحقق من الرقم القومي ← يجد الطالب ← يغيّر كلمة المرور مباشرة
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

    // التحقق من صحة المدخلات
    if (!nationalId || nationalId.length !== 14 || !/^\d{14}$/.test(nationalId)) {
        return res.status(400).json({
            error: "الرقم القومي يجب أن يتكون من 14 رقم"
        });
    }

    if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({
            error: "كلمة المرور يجب أن تكون 6 أحرف على الأقل"
        });
    }

    try {
        // 1. البحث عن الطالب بالرقم القومي
        const snapshot = await db.collection("students")
            .where("nationalId", "==", nationalId)
            .limit(1)
            .get();

        if (snapshot.empty) {
            return res.status(404).json({
                error: "الرقم القومي غير مسجل في النظام"
            });
        }

        const studentDoc = snapshot.docs[0];
        const student = studentDoc.data();

        if (!student.code) {
            return res.status(400).json({
                error: "لا يوجد كود مرتبط بهذا الرقم القومي"
            });
        }

        // 2. إيجاد المستخدم في Firebase Auth
        const email = `${student.code}@bar-parents.com`;
        let userRecord;
        try {
            userRecord = await admin.auth().getUserByEmail(email);
        } catch (e) {
            return res.status(404).json({
                error: "الحساب غير موجود في نظام المصادقة"
            });
        }

        // 3. تغيير كلمة المرور في Firebase Auth
        await admin.auth().updateUser(userRecord.uid, {
            password: newPassword,
        });

        // 4. تحديث كلمة المرور في Firestore
        await studentDoc.ref.update({ password: newPassword });

        return res.status(200).json({
            success: true,
            message: "تم تغيير كلمة المرور بنجاح",
            code: student.code  // Return the code so user can login
        });

    } catch (error) {
        console.error("Reset Password Error:", error);
        return res.status(500).json({
            error: "حدث خطأ غير متوقع، يرجى المحاولة مرة أخرى"
        });
    }
}
