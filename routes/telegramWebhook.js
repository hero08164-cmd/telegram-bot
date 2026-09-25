// routes/telegramWebhook.js
//
// Same IMAGE -> CATEGORY -> PROMPT flow as before, moved from a Vercel
// serverless-function export into an Express router so it runs on
// Render. State between steps is still kept in Firestore
// (telegram_uploads/{chatId}) since we treat each request independently.

const express = require('express');
const router = express.Router();
const { admin, getDb } = require('../lib/firebase');
const { replyTo, downloadTelegramPhoto } = require('../lib/telegramApi');
const { uploadToCloudinary } = require('../lib/cloudinary');
const { sendPushNotification } = require('../lib/onesignal');

const CATEGORIES = [
  "Trending", "Girls", "Boys", "Couple", "Cinematic",
  "Bikes", "God", "Travel", "Birthday", "Kids",
];

const ALLOWED_CHAT_ID = process.env.TELEGRAM_ALLOWED_CHAT_ID; // set this after step 0 below

// Telegram itself only ever POSTs here. GET is just a manual "is it
// alive" check for you.
router.get('/', (req, res) => {
  res.status(200).send('Telegram webhook is alive.');
});

router.post('/', async (req, res) => {
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
        `Is chat/group ki ID hai:\n${chatId}\n\nIse Render service ke TELEGRAM_ALLOWED_CHAT_ID environment variable mein daal ke redeploy karo, phir dobara try karo.`
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

        // FIX / NEW: Telegram uploads now also trigger a push notification,
        // same as the admin panel — this never happened before. A failure
        // here must never break the "upload ho gaya" confirmation, so it
        // only logs on error instead of throwing.
        sendPushNotification(
          "✨ New Prompt Added!",
          `Category: ${state.category}`
        ).catch((err) => console.error('Push notify failed:', err));

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
});

module.exports = router;
