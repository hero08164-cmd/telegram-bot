// lib/telegramApi.js — thin wrapper around Telegram's Bot API
// (unchanged logic from the old Vercel version).

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

async function tgApi(method, params) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}

function replyTo(chatId, text) {
  return tgApi('sendMessage', { chat_id: chatId, text });
}

async function downloadTelegramPhoto(fileId) {
  const fileInfo = await tgApi('getFile', { file_id: fileId });
  if (!fileInfo.ok) throw new Error('Telegram getFile failed: ' + JSON.stringify(fileInfo));
  const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.result.file_path}`;
  const res = await fetch(fileUrl);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

module.exports = { tgApi, replyTo, downloadTelegramPhoto };
