import admin from "firebase-admin";
import { verifyAdminRole } from "./utils/auth-admin"; // 👈 استدعاء الحماية

// تهيئة Firebase Admin (لن تتغير)
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

export default async function handler(req, res) {
  // إعدادات CORS
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "https://darbw.netlify.app");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization"
  ); // أضفنا Authorization

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
    return res.status(403).json({ error: "ممنوع: هذا الإجراء للمشرفين فقط" });
  }
  // 🛡️ نهاية كود الحماية

  const { uid } = req.body;
  if (!uid) return res.status(400).json({ error: "مطلوب معرف المستخدم (uid)" });

  try {
    await admin.auth().deleteUser(uid);
    return res
      .status(200)
      .json({ success: true, message: "تم حذف المستخدم بنجاح" });
  } catch (error) {
    console.error("Delete Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
