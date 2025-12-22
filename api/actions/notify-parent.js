// api/actions/notify-parent.js
import admin from "firebase-admin";
import { verifyAdminRole } from "../_utils/auth-admin.js"; // 👈 إضافة الاستدعاء الصحيح

// تهيئة Firebase Admin
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
  // إعدادات CORS
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "https://darbw.netlify.app");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method Not Allowed" });

  // 🛡️ بداية كود الحماية المضاف
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "غير مصرح: يجب إرسال التوكن" });
  }

  const token = authHeader.split("Bearer ")[1];
  const isAuthorized = await verifyAdminRole(token);

  if (!isAuthorized) {
    return res
      .status(403)
      .json({ error: "ممنوع: هذا الإجراء للمشرفين والمعلمين فقط" });
  }
  // 🛡️ نهاية كود الحماية

  const { studentId, message, title } = req.body;

  if (!studentId || !message) {
    return res
      .status(400)
      .json({ error: "بيانات ناقصة (studentId أو message)" });
  }

  try {
    const studentDoc = await db.collection("students").doc(studentId).get();
    if (!studentDoc.exists) throw new Error("الطالب غير موجود");

    const parentId = studentDoc.data().parentId;
    if (!parentId) throw new Error("لا يوجد ولي أمر مرتبط بهذا الطالب");

    const parentDoc = await db.collection("users").doc(parentId).get();
    const fcmToken = parentDoc.data()?.fcmToken;

    if (!fcmToken) {
      return res
        .status(404)
        .json({ error: "ولي الأمر لم يقم بتفعيل الإشعارات بعد" });
    }

    const notificationPayload = {
      notification: {
        title: title || "تنبيه هام من الإدارة",
        body: message,
      },
      token: fcmToken,
    };

    const response = await admin.messaging().send(notificationPayload);

    return res.status(200).json({
      success: true,
      messageId: response,
      info: "تم إرسال الإشعار لولي الأمر بنجاح",
    });
  } catch (error) {
    console.error("Notification Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
