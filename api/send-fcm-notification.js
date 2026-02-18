import admin from "firebase-admin";

// Initialize Firebase Admin (Reuse existing logic)
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

/**
 * API to send Push Notification via FCM
 * POST /api/send-fcm-notification
 * Body: { token: string, title: string, body: string, data: object }
 */
export default async function handler(req, res) {
    // CORS
    res.setHeader("Access-Control-Allow-Credentials", true);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    const { token, title, body, data } = req.body;

    if (!token) {
        return res.status(400).json({ error: "Missing FCM Token" });
    }

    try {
        const message = {
            notification: {
                title: title || "New Message",
                body: body || "You have a new message",
            },
            data: data || {},
            token: token,
            // إعدادات Android عالية الأولوية
            android: {
                priority: "high",
                notification: {
                    channelId: "high_importance_channel",
                    priority: "max",
                    defaultSound: true,
                    defaultVibrateTimings: true,
                },
            },
        };

        const response = await admin.messaging().send(message);

        return res.status(200).json({ success: true, messageId: response });

    } catch (error) {
        console.error("FCM Send Error:", error.code, error.message);

        // تنظيف التوكن المنتهي تلقائياً
        const isStaleToken =
            error.code === "messaging/registration-token-not-registered" ||
            error.code === "messaging/invalid-registration-token" ||
            error.code === "messaging/not-found" ||
            (error.message && error.message.includes("Requested entity was not found"));

        if (isStaleToken) {
            console.log(`🗑️ Cleaning stale token: ${token.substring(0, 20)}...`);
            try {
                // البحث عن المستخدم بالتوكن وحذفه
                const usersSnap = await db
                    .collection("users")
                    .where("fcmToken", "==", token)
                    .limit(1)
                    .get();

                if (!usersSnap.empty) {
                    const userDoc = usersSnap.docs[0];
                    await userDoc.ref.update({ fcmToken: admin.firestore.FieldValue.delete() });
                    console.log(`✅ Removed stale token from user: ${userDoc.id}`);
                }
            } catch (cleanupErr) {
                console.warn("⚠️ Token cleanup failed:", cleanupErr.message);
            }

            return res.status(200).json({
                success: false,
                staleToken: true,
                message: "Token was stale and has been cleaned up"
            });
        }

        return res.status(500).json({ error: error.message });
    }
}
