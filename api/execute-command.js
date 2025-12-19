// api/execute-command.js
import deleteUser from "./delete-user.js";
import resetPassword from "./reset-password.js";
import updateEmail from "./update-email.js";
// نحدث المسارات لتشمل مجلد actions
import moveToReserve from "./actions/move-to-reserve.js";
import notifyParent from "./actions/notify-parent.js";

export default async function handler(req, res) {
  // إعدادات CORS الضرورية
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "https://darbw.netlify.app");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  const { command } = req.body;

  try {
    switch (command.action) {
      case "delete_user":
        return await deleteUser(req, res);
      case "reset_password":
        return await resetPassword(req, res);
      case "update_email":
        return await updateEmail(req, res);
      case "move_to_reserve":
        return await moveToReserve(req, res);
      case "notify_parent":
        return await notifyParent(req, res);
      default:
        return res.status(400).json({
          error: `الإجراء ${command.action} غير مدعوم حالياً`,
        });
    }
  } catch (err) {
    console.error("Execution Error:", err);
    res.status(500).json({ error: "خطأ في تنفيذ العملية البرمجية" });
  }
}
