import admin from 'firebase-admin';

// تهيئة الفايربيس (تأكد من عدم تكرار التهيئة)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // معالجة السطور الجديدة في المفتاح الخاص بشكل صحيح
      privateKey: process.env.FIREBASE_PRIVATE_KEY 
        ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') 
        : undefined,
    }),
  });
}

export default async function handler(req, res) {
  // 1. إضافة الهيدرز (Headers) يدوياً لضمان القبول
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // 2. الرد الفوري على طلبات الفحص (OPTIONS)
  // هذا هو الجزء الذي يحل مشكلة Preflight request failed
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // 3. التحقق من نوع الطلب الحقيقي
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { uid, newPassword } = req.body;

  if (!uid || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'بيانات غير صالحة أو كلمة المرور قصيرة' });
  }

  try {
    // 4. تنفيذ التغيير
    await admin.auth().updateUser(uid, {
      password: newPassword,
    });

    return res.status(200).json({ success: true, message: 'تم تغيير كلمة المرور بنجاح' });
  } catch (error) {
    console.error('Error updating password:', error);
    return res.status(500).json({ error: error.message });
  }
}