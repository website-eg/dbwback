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
    console.log("🔄 Running Monthly Absence Check...");

    // ============================================================
    // 1. البحث عن حلقة "احتياطي" الحقيقية لجلب الـ ID الخاص بها
    // ============================================================
    let reserveHalaqaId = "reserve"; // قيمة افتراضية
    let reserveHalaqaName = "احتياطي";

    // نحاول البحث عن حلقة اسمها بالضبط "احتياطي"
    const halaqaSnap = await db
      .collection("halaqat")
      .where("name", "==", "احتياطي")
      .limit(1)
      .get();

    if (!halaqaSnap.empty) {
      const hDoc = halaqaSnap.docs[0];
      reserveHalaqaId = hDoc.id; // ✅ الـ ID الحقيقي من قاعدة بياناتك
      reserveHalaqaName = hDoc.data().name;
      console.log(
        `✅ Found Real Reserve Halaqa: ${reserveHalaqaName} (${reserveHalaqaId})`
      );
    } else {
      console.warn(
        '⚠️ Warning: No Halaqa named "احتياطي" found. Using default ID.'
      );
    }

    // ============================================================
    // 2. حساب تاريخ "قبل 60 يوماً"
    // ============================================================
    const today = new Date();
    const cutoffDate = new Date();
    cutoffDate.setDate(today.getDate() - 60);
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

    const activeStudentIds = [];
    studentsSnap.forEach((doc) => activeStudentIds.push(doc.id));

    // ============================================================
    // 4. جلب من سجلوا حضور "حاضر" خلال آخر 60 يوم
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
    // 5. تحديد المتغيبين
    // ============================================================
    const studentsToDemote = activeStudentIds.filter(
      (id) => !attendedStudentIds.has(id)
    );

    if (studentsToDemote.length === 0) {
      return res
        .status(200)
        .json({ message: "Excellent! No students exceeded absence limit." });
    }

    // ============================================================
    // 6. تنفيذ النقل للحلقة الاحتياطي الحقيقية
    // ============================================================
    const batch = db.batch();

    studentsToDemote.forEach((id) => {
      const ref = db.collection("students").doc(id);
      batch.update(ref, {
        type: "reserve", // تغيير النوع
        halaqaName: reserveHalaqaName, // اسم الحلقة الحقيقي
        halaqaId: reserveHalaqaId, // 🎯 الـ ID الحقيقي للحلقة
        notes: "تم النقل تلقائياً بسبب الغياب لمدة 60 يوم",
        updatedAt: new Date(),
      });
    });

    await batch.commit();

    console.log(
      `✅ Moved ${studentsToDemote.length} students to ${reserveHalaqaName}.`
    );

    return res.status(200).json({
      success: true,
      count: studentsToDemote.length,
      target_halaqa: reserveHalaqaName,
      demoted_ids: studentsToDemote,
    });
  } catch (error) {
    console.error("Cron Job Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
