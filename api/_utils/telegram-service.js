import fetch from "node-fetch";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

export const TelegramAgent = {
  // دالة لإرسال رسالة نصية
  async send(chatId, message) {
    if (!chatId) return;
    try {
      const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: "Markdown", // لتنسيق النص (bold, italic)
        }),
      });
      return await response.json();
    } catch (error) {
      console.error("Telegram Error:", error);
      return { success: false };
    }
  },
};
