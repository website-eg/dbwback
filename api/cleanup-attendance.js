// api/cleanup-attendance.js
// One-time cleanup: finds attendance docs with random IDs (from old cron bug)
// and either deletes duplicates or migrates them to proper date_studentId format.
// Run via: GET https://dbwback2.vercel.app/api/cleanup-attendance?confirm=yes

import admin from "firebase-admin";

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
    res.setHeader('Access-Control-Allow-Origin', '*');

    const confirm = req.query.confirm === 'yes';

    try {
        console.log('🧹 Starting attendance cleanup...');

        // Fetch ALL attendance records
        const allSnap = await db.collection('attendance').get();
        console.log(`📊 Total attendance records: ${allSnap.size}`);

        const properDocs = new Map();   // date_studentId -> doc data
        const randomDocs = [];          // docs with random IDs

        for (const doc of allSnap.docs) {
            const data = doc.data();
            const id = doc.id;
            const studentId = data.studentId;
            const date = data.date;

            if (!studentId || !date) continue;

            const expectedId = `${date}_${studentId}`;

            if (id === expectedId) {
                // Proper format doc
                properDocs.set(expectedId, { id, data, ref: doc.ref });
            } else {
                // Random ID doc (from old cron bug)
                randomDocs.push({ id, expectedId, data, ref: doc.ref, studentId, date });
            }
        }

        console.log(`✅ Proper docs: ${properDocs.size}`);
        console.log(`⚠️ Random ID docs: ${randomDocs.length}`);

        let deleted = 0;
        let migrated = 0;
        let skipped = 0;
        const details = [];

        if (!confirm) {
            // DRY RUN - just report
            for (const rd of randomDocs) {
                if (properDocs.has(rd.expectedId)) {
                    details.push(`DELETE: ${rd.id} (duplicate of ${rd.expectedId}, student: ${rd.data.studentName}, date: ${rd.date}, status: ${rd.data.status})`);
                    deleted++;
                } else {
                    details.push(`MIGRATE: ${rd.id} → ${rd.expectedId} (student: ${rd.data.studentName}, date: ${rd.date}, status: ${rd.data.status})`);
                    migrated++;
                }
            }

            return res.status(200).json({
                mode: 'DRY RUN (add ?confirm=yes to execute)',
                total_records: allSnap.size,
                proper_docs: properDocs.size,
                random_docs: randomDocs.length,
                will_delete: deleted,
                will_migrate: migrated,
                details: details.slice(0, 100), // Show first 100
            });
        }

        // ACTUAL CLEANUP
        const batchSize = 450;
        let batch = db.batch();
        let opCount = 0;

        for (const rd of randomDocs) {
            if (properDocs.has(rd.expectedId)) {
                // Duplicate - delete the random ID one (keep the proper one)
                batch.delete(rd.ref);
                deleted++;
                details.push(`DELETED: ${rd.id} (dup of ${rd.expectedId})`);
            } else {
                // No proper doc exists - migrate: create proper + delete random
                const newRef = db.collection('attendance').doc(rd.expectedId);
                batch.set(newRef, rd.data);
                batch.delete(rd.ref);
                migrated++;
                opCount++; // extra op for set
                details.push(`MIGRATED: ${rd.id} → ${rd.expectedId}`);
            }

            opCount++;
            if (opCount >= batchSize) {
                await batch.commit();
                batch = db.batch();
                opCount = 0;
            }
        }

        if (opCount > 0) await batch.commit();

        console.log(`🧹 Cleanup done: ${deleted} deleted, ${migrated} migrated`);

        return res.status(200).json({
            mode: 'EXECUTED',
            total_records: allSnap.size,
            proper_docs: properDocs.size,
            random_docs_found: randomDocs.length,
            deleted,
            migrated,
            details: details.slice(0, 100),
        });

    } catch (error) {
        console.error('Cleanup error:', error);
        return res.status(500).json({ error: error.message });
    }
}
