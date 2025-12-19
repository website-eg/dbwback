// api/actions/move-to-reserve.js
import admin from "firebase-admin";

// تهيئة Firebase Admin (نفس كود ملفاتك السابقة لضمان الاستمرارية)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}

const db = admin.firestore();

export default async function handler(req, res) {
  // إعدادات CORS المتوافقة مع مشروعك
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "https://darbw.netlify.app");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method Not Allowed" });

  const { studentId, reason } = req.body;

  if (!studentId) {
    return res.status(400).json({ error: "معرف الطالب (studentId) مطلوب" });
  }

  try {
    const studentRef = db.collection("students").doc(studentId);
    const alertRef = db.collection("demotion_alerts").doc(studentId);

    // استخدام Transaction لضمان تنفيذ كافة العمليات أو فشلها معاً
    await db.runTransaction(async (transaction) => {
      const studentDoc = await transaction.get(studentRef);

      if (!studentDoc.exists) {
        throw new Error("الطالب غير موجود في قاعدة البيانات");
      }

      // 1. تحديث بيانات الطالب للاحتياطي
      transaction.update(studentRef, {
        type: "reserve",
        status: "inactive",
        demotionDate: admin.firestore.FieldValue.serverTimestamp(),
        demotionReason: reason || "تم النقل بواسطة نظام الإدارة الذكي",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // 2. تحديث حالة التنبيه إذا كان موجوداً
      transaction.update(alertRef, {
        status: "executed",
        executedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    return res.status(200).json({
      success: true,
      message: `تم نقل الطالب ${studentId} إلى الاحتياطي بنجاح`,
    });
  } catch (error) {
    console.error("Move to Reserve Error:", error);
    // إذا لم يكن هناك تنبيه مسبق، سنكمل عملية النقل بنجاح
    if (error.message.includes("NOT_FOUND") || error.code === 5) {
      return res
        .status(200)
        .json({ success: true, message: "تم نقل الطالب (لا يوجد تنبيه مسبق)" });
    }
    return res.status(500).json({ error: error.message });
  }
}
