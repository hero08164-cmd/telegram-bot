// api/telegram-webhook.js
//
// Telegram sends every message from the bot's group here as a POST request.
// Flow per chat: Image -> Category (text) -> Prompt (text) -> auto-saved to
// Firestore's "prompts" collection, exactly like the admin panel's Single
// Upload does. State between steps is kept in a Firestore document
// (telegram_uploads/{chatId}) since serverless functions don't keep memory
// between requests.

const admin = require('firebase-admin');

const CATEGORIES = [
  "Trending", "Girls", "Boys", "Couple", "Cinematic",
  "Bikes", "God", "Travel", "Birthday", "Kids",
];

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_CHAT_ID = process.env.TELEGRAM_ALLOWED_CHAT_ID; // set this after step 0 below
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'promtverse';
const CLOUDINARY_UPLOAD_PRESET = process.env.CLOUDINARY_UPLOAD_PRESET || 'my_upload_preset';

function getDb() {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON env var is missing');
    const serviceAccount = JSON.parse(raw);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
  return admin.firestore();
}

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

async function uploadToCloudinary(buffer, filename) {
  const form = new FormData();
  form.append('file', new Blob([buffer]), filename);
  form.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
    { method: 'POST', body: form }
  );
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || 'Cloudinary upload failed');
  return json.secure_url;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(200).send('Telegram webhook is alive.');
    return;
  }

  try {
    const update = req.body;
    const message = update && update.message;
    if (!message) {
      res.status(200).json({ ok: true });
      return;
    }

    const chatId = String(message.chat.id);

    // ---- Step 0: chat not configured yet — tell the sender its ID and stop ----
    if (!ALLOWED_CHAT_ID) {
      await replyTo(
        chatId,
        `Is chat/group ki ID hai:\n${chatId}\n\nIse Vercel project ke TELEGRAM_ALLOWED_CHAT_ID environment variable mein daal ke redeploy karo, phir dobara try karo.`
      );
      res.status(200).json({ ok: true });
      return;
    }

    // Security: ignore anything from any other chat.
    if (chatId !== String(ALLOWED_CHAT_ID)) {
      res.status(200).json({ ok: true });
      return;
    }

    const db = getDb();
    const stateRef = db.collection('telegram_uploads').doc(chatId);
    const stateSnap = await stateRef.get();
    const state = stateSnap.exists ? stateSnap.data() : { step: 'idle' };

    // ---- Step 1: photo received ----
    if (message.photo && message.photo.length > 0) {
      await replyTo(chatId, "📸 Image mil gayi, upload ho rahi hai...");
      const largest = message.photo[message.photo.length - 1];
      const buffer = await downloadTelegramPhoto(largest.file_id);
      const imageUrl = await uploadToCloudinary(buffer, `tg_${Date.now()}.jpg`);

      await stateRef.set({
        step: 'awaiting_category',
        imageUrl,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      await replyTo(
        chatId,
        "✅ Image upload ho gayi.\nAb category bhejo (in mein se ek):\n" + CATEGORIES.join(", ")
      );
      res.status(200).json({ ok: true });
      return;
    }

    // ---- Step 2 & 3: text (category, then prompt) ----
    if (message.text) {
      const text = message.text.trim();

      if (state.step === 'awaiting_category') {
        const match = CATEGORIES.find((c) => c.toLowerCase() === text.toLowerCase());
        if (!match) {
          await replyTo(
            chatId,
            `❌ "${text}" valid category nahi hai. In mein se ek bhejo:\n` + CATEGORIES.join(", ")
          );
          res.status(200).json({ ok: true });
          return;
        }
        await stateRef.set(
          { step: 'awaiting_prompt', category: match, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        );
        await replyTo(chatId, `✅ Category set: ${match}\nAb prompt text bhejo.`);
        res.status(200).json({ ok: true });
        return;
      }

      if (state.step === 'awaiting_prompt') {
        await db.collection('prompts').add({
          imageUrl: state.imageUrl,
          category: state.category,
          prompt: text,
          type: 'image',
          isPremium: false,
          likes: 0,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        await stateRef.delete();
        await replyTo(chatId, "🎉 Upload ho gaya! App mein live hai.");
        res.status(200).json({ ok: true });
        return;
      }

      // Idle — no image in progress yet.
      await replyTo(chatId, "Pehle ek IMAGE bhejo, phir CATEGORY, phir PROMPT — is order mein.");
      res.status(200).json({ ok: true });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('telegram-webhook error:', err);
    // Always 200 so Telegram doesn't retry-storm the same failing update.
    res.status(200).json({ ok: true });
  }
};
