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
 * API للحصول على بيانات الدخول بالرقم القومي
 * POST /api/get-credentials-by-nid
 * Body: { nationalId: string }
 * 
 * يُستخدم من صفحة تسجيل الدخول للحصول على بيانات الطالب
 */
export default async function handler(req, res) {
    // CORS
    res.setHeader("Access-Control-Allow-Credentials", true);
    res.setHeader("Access-Control-Allow-Origin", "*"); // يمكن تحديد النطاق لو محتاج
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    const { nationalId } = req.body;

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

        // جلب أو إنشاء Login Token للطالب
        let loginToken = null;
        const tokenSnapshot = await db.collection("login_tokens")
            .where("studentId", "==", studentDoc.id)
            .where("permanent", "==", true)
            .limit(1)
            .get();

        if (!tokenSnapshot.empty) {
            loginToken = tokenSnapshot.docs[0].id;
        }

        // إرجاع البيانات (password قد يكون فارغ لو مش متخزن)
        return res.status(200).json({
            success: true,
            data: {
                name: student.fullName || "",
                code: student.code,
                password: student.password || null, // قد يكون فارغ
                token: loginToken || studentDoc.id
            }
        });

    } catch (error) {
        console.error("Get Credentials Error:", error);
        return res.status(500).json({
            error: "حدث خطأ غير متوقع، يرجى المحاولة مرة أخرى"
        });
    }
}
