// api/cron/agent-absence.js
import admin from "firebase-admin";
import { TelegramAgent } from "../_utils/telegram-service.js";

// تهيئة Firebase (نفس كودك المعتاد)
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

// 💡 ضع هنا معرف قناة المشرفين أو معرفك الشخصي
// يمكنك معرفته بإرسال رسالة للبوت ثم زيارة: https://api.telegram.org/bot<TOKEN>/getUpdates
const ADMIN_CHANNEL_ID = process.env.ADMIN_TELEGRAM_CHAT_ID; 

export default async function handler(req, res) {
  const todayDateStr = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
  
  // 1. تشغيل سكربت التغييب التلقائي أولاً (لضمان تسجيل الغياب)
  // (يمكنك دمج كود auto-absent هنا أو استدعاؤه)
  
  // 2. البحث عن الغائبين اليوم
  const snapshot = await db.collection('attendance')
    .where('date', '==', todayDateStr)
    .where('status', '==', 'absent')
    .get();

  if (snapshot.empty) return res.json({ message: "لا يوجد غياب اليوم ✅" });

  // 3. تجهيز قائمة الأسماء
  let message = `🚨 **تقرير الغياب اليومي** 🚨\n`;
  message += `📅 التاريخ: ${todayDateStr}\n\n`;
  message += `الطلاب المتغيبون:\n`;

  let count = 0;
  snapshot.forEach(doc => {
    const data = doc.data();
    count++;
    message += `${count}. **${data.studentName}** (${data.halaqaName})\n`;
  });

  message += `\n⚠️ إجمالي الغياب: ${count} طالب`;

  // 4. إرسال التقرير لتيليجرام
  await TelegramAgent.send(ADMIN_CHANNEL_ID, message);

  return res.json({ success: true, sent_to: count });
}