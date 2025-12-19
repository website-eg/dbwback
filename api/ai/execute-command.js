// api/actions/execute-command.js
import deleteUser from "./delete-user.js";
import resetPassword from "./reset-password.js";
import updateEmail from "./update-email.js";
import moveToReserve from "./move-to-reserve.js";
import notifyParent from "./notify-parent.js";

export default async function handler(req, res) {
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

      case "notify_parent": // إضافة حالة إرسال الإشعار
        return await notifyParent(req, res);

      default:
        return res.status(400).json({
          error: `الإجراء ${command.action} غير مدعوم حالياً`,
        });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "خطأ في تنفيذ الأمر" });
  }
}
