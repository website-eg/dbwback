// api/cron/check-absence.js
import admin from "firebase-admin";

// 1. تهيئة Firebase Admin
if (!admin.apps.length) {
  if (!process.env.FIREBASE_PRIVATE_KEY) {
    throw new Error("Missing FIREBASE_PRIVATE_KEY");
  }
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}

const db = admin.firestore();

export default async function handler(req, res) {
  try {
    console.log("🔄 Running Monthly Absence Check (Alert System Enabled)...");

    // ============================================================
    // 1. جلب إعدادات المدة من الأدمن (الافتراضي 60 يوم)
    // ============================================================
    const configSnap = await db
      .collection("app_settings")
      .doc("absence_config")
      .get();
    const absenceLimitDays = configSnap.exists
      ? configSnap.data().limitDays || 60
      : 60;

    console.log(`📡 Current Absence Limit: ${absenceLimitDays} days.`);

    // ============================================================
    // 2. حساب تاريخ "الحد القاطع" بناءً على إعدادات الأدمن
    // ============================================================
    const today = new Date();
    const cutoffDate = new Date();
    cutoffDate.setDate(today.getDate() - absenceLimitDays);
    const cutoffDateStr = cutoffDate.toISOString().split("T")[0];

    // ============================================================
    // 3. جلب كل الطلاب "الأساسيين" (type == main)
    // ============================================================
    const studentsSnap = await db
      .collection("students")
      .where("type", "==", "main")
      .get();

    if (studentsSnap.empty) {
      return res.status(200).json({ message: "No main students found." });
    }

    const mainStudents = [];
    studentsSnap.forEach((doc) =>
      mainStudents.push({ id: doc.id, ...doc.data() })
    );

    // ============================================================
    // 4. جلب الطلاب الحاضرين فعلياً خلال هذه المدة
    // ============================================================
    const attendanceSnap = await db
      .collection("attendance")
      .where("status", "==", "present")
      .where("date", ">=", cutoffDateStr)
      .get();

    const attendedStudentIds = new Set();
    attendanceSnap.forEach((doc) => {
      attendedStudentIds.add(doc.data().studentId);
    });

    // ============================================================
    // 5. جلب الطلاب الذين لديهم "استئذان مفعل" (Approved Leave)
    // ============================================================
    const activeLeavesSnap = await db
      .collection("leave_requests")
      .where("status", "==", "approved")
      .where("endDate", ">=", admin.firestore.Timestamp.now())
      .get();

    const excusedStudentIds = new Set();
    activeLeavesSnap.forEach((doc) => {
      excusedStudentIds.add(doc.data().studentId);
    });

    // ============================================================
    // 6. تحديد الطلاب المرشحين للنقل (غائب + ليس لديه عذر مقبول)
    // ============================================================
    const candidatesForDemotion = mainStudents.filter(
      (s) => !attendedStudentIds.has(s.id) && !excusedStudentIds.has(s.id)
    );

    if (candidatesForDemotion.length === 0) {
      return res.status(200).json({ message: "No students to alert about." });
    }

    // ============================================================
    // 7. إنشاء "إنذارات" للأدمن بدلاً من النقل المباشر
    // ============================================================
    const batch = db.batch();

    candidatesForDemotion.forEach((student) => {
      // ننشئ وثيقة في مجموعة تنبيهات النقل
      const alertRef = db.collection("demotion_alerts").doc(student.id);
      batch.set(
        alertRef,
        {
          studentId: student.id,
          studentName: student.fullName || "مجهول",
          halaqaName: student.halaqaName || "بدون حلقة",
          lastCutoffDate: cutoffDateStr,
          absenceDays: absenceLimitDays,
          status: "pending", // معلق لموافقة الأدمن
          reason: `غائب لمدة تتجاوز ${absenceLimitDays} يوم بدون عذر`,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });

    await batch.commit();

    console.log(
      `✅ Created alerts for ${candidatesForDemotion.length} students for Admin review.`
    );

    return res.status(200).json({
      success: true,
      alerts_created: candidatesForDemotion.length,
      limit_used: absenceLimitDays,
      students: candidatesForDemotion.map((s) => s.fullName),
    });
  } catch (error) {
    console.error("Cron Job Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
