// api/fix-auth-emails.js
// Scans auth.users and fixes email-to-UUID mismatches caused by Firebase migration.
// Uses Service Role Key (admin) to read and update auth.users.

import { getSupabaseAdmin } from "./_utils/auth-admin.js";

const supabase = getSupabaseAdmin();

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  // Only allow POST for actual fixing, GET for dry-run scan
  const dryRun = req.method === "GET";

  try {
    // 1. Get ALL auth users (paginated)
    let allAuthUsers = [];
    let page = 1;
    const perPage = 1000;
    while (true) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
      if (error) throw new Error(`Failed to list auth users: ${error.message}`);
      if (!data.users || data.users.length === 0) break;
      allAuthUsers.push(...data.users);
      if (data.users.length < perPage) break;
      page++;
    }
    console.log(`Total auth users: ${allAuthUsers.length}`);

    // 2. Get ALL public users (code -> id mapping)
    const { data: publicUsers, error: pubErr } = await supabase
      .from('users')
      .select('id, code, fullName, role');
    if (pubErr) throw new Error(`Failed to fetch public users: ${pubErr.message}`);

    // Build code -> expected_id map
    const codeToExpectedId = {};
    for (const u of publicUsers) {
      if (u.code) {
        codeToExpectedId[u.code.toLowerCase().trim()] = { id: u.id, name: u.fullName, role: u.role };
      }
    }

    // 3. Check each auth user's email against expected ID
    const mismatches = [];
    const orphans = [];

    for (const authUser of allAuthUsers) {
      const email = authUser.email;
      if (!email || !email.endsWith('@bar-parents.com')) continue;

      const code = email.replace('@bar-parents.com', '').toLowerCase().trim();
      const expected = codeToExpectedId[code];

      if (!expected) {
        orphans.push({ email, authId: authUser.id, code });
        continue;
      }

      if (authUser.id !== expected.id) {
        mismatches.push({
          code,
          email,
          authId: authUser.id,
          expectedId: expected.id,
          studentName: expected.name,
          role: expected.role,
        });
      }
    }

    console.log(`Found ${mismatches.length} mismatches and ${orphans.length} orphans`);

    // 4. Fix mismatches if not dry-run
    const fixed = [];
    const errors = [];

    if (!dryRun && mismatches.length > 0) {
      for (const m of mismatches) {
        try {
          // Strategy: Update the PUBLIC tables to match the auth ID
          // (We can't change auth.users UUID, so we align public tables to auth)
          
          // Update users table: set the row with code=m.code to have id=m.authId
          // But we can't change primary key easily. Instead:
          // Option A: Delete old row, insert new row with correct ID
          // Option B: Update the auth user's email to match a different code
          
          // Actually, the cleanest fix is:
          // 1. Update the students row that has code=m.code to have id=m.authId
          // 2. Update the users row that has code=m.code to have id=m.authId
          // But changing primary keys is complex.
          
          // Better approach: Update auth user's email to match where its ID points
          // OR delete and recreate the auth user with the correct ID
          
          // Safest approach: Update the auth user's email
          // Find which code the auth user's current ID should have
          const currentCodeEntry = publicUsers.find(u => u.id === m.authId);
          
          if (currentCodeEntry) {
            // The auth user's ID currently points to a different student
            // We need to swap: this is complex if both auth users exist
            console.log(`Complex swap needed: auth ${m.email} (ID ${m.authId}) should be ${m.code} but ID maps to ${currentCodeEntry.code}`);
            
            // For now, let's try a different approach:
            // Update the public tables to match auth
            // Delete old users/students rows and create new ones with correct IDs
            
            // Step 1: Get full data for the student
            const { data: fullStudent } = await supabase.from('students').select('*').eq('code', m.code).maybeSingle();
            const { data: fullUser } = await supabase.from('users').select('*').eq('code', m.code).maybeSingle();
            
            if (fullStudent && fullStudent.id !== m.authId) {
              // Delete old row and insert with correct ID
              await supabase.from('students').delete().eq('id', fullStudent.id);
              const newStudent = { ...fullStudent, id: m.authId };
              const { error: insErr } = await supabase.from('students').upsert(newStudent);
              if (insErr) {
                errors.push({ code: m.code, step: 'students upsert', error: insErr.message });
                continue;
              }
            }
            
            if (fullUser && fullUser.id !== m.authId) {
              await supabase.from('users').delete().eq('id', fullUser.id);
              const newUser = { ...fullUser, id: m.authId };
              const { error: insErr } = await supabase.from('users').upsert(newUser);
              if (insErr) {
                errors.push({ code: m.code, step: 'users upsert', error: insErr.message });
                continue;
              }
            }
            
            // Also update related tables that reference the old ID
            const oldId = m.expectedId;
            const newId = m.authId;
            
            // Update attendance
            await supabase.from('attendance').update({ studentId: newId }).eq('studentId', oldId);
            // Update progress
            await supabase.from('progress').update({ studentId: newId }).eq('studentId', oldId);
            // Update behavior_records
            await supabase.from('behavior_records').update({ studentId: newId }).eq('studentId', oldId);
            // Update sard_bookings
            await supabase.from('sard_bookings').update({ studentId: newId }).eq('studentId', oldId);
            // Update leave_requests
            await supabase.from('leave_requests').update({ studentId: newId }).eq('studentId', oldId);
            // Update redemptions
            await supabase.from('redemptions').update({ studentId: newId }).eq('studentId', oldId);

            fixed.push({ code: m.code, name: m.studentName, oldId, newId });
          } else {
            // The auth ID doesn't map to any existing public user
            // Simply update the public tables
            const { data: fullStudent } = await supabase.from('students').select('*').eq('code', m.code).maybeSingle();
            const { data: fullUser } = await supabase.from('users').select('*').eq('code', m.code).maybeSingle();
            
            if (fullStudent && fullStudent.id !== m.authId) {
              const oldId = fullStudent.id;
              await supabase.from('students').delete().eq('id', oldId);
              await supabase.from('students').upsert({ ...fullStudent, id: m.authId });
              await supabase.from('attendance').update({ studentId: m.authId }).eq('studentId', oldId);
              await supabase.from('progress').update({ studentId: m.authId }).eq('studentId', oldId);
              await supabase.from('behavior_records').update({ studentId: m.authId }).eq('studentId', oldId);
              await supabase.from('sard_bookings').update({ studentId: m.authId }).eq('studentId', oldId);
              await supabase.from('leave_requests').update({ studentId: m.authId }).eq('studentId', oldId);
              await supabase.from('redemptions').update({ studentId: m.authId }).eq('studentId', oldId);
            }
            
            if (fullUser && fullUser.id !== m.authId) {
              await supabase.from('users').delete().eq('id', fullUser.id);
              await supabase.from('users').upsert({ ...fullUser, id: m.authId });
            }
            
            fixed.push({ code: m.code, name: m.studentName, oldId: m.expectedId, newId: m.authId });
          }
        } catch (e) {
          errors.push({ code: m.code, error: e.message });
        }
      }
    }

    return res.status(200).json({
      success: true,
      dryRun,
      totalAuthUsers: allAuthUsers.length,
      totalPublicUsers: publicUsers.length,
      mismatches: mismatches.map(m => ({
        code: m.code,
        name: m.studentName,
        authId: m.authId,
        expectedId: m.expectedId,
      })),
      mismatchCount: mismatches.length,
      orphanCount: orphans.length,
      orphans: orphans.slice(0, 10), // Show first 10
      fixed: fixed.length,
      fixedDetails: fixed,
      errors,
    });

  } catch (error) {
    console.error("Fix auth emails error:", error);
    return res.status(500).json({ error: error.message });
  }
}
