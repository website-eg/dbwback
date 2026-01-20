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
    const dayCode = getDayCode(dayName); // تحويل Saturday -> Sat

    console.log(`📅 Running Auto Absence for: ${todayDateStr} (${dayName})`);

    // ============================================================
    // 2. التحقق من العطل أولاً
    // ============================================================
    const holidaysSnap = await db.collection("app_settings").doc("holidays").get();
    const holidaysData = holidaysSnap.exists ? holidaysSnap.data() : { holidays: [] };
    const holidays = holidaysData.holidays || [];

    // التحقق إذا كان اليوم ضمن فترة عطلة
    const isHoliday = holidays.some(h => {
      return todayDateStr >= h.startDate && todayDateStr <= h.endDate;
    });

    if (isHoliday) {
      const holidayName = holidays.find(h => todayDateStr >= h.startDate && todayDateStr <= h.endDate)?.name || "عطلة";
      console.log(`🏖️ Today is a holiday: ${holidayName}`);
      return res.status(200).json({
        message: `تم تخطي الغياب التلقائي - اليوم ${holidayName}`,
        skipped: true,
        reason: "holiday",
        holidayName
      });
    }

    // ============================================================
    // 3. جلب إعدادات النظام
    // ============================================================
    const settingsSnap = await db.collection("app_settings").doc("rules").get();
    const settings = settingsSnap.exists ? settingsSnap.data() : {
      resident: { requiredDays: ["Sat", "Mon", "Wed"] },
      expat: { requiredDays: [] }
    };

    // التحقق من أيام العمل للمقيمين (الأساسية)
    const residentRequiredDays = settings.resident?.requiredDays || ["Sat", "Mon", "Wed"];

    if (!residentRequiredDays.includes(dayCode)) {
      console.log(`📆 Today (${dayCode}) is not a required day for residents`);
      return res.status(200).json({
        message: `Today is ${dayName} (${dayCode}), not in required days: ${residentRequiredDays.join(', ')}, skipping auto-absence.`,
        skipped: true,
        reason: "not_required_day"
      });
    }

    // ============================================================
    // 4. جلب جميع الطلاب
    // ============================================================
    const studentsSnap = await db.collection("students").get();

    if (studentsSnap.empty) {
      return res.status(200).json({ message: "No students found in the database." });
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

    // 5. جلب سجلات الحضور لهذا اليوم لتجنب تكرار التحضير
    const attendanceSnap = await db
      .collection("attendance")
      .where("date", "==", todayDateStr)
      .get();

    const processedStudentIds = new Set();
    attendanceSnap.forEach((doc) => {
      processedStudentIds.add(doc.data().studentId);
    });

    // 6. تحديد الطلاب الذين لم يتم رصدهم (لا حاضر ولا غائب)
    // مع مراعاة نوع الطالب (مقيم/مغترب)
    const studentsToMarkAbsent = allStudents.filter((s) => {
      if (processedStudentIds.has(s.id)) return false;

      // التحقق من أيام الطالب حسب نوعه
      const isExpat = s.isExpat || s.type === 'expat';
      const studentRequiredDays = isExpat
        ? (settings.expat?.requiredDays || [])
        : residentRequiredDays;

      // إذا كان اليوم ليس من أيام هذا الطالب، لا نسجل غيابه
      if (studentRequiredDays.length > 0 && !studentRequiredDays.includes(dayCode)) {
        return false;
      }

      return true;
    });

    if (studentsToMarkAbsent.length === 0) {
      return res.status(200).json({
        message: "All students across all halaqat are already processed or not required today.",
        date: todayDateStr,
        requiredDays: residentRequiredDays
      });
    }

    // 7. تسجيل الغياب بنظام الـ Batch
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
      settings_used: {
        residentDays: residentRequiredDays,
        expatDays: settings.expat?.requiredDays || []
      }
    });
  } catch (error) {
    console.error("Auto Absence Error:", error);
    return res.status(500).json({ error: error.message });
  }
}

// Helper: تحويل اسم اليوم الكامل إلى الاختصار
function getDayCode(dayName) {
  const map = {
    'Saturday': 'Sat',
    'Sunday': 'Sun',
    'Monday': 'Mon',
    'Tuesday': 'Tue',
    'Wednesday': 'Wed',
    'Thursday': 'Thu',
    'Friday': 'Fri'
  };
  return map[dayName] || dayName;
}
