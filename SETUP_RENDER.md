# Prompt Beta — Telegram Auto-Upload Bot (Render)

Yeh Node/Express server Telegram group mein aane wale
IMAGE → CATEGORY → PROMPT sequence ko pakadke Firestore ke `prompts`
collection mein save karta hai, aur push notification bhi bhejta hai —
Render ke free/starter Web Service plan pe chalta hai.

(Yeh Vercel wale version ki jagah hai — Vercel pe baar-baar 404 aa raha
tha kyunki upload/zip ke time `api/telegram-webhook.js` ka exact path
Vercel ki expectation se match nahi ho raha tha. Render ek normal,
hamesha-chalta Node server chalata hai, isliye yeh problem hi nahi
hogi.)

## Ek baar ka setup

### 1. Render pe deploy karo
1. Is poore `telegram-bot-render` folder ko GitHub pe ek naye repo mein
   push karo (root mein `server.js`, `package.json` seedhe dikhne
   chahiye — kisi aur folder ke andar nahi)
2. Render Dashboard → **New +** → **Web Service** → apna GitHub repo
   connect karo
3. Settings:
   - **Root Directory**: khaali chhodo (agar repo root mein hi yeh
     files hain) — agar sirf yeh folder alag repo mein daala hai to
     bhi khaali hi rakho
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free (ya Starter, agar free plan ki "spin
     down after inactivity" wali dikkat na chahiye ho — free plan pe
     pehla request kabhi-kabhi 30-50 sec slow ho sakta hai jab server
     "sleep" se jaagta hai)
4. Deploy hone ke baad Render ek URL dega, jaise:
   `https://promptbeta-bot.onrender.com`

### 2. Environment Variables set karo
Render → apna service → **Environment** tab, yeh sab add karo:

| Key | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | aapka bot token (BotFather wala) |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Firebase service account JSON ka poora content (ek line mein) |
| `CLOUDINARY_CLOUD_NAME` | `promtverse` |
| `CLOUDINARY_UPLOAD_PRESET` | `my_upload_preset` |
| `ONESIGNAL_APP_ID` | aapki OneSignal App ID |
| `ONESIGNAL_REST_API_KEY` | aapki OneSignal REST API Key |
| `NOTIFY_SHARED_SECRET` | koi bhi random string (optional, lekin recommended) |

`TELEGRAM_ALLOWED_CHAT_ID` **abhi mat daalna** — pehle neeche step 4
karo, wahan se ID milegi.

Env vars add karne ke baad Render khud redeploy kar dega (ya
**Manual Deploy** dabao).

### 3. Telegram ko bata do webhook kahan bhejna hai
Browser/terminal mein yeh URL khol do (apna token aur Render URL daal ke):

```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<your-app>.onrender.com/api/telegram-webhook
```

`{"ok":true,"result":true,...}` aana chahiye. Confirm karne ke liye:
```
https://api.telegram.org/bot<TOKEN>/getWebhookInfo
```
`last_error_message` khaali hona chahiye.

### 4. Group Chat ID nikalo
1. Bot ko apne Telegram group mein add karo
2. Group mein koi bhi message bhejo (jaise "hi")
3. Bot khud reply karega: **"Is chat/group ki ID hai: -100xxxxxxxxxx"**
4. Wo ID copy karke Render env vars mein `TELEGRAM_ALLOWED_CHAT_ID`
   naam se add karo → Manual Deploy

### 5. Admin panel ko is server se jodo
`admin_panel/app.js` ke top pe:
```js
const NOTIFY_API_BASE = "https://<your-app>.onrender.com";
const NOTIFY_SHARED_SECRET = "..."; // Step 2 wala NOTIFY_SHARED_SECRET, agar set kiya ho
```

## Roz ka use
Us group mein:
1. **Image bhejo** → bot "upload ho rahi hai" bolega, phir category list
2. **Category likho** (jaise `Travel`) → bot confirm karega
3. **Prompt text likho** → Firestore mein save + push notification
   bhejega + "🎉 Upload ho gaya!" bolega

## Free plan note
Render ke Free Web Service plan pe agar 15 min tak koi request nahi
aati to server "sleep" ho jaata hai — agla request 30-50 sec le sakta
hai jaagne mein (bot thoda late reply karega, lekin kaam karega).
Isse bachne ke liye Starter plan (paid) use kar sakte ho, ya koi free
"uptime pinger" service (jaise UptimeRobot) har 10 min pe
`https://<your-app>.onrender.com/` ping karta rahe.
