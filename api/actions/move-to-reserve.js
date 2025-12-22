import admin from "firebase-admin";
import { verifyAdminRole } from "../_utils/auth-admin"; // تأكد من المسار الصحيح (نقطتين للخلف)

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
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "https://darbw.netlify.app");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();

  // 🛡️ الحماية
  const token = req.headers.authorization?.split("Bearer ")[1];
  if (!token || !(await verifyAdminRole(token))) {
    return res.status(403).json({ error: "غير مصرح لك بهذا الإجراء" });
  }

  const { studentId, reason } = req.body;
  if (!studentId) return res.status(400).json({ error: "معرف الطالب مطلوب" });

  try {
    const studentRef = db.collection("students").doc(studentId);
    const alertRef = db.collection("demotion_alerts").doc(studentId);

    await db.runTransaction(async (transaction) => {
      const studentDoc = await transaction.get(studentRef);
      if (!studentDoc.exists) throw new Error("الطالب غير موجود");

      transaction.update(studentRef, {
        type: "reserve",
        status: "inactive",
        demotionDate: admin.firestore.FieldValue.serverTimestamp(),
        demotionReason: reason || "بواسطة الأدمن",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      transaction.update(alertRef, {
        status: "executed",
        executedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    return res.status(200).json({ success: true, message: "تم النقل بنجاح" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
