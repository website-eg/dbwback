import admin from "firebase-admin";
import { verifyAdminRole } from "./_utils/auth-admin"; // 👈 استدعاء الحماية

// تهيئة Firebase (نفس السابق)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "https://darbw.netlify.app");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method Not Allowed" });

  // 🛡️ الحماية
  const token = req.headers.authorization?.split("Bearer ")[1];
  if (!token || !(await verifyAdminRole(token))) {
    return res.status(403).json({ error: "غير مصرح لك بتغيير كلمات المرور" });
  }

  const { uid, newPassword } = req.body;

  if (!uid || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: "بيانات غير صالحة" });
  }

  try {
    await admin.auth().updateUser(uid, { password: newPassword });
    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
