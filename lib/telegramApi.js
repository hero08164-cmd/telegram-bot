
// lib/telegramApi.js - thin wrapper around Telegram Bot API

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;

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

async function downloadTelegramFile(fileId) {
  const fileInfo = await tgApi('getFile', { file_id: fileId });
  if (!fileInfo.ok) throw new Error('Telegram getFile failed: ' + JSON.stringify(fileInfo));
  const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.result.file_path}`;
  const res = await fetch(fileUrl);
  const arrayBuffer = await res.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), filePath: fileInfo.result.file_path, fileUrl };
}

async function downloadTelegramPhoto(fileId) {
  const { buffer } = await downloadTelegramFile(fileId);
  return buffer;
}

async function getTelegramFileUrl(fileId) {
  const fileInfo = await tgApi('getFile', { file_id: fileId });
  if (!fileInfo.ok) throw new Error('Telegram getFile failed');
  return `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.result.file_path}`;
}

module.exports = { tgApi, replyTo, downloadTelegramPhoto, downloadTelegramFile, getTelegramFileUrl };
