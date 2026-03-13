import { verifyAdminRole, getSupabaseAdmin } from "../_utils/auth-admin.js";

/**
 * Move Student to Reserve (Migrated to Supabase)
 * POST /api/actions/move-to-reserve
 * Body: { studentId, reason? }
 */
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  // 🛡️ Security Check
  const token = req.headers.authorization?.split("Bearer ")[1];
  if (!token || !(await verifyAdminRole(token))) {
    return res.status(403).json({ error: "غير مصرح لك بهذا الإجراء" });
  }

  const { studentId, reason } = req.body;
  if (!studentId) return res.status(400).json({ error: "معرف الطالب مطلوب" });

  try {
    const supabase = getSupabaseAdmin();

    // 1. Check student exists
    const { data: student, error: fetchErr } = await supabase
      .from('students')
      .select('id, fullName')
      .eq('id', studentId)
      .maybeSingle();

    if (fetchErr || !student) {
      return res.status(404).json({ error: "الطالب غير موجود" });
    }

    // 2. Update student to reserve
    const { error: updateErr } = await supabase
      .from('students')
      .update({
        type: "reserve",
        demotionDate: new Date().toISOString(),
        demotionReason: reason || "بواسطة الأدمن",
        updatedAt: new Date().toISOString(),
      })
      .eq('id', studentId);

    if (updateErr) throw new Error(updateErr.message);

    // 3. Update demotion alert (if exists)
    await supabase
      .from('demotion_alerts')
      .upsert({
        id: `manual_${studentId}`,
        studentId,
        studentName: student.fullName || "Unknown",
        reason: reason || "بواسطة الأدمن",
        status: "executed",
        executedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      });

    return res.status(200).json({ success: true, message: "تم النقل بنجاح" });
  } catch (error) {
    console.error("Move to Reserve Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
