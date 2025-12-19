// api/utils/auth-admin.js
import admin from "firebase-admin";

// تهيئة Firebase Admin (تأكد من إضافة البيانات في Environment Variables على Vercel)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
    databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}.firebaseio.com`,
  });
}

const db = admin.firestore();

/**
 * التحقق مما إذا كان المستخدم لديه رتبة "أدمن" أو "معلم"
 */
export async function verifyAdminRole(token) {
  try {
    // 1. فك تشفير التوكن والحصول على UID المستخدم
    const decodedToken = await admin.auth().verifyIdToken(token);
    const uid = decodedToken.uid;

    // 2. جلب رتبة المستخدم من ملفه الشخصي في Firestore
    const userDoc = await db.collection("users").doc(uid).get();

    if (!userDoc.exists) return false;

    const role = userDoc.data().role;
    // يسمح فقط للأدمن والمعلم بتنفيذ الأوامر عبر المساعد الذكي
    return role === "admin" || role === "teacher";
  } catch (error) {
    console.error("Auth Verification Error:", error);
    return false;
  }
}
