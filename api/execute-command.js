// api/execute-command.js
import deleteUser from "./delete-user.js";
import resetPassword from "./reset-password.js";
import updateEmail from "./update-email.js";
import moveToReserve from "./actions/move-to-reserve.js";
import notifyParent from "./actions/notify-parent.js";
// يفترض وجود ملف للتحقق من التوكن (Firebase Admin)
// import { verifyAdminRole } from "./utils/auth-admin.js";

export default async function handler(req, res) {
  // 1. إعدادات CORS لضمان استقبال الطلبات من نيتليفاى فقط
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "https://darbw.netlify.app");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  const { command, userToken } = req.body;

  try {
    // 2. 🛡️ طبقة الحماية القصوى: التحقق من الرتبة (Authorization)
    // هنا نتأكد أن الذي يرسل الأمر هو "أدمن" فعلاً وليس طالب يحاول اختراق النظام
    if (!userToken) {
      return res
        .status(401)
        .json({ error: "غير مصرح لك: يجب تسجيل الدخول أولاً" });
    }

    // ملاحظة: هنا يجب استدعاء دالة تتحقق من التوكن عبر Firebase Admin SDK
    const isAdmin = await verifyAdminRole(userToken);
    if (!isAdmin) return res.status(403).json({ error: "صلاحياتك لا تسمح بتنفيذ أوامر إدارية" });

    // 3. موزع الأوامر (Command Dispatcher)
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

      case "chat":
        // إذا كان الإجراء مجرد دردشة، نرد بالرسالة الودية فقط
        return res
          .status(200)
          .json({ success: true, message: command.warning });

      default:
        return res.status(400).json({
          error: `الإجراء ${command.action} غير مدعوم أو غير موجود في النظام`,
        });
    }
  } catch (err) {
    console.error("Execution Error:", err);
    res
      .status(500)
      .json({ error: "حدث خطأ داخلي أثناء تنفيذ العملية البرمجية" });
  }
}
