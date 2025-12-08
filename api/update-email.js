import admin from 'firebase-admin';

// تهيئة Firebase (نفس الكود السابق لضمان العمل)
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
  // ✅ 1. إصلاح CORS: وضع رابط موقعك بدلاً من النجمة
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', 'https://darbw.netlify.app'); 
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  // معالجة طلب الفحص المسبق
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { uid, newEmail } = req.body;

  if (!uid || !newEmail) {
    return res.status(400).json({ error: 'بيانات ناقصة' });
  }

  try {
    // 2. تحديث البريد الإلكتروني
    await admin.auth().updateUser(uid, {
      email: newEmail,
      emailVerified: true
    });

    return res.status(200).json({ success: true, message: 'تم تحديث الإيميل بنجاح' });
  } catch (error) {
    console.error('Error updating email:', error);
    return res.status(500).json({ error: error.message });
  }
}