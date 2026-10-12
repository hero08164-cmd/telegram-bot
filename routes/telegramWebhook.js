// routes/telegramWebhook.js
// FLOW: App + Instagram combined with delete logic
// - Default: IMAGE(S) (1-10, ek saath/album) -> CATEGORY -> PROMPT -> App save (saari images ek hi prompt me, jaise admin panel ka carousel)
//            -> Extra images (optional, sirf Instagram ke liye)
//            -> TITLE -> CAPTION -> IG Carousel (App images pehle, phir extra) -> temp state delete
//            /skip kisi bhi time (prompt ke baad) = Instagram pe NAHI jayega, sirf App
// - /onlyinsta: Only Instagram Carousel (App skip) -> 2-10 images -> Title -> Caption -> IG -> temp delete
// - /reels: Only Instagram Reels -> Video -> Title -> Caption -> IG Reel -> temp delete
// - /done: images collect karna band karo aur agle step pe jao (10 sec wait nahi karna)

const express = require('express');
const router = express.Router();
const { admin, getDb } = require('../lib/firebase');
const { replyTo, downloadTelegramFile } = require('../lib/telegramApi');
const { uploadToCloudinary } = require('../lib/cloudinary');
const { sendPushNotification } = require('../lib/onesignal');
const { postCarouselToInstagram, postReelToInstagram } = require('../lib/instagram');

const CATEGORIES = [
  "Trending", "Girls", "Boys", "Couple", "Cinematic",
  "Bikes", "God", "Travel", "Birthday", "Kids",
  "Wedding", "Vote Banner",   // admin panel (app.js CATEGORIES) ke saath EXACT same hona chahiye
];

const MAX_APP_IMAGES = 10;     // ek prompt me max images (admin panel MAX_SLIDES ke barabar)
const MAX_IG_IMAGES = 10;      // Instagram carousel limit
const ALBUM_DELAY = 3000;      // album ke liye wait (ms)
const SINGLE_DELAY = 10000;    // alag-alag images ke liye wait (ms)

const ALLOWED_CHAT_ID = process.env.TELEGRAM_ALLOWED_CHAT_ID;

// ---------- helpers ----------
const ts = () => admin.firestore.FieldValue.serverTimestamp();
const norm = (s) => String(s || '').toLowerCase().replace(/[\s_\-]+/g, '');
// category match: space/capital/last 's' ignore (wedding = weddings = Wedding)
const catKey = (s) => norm(s).replace(/s$/, '');
const newToken = () => Date.now() + '-' + Math.random().toString(36).substring(2, 8);

// Images state me {url, mid} objects ki tarah save hoti hain (mid = telegram message id)
// taaki album ki order sahi rahe. Purane string format ko bhi handle karta hai.
function urlsOf(arr) {
  return [...(arr || [])]
    .sort((a, b) => ((a && a.mid) || 0) - ((b && b.mid) || 0))
    .map((i) => (typeof i === 'string' ? i : i.url))
    .filter(Boolean);
}

// Atomic add (arrayUnion) - album ki saari photos ek saath aaye tab bhi koi image overwrite nahi hogi
function imageItem(url, message) {
  return { url, mid: message.message_id || 0 };
}

// Last image aane ke baad "quiet" period guzre to hi next step chalao (sirf last wala timer match karega)
function afterQuiet(stateRef, token, delay, expectedStep, fn) {
  setTimeout(async () => {
    try {
      const snap = await stateRef.get();
      if (!snap.exists) return;
      const s = snap.data();
      if (s.step !== expectedStep || s.lastImageToken !== token) return;
      await fn(s);
    } catch (e) {
      console.error('afterQuiet error', e.message);
    }
  }, delay);
}

async function finishAppImages(stateRef, chatId, s) {
  const n = urlsOf(s.appImages).length;
  await stateRef.set({ step: 'awaiting_category', updatedAt: ts() }, { merge: true });
  let msg = n > 1
    ? `✅ ${n} images ready! Ye sab EK hi prompt me jayengi (1st = cover, baaki slides)`
    : `✅ App image ready!`;
  if (n > MAX_APP_IMAGES) msg += `\n⚠️ Ek prompt me max ${MAX_APP_IMAGES} images, sirf pehli ${MAX_APP_IMAGES} jayengi.`;
  await replyTo(chatId, `${msg}\n\nAb category bhejo:\n${CATEGORIES.join(', ')}`);
}

async function finishExtraImages(stateRef, chatId, s) {
  const appN = urlsOf(s.appImages).length;
  const extraN = urlsOf(s.carouselImages).length;
  const total = appN + extraN;
  await stateRef.set({ step: 'awaiting_title', updatedAt: ts() }, { merge: true });
  let msg = `✅ Extra images done! Total ${total} images (pehle ${appN} App wali, phir ${extraN} extra)`;
  if (total > MAX_IG_IMAGES) msg += `\n⚠️ Instagram max ${MAX_IG_IMAGES} allow karta hai, sirf pehli ${MAX_IG_IMAGES} jayengi.`;
  await replyTo(chatId, `${msg}\n\n✏️ Ab TITLE bhejo:`);
}

async function finishOnlyInstaImages(stateRef, chatId, s) {
  const n = urlsOf(s.carouselImages).length;
  if (n < 2) {
    await replyTo(chatId, `⚠️ Kam se kam 2 images chahiye, abhi ${n} hai. Aur bhejo.`);
    return false;
  }
  await stateRef.set({ step: 'awaiting_title_onlyinsta', updatedAt: ts() }, { merge: true });
  let msg = `✅ ${n} images collect ho gayi!`;
  if (n > MAX_IG_IMAGES) msg += `\n⚠️ Instagram max ${MAX_IG_IMAGES} allow karta hai, sirf pehli ${MAX_IG_IMAGES} jayengi.`;
  await replyTo(chatId, `${msg}\n\n✏️ TITLE bhejo:`);
  return true;
}

router.get('/', (req, res) => {
  res.status(200).send('Telegram webhook is alive - App+Instagram Combined Mode');
});

router.post('/', async (req, res) => {
  try {
    const update = req.body;
    const message = update && update.message;
    if (!message) { res.status(200).json({ ok: true }); return; }

    const chatId = String(message.chat.id);
    const text = message.text ? message.text.trim() : '';

    // Step 0: chat not configured
    if (!ALLOWED_CHAT_ID) {
      await replyTo(chatId, `Is chat/group ki ID hai:\n${chatId}\n\nIse Render env TELEGRAM_ALLOWED_CHAT_ID me daal ke redeploy karo.`);
      res.status(200).json({ ok: true }); return;
    }
    if (chatId !== String(ALLOWED_CHAT_ID)) { res.status(200).json({ ok: true }); return; }

    const db = getDb();
    const stateRef = db.collection('telegram_uploads').doc(chatId);
    const stateSnap = await stateRef.get();
    let state = stateSnap.exists ? stateSnap.data() : { step: 'idle', mode: 'app_plus_insta' };

    // ============ COMMANDS ============
    if (text.startsWith('/')) {
      const cmd = text.split(' ')[0].toLowerCase().split('@')[0];

      if (cmd === '/start') {
        await stateRef.delete().catch(() => {});
        await replyTo(chatId,
          `🚀 TubePilot - App + Instagram Bot\n\n` +
          `MODE 1 (Default):\n1-10 IMAGE ek saath bhejo (album) = EK hi prompt (1st = cover, baaki slides) -> Category -> Prompt -> App me save -> Instagram ke liye extra images / title / caption\n` +
          `   /done = images bhejna ho gaya (wait na karo)\n` +
          `   /same = Instagram pe sirf App wali images\n` +
          `   /skip = Instagram pe NAHI karna (sirf App)\n\n` +
          `MODE 2: /onlyinsta - Sirf Instagram carousel, App me nahi jayega\n` +
          `MODE 3: /reels - Sirf Instagram Reel\n\n` +
          `Categories: ${CATEGORIES.join(', ')}\n\n` +
          `Note: Instagram carousel me App wali images hamesha PEHLE aayengi. Instagram max ${MAX_IG_IMAGES} images.\n` +
          `/cancel = kabhi bhi band karo`
        );
        res.status(200).json({ ok: true }); return;
      }

      if (cmd === '/onlyinsta' || cmd === '/igonly') {
        await stateRef.set({
          step: 'awaiting_carousel_onlyinsta',
          mode: 'onlyinsta',
          carouselImages: [],
          title: '',
          caption: '',
          updatedAt: ts()
        });
        await replyTo(chatId, `📸 Only Instagram Carousel Mode ON\nApp me nahi jayega.\n2-${MAX_IG_IMAGES} images ek saath bhejo (album me). Khatam hone par /done likho.\nPost ke baad temp data delete ho jayega.`);
        res.status(200).json({ ok: true }); return;
      }

      if (cmd === '/reels') {
        await stateRef.set({
          step: 'awaiting_video_reels',
          mode: 'reels',
          videoUrl: '',
          title: '',
          caption: '',
          updatedAt: ts()
        });
        await replyTo(chatId, `🎬 Reels Mode ON\nSirf Instagram pe Reel jayegi.\n1 Video bhejo boss!\nPost ke baad video DB se delete.`);
        res.status(200).json({ ok: true }); return;
      }

      if (cmd === '/same') {
        if (state.step === 'awaiting_extra_images' && state.mode === 'app_plus_insta') {
          await stateRef.set({ step: 'awaiting_title', updatedAt: ts() }, { merge: true });
          const n = urlsOf(state.appImages).length;
          await replyTo(chatId, `✅ Ok! Sirf App wali ${n} image${n > 1 ? 's' : ''} se hi Instagram pe post karunga (${n > 1 ? 'carousel' : 'single'}).\n\n✏️ Ab TITLE bhejo:\n(Instagram nahi karni to /skip)`);
        } else {
          await replyTo(chatId, `❌ /same sirf App+Instagram flow me extra images ke time kaam karta hai.`);
        }
        res.status(200).json({ ok: true }); return;
      }

      if (cmd === '/skip') {
        const skippable = ['awaiting_extra_images', 'awaiting_title', 'awaiting_caption'];
        const tooEarly = ['collecting_app_images', 'awaiting_category', 'awaiting_prompt'];
        if (state.mode === 'app_plus_insta' && skippable.includes(state.step)) {
          const n = urlsOf(state.appImages).length;
          await stateRef.delete().catch(() => {});
          await replyTo(chatId, `⏭️ Instagram SKIP! App me ${n} image${n > 1 ? 's' : ''} already live hai, Instagram pe kuch nahi gaya.\n\nNaya post: image bhejo.`);
        } else if (state.mode === 'app_plus_insta' && tooEarly.includes(state.step)) {
          await replyTo(chatId, `⚠️ /skip tab use karo jab App me upload ho chuka ho (prompt dene ke baad).\nAbhi sab band karna ho to /cancel likho.`);
        } else {
          await replyTo(chatId, `❌ /skip sirf App+Instagram flow me, App upload ke baad kaam karta hai. Band karna ho to /cancel.`);
        }
        res.status(200).json({ ok: true }); return;
      }

      if (cmd === '/done') {
        if (state.step === 'collecting_app_images' && state.mode === 'app_plus_insta') {
          if (urlsOf(state.appImages).length < 1) {
            await replyTo(chatId, `⚠️ Abhi koi image nahi aayi. Pehle image bhejo.`);
          } else {
            await finishAppImages(stateRef, chatId, state);
          }
        } else if (state.step === 'awaiting_extra_images' && state.mode === 'app_plus_insta') {
          if (urlsOf(state.carouselImages).length < 1) {
            await replyTo(chatId, `⚠️ Extra image abhi nahi aayi.\nExtra images bhejo, ya /same (sirf App wali images se post), ya /skip (Instagram nahi).`);
          } else {
            await finishExtraImages(stateRef, chatId, state);
          }
        } else if (state.step === 'awaiting_carousel_onlyinsta' && state.mode === 'onlyinsta') {
          await finishOnlyInstaImages(stateRef, chatId, state);
        } else {
          await replyTo(chatId, `❌ /done abhi kaam nahi karta (images collect hone ke time use karo).`);
        }
        res.status(200).json({ ok: true }); return;
      }

      if (cmd === '/cancel') {
        await stateRef.delete().catch(() => {});
        await replyTo(chatId, `❌ Cancel ho gaya! /start se restart karo`);
        res.status(200).json({ ok: true }); return;
      }
    }

    // ============ PHOTO HANDLER ============
    if (message.photo && message.photo.length > 0) {
      const largest = message.photo[message.photo.length - 1];
      const fileId = largest.file_id;
      const isAlbum = !!message.media_group_id;
      const delay = isAlbum ? ALBUM_DELAY : SINGLE_DELAY;

      // Case A: App ke liye images (idle ya already collecting) - 1 ya zyada
      const isFirstAppImage = state.step === 'idle' || !state.step;
      if (isFirstAppImage || (state.step === 'collecting_app_images' && state.mode === 'app_plus_insta')) {
        if (!isAlbum) await replyTo(chatId, "📸 Image mil gayi, Cloudinary pe upload ho rahi hai App ke liye...");
        try {
          const { buffer } = await downloadTelegramFile(fileId);
          const cloudUrl = await uploadToCloudinary(buffer, `app_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`);
          const token = newToken();

          await stateRef.set({
            mode: 'app_plus_insta',
            step: 'collecting_app_images',
            appImages: admin.firestore.FieldValue.arrayUnion(imageItem(cloudUrl, message)),
            lastImageToken: token,
            updatedAt: ts()
          }, { merge: true });

          if (!isAlbum) {
            const n = urlsOf(state.appImages).length + 1;
            await replyTo(chatId, `✅ App image ${n} ready!\nAur images bhejo ya /done likho.\n(${Math.round(delay / 1000)} sec me kuch na aaya to next step pe chala jaunga)`);
          }

          afterQuiet(stateRef, token, delay, 'collecting_app_images', (s) => finishAppImages(stateRef, chatId, s));
        } catch (e) {
          console.error('Cloudinary upload fail', e);
          await replyTo(chatId, "❌ Cloudinary upload fail: " + e.message);
        }
        res.status(200).json({ ok: true }); return;
      }

      // Case B: awaiting_extra_images for app_plus_insta (extra carousel images)
      if (state.step === 'awaiting_extra_images' && state.mode === 'app_plus_insta') {
        try {
          const { buffer } = await downloadTelegramFile(fileId);
          const cloudUrl = await uploadToCloudinary(buffer, `extra_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`);
          const token = newToken();

          await stateRef.set({
            carouselImages: admin.firestore.FieldValue.arrayUnion(imageItem(cloudUrl, message)),
            lastImageToken: token,
            updatedAt: ts()
          }, { merge: true });

          if (!isAlbum) {
            const extraN = urlsOf(state.carouselImages).length + 1;
            const appN = urlsOf(state.appImages).length;
            await replyTo(chatId, `📸 Extra image ${extraN} mili! Total: ${appN} (App wali, pehle) + ${extraN} = ${appN + extraN} images\nAur bhejo ya /done likho.`);
          }

          afterQuiet(stateRef, token, delay, 'awaiting_extra_images', (s) => finishExtraImages(stateRef, chatId, s));
        } catch (e) {
          console.error('Extra image upload fail', e);
          await replyTo(chatId, "❌ Extra image upload fail: " + e.message);
        }
        res.status(200).json({ ok: true }); return;
      }

      // Case C: onlyinsta carousel collection
      if (state.step === 'awaiting_carousel_onlyinsta' && state.mode === 'onlyinsta') {
        try {
          const { buffer } = await downloadTelegramFile(fileId);
          const cloudUrl = await uploadToCloudinary(buffer, `onlyinsta_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`);
          const token = newToken();

          await stateRef.set({
            carouselImages: admin.firestore.FieldValue.arrayUnion(imageItem(cloudUrl, message)),
            lastImageToken: token,
            updatedAt: ts()
          }, { merge: true });

          if (!isAlbum) {
            const n = urlsOf(state.carouselImages).length + 1;
            await replyTo(chatId, `📸 Image ${n} mili! (2-${MAX_IG_IMAGES} chahiye) Aur bhejo ya /done likho.`);
          }

          afterQuiet(stateRef, token, delay, 'awaiting_carousel_onlyinsta', (s) => finishOnlyInstaImages(stateRef, chatId, s));
        } catch (e) {
          console.error('Onlyinsta upload fail', e);
          await replyTo(chatId, "❌ Upload fail: " + e.message);
        }
        res.status(200).json({ ok: true }); return;
      }

      res.status(200).json({ ok: true }); return;
    }

    // ============ VIDEO HANDLER (for reels) ============
    if (message.video || (message.document && message.document.mime_type && message.document.mime_type.startsWith('video/'))) {
      const fileId = message.video ? message.video.file_id : message.document.file_id;

      if (state.step === 'awaiting_video_reels' && state.mode === 'reels') {
        await replyTo(chatId, "🎬 Video mil gayi, Cloudinary pe upload ho rahi hai...");
        try {
          const { buffer } = await downloadTelegramFile(fileId);
          // Cloudinary video upload
          const form = new FormData();
          form.append('file', new Blob([buffer]), `reel_${Date.now()}.mp4`);
          form.append('upload_preset', process.env.CLOUDINARY_UPLOAD_PRESET || 'my_upload_preset');
          form.append('resource_type', 'video');

          const resCloud = await fetch(
            `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME || 'promtverse'}/video/upload`,
            { method: 'POST', body: form }
          );
          const json = await resCloud.json();
          if (!resCloud.ok) throw new Error(json?.error?.message || 'Video upload failed');

          await stateRef.set({
            videoUrl: json.secure_url,
            step: 'awaiting_title_reels',
            updatedAt: ts()
          }, { merge: true });

          await replyTo(chatId, `✅ Video ready!\n\n✏️ TITLE bhejo:`);
        } catch (e) {
          console.error('Video upload fail', e);
          await replyTo(chatId, "❌ Video upload fail: " + e.message);
        }
        res.status(200).json({ ok: true }); return;
      }
    }

    // ============ TEXT HANDLER ============
    if (text) {
      // Step: awaiting_category (app_plus_insta)
      if (state.step === 'awaiting_category' && state.mode === 'app_plus_insta') {
        const match = CATEGORIES.find(c => catKey(c) === catKey(text));
        if (!match) {
          await replyTo(chatId, `❌ "${text}" valid category nahi hai.\nValid: ${CATEGORIES.join(", ")}`);
          res.status(200).json({ ok: true }); return;
        }
        await stateRef.set({ step: 'awaiting_prompt', category: match, updatedAt: ts() }, { merge: true });
        await replyTo(chatId, `✅ Category set: ${match}\nAb prompt text bhejo.`);
        res.status(200).json({ ok: true }); return;
      }

      // Step: awaiting_prompt -> save to prompts + move to extra images
      if (state.step === 'awaiting_prompt' && state.mode === 'app_plus_insta') {
        try {
          const appUrls = urlsOf(state.appImages).slice(0, MAX_APP_IMAGES);
          if (appUrls.length === 0) throw new Error('App image nahi mili, /cancel karke dobara image bhejo');

          // Admin panel jaisa hi format: imageUrl = cover, imageUrls = saari slides (ek hi prompt)
          const docRef = await db.collection('prompts').add({
            imageUrl: appUrls[0],          // cover (purane app versions ke liye bhi)
            imageUrls: appUrls,            // carousel list (1 ya zyada)
            category: state.category,
            prompt: text,
            type: 'image',
            isPremium: false,
            likes: 0,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });

          await stateRef.set({
            step: 'awaiting_extra_images',
            promptText: text,
            promptId: docRef.id,
            carouselImages: [],
            updatedAt: ts()
          }, { merge: true });

          await replyTo(chatId,
            `🎉 App me upload ho gaya! ✅\nCategory: ${state.category}\nImages: ${appUrls.length}${appUrls.length > 1 ? ' (ek hi prompt me carousel)' : ''}\n\n` +
            `Ab Instagram ke liye:\n` +
            `📸 Aur images bhejo (total max ${MAX_IG_IMAGES}, App wali pehle aayengi)\n` +
            `➡️ /same - sirf App wali image${appUrls.length > 1 ? 's' : ''} se post\n` +
            `⏭️ /skip - Instagram pe NAHI karna (sirf App)`
          );

          sendPushNotification("✨ New Prompt Added!", `Category: ${state.category}`).catch(e => console.error('Push fail', e));

        } catch (e) {
          console.error('Prompts save error', e);
          await replyTo(chatId, "❌ App me save fail: " + e.message);
        }
        res.status(200).json({ ok: true }); return;
      }

      // Steps: awaiting_title (app_plus_insta)
      if (state.step === 'awaiting_title' && state.mode === 'app_plus_insta') {
        await stateRef.set({ step: 'awaiting_caption', title: text, updatedAt: ts() }, { merge: true });
        await replyTo(chatId, `✅ Title: "${text}"\n\n📝 Ab CAPTION bhejo:\n(Instagram nahi karni to /skip)`);
        res.status(200).json({ ok: true }); return;
      }

      if (state.step === 'awaiting_caption' && state.mode === 'app_plus_insta') {
        await stateRef.set({ caption: text, updatedAt: ts() }, { merge: true });
        await replyTo(chatId, `✅ Caption save! Ab Instagram pe post kar raha hoon...`);

        // POST TO INSTAGRAM - App images pehle, phir extra
        (async () => {
          try {
            const snap = await stateRef.get();
            if (!snap.exists) return;
            const s = snap.data();
            const appUrls = urlsOf(s.appImages);
            const extraUrls = urlsOf(s.carouselImages);
            const allImages = [...appUrls, ...extraUrls].filter(Boolean).slice(0, MAX_IG_IMAGES);
            const finalCaption = `${s.title}\n\n${text}\n\n🚀 TubePilot`;

            const publishId = await postCarouselToInstagram(allImages, finalCaption);

            await replyTo(chatId, `✅ Instagram pe Posted! 🎉\nType: ${allImages.length > 1 ? 'Carousel' : 'Single'} (${allImages.length} images)\nhttps://www.instagram.com/p/${publishId}/\n\n🗑️ Temp data clear. App me ${appUrls.length} image${appUrls.length > 1 ? 's' : ''} permanent rahengi.`);

            // CLEANUP: telegram_uploads delete, prompts (app images) permanent
            await stateRef.delete();
            try {
              const extraSnap = await db.collection('instagram_temp').where('chatId', '==', chatId).get();
              for (const doc of extraSnap.docs) await doc.ref.delete();
            } catch (e) {}

            console.log(`[CLEANUP] app_plus_insta done - kept ${appUrls.length} app image(s) in prompts, cleared ${extraUrls.length} extra from telegram_uploads`);

          } catch (e) {
            console.error('IG post error app_plus_insta', e.response?.data || e.message);
            await replyTo(chatId, `❌ Instagram post fail: ${e.response?.data?.error?.message || e.message}\n\nRetry: caption dobara bhejo. Instagram nahi karni to /skip.`);
          }
        })();

        res.status(200).json({ ok: true }); return;
      }

      // Steps: onlyinsta - title and caption
      if (state.step === 'awaiting_title_onlyinsta' && state.mode === 'onlyinsta') {
        await stateRef.set({ step: 'awaiting_caption_onlyinsta', title: text, updatedAt: ts() }, { merge: true });
        await replyTo(chatId, `✅ Title: "${text}"\n\n📝 CAPTION bhejo:`);
        res.status(200).json({ ok: true }); return;
      }

      if (state.step === 'awaiting_caption_onlyinsta' && state.mode === 'onlyinsta') {
        const title = state.title || '';
        await stateRef.set({ caption: text, updatedAt: ts() }, { merge: true });
        await replyTo(chatId, `✅ Caption save! Instagram pe carousel post kar raha hoon...`);

        (async () => {
          try {
            const snap = await stateRef.get();
            if (!snap.exists) return;
            const s = snap.data();
            const allImages = urlsOf(s.carouselImages).slice(0, MAX_IG_IMAGES);
            const finalCaption = `${title}\n\n${text}\n\n🚀 TubePilot`;

            const publishId = await postCarouselToInstagram(allImages, finalCaption);

            await replyTo(chatId, `✅ Instagram Carousel Posted! 🎉\nhttps://www.instagram.com/p/${publishId}/\n\n🗑️ Sab ${allImages.length} images ka temp data delete ho gaya! (onlyinsta mode)`);

            // DELETE ALL - no app image to keep
            await stateRef.delete();
            console.log(`[CLEANUP] onlyinsta done - cleared ${allImages.length} images from DB`);

          } catch (e) {
            console.error('IG post error onlyinsta', e.response?.data || e.message);
            await replyTo(chatId, `❌ Post fail: ${e.response?.data?.error?.message || e.message}`);
            await stateRef.delete().catch(() => {});
          }
        })();

        res.status(200).json({ ok: true }); return;
      }

      // Steps: reels - title and caption
      if (state.step === 'awaiting_title_reels' && state.mode === 'reels') {
        await stateRef.set({ step: 'awaiting_caption_reels', title: text, updatedAt: ts() }, { merge: true });
        await replyTo(chatId, `✅ Title: "${text}"\n\n📝 CAPTION bhejo:`);
        res.status(200).json({ ok: true }); return;
      }

      if (state.step === 'awaiting_caption_reels' && state.mode === 'reels') {
        const title = state.title || '';

        (async () => {
          try {
            const snap = await stateRef.get();
            if (!snap.exists) return;
            const s = snap.data();
            const finalCaption = `${title}\n\n${text}\n\n🚀 TubePilot`;

            const publishId = await postReelToInstagram(s.videoUrl, finalCaption);

            await replyTo(chatId, `✅ Reel Posted! 🎬🎉\nhttps://www.instagram.com/p/${publishId}/\n\n🗑️ Video DB se delete ho gaya!`);

            await stateRef.delete();
            console.log(`[CLEANUP] reels done - deleted video from DB`);

          } catch (e) {
            console.error('IG reel post error', e.response?.data || e.message);
            await replyTo(chatId, `❌ Reel post fail: ${e.response?.data?.error?.message || e.message}`);
            await stateRef.delete().catch(() => {});
          }
        })();

        res.status(200).json({ ok: true }); return;
      }

      // Idle text
      await replyTo(chatId, "Pehle IMAGE(S) bhejo, ya /onlyinsta ya /reels use karo.\nOrder: IMAGE(S) -> CATEGORY -> PROMPT -> Extra Images -> TITLE -> CAPTION\n(/skip = Instagram nahi, /done = images khatam)");
      res.status(200).json({ ok: true }); return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('telegram-webhook error:', err);
    res.status(200).json({ ok: true });
  }
});

module.exports = router;
