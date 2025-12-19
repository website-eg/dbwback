// api/execute-command.js
import { verifyAdminRole } from "./utils/auth-admin.js";
import deleteUser from "./delete-user.js";
import resetPassword from "./reset-password.js";
import updateEmail from "./update-email.js";
import moveToReserve from "./actions/move-to-reserve.js";
import notifyParent from "./actions/notify-parent.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "https://darbw.netlify.app");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  const { command, userToken } = req.body;

  try {
    // 💡 الدردشة العامة مسموحة للجميع دون قيود
    if (command.action === "chat") {
      return res.status(200).json({ success: true, message: command.warning });
    }

    // 🔒 الأوامر الإدارية تتطلب صلاحيات كاملة
    if (!userToken)
      return res.status(401).json({ error: "يجب تسجيل الدخول كمسؤول أولاً" });

    const isAdmin = await verifyAdminRole(userToken);
    if (!isAdmin)
      return res
        .status(403)
        .json({ error: "عذراً، هذه العملية تتطلب صلاحيات إدارية حصرية" });

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
        return res
          .status(400)
          .json({ error: "الإجراء المطلوب غير مدرج في النظام" });
    }
  } catch (err) {
    res.status(500).json({ error: "خطأ فني داخلي أثناء التنفيذ" });
  }
}
