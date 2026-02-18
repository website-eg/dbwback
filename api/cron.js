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

// ── FCM Push Notification Helper ──
async function sendPushToStudent(studentId, title, body, dataPayload = {}) {
    try {
        // Student doc has a 'userId' or the student doc ID itself maps to users
        const studentDoc = await db.collection('students').doc(studentId).get();
        if (!studentDoc.exists) return;
        const studentData = studentDoc.data();
        const userId = studentData.userId || studentData.uid;
        if (!userId) return;

        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) return;
        const fcmToken = userDoc.data().fcmToken;
        if (!fcmToken) return;

        await admin.messaging().send({
            notification: { title, body },
            data: { ...dataPayload, studentId, type: dataPayload.type || 'general' },
            token: fcmToken,
        });
        console.log(`📲 Push sent to ${studentData.fullName || studentId}`);
    } catch (err) {
        // Don't fail the cron if a single push fails (e.g. stale token)
        console.warn(`⚠️ Push failed for ${studentId}:`, err.code || err.message);
    }
}

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
            case 'check-promotion':
                return await handleCheckPromotion(req, res);
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
// ACTION 1: Auto Absent (Daily System)
// ==========================================
// ==========================================
// ACTION 1: Auto Absent (Daily System)
// ==========================================
async function handleAutoAbsent(req, res) {
    // Cron runs at midnight (start of next day), so we check YESTERDAY's date
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const todayDateStr = yesterday.toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
    const dayName = yesterday.toLocaleDateString("en-US", { timeZone: "Africa/Cairo", weekday: "long" });
    const dayIndex = getDayIndex(dayName); // 0=Sun, ..., 6=Sat

    console.log(`📅 Check Auto Absence for YESTERDAY: ${todayDateStr} (${dayName}, idx:${dayIndex})`);

    // 1. Load Rules
    const rulesSnap = await db.collection("app_settings").doc("rules").get();
    const rulesConfig = rulesSnap.exists ? rulesSnap.data() : {};

    // Check Global Auto Absent
    const autoAbsentConfig = rulesConfig.autoAbsent || { enabled: true, days: [6, 1, 3] };
    if (autoAbsentConfig.enabled === false) {
        return res.status(200).json({ message: "Auto Absent System is DISABLED by admin.", skipped: true });
    }

    // Check Required Day
    const requiredDays = autoAbsentConfig.days || [6, 1, 3];
    if (!requiredDays.includes(dayIndex)) {
        return res.status(200).json({ message: `Today (${dayName}) is not a required active day.`, skipped: true });
    }

    // 2. Check Global Holidays
    const holidaysSnap = await db.collection("app_settings").doc("holidays").get();
    const holidaysList = holidaysSnap.exists ? (holidaysSnap.data().list || []) : [];
    const isGlobalHoliday = holidaysList.some(h => !h.halaqaId && todayDateStr >= h.from && todayDateStr <= h.to);

    if (isGlobalHoliday) {
        return res.status(200).json({ message: "Today is a Global Holiday. No absence recorded.", skipped: true });
    }

    // 3. Process Students
    const studentsSnap = await db.collection("students").where("status", "==", "active").get();
    if (studentsSnap.empty) return res.status(200).json({ message: "No active students found." });

    const batch = db.batch();
    let opCount = 0;
    let absentCount = 0;
    const processedStudentIds = new Set();

    // Check existing attendance for today to avoid duplicates/overwrites
    const attendanceSnap = await db.collection("attendance").where("date", "==", todayDateStr).get();
    attendanceSnap.forEach((doc) => processedStudentIds.add(doc.data().studentId));

    for (const doc of studentsSnap.docs) {
        const s = doc.data();
        if (processedStudentIds.has(doc.id)) continue; // Already has record
        if (s.type === 'reserve') continue; // Skip reserve students

        // Check Per-Halaqa Holiday (from holidays list)
        const isHalaqaHoliday = holidaysList.some(h =>
            h.halaqaId === s.halaqaId && todayDateStr >= h.from && todayDateStr <= h.to
        );
        if (isHalaqaHoliday) {
            continue; // Skip this student, their halaqa is on holiday
        }

        // Mark Absent
        const attRef = db.collection("attendance").doc();
        batch.set(attRef, {
            studentId: doc.id,
            studentName: s.fullName || "Unknown",
            halaqaId: s.halaqaId || "unknown",
            halaqaName: s.halaqaName || "بدون حلقة",
            status: "absent",
            date: todayDateStr,
            recordedBy: "system_auto",
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });

        opCount++;
        absentCount++;

        if (opCount >= 450) {
            await batch.commit();
            opCount = 0;
        }
    }

    if (opCount > 0) await batch.commit();

    // Send push notifications for absences (fire & forget, don't block response)
    // We don't await these — they happen in background
    for (const doc of studentsSnap.docs) {
        const s = doc.data();
        if (processedStudentIds.has(doc.id)) continue;
        if (s.type === 'reserve') continue;
        const isHalaqaHoliday = holidaysList.some(h =>
            h.halaqaId === s.halaqaId && todayDateStr >= h.from && todayDateStr <= h.to
        );
        if (isHalaqaHoliday) continue;

        sendPushToStudent(
            doc.id,
            '⚠️ تسجيل غياب',
            `تم تسجيل غيابك ليوم ${todayDateStr}. إذا كنت حاضراً تواصل مع المعلم.`,
            { type: 'absence', date: todayDateStr }
        );
    }

    return res.status(200).json({ success: true, marked_count: absentCount, date: todayDateStr });
}

// ==========================================
// ACTION 2: Check Absence (Monthly Limits & Rules)
// ==========================================
async function handleCheckAbsence(req, res) {
    console.log("🔄 Running Monthly Absence Check...");

    // 1. Load Rules
    const rulesSnap = await db.collection("app_settings").doc("rules").get();
    const rulesConfig = rulesSnap.exists ? rulesSnap.data() : {};
    const demotionSettings = rulesConfig.demotion || { enabled: true, maxMonthlyUnexcused: 4, maxMonthlyExcused: 2 };
    const halaqaPairings = rulesConfig.halaqaPairings || {}; // { halaqaId: reserveHalaqaId }

    if (demotionSettings.enabled === false) {
        return res.status(200).json({ message: "Demotion check is DISABLED.", skipped: true });
    }

    const globalMaxUnexcused = demotionSettings.maxMonthlyUnexcused ?? 4;
    const globalMaxExcused = demotionSettings.maxMonthlyExcused ?? 2;

    // 2. Determine Start of Current Month
    const now = new Date();
    // Start of month: YYYY-MM-01
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    // Format as YYYY-MM-DD in local time (or just use ISO split for simplicity if stored as YYYY-MM-DD)
    // IMPORTANT: Stored dates are likely strings YYYY-MM-DD.
    // We construct start string:
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const startOfMonthStr = `${year}-${month}-01`;

    // 3. Process Active Main Students
    const studentsSnap = await db.collection("students")
        .where("type", "==", "main")
        .where("status", "==", "active")
        .get();

    if (studentsSnap.empty) return res.status(200).json({ message: "No active students." });

    // 4. Batch Process - We need to count absences per student for THIS MONTH
    // Optimization: Fetch ALL 'absent'/'excused' attendance for >= startOfMonthStr
    // Then group by studentId in memory.
    const attSnap = await db.collection("attendance")
        .where("date", ">=", startOfMonthStr)
        .where("status", "in", ["absent", "excused"])
        .get();

    const statsMap = {}; // { studentId: { absent: 0, excused: 0 } }

    attSnap.forEach(doc => {
        const d = doc.data();
        if (!statsMap[d.studentId]) statsMap[d.studentId] = { absent: 0, excused: 0 };

        if (d.status === 'absent') statsMap[d.studentId].absent++;
        else if (d.status === 'excused') statsMap[d.studentId].excused++;
    });

    const alerts = [];

    studentsSnap.forEach(doc => {
        const s = doc.data();
        const stats = statsMap[doc.id] || { absent: 0, excused: 0 };

        // Determine Rules for Student (Global limits apply to all)
        const limitUnexcused = globalMaxUnexcused;
        const limitExcused = globalMaxExcused;
        const globalMaxTotal = demotionSettings.maxMonthlyTotal ?? 6;
        const limitTotal = globalMaxTotal;

        // Target reserve from halaqaPairings
        const targetReserveId = halaqaPairings[s.halaqaId] || null;

        let reason = null;
        let triggerType = null;

        const totalAbsence = stats.absent + stats.excused;

        if (stats.absent >= limitUnexcused) {
            reason = `تجاوز حد الغياب الشهري (${stats.absent}/${limitUnexcused})`;
            triggerType = 'unexcused';
        } else if (stats.excused >= limitExcused) {
            reason = `تجاوز حد الأعذار الشهري (${stats.excused}/${limitExcused})`;
            triggerType = 'excused';
        } else if (totalAbsence >= limitTotal) {
            reason = `تجاوز الحد الكلي للغياب (${totalAbsence}/${limitTotal})`;
            triggerType = 'total_cap';
        }

        if (reason) {
            alerts.push({
                studentId: doc.id,
                studentName: s.fullName,
                halaqaId: s.halaqaId,
                halaqaName: s.halaqaName,
                reason: reason,
                stats: { ...stats, total: totalAbsence },
                targetReserveId: targetReserveId,
                type: triggerType
            });
        }
    });

    if (alerts.length === 0) {
        return res.status(200).json({ message: "No violations found." });
    }

    // 5. Create Alerts
    const batch = db.batch();
    // Use composite ID: demotion_{studentId}_{YYYYMM}
    const alertMonthId = `${year}${month}`;

    alerts.forEach(a => {
        const alertId = `demotion_${a.studentId}_${alertMonthId}`;
        const ref = db.collection("demotion_alerts").doc(alertId);

        batch.set(ref, {
            studentId: a.studentId,
            studentName: a.studentName || "Unknown",
            halaqaId: a.halaqaId,
            halaqaName: a.halaqaName,
            reason: a.reason,
            stats: a.stats,
            targetReserveId: a.targetReserveId, // Where they should go
            status: "pending",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            month: alertMonthId
        }, { merge: true });
    });

    await batch.commit();

    // Send push notifications for demotion alerts
    for (const a of alerts) {
        sendPushToStudent(
            a.studentId,
            '🔴 تنبيه تجاوز الحد',
            `${a.reason}. قد يتم نقلك إلى حلقة الاحتياط.`,
            { type: 'demotion', reason: a.reason }
        );
    }

    return res.status(200).json({ success: true, alerts_created: alerts.length });
}

// ==========================================
// ACTION 3: Agent Report (Telegram)
// ==========================================
async function handleAgentReport(req, res) {
    // Same implementation as before, lightly cleaned up
    const todayDateStr = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
    const snapshot = await db.collection('attendance').where('date', '==', todayDateStr).where('status', '==', 'absent').get();

    if (snapshot.empty) return res.json({ message: "لا يوجد غياب اليوم ✅" });

    let message = `🚨 **تقرير الغياب اليومي** 🚨\n📅 التاريخ: ${todayDateStr}\n\nالطلاب المتغيبون:\n`;
    let count = 0;
    snapshot.forEach(doc => { count++; message += `${count}. **${doc.data().studentName}** (${doc.data().halaqaName})\n`; });

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
    return res.json({ success: true, sent_to: count });
}

// Helpers
function getDayIndex(dayName) {
    // Standardizes day names to 0-6 index (Sunday=0)
    const map = {
        'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3, 'Thursday': 4, 'Friday': 5, 'Saturday': 6,
        'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6
    };
    return map[dayName] ?? -1;
}

// ==========================================
// ACTION 4: Check Promotion (Monthly Reserve → Main)
// ==========================================
async function handleCheckPromotion(req, res) {
    console.log("🚀 Running Monthly Promotion Check...");

    // 1. Load promotion rules
    const rulesSnap = await db.collection("app_settings").doc("rules").get();
    const rulesData = rulesSnap.exists ? rulesSnap.data() : {};
    const promotion = rulesData.promotion || {};

    if (promotion.enabled === false) {
        return res.status(200).json({ message: "Promotion system is DISABLED.", skipped: true });
    }

    const minAttendance = promotion.minAttendance ?? 12;
    const minSessionScore = promotion.minSessionScore ?? 12;

    // 2. Determine PREVIOUS month range (cron runs on 1st, so check last month)
    const now = new Date();
    const prevMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
    const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const firstDay = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-01`;
    const lastDayDate = new Date(prevYear, prevMonth + 1, 0);
    const lastDay = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-${String(lastDayDate.getDate()).padStart(2, '0')}`;

    console.log(`📅 Checking promotion for period: ${firstDay} → ${lastDay}`);

    // 3. Find target halaqa
    const targetSnap = await db.collection("halaqat").where("name", "==", "أساسي جديد").limit(1).get();
    if (targetSnap.empty) {
        return res.status(200).json({ message: "No 'أساسي جديد' halaqa found. Skipping.", skipped: true });
    }
    const targetId = targetSnap.docs[0].id;
    const targetName = targetSnap.docs[0].data().name;

    // 4. Get all reserve students
    const reserveSnap = await db.collection("students").where("type", "==", "reserve").where("status", "==", "active").get();
    if (reserveSnap.empty) {
        return res.status(200).json({ message: "No active reserve students found." });
    }

    const batch = db.batch();
    let promotedCount = 0;
    let opCount = 0;

    for (const doc of reserveSnap.docs) {
        const sid = doc.id;
        const sData = doc.data();

        // 5. Check attendance count
        const attSnap = await db.collection("attendance")
            .where("studentId", "==", sid)
            .where("date", ">=", firstDay)
            .where("date", "<=", lastDay)
            .where("status", "in", ["present", "sard"])
            .get();

        if (attSnap.size < minAttendance) continue;

        // 6. Check scores for each session
        const progSnap = await db.collection("progress")
            .where("studentId", "==", sid)
            .where("date", ">=", firstDay)
            .where("date", "<=", lastDay)
            .get();

        if (progSnap.empty) continue;

        let allScoresMet = true;
        progSnap.forEach(p => {
            const d = p.data();
            const total = Number(d.lessonScore || 0) + Number(d.revisionScore || 0) +
                Number(d.tilawaScore || 0) + Number(d.homeworkScore || 0);
            if (total < minSessionScore) allScoresMet = false;
        });

        if (!allScoresMet) continue;

        // 7. Promote!
        batch.update(db.collection("students").doc(sid), {
            type: "main",
            halaqaId: targetId,
            halaqaName: targetName,
        });
        promotedCount++;
        opCount++;

        // Send notification
        sendPushToStudent(sid, '🎉 مبروك! تمت ترقيتك',
            `لقد تم نقلك من الاحتياط إلى حلقة "${targetName}" بناءً على أدائك المتميز!`,
            { type: 'promotion' }
        );

        if (opCount >= 450) {
            await batch.commit();
            opCount = 0;
        }
    }

    if (opCount > 0) await batch.commit();

    console.log(`🚀 Promoted ${promotedCount} students (rules: ${minAttendance} sessions, ${minSessionScore} score)`);
    return res.status(200).json({
        success: true,
        promoted: promotedCount,
        rules: { minAttendance, minSessionScore },
        period: { from: firstDay, to: lastDay }
    });
}
