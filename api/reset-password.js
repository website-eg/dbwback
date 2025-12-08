import admin from 'firebase-admin';

export default async function handler(req, res) {
  // 1. ضبط CORS فوراً (قبل أي منطق آخر)
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // 2. الرد على فحص المتصفح (OPTIONS)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 3. معالجة الطلب داخل try/catch لمنع الانهيار
  try {
    // التحقق من الطريقة
    if (req.method !== 'POST') {
      throw new Error('Method Not Allowed');
    }

    // تهيئة Firebase (داخل الدالة لضمان التقاط الأخطاء)
    if (!admin.apps.length) {
      if (!process.env.FIREBASE_PRIVATE_KEY) {
        throw new Error('Missing FIREBASE_PRIVATE_KEY in Vercel Env Variables');
      }
      
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          // معالجة السطور الجديدة في المفتاح
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
      });
    }

    const { uid, newPassword } = req.body;

    if (!uid || !newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'بيانات غير صالحة أو كلمة المرور قصيرة' });
    }

    // تنفيذ التغيير
    await admin.auth().updateUser(uid, {
      password: newPassword,
    });

    return res.status(200).json({ success: true, message: 'تم التغيير بنجاح' });

  } catch (error) {
    console.error('Server Error:', error);
    // الرد برسالة الخطأ الحقيقية مع الحفاظ على CORS
    return res.status(500).json({ error: error.message });
  }
}