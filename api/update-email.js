import admin from 'firebase-admin';
import { verifyAdminRole } from './_utils/auth-admin.js'; // 👈 استدعاء الحماية

// تهيئة Firebase
if (!admin.apps.length) {
  if (!process.env.FIREBASE_PRIVATE_KEY) throw new Error('Missing FIREBASE_PRIVATE_KEY');
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });
}

export default async function handler(req, res) {
  // إعدادات CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', 'https://darbw.netlify.app'); 
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  // 🛡️ كود الحماية (كان ناقصاً)
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Token' });
  }
  const token = authHeader.split('Bearer ')[1];
  if (!(await verifyAdminRole(token))) {
    return res.status(403).json({ error: 'Forbidden: Admins Only' });
  }
  // 🛡️ نهاية الحماية

  const { uid, newEmail } = req.body;
  if (!uid || !newEmail) return res.status(400).json({ error: 'Missing Data' });

  try {
    await admin.auth().updateUser(uid, { email: newEmail });
    // تحديث الإيميل في Firestore أيضاً لضمان التطابق
    await admin.firestore().collection('users').doc(uid).update({ email: newEmail });
    
    return res.status(200).json({ success: true, message: 'Email updated' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}