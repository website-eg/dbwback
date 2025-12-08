import admin from 'firebase-admin';

export default async function handler(req, res) {
  // 1. ضبط إعدادات CORS للسماح لموقعك فقط
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', 'https://darbw.netlify.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // 2. الرد على فحص المتصفح المسبق (OPTIONS request)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 3. معالجة الطلب الأساسي
  try {
    // التأكد من أن الطلب من نوع POST
    if (req.method !== 'POST') {
      throw new Error('Method Not Allowed');
    }

    // تهيئة Firebase Admin إذا لم يكن قد بدأ بالفعل
    if (!admin.apps.length) {
      if (!process.env.FIREBASE_PRIVATE_KEY) {
        throw new Error('Missing FIREBASE_PRIVATE_KEY in Vercel Env Variables');
      }
      
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          // إصلاح مشكلة السطور الجديدة في المفتاح الخاص عند قراءته من البيئة
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
      });
    }

    // استخراج البيانات من الطلب
    const { uid, newPassword } = req.body;

    // التحقق من صحة البيانات
    if (!uid || !newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'بيانات غير صالحة أو كلمة المرور قصيرة (يجب أن تكون 6 أحرف على الأقل)' });
    }

    // تنفيذ تغيير كلمة المرور في Firebase Auth
    await admin.auth().updateUser(uid, {
      password: newPassword,
    });

    // إرسال رد النجاح
    return res.status(200).json({ success: true, message: 'تم تغيير كلمة المرور بنجاح' });

  } catch (error) {
    console.error('Server Error:', error);
    // إرسال تفاصيل الخطأ (مفيد أثناء التطوير لمعرفة السبب)
    return res.status(500).json({ error: error.message });
  }
}