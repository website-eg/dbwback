// api/cron/auto-absent.js
import admin from "firebase-admin";

// تهيئة Firebase
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
    // 1. تحديد التاريخ واليوم بتوقيت مصر
    const options = { timeZone: "Africa/Cairo", year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long' };
    
    // استخراج التاريخ فقط (YYYY-MM-DD)
    const todayDateStr = new Date().toLocaleDateString('en-CA', { timeZone: "Africa/Cairo" });
    
    // استخراج اسم اليوم
    const dayName = new Date().toLocaleDateString('en-US', { timeZone: "Africa/Cairo", weekday: 'long' });

    console.log(`📅 Running Auto Absence for: ${todayDateStr} (${dayName})`);

    // التحقق من أيام العمل
    const allowedDays = ['Saturday', 'Monday', 'Wednesday'];
    if (!allowedDays.includes(dayName)) {
        return res.status(200).json({ message: `Today is ${dayName}, skipping auto-absence.` });
    }

    // ============================================================
    // 2. التعديل هنا: جلب الطلاب (الأساسي + الاحتياطي)
    // ============================================================
    const studentsSnap = await db.collection("students")
      .where("type", "in", ["main", "reserve"]) // ✅ تم التعديل لجلب النوعين
      .get();

    if (studentsSnap.empty) {
      return res.status(200).json({ message: "No active students found." });
    }

    const allStudents = [];
    studentsSnap.forEach(doc => {
        allStudents.push({ id: doc.id, ...doc.data() });
    });

    // 3. جلب سجلات الحضور لهذا اليوم
    const attendanceSnap = await db.collection("attendance")
      .where("date", "==", todayDateStr)
      .get();

    // قائمة بمن تم تحضيرهم بالفعل
    const processedStudentIds = new Set();
    attendanceSnap.forEach(doc => {
        processedStudentIds.add(doc.data().studentId);
    });

    // 4. تحديد المتغيبين (من لم يسجل لهم أي شيء)
    const studentsToMarkAbsent = allStudents.filter(s => !processedStudentIds.has(s.id));

    if (studentsToMarkAbsent.length === 0) {
      return res.status(200).json({ message: "All students are already processed for today." });
    }

    // 5. تسجيل الغياب (Batch)
    const batches = [];
    let batch = db.batch();
    let operationCount = 0;

    studentsToMarkAbsent.forEach((student) => {
        const docRef = db.collection("attendance").doc();
        
        batch.set(docRef, {
            studentId: student.id,
            studentName: student.fullName || student.name || "Unknown",
            halaqaId: student.halaqaId || "unknown",
            status: "absent", // حالة غياب
            date: todayDateStr,
            recordedBy: "system_auto",
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        operationCount++;

        if (operationCount >= 400) {
            batches.push(batch.commit());
            batch = db.batch();
            operationCount = 0;
        }
    });

    if (operationCount > 0) {
        batches.push(batch.commit());
    }

    await Promise.all(batches);

    console.log(`✅ Marked ${studentsToMarkAbsent.length} students (Main & Reserve) as absent.`);

    return res.status(200).json({
      success: true,
      marked_absent_count: studentsToMarkAbsent.length,
      student_types: "main + reserve",
      date: todayDateStr
    });

  } catch (error) {
    console.error("Auto Absence Error:", error);
    return res.status(500).json({ error: error.message });
  }
}