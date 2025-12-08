import admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
    }),
  });
}

export default async function handler(req, res) {
  // 1. إعدادات CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { uid, newEmail } = req.body;

  if (!uid || !newEmail) {
    return res.status(400).json({ error: 'بيانات ناقصة' });
  }

  try {
    // 2. تحديث البريد الإلكتروني في Authentication
    await admin.auth().updateUser(uid, {
      email: newEmail,
      emailVerified: true // نجعله مفعل تلقائياً
    });

    return res.status(200).json({ success: true, message: 'تم تحديث الإيميل بنجاح' });
  } catch (error) {
    console.error('Error updating email:', error);
    return res.status(500).json({ error: error.message });
  }
}