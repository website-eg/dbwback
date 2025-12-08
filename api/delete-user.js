// api/delete-user.js
import admin from 'firebase-admin';

// تهيئة Firebase Admin (نفس كود الملفات السابقة)
if (!admin.apps.length) {
  if (!process.env.FIREBASE_PRIVATE_KEY) {
    throw new Error('Missing FIREBASE_PRIVATE_KEY');
  }
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });
}

export default async function handler(req, res) {
  // ✅ ضبط إعدادات CORS (مهم جداً)
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', 'https://darbw.netlify.app'); 
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { uid } = req.body;

  if (!uid) return res.status(400).json({ error: 'مطلوب معرف المستخدم (uid)' });

  try {
    // 🔥 الحذف النهائي من Authentication
    await admin.auth().deleteUser(uid);
    return res.status(200).json({ success: true, message: 'تم حذف الحساب نهائياً' });
  } catch (error) {
    console.error('Delete Error:', error);
    // إذا كان المستخدم غير موجود أصلاً في Auth، نعتبرها عملية ناجحة
    if (error.code === 'auth/user-not-found') {
        return res.status(200).json({ success: true });
    }
    return res.status(500).json({ error: error.message });
  }
}