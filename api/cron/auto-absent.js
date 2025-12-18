// api/cron/auto-absent.js
import admin from "firebase-admin";

// تهيئة Firebase Admin
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
    // 1. تحديد التاريخ واليوم بتوقيت القاهرة
    const todayDateStr = new Date().toLocaleDateString("en-CA", {
      timeZone: "Africa/Cairo",
    });
    const dayName = new Date().toLocaleDateString("en-US", {
      timeZone: "Africa/Cairo",
      weekday: "long",
    });

    console.log(`📅 Running Auto Absence for: ${todayDateStr} (${dayName})`);

    // التحقق من أيام العمل (السبت، الإثنين، الأربعاء)
    const allowedDays = ["Saturday", "Monday", "Wednesday"];
    if (!allowedDays.includes(dayName)) {
      return res
        .status(200)
        .json({ message: `Today is ${dayName}, skipping auto-absence.` });
    }

    // ============================================================
    // 2. جلب جميع الطلاب (بدون تقيد بنوع معين لضمان شمول كل الحلقات)
    // ============================================================
    const studentsSnap = await db.collection("students").get();

    if (studentsSnap.empty) {
      return res
        .status(200)
        .json({ message: "No students found in the database." });
    }

    const allStudents = [];
    const detectedHalaqat = new Set();

    studentsSnap.forEach((doc) => {
      const data = doc.data();
      allStudents.push({ id: doc.id, ...data });
      if (data.halaqaName) detectedHalaqat.add(data.halaqaName);
    });

    console.log(
      `🔍 Detected ${allStudents.length} students across ${detectedHalaqat.size} groups:`,
      Array.from(detectedHalaqat)
    );

    // 3. جلب سجلات الحضور لهذا اليوم لتجنب تكرار التحضير
    const attendanceSnap = await db
      .collection("attendance")
      .where("date", "==", todayDateStr)
      .get();

    const processedStudentIds = new Set();
    attendanceSnap.forEach((doc) => {
      processedStudentIds.add(doc.data().studentId);
    });

    // 4. تحديد الطلاب الذين لم يتم رصدهم (لا حاضر ولا غائب)
    const studentsToMarkAbsent = allStudents.filter(
      (s) => !processedStudentIds.has(s.id)
    );

    if (studentsToMarkAbsent.length === 0) {
      return res
        .status(200)
        .json({
          message: "All students across all halaqat are already processed.",
        });
    }

    // 5. تسجيل الغياب بنظام الـ Batch
    const batches = [];
    let batch = db.batch();
    let count = 0;

    studentsToMarkAbsent.forEach((student) => {
      const docRef = db.collection("attendance").doc();

      batch.set(docRef, {
        studentId: student.id,
        studentName: student.fullName || student.name || "Unknown",
        halaqaId: student.halaqaId || "unknown",
        halaqaName: student.halaqaName || "بدون حلقة",
        status: "absent",
        date: todayDateStr,
        recordedBy: "system_auto",
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      count++;
      if (count >= 400) {
        batches.push(batch.commit());
        batch = db.batch();
        count = 0;
      }
    });

    if (count > 0) batches.push(batch.commit());
    await Promise.all(batches);

    console.log(
      `✅ Success: Marked ${studentsToMarkAbsent.length} students as absent.`
    );

    return res.status(200).json({
      success: true,
      marked_count: studentsToMarkAbsent.length,
      processed_groups: Array.from(detectedHalaqat),
      date: todayDateStr,
    });
  } catch (error) {
    console.error("Auto Absence Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
