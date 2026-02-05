// api/cron.js
// Consolidated cron functions: auto-absent, check-absence, agent-absence
// Usage: POST /api/cron with { action: 'auto-absent' | 'check-absence' | 'agent-report' }

import admin from "firebase-admin";

// Initialize Firebase Admin
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
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const action = req.query.action || req.body?.action || 'auto-absent';

    try {
        switch (action) {
            case 'auto-absent':
                return await handleAutoAbsent(req, res);
            case 'check-absence':
                return await handleCheckAbsence(req, res);
            case 'agent-report':
                return await handleAgentReport(req, res);
            default:
                return res.status(400).json({ error: `Unknown action: ${action}` });
        }
    } catch (error) {
        console.error('Cron Error:', error);
        return res.status(500).json({ error: error.message });
    }
}

// ==========================================
// ACTION 1: Auto Absent (Daily)
// ==========================================
async function handleAutoAbsent(req, res) {
    const todayDateStr = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
    const dayName = new Date().toLocaleDateString("en-US", { timeZone: "Africa/Cairo", weekday: "long" });
    const dayCode = getDayCode(dayName);

    console.log(`📅 Running Auto Absence for: ${todayDateStr} (${dayName})`);

    // Check holidays
    const holidaysSnap = await db.collection("app_settings").doc("holidays").get();
    const holidaysData = holidaysSnap.exists ? holidaysSnap.data() : { holidays: [] };
    const holidays = holidaysData.holidays || [];

    const isHoliday = holidays.some(h => todayDateStr >= h.startDate && todayDateStr <= h.endDate);
    if (isHoliday) {
        const holidayName = holidays.find(h => todayDateStr >= h.startDate && todayDateStr <= h.endDate)?.name || "عطلة";
        return res.status(200).json({ message: `تم تخطي الغياب التلقائي - اليوم ${holidayName}`, skipped: true, reason: "holiday" });
    }

    // Get settings
    const settingsSnap = await db.collection("app_settings").doc("rules").get();
    const settings = settingsSnap.exists ? settingsSnap.data() : { resident: { requiredDays: ["Sat", "Mon", "Wed"] }, expat: { requiredDays: [] } };
    const residentRequiredDays = settings.resident?.requiredDays || ["Sat", "Mon", "Wed"];

    if (!residentRequiredDays.includes(dayCode)) {
        return res.status(200).json({ message: `Today is ${dayName}, not a required day`, skipped: true, reason: "not_required_day" });
    }

    // Get students
    const studentsSnap = await db.collection("students").get();
    if (studentsSnap.empty) return res.status(200).json({ message: "No students found." });

    const allStudents = [];
    studentsSnap.forEach((doc) => allStudents.push({ id: doc.id, ...doc.data() }));

    // Get today's attendance
    const attendanceSnap = await db.collection("attendance").where("date", "==", todayDateStr).get();
    const processedStudentIds = new Set();
    attendanceSnap.forEach((doc) => processedStudentIds.add(doc.data().studentId));

    // Filter students to mark absent
    const studentsToMarkAbsent = allStudents.filter((s) => {
        if (processedStudentIds.has(s.id)) return false;
        const isExpat = s.isExpat || s.type === 'expat';
        const studentRequiredDays = isExpat ? (settings.expat?.requiredDays || []) : residentRequiredDays;
        if (studentRequiredDays.length > 0 && !studentRequiredDays.includes(dayCode)) return false;
        return true;
    });

    if (studentsToMarkAbsent.length === 0) {
        return res.status(200).json({ message: "All students already processed.", date: todayDateStr });
    }

    // Batch write
    const batches = [];
    let batch = db.batch();
    let count = 0;

    studentsToMarkAbsent.forEach((student) => {
        const docRef = db.collection("attendance").doc();
        batch.set(docRef, {
            studentId: student.id,
            studentName: student.fullName || "Unknown",
            halaqaId: student.halaqaId || "unknown",
            halaqaName: student.halaqaName || "بدون حلقة",
            status: "absent",
            date: todayDateStr,
            recordedBy: "system_auto",
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
        count++;
        if (count >= 400) { batches.push(batch.commit()); batch = db.batch(); count = 0; }
    });

    if (count > 0) batches.push(batch.commit());
    await Promise.all(batches);

    return res.status(200).json({ success: true, marked_count: studentsToMarkAbsent.length, date: todayDateStr });
}

// ==========================================
// ACTION 2: Check Absence (Monthly alerts)
// ==========================================
async function handleCheckAbsence(req, res) {
    console.log("🔄 Running Monthly Absence Check...");

    const configSnap = await db.collection("app_settings").doc("absence_config").get();
    const absenceLimitDays = configSnap.exists ? configSnap.data().limitDays || 60 : 60;

    const today = new Date();
    const cutoffDate = new Date();
    cutoffDate.setDate(today.getDate() - absenceLimitDays);
    const cutoffDateStr = cutoffDate.toISOString().split("T")[0];

    // Get main students
    const studentsSnap = await db.collection("students").where("type", "==", "main").get();
    if (studentsSnap.empty) return res.status(200).json({ message: "No main students found." });

    const mainStudents = [];
    studentsSnap.forEach((doc) => mainStudents.push({ id: doc.id, ...doc.data() }));

    // Get attended students
    const attendanceSnap = await db.collection("attendance").where("status", "in", ["present", "sard"]).where("date", ">=", cutoffDateStr).get();
    const attendedStudentIds = new Set();
    attendanceSnap.forEach((doc) => attendedStudentIds.add(doc.data().studentId));

    // Get excused students
    const activeLeavesSnap = await db.collection("leave_requests").where("status", "==", "approved").where("endDate", ">=", admin.firestore.Timestamp.now()).get();
    const excusedStudentIds = new Set();
    activeLeavesSnap.forEach((doc) => excusedStudentIds.add(doc.data().studentId));

    // Find candidates
    const candidatesForDemotion = mainStudents.filter((s) => !attendedStudentIds.has(s.id) && !excusedStudentIds.has(s.id));

    if (candidatesForDemotion.length === 0) {
        return res.status(200).json({ message: "No students to alert about." });
    }

    // Create alerts
    const batch = db.batch();
    candidatesForDemotion.forEach((student) => {
        const alertRef = db.collection("demotion_alerts").doc(student.id);
        batch.set(alertRef, {
            studentId: student.id,
            studentName: student.fullName || "مجهول",
            halaqaName: student.halaqaName || "بدون حلقة",
            lastCutoffDate: cutoffDateStr,
            absenceDays: absenceLimitDays,
            status: "pending",
            reason: `غائب لمدة تتجاوز ${absenceLimitDays} يوم بدون عذر`,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    });

    await batch.commit();
    return res.status(200).json({ success: true, alerts_created: candidatesForDemotion.length, limit_used: absenceLimitDays });
}

// ==========================================
// ACTION 3: Agent Report (Telegram)
// ==========================================
async function handleAgentReport(req, res) {
    const todayDateStr = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });

    const snapshot = await db.collection('attendance').where('date', '==', todayDateStr).where('status', '==', 'absent').get();

    if (snapshot.empty) return res.json({ message: "لا يوجد غياب اليوم ✅" });

    let message = `🚨 **تقرير الغياب اليومي** 🚨\n📅 التاريخ: ${todayDateStr}\n\nالطلاب المتغيبون:\n`;
    let count = 0;
    snapshot.forEach(doc => { count++; message += `${count}. **${doc.data().studentName}** (${doc.data().halaqaName})\n`; });
    message += `\n⚠️ إجمالي الغياب: ${count} طالب`;

    // Send to Telegram if configured
    const ADMIN_CHANNEL_ID = process.env.ADMIN_TELEGRAM_CHAT_ID;
    if (ADMIN_CHANNEL_ID && process.env.TELEGRAM_BOT_TOKEN) {
        try {
            await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: ADMIN_CHANNEL_ID, text: message, parse_mode: 'Markdown' })
            });
        } catch (e) { console.warn('Telegram send failed:', e); }
    }

    return res.json({ success: true, sent_to: count, message });
}

// Helper
function getDayCode(dayName) {
    const map = { 'Saturday': 'Sat', 'Sunday': 'Sun', 'Monday': 'Mon', 'Tuesday': 'Tue', 'Wednesday': 'Wed', 'Thursday': 'Thu', 'Friday': 'Fri' };
    return map[dayName] || dayName;
}
