// api/cron.js
// Consolidated cron: auto-absent, check-absence (auto-demotion), check-promotion
// Single daily cron runs ALL tasks in sequence (Vercel Hobby plan = 1 cron only)

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
            android: { priority: "high" },
        });
        console.log(`📲 Push sent to ${studentData.fullName || studentId}`);
    } catch (err) {
        if (
            err.code === "messaging/registration-token-not-registered" ||
            err.code === "messaging/invalid-registration-token"
        ) {
            try {
                const studentDoc = await db.collection('students').doc(studentId).get();
                const userId = studentDoc.data()?.userId || studentDoc.data()?.uid;
                if (userId) {
                    await db.collection('users').doc(userId).update({
                        fcmToken: admin.firestore.FieldValue.delete(),
                    });
                    console.log(`🗑️ Cleaned stale token for ${studentId}`);
                }
            } catch (_) { }
        } else {
            console.warn(`⚠️ Push failed for ${studentId}:`, err.code || err.message);
        }
    }
}

export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const action = req.query.action || req.body?.action || 'all';

    try {
        switch (action) {
            case 'all': {
                // ── Run ALL tasks in sequence (single daily cron) ──
                const results = {};
                console.log("🔄 Running ALL cron tasks...");

                // 1. Auto Absent
                results.autoAbsent = await runAutoAbsent();
                console.log("✅ Auto Absent done:", results.autoAbsent);

                // 2. Check Absence (Demotion)
                results.checkAbsence = await runCheckAbsence();
                console.log("✅ Check Absence done:", results.checkAbsence);

                // 3. Check Promotion (only on 1st of month)
                const today = new Date();
                const dayOfMonth = parseInt(today.toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" }).split('-')[2]);
                if (dayOfMonth === 1) {
                    results.checkPromotion = await runCheckPromotion();
                    console.log("✅ Check Promotion done:", results.checkPromotion);
                } else {
                    results.checkPromotion = { skipped: true, message: "Not 1st of month" };
                }

                return res.status(200).json({ success: true, results });
            }
            case 'auto-absent':
                return res.status(200).json(await runAutoAbsent());
            case 'check-absence':
                return res.status(200).json(await runCheckAbsence());
            case 'check-promotion':
                return res.status(200).json(await runCheckPromotion());
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
async function runAutoAbsent() {
    // Use TODAY's date (for both cron at midnight and manual trigger)
    const now = new Date();
    const todayDateStr = now.toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
    const dayName = now.toLocaleDateString("en-US", { timeZone: "Africa/Cairo", weekday: "long" });
    const dayIndex = getDayIndex(dayName);

    console.log(`📅 Check Auto Absence for TODAY: ${todayDateStr} (${dayName}, idx:${dayIndex})`);

    // 1. Load Rules
    const rulesSnap = await db.collection("app_settings").doc("rules").get();
    const rulesConfig = rulesSnap.exists ? rulesSnap.data() : {};

    const autoAbsentConfig = rulesConfig.autoAbsent || { enabled: true, days: [6, 1, 3] };
    if (autoAbsentConfig.enabled === false) {
        return { message: "Auto Absent System is DISABLED by admin.", skipped: true };
    }

    const globalDays = autoAbsentConfig.days || [6, 1, 3];
    const halaqaDays = autoAbsentConfig.halaqaDays || {};

    // 2. Check Global Holidays
    const holidaysSnap = await db.collection("app_settings").doc("holidays").get();
    const holidaysList = holidaysSnap.exists ? (holidaysSnap.data().list || []) : [];
    const isGlobalHoliday = holidaysList.some(h => !h.halaqaId && todayDateStr >= h.from && todayDateStr <= h.to);

    if (isGlobalHoliday) {
        return { message: "Today is a Global Holiday. No absence recorded.", skipped: true };
    }

    // 3. Process Students (no 'status' field on students — fetch all non-reserve)
    const studentsSnap = await db.collection("students").get();
    if (studentsSnap.empty) return { message: "No active students found." };

    const batch = db.batch();
    let opCount = 0;
    let absentCount = 0;
    const processedStudentIds = new Set();

    const attendanceSnap = await db.collection("attendance").where("date", "==", todayDateStr).get();
    attendanceSnap.forEach((doc) => processedStudentIds.add(doc.data().studentId));

    for (const doc of studentsSnap.docs) {
        const s = doc.data();
        if (processedStudentIds.has(doc.id)) continue;
        if (s.type === 'reserve') continue;

        const activeDays = (s.halaqaId && halaqaDays[s.halaqaId]?.length > 0) ? halaqaDays[s.halaqaId] : globalDays;
        if (!activeDays.includes(dayIndex)) continue;

        const isHalaqaHoliday = holidaysList.some(h =>
            h.halaqaId === s.halaqaId && todayDateStr >= h.from && todayDateStr <= h.to
        );
        if (isHalaqaHoliday) continue;

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

    // Fire & forget push notifications
    for (const doc of studentsSnap.docs) {
        const s = doc.data();
        if (processedStudentIds.has(doc.id)) continue;
        if (s.type === 'reserve') continue;
        const activeDays = (s.halaqaId && halaqaDays[s.halaqaId]?.length > 0) ? halaqaDays[s.halaqaId] : globalDays;
        if (!activeDays.includes(dayIndex)) continue;
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

    return { success: true, marked_count: absentCount, date: todayDateStr };
}

// ==========================================
// ACTION 2: Check Absence + AUTO DEMOTION
// ==========================================
async function runCheckAbsence() {
    console.log("🔄 Running Monthly Absence Check + Auto Demotion...");

    // 1. Load Rules
    const rulesSnap = await db.collection("app_settings").doc("rules").get();
    const rulesConfig = rulesSnap.exists ? rulesSnap.data() : {};
    const demotionSettings = rulesConfig.demotion || { enabled: true, maxMonthlyUnexcused: 4, maxMonthlyExcused: 2 };
    const halaqaPairings = rulesConfig.halaqaPairings || {};

    if (demotionSettings.enabled === false) {
        return { message: "Demotion check is DISABLED.", skipped: true };
    }

    const globalMaxUnexcused = demotionSettings.maxMonthlyUnexcused ?? 4;
    const globalMaxExcused = demotionSettings.maxMonthlyExcused ?? 2;
    const globalMaxTotal = demotionSettings.maxMonthlyTotal ?? 6;

    // 2. Current Month range
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const startOfMonthStr = `${year}-${month}-01`;

    // 3. Active Main Students (filter by type only, no 'status' field)
    const studentsSnap = await db.collection("students")
        .where("type", "==", "main")
        .get();

    if (studentsSnap.empty) return { message: "No active main students." };

    // 4. Fetch all attendance for this month (single field query — no composite index needed)
    const attSnap = await db.collection("attendance")
        .where("date", ">=", startOfMonthStr)
        .get();

    const statsMap = {};
    attSnap.forEach(doc => {
        const d = doc.data();
        if (d.status !== 'absent' && d.status !== 'excused') return; // filter in memory
        if (!statsMap[d.studentId]) statsMap[d.studentId] = { absent: 0, excused: 0 };
        if (d.status === 'absent') statsMap[d.studentId].absent++;
        else if (d.status === 'excused') statsMap[d.studentId].excused++;
    });

    const alerts = [];
    const alertMonthId = `${year}${month}`;

    studentsSnap.forEach(doc => {
        const s = doc.data();
        const stats = statsMap[doc.id] || { absent: 0, excused: 0 };
        const totalAbsence = stats.absent + stats.excused;
        const targetReserveId = halaqaPairings[s.halaqaId] || null;

        let reason = null;
        let triggerType = null;

        if (stats.absent >= globalMaxUnexcused) {
            reason = `تجاوز حد الغياب الشهري (${stats.absent}/${globalMaxUnexcused})`;
            triggerType = 'unexcused';
        } else if (stats.excused >= globalMaxExcused) {
            reason = `تجاوز حد الأعذار الشهري (${stats.excused}/${globalMaxExcused})`;
            triggerType = 'excused';
        } else if (totalAbsence >= globalMaxTotal) {
            reason = `تجاوز الحد الكلي للغياب (${totalAbsence}/${globalMaxTotal})`;
            triggerType = 'total_cap';
        }

        if (reason) {
            alerts.push({
                studentId: doc.id,
                studentName: s.fullName,
                halaqaId: s.halaqaId,
                halaqaName: s.halaqaName,
                reason,
                stats: { ...stats, total: totalAbsence },
                targetReserveId,
                type: triggerType
            });
        }
    });

    if (alerts.length === 0) {
        return { message: "No violations found." };
    }

    // 5. Create alerts AND auto-move students to reserve
    const batch = db.batch();
    let movedCount = 0;

    for (const a of alerts) {
        // Check if alert already handled this month (avoid re-demoting)
        const alertId = `demotion_${a.studentId}_${alertMonthId}`;
        const existingAlert = await db.collection("demotion_alerts").doc(alertId).get();
        if (existingAlert.exists && existingAlert.data().status === 'executed') {
            continue; // Already demoted this month
        }

        // Create/update alert
        batch.set(db.collection("demotion_alerts").doc(alertId), {
            studentId: a.studentId,
            studentName: a.studentName || "Unknown",
            halaqaId: a.halaqaId,
            halaqaName: a.halaqaName,
            reason: a.reason,
            stats: a.stats,
            targetReserveId: a.targetReserveId,
            status: "executed",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            executedAt: admin.firestore.FieldValue.serverTimestamp(),
            month: alertMonthId
        }, { merge: true });

        // AUTO-MOVE: If there's a paired reserve halaqa, move the student
        if (a.targetReserveId) {
            // Get reserve halaqa name
            const reserveSnap = await db.collection("halaqat").doc(a.targetReserveId).get();
            const reserveName = reserveSnap.exists ? reserveSnap.data().name : "احتياط";

            batch.update(db.collection("students").doc(a.studentId), {
                type: "reserve",
                halaqaId: a.targetReserveId,
                halaqaName: reserveName,
                demotionDate: admin.firestore.FieldValue.serverTimestamp(),
                demotionReason: a.reason,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            movedCount++;
        }

        // Send notification
        sendPushToStudent(
            a.studentId,
            '🔴 تم نقلك للاحتياط',
            `${a.reason}. تم نقلك تلقائياً إلى حلقة الاحتياط.`,
            { type: 'demotion', reason: a.reason }
        );
    }

    await batch.commit();

    return {
        success: true,
        alerts_created: alerts.length,
        students_moved: movedCount,
        month: alertMonthId
    };
}

// ==========================================
// ACTION 3: Check Promotion (Monthly Reserve → Main)
// ==========================================
async function runCheckPromotion() {
    console.log("🚀 Running Monthly Promotion Check...");

    const rulesSnap = await db.collection("app_settings").doc("rules").get();
    const rulesData = rulesSnap.exists ? rulesSnap.data() : {};
    const promotion = rulesData.promotion || {};

    if (promotion.enabled === false) {
        return { message: "Promotion system is DISABLED.", skipped: true };
    }

    const minAttendance = promotion.minAttendance ?? 12;
    const minSessionScore = promotion.minSessionScore ?? 12;
    const halaqaPairings = promotion.halaqaPairings || {};

    // Previous month range
    const now = new Date();
    const prevMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
    const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const firstDay = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-01`;
    const lastDayDate = new Date(prevYear, prevMonth + 1, 0);
    const lastDay = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-${String(lastDayDate.getDate()).padStart(2, '0')}`;

    console.log(`📅 Checking promotion for period: ${firstDay} → ${lastDay}`);

    // Pre-load target halaqat names
    const halaqatCache = {};
    for (const [reserveId, targetId] of Object.entries(halaqaPairings)) {
        if (!targetId) continue;
        const hSnap = await db.collection("halaqat").doc(targetId).get();
        if (hSnap.exists) halaqatCache[reserveId] = { id: targetId, name: hSnap.data().name };
    }

    if (Object.keys(halaqatCache).length === 0) {
        return { message: "لم يتم تحديد أي ربط لحلقات الاحتياط.", skipped: true };
    }

    const reserveSnap = await db.collection("students").where("type", "==", "reserve").get();
    if (reserveSnap.empty) {
        return { message: "No active reserve students found." };
    }

    const batch = db.batch();
    let promotedCount = 0;
    let opCount = 0;

    for (const doc of reserveSnap.docs) {
        const sid = doc.id;
        const sData = doc.data();
        const studentHalaqaId = sData.halaqaId;

        const target = halaqatCache[studentHalaqaId];
        if (!target) continue;

        // Fetch attendance for this student in the period (simple query, filter in memory)
        const attSnap = await db.collection("attendance")
            .where("studentId", "==", sid)
            .where("date", ">=", firstDay)
            .where("date", "<=", lastDay)
            .get();

        // Count only present/sard in memory
        let presentCount = 0;
        attSnap.forEach(a => {
            const st = a.data().status;
            if (st === 'present' || st === 'sard') presentCount++;
        });
        if (presentCount < minAttendance) continue;

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

        batch.update(db.collection("students").doc(sid), {
            type: "main",
            halaqaId: target.id,
            halaqaName: target.name,
            promotionDate: admin.firestore.FieldValue.serverTimestamp(),
        });
        promotedCount++;
        opCount++;

        sendPushToStudent(sid, '🎉 مبروك! تمت ترقيتك',
            `لقد تم نقلك من الاحتياط إلى حلقة "${target.name}" بناءً على أدائك المتميز!`,
            { type: 'promotion' }
        );

        if (opCount >= 450) {
            await batch.commit();
            opCount = 0;
        }
    }

    if (opCount > 0) await batch.commit();

    console.log(`🚀 Promoted ${promotedCount} students`);
    return {
        success: true,
        promoted: promotedCount,
        rules: { minAttendance, minSessionScore },
        period: { from: firstDay, to: lastDay }
    };
}

// ==========================================
// ACTION 4: Agent Report (Telegram)
// ==========================================
async function handleAgentReport(req, res) {
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
    const map = {
        'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3, 'Thursday': 4, 'Friday': 5, 'Saturday': 6,
        'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6
    };
    return map[dayName] ?? -1;
}
