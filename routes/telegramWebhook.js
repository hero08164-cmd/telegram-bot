
// routes/telegramWebhook.js
// FINAL FLOW: App + Instagram combined with delete logic
// - Default: IMAGE -> CATEGORY -> PROMPT -> App save (1 image permanent) -> Extra 1-5 images -> TITLE -> CAPTION -> IG Carousel (1st = App image fixed) -> DELETE extra from DB
// - /onlyinsta: Only Instagram Carousel (App skip) -> 2-6 images -> Title -> Caption -> IG -> DELETE ALL from DB
// - /reels: Only Instagram Reels -> Video -> Title -> Caption -> IG Reel -> DELETE ALL from DB

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
];

const ALLOWED_CHAT_ID = process.env.TELEGRAM_ALLOWED_CHAT_ID;

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
      const cmd = text.split(' ')[0].toLowerCase();
      
      if (cmd === '/start') {
        await stateRef.delete().catch(()=>{});
        await replyTo(chatId,
          `🚀 TubePilot - App + Instagram Bot\n\n` +
          `MODE 1 (Default):\n1 IMAGE bhejo -> Category -> Prompt -> App me save + fir Instagram carousel ke liye extra images maangunga\n\n` +
          `MODE 2: /onlyinsta - Sirf Instagram carousel, App me nahi jayega\n` +
          `MODE 3: /reels - Sirf Instagram Reel\n\n` +
          `Note: App wali image hamesha Instagram carousel ki FIRST image hogi!\n` +
          `Extra images/video post ke baad DB se auto delete, sirf 1 App wali image rahegi.`
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
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        await replyTo(chatId, `📸 Only Instagram Carousel Mode ON\nApp me nahi jayega.\n2-6 images ek saath bhejo (album me).\nPost ke baad sab DB se delete ho jayega.`);
        res.status(200).json({ ok: true }); return;
      }

      if (cmd === '/reels') {
        await stateRef.set({
          step: 'awaiting_video_reels',
          mode: 'reels',
          videoUrl: '',
          title: '',
          caption: '',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        await replyTo(chatId, `🎬 Reels Mode ON\nSirf Instagram pe Reel jayegi.\n1 Video bhejo boss!\nPost ke baad video DB se delete.`);
        res.status(200).json({ ok: true }); return;
      }

      if (cmd === '/same') {
        if (state.step === 'awaiting_extra_images' && state.mode === 'app_plus_insta') {
          await stateRef.set({ step: 'awaiting_title', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
          await replyTo(chatId, `✅ Ok! Sirf App wali image se hi Instagram pe post karunga (single).\n\n✏️ Ab TITLE bhejo:`);
        } else {
          await replyTo(chatId, `❌ /same sirf App+Instagram flow me extra images ke time kaam karta hai.`);
        }
        res.status(200).json({ ok: true }); return;
      }

      if (cmd === '/cancel') {
        await stateRef.delete().catch(()=>{});
        await replyTo(chatId, `❌ Cancel ho gaya! /start se restart karo`);
        res.status(200).json({ ok: true }); return;
      }
    }

    // ============ PHOTO HANDLER ============
    if (message.photo && message.photo.length > 0) {
      const largest = message.photo[message.photo.length - 1];
      const fileId = largest.file_id;

      // Case A: idle or first image for app_plus_insta
      if (state.step === 'idle' || !state.step) {
        await replyTo(chatId, "📸 Image mil gayi, Cloudinary pe upload ho rahi hai App ke liye...");
        try {
          const { buffer } = await downloadTelegramFile(fileId);
          const cloudUrl = await uploadToCloudinary(buffer, `app_${Date.now()}.jpg`);
          
          await stateRef.set({
            step: 'awaiting_category',
            mode: 'app_plus_insta',
            appImageUrl: cloudUrl,
            appImageFileId: fileId,
            carouselImages: [],
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
          
          await replyTo(chatId, "✅ App image ready!\nAb category bhejo:\n" + CATEGORIES.join(", "));
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
          
          const existing = state.carouselImages || [];
          existing.push(cloudUrl);
          
          await stateRef.set({
            carouselImages: existing,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });

          await replyTo(chatId, `📸 Extra image ${existing.length} mili! Total: 1 (App wali FIXED first) + ${existing.length} = ${1+existing.length} images`);

          // Auto move to title after 10 sec if no more images (or 3 sec for album)
          const delay = message.media_group_id ? 3000 : 10000;
          setTimeout(async () => {
            try {
              const snap = await stateRef.get();
              if (!snap.exists) return;
              const s = snap.data();
              if (s.step !== 'awaiting_extra_images') return;
              await stateRef.set({ step: 'awaiting_title', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
              await replyTo(chatId, `✅ Extra images done! Total ${1 + (s.carouselImages||[]).length} images (1st = App wali fixed!)\n\n✏️ Ab TITLE bhejo:`);
            } catch(e){}
          }, delay);

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
          
          const existing = state.carouselImages || [];
          existing.push(cloudUrl);
          
          await stateRef.set({
            carouselImages: existing,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });

          await replyTo(chatId, `📸 Image ${existing.length} mili! Total: ${existing.length} (2-6 chahiye)`);

          const delay = message.media_group_id ? 3000 : 10000;
          setTimeout(async () => {
            try {
              const snap = await stateRef.get();
              if (!snap.exists) return;
              const s = snap.data();
              if (s.step !== 'awaiting_carousel_onlyinsta') return;
              if ((s.carouselImages||[]).length < 2) {
                await replyTo(chatId, `⚠️ Kam se kam 2 images chahiye, abhi ${s.carouselImages.length} hai. Aur bhejo.`);
                return;
              }
              await stateRef.set({ step: 'awaiting_title_onlyinsta', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
              await replyTo(chatId, `✅ ${s.carouselImages.length} images collect ho gayi!\n\n✏️ TITLE bhejo:`);
            } catch(e){}
          }, delay);

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
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
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
        const match = CATEGORIES.find(c => c.toLowerCase() === text.toLowerCase());
        if (!match) {
          await replyTo(chatId, `❌ "${text}" valid category nahi hai.\nValid: ${CATEGORIES.join(", ")}`);
          res.status(200).json({ ok: true }); return;
        }
        await stateRef.set({ step: 'awaiting_prompt', category: match, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        await replyTo(chatId, `✅ Category set: ${match}\nAb prompt text bhejo.`);
        res.status(200).json({ ok: true }); return;
      }

      // Step: awaiting_prompt -> save to prompts + move to extra images
      if (state.step === 'awaiting_prompt' && state.mode === 'app_plus_insta') {
        try {
          await db.collection('prompts').add({
            imageUrl: state.appImageUrl,
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
            carouselImages: [],
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });

          await replyTo(chatId,
            `🎉 App me upload ho gaya! ✅\nCategory: ${state.category}\n\n` +
            `⚠️ Note: App wali image hamesha Instagram carousel ki FIRST image hogi (fixed!)\n\n` +
            `📸 Ab Instagram ke liye aur 1-5 images bhejo (total 2-6)\n` +
            `Ya /same likho agar sirf isi 1 image se post karna hai`
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
        await stateRef.set({ step: 'awaiting_caption', title: text, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        await replyTo(chatId, `✅ Title: "${text}"\n\n📝 Ab CAPTION bhejo:`);
        res.status(200).json({ ok: true }); return;
      }

      if (state.step === 'awaiting_caption' && state.mode === 'app_plus_insta') {
        await stateRef.set({ caption: text, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        await replyTo(chatId, `✅ Caption save! Ab Instagram pe post kar raha hoon...`);
        
        // POST TO INSTAGRAM - keep app image, delete extra from DB
        (async () => {
          try {
            const snap = await stateRef.get();
            if (!snap.exists) return;
            const s = snap.data();
            const allImages = [s.appImageUrl, ...(s.carouselImages || [])].filter(Boolean);
            const finalCaption = `${s.title}\n\n${text}\n\n🚀 TubePilot`;
            
            const { postCarouselToInstagram } = require('../lib/instagram');
            const publishId = await postCarouselToInstagram(allImages, finalCaption);
            
            await replyTo(chatId, `✅ Instagram pe Posted! 🎉\nType: ${allImages.length > 1 ? 'Carousel' : 'Single'}\nhttps://www.instagram.com/p/${publishId}/\n\n🗑️ Extra ${s.carouselImages?.length || 0} images DB se delete, sirf 1 App wali image prompts me rahegi!`);
            
            // CLEANUP: Delete telegram_uploads but KEEP prompts (app image permanent)
            await stateRef.delete();
            // Delete any extra temp collections
            try {
              const extraSnap = await db.collection('instagram_temp').where('chatId', '==', chatId).get();
              for (const doc of extraSnap.docs) await doc.ref.delete();
            } catch(e){}
            
            console.log(`[CLEANUP] app_plus_insta done - kept 1 app image in prompts, deleted ${s.carouselImages?.length || 0} extra from telegram_uploads`);
            
          } catch (e) {
            console.error('IG post error app_plus_insta', e.response?.data || e.message);
            await replyTo(chatId, `❌ Instagram post fail: ${e.response?.data?.error?.message || e.message}`);
          }
        })();

        res.status(200).json({ ok: true }); return;
      }

      // Steps: onlyinsta - title and caption
      if (state.step === 'awaiting_title_onlyinsta' && state.mode === 'onlyinsta') {
        await stateRef.set({ step: 'awaiting_caption_onlyinsta', title: text, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        await replyTo(chatId, `✅ Title: "${text}"\n\n📝 CAPTION bhejo:`);
        res.status(200).json({ ok: true }); return;
      }

      if (state.step === 'awaiting_caption_onlyinsta' && state.mode === 'onlyinsta') {
        const title = state.title || '';
        await stateRef.set({ caption: text, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        await replyTo(chatId, `✅ Caption save! Instagram pe carousel post kar raha hoon...`);

        (async () => {
          try {
            const snap = await stateRef.get();
            if (!snap.exists) return;
            const s = snap.data();
            const allImages = s.carouselImages || [];
            const finalCaption = `${title}\n\n${text}\n\n🚀 TubePilot`;
            
            const { postCarouselToInstagram } = require('../lib/instagram');
            const publishId = await postCarouselToInstagram(allImages, finalCaption);
            
            await replyTo(chatId, `✅ Instagram Carousel Posted! 🎉\nhttps://www.instagram.com/p/${publishId}/\n\n🗑️ Sab ${allImages.length} images DB se delete ho gayi! (onlyinsta mode)`);
            
            // DELETE ALL - no app image to keep
            await stateRef.delete();
            console.log(`[CLEANUP] onlyinsta done - deleted all ${allImages.length} images from DB`);
            
          } catch (e) {
            console.error('IG post error onlyinsta', e.response?.data || e.message);
            await replyTo(chatId, `❌ Post fail: ${e.response?.data?.error?.message || e.message}`);
            await stateRef.delete().catch(()=>{});
          }
        })();

        res.status(200).json({ ok: true }); return;
      }

      // Steps: reels - title and caption
      if (state.step === 'awaiting_title_reels' && state.mode === 'reels') {
        await stateRef.set({ step: 'awaiting_caption_reels', title: text, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
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
            
            const { postReelToInstagram } = require('../lib/instagram');
            const publishId = await postReelToInstagram(s.videoUrl, finalCaption);
            
            await replyTo(chatId, `✅ Reel Posted! 🎬🎉\nhttps://www.instagram.com/p/${publishId}/\n\n🗑️ Video DB se delete ho gaya!`);
            
            await stateRef.delete();
            console.log(`[CLEANUP] reels done - deleted video from DB`);
            
          } catch (e) {
            console.error('IG reel post error', e.response?.data || e.message);
            await replyTo(chatId, `❌ Reel post fail: ${e.response?.data?.error?.message || e.message}`);
            await stateRef.delete().catch(()=>{});
          }
        })();

        res.status(200).json({ ok: true }); return;
      }

      // Idle text
      await replyTo(chatId, "Pehle IMAGE bhejo, ya /onlyinsta ya /reels use karo.\nOrder: IMAGE -> CATEGORY -> PROMPT -> Extra Images -> TITLE -> CAPTION");
      res.status(200).json({ ok: true }); return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('telegram-webhook error:', err);
    res.status(200).json({ ok: true });
  }
});

module.exports = router;
