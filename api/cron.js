// api/cron.js
// Consolidated cron: auto-absent, check-absence (auto-demotion), check-promotion
// Single daily cron runs ALL tasks in sequence (Vercel Hobby plan = 1 cron only)
// ✅ Migrated to Supabase for data access. Firebase Admin kept ONLY for FCM.

import admin from "firebase-admin";
import { getSupabaseAdmin } from "./_utils/auth-admin.js";

// Initialize Firebase Admin (ONLY for FCM push notifications)
if (!admin.apps.length) {
    if (!process.env.FIREBASE_PRIVATE_KEY) {
        console.warn("⚠️ Missing FIREBASE_PRIVATE_KEY — FCM push will be disabled");
    } else {
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
            }),
        });
    }
}

const supabase = getSupabaseAdmin();

// ── FCM Push Notification Helper ──
async function sendPushToStudent(studentId, title, body, dataPayload = {}) {
    if (!admin.apps.length) return; // FCM not available
    try {
        // Get student's userId
        const { data: student } = await supabase
            .from('students')
            .select('uid, fullName')
            .eq('id', studentId)
            .maybeSingle();
        if (!student) return;
        const userId = student.uid || studentId;

        // Get FCM token from users table
        const { data: user } = await supabase
            .from('users')
            .select('fcmToken')
            .eq('id', userId)
            .maybeSingle();
        if (!user?.fcmToken) return;

        await admin.messaging().send({
            notification: { title, body },
            data: { ...dataPayload, studentId, type: dataPayload.type || 'general' },
            token: user.fcmToken,
            android: { priority: "high" },
        });
        console.log(`📲 Push sent to ${student.fullName || studentId}`);
    } catch (err) {
        if (
            err.code === "messaging/registration-token-not-registered" ||
            err.code === "messaging/invalid-registration-token"
        ) {
            try {
                const { data: student } = await supabase
                    .from('students')
                    .select('uid')
                    .eq('id', studentId)
                    .maybeSingle();
                const userId = student?.uid || studentId;
                if (userId) {
                    await supabase.from('users').update({ fcmToken: null }).eq('id', userId);
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
    const isManual = req.query.manual !== 'false';

    try {
        switch (action) {
            case 'all': {
                const results = {};
                console.log("🔄 Running ALL cron tasks...");

                results.autoAbsent = await runAutoAbsent(false);
                console.log("✅ Auto Absent done:", results.autoAbsent);

                results.checkAbsence = await runCheckAbsence();
                console.log("✅ Check Absence done:", results.checkAbsence);

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
                return res.status(200).json(await runAutoAbsent(isManual));
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
async function runAutoAbsent(manual = true) {
    const now = new Date();
    let targetDate;
    if (manual) {
        targetDate = now;
    } else {
        targetDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }
    const todayDateStr = targetDate.toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
    const dayName = targetDate.toLocaleDateString("en-US", { timeZone: "Africa/Cairo", weekday: "long" });
    const dayIndex = getDayIndex(dayName);

    console.log(`📅 Auto Absence for ${manual ? 'TODAY' : 'YESTERDAY'}: ${todayDateStr} (${dayName}, idx:${dayIndex})`);

    // 1. Load Rules from app_settings (data is in direct columns, not 'value')
    const { data: rulesRow } = await supabase
        .from('app_settings')
        .select('*')
        .eq('id', 'rules')
        .maybeSingle();
    const rulesConfig = rulesRow || {};

    const autoAbsentConfig = rulesConfig.autoAbsent || { enabled: true, days: [6, 1, 3] };
    if (autoAbsentConfig.enabled === false) {
        return { message: "Auto Absent System is DISABLED by admin.", skipped: true };
    }

    const globalDays = autoAbsentConfig.days || [6, 1, 3];
    const halaqaDays = autoAbsentConfig.halaqaDays || {};

    // 2. Check Global Holidays
    const { data: holidaysRow } = await supabase
        .from('app_settings')
        .select('*')
        .eq('id', 'holidays')
        .maybeSingle();
    const holidaysList = holidaysRow?.list || [];
    const isGlobalHoliday = holidaysList.some(h => !h.halaqaId && todayDateStr >= h.from && todayDateStr <= h.to);

    if (isGlobalHoliday) {
        return { message: "Today is a Global Holiday. No absence recorded.", skipped: true };
    }

    // 3. Process Students
    const { data: students } = await supabase.from('students').select('id, fullName, halaqaId, halaqaName, type');
    if (!students || students.length === 0) return { message: "No active students found." };

    // 4. Get already-processed attendance for this date
    const { data: existingAttendance } = await supabase
        .from('attendance')
        .select('studentId')
        .eq('date', todayDateStr);
    const processedStudentIds = new Set((existingAttendance || []).map(a => a.studentId));

    let absentCount = 0;
    const newlyAbsentIds = [];
    const attendanceBatch = [];

    for (const s of students) {
        if (processedStudentIds.has(s.id)) continue;
        if (s.type === 'reserve') continue;

        const activeDays = (s.halaqaId && halaqaDays[s.halaqaId]?.length > 0) ? halaqaDays[s.halaqaId] : globalDays;
        if (!activeDays.includes(dayIndex)) continue;

        const isHalaqaHoliday = holidaysList.some(h =>
            h.halaqaId === s.halaqaId && todayDateStr >= h.from && todayDateStr <= h.to
        );
        if (isHalaqaHoliday) continue;

        attendanceBatch.push({
            id: `${todayDateStr}_${s.id}`,
            studentId: s.id,
            halaqaId: s.halaqaId || "unknown",
            halaqaName: s.halaqaName || "بدون حلقة",
            status: "absent",
            date: todayDateStr,
            recordedBy: "system_auto",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });

        newlyAbsentIds.push(s.id);
        absentCount++;
    }

    // Batch upsert attendance
    if (attendanceBatch.length > 0) {
        for (let i = 0; i < attendanceBatch.length; i += 200) {
            const batch = attendanceBatch.slice(i, i + 200);
            const { error } = await supabase.from('attendance').upsert(batch);
            if (error) console.error("Attendance upsert error:", error.message);
        }
    }

    // Fire & forget push notifications
    for (const studentId of newlyAbsentIds) {
        sendPushToStudent(
            studentId,
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

    // 1. Load Rules (data is in direct columns)
    const { data: rulesRow } = await supabase
        .from('app_settings')
        .select('*')
        .eq('id', 'rules')
        .maybeSingle();
    const rulesConfig = rulesRow || {};
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
    const endOfMonthDate = new Date(year, now.getMonth() + 1, 0);
    const endOfMonthStr = `${year}-${month}-${String(endOfMonthDate.getDate()).padStart(2, '0')}`;

    // 3. Active Main Students
    const { data: mainStudents } = await supabase
        .from('students')
        .select('id, fullName, halaqaId, halaqaName')
        .eq('type', 'main');

    if (!mainStudents || mainStudents.length === 0) return { message: "No active main students." };

    // 4. Fetch all attendance for this month
    const { data: attData } = await supabase
        .from('attendance')
        .select('studentId, status')
        .gte('date', startOfMonthStr)
        .lte('date', endOfMonthStr)
        .in('status', ['absent', 'excused']);

    const statsMap = {};
    (attData || []).forEach(d => {
        if (!statsMap[d.studentId]) statsMap[d.studentId] = { absent: 0, excused: 0 };
        if (d.status === 'absent') statsMap[d.studentId].absent++;
        else if (d.status === 'excused') statsMap[d.studentId].excused++;
    });

    const alerts = [];
    const alertMonthId = `${year}${month}`;

    for (const s of mainStudents) {
        const stats = statsMap[s.id] || { absent: 0, excused: 0 };
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
                studentId: s.id,
                studentName: s.fullName,
                halaqaId: s.halaqaId,
                halaqaName: s.halaqaName,
                reason,
                stats: { ...stats, total: totalAbsence },
                targetReserveId,
                type: triggerType
            });
        }
    }

    if (alerts.length === 0) {
        return { message: "No violations found." };
    }

    // 5. Create alerts AND auto-move students to reserve
    let movedCount = 0;

    for (const a of alerts) {
        const alertId = `demotion_${a.studentId}_${alertMonthId}`;

        // Check if already handled
        const { data: existingAlert } = await supabase
            .from('demotion_alerts')
            .select('status')
            .eq('id', alertId)
            .maybeSingle();

        if (existingAlert?.status === 'executed') continue;

        // Create/update alert
        await supabase.from('demotion_alerts').upsert({
            id: alertId,
            studentId: a.studentId,
            studentName: a.studentName || "Unknown",
            halaqaId: a.halaqaId,
            halaqaName: a.halaqaName,
            reason: a.reason,
            stats: a.stats,
            targetReserveId: a.targetReserveId,
            status: "executed",
            createdAt: new Date().toISOString(),
            executedAt: new Date().toISOString(),
            month: alertMonthId
        });

        // AUTO-MOVE to reserve if paired
        if (a.targetReserveId) {
            const { data: reserveHalaqa } = await supabase
                .from('halaqat')
                .select('name')
                .eq('id', a.targetReserveId)
                .maybeSingle();
            const reserveName = reserveHalaqa?.name || "احتياط";

            await supabase.from('students').update({
                type: "reserve",
                halaqaId: a.targetReserveId,
                halaqaName: reserveName,
                demotionDate: new Date().toISOString(),
                demotionReason: a.reason,
            }).eq('id', a.studentId);

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

    const { data: rulesRow } = await supabase
        .from('app_settings')
        .select('*')
        .eq('id', 'rules')
        .maybeSingle();
    const rulesData = rulesRow || {};
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
        const { data: h } = await supabase.from('halaqat').select('name').eq('id', targetId).maybeSingle();
        if (h) halaqatCache[reserveId] = { id: targetId, name: h.name };
    }

    if (Object.keys(halaqatCache).length === 0) {
        return { message: "لم يتم تحديد أي ربط لحلقات الاحتياط.", skipped: true };
    }

    // Reserve students
    const { data: reserveStudents } = await supabase
        .from('students')
        .select('id, fullName, halaqaId, halaqaName')
        .eq('type', 'reserve');

    if (!reserveStudents || reserveStudents.length === 0) {
        return { message: "No active reserve students found." };
    }

    let promotedCount = 0;

    for (const s of reserveStudents) {
        const target = halaqatCache[s.halaqaId];
        if (!target) continue;

        // Fetch attendance for this student in date range
        const { data: attRecords } = await supabase
            .from('attendance')
            .select('status, date')
            .eq('studentId', s.id)
            .gte('date', firstDay)
            .lte('date', lastDay)
            .in('status', ['present', 'sard']);

        const presentCount = attRecords?.length || 0;
        if (presentCount < minAttendance) continue;

        // Fetch progress
        const { data: progRecords } = await supabase
            .from('progress')
            .select('lessonScore, revisionScore, tilawaScore, homeworkScore, date')
            .eq('studentId', s.id)
            .gte('date', firstDay)
            .lte('date', lastDay);

        if (!progRecords || progRecords.length === 0) continue;

        let allScoresMet = true;
        for (const d of progRecords) {
            const total = Number(d.lessonScore || 0) + Number(d.revisionScore || 0) +
                Number(d.tilawaScore || 0) + Number(d.homeworkScore || 0);
            if (total < minSessionScore) { allScoresMet = false; break; }
        }

        if (!allScoresMet) continue;

        await supabase.from('students').update({
            type: "main",
            halaqaId: target.id,
            halaqaName: target.name,
            promotionDate: new Date().toISOString(),
        }).eq('id', s.id);

        promotedCount++;

        sendPushToStudent(s.id, '🎉 مبروك! تمت ترقيتك',
            `لقد تم نقلك من الاحتياط إلى حلقة "${target.name}" بناءً على أدائك المتميز!`,
            { type: 'promotion' }
        );
    }

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

    const { data: absentRecords } = await supabase
        .from('attendance')
        .select('studentName, halaqaName')
        .eq('date', todayDateStr)
        .eq('status', 'absent');

    if (!absentRecords || absentRecords.length === 0) {
        return res.json({ message: "لا يوجد غياب اليوم ✅" });
    }

    let message = `🚨 **تقرير الغياب اليومي** 🚨\n📅 التاريخ: ${todayDateStr}\n\nالطلاب المتغيبون:\n`;
    absentRecords.forEach((r, i) => {
        message += `${i + 1}. **${r.studentName}** (${r.halaqaName})\n`;
    });

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
    return res.json({ success: true, sent_to: absentRecords.length });
}

// Helpers
function getDayIndex(dayName) {
    const map = {
        'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3, 'Thursday': 4, 'Friday': 5, 'Saturday': 6,
        'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6
    };
    return map[dayName] ?? -1;
}
