// api/utils/auth-admin.js
import admin from "firebase-admin";

// تهيئة Firebase Admin (استخدم متغيرات البيئة في Vercel)
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

export async function verifyAdminRole(token) {
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    const userDoc = await db.collection("users").doc(decodedToken.uid).get();

    if (!userDoc.exists) return false;

    const role = userDoc.data().role;
    // يسمح فقط للأدمن أو المعلم بالتنفيذ
    return role === "admin" || role === "teacher";
  } catch (error) {
    return false;
  }
}
