Prompt Beta - App + Instagram Combined Bot (Render)
NAYA FLOW (3 Modes)
MODE 1: Default App + Instagram Carousel
Telegram Group me 1 IMAGE bhejo (App ke liye)
  ↓ Bot: Category bhejo
  ↓ Category bhejo
  ↓ Bot: Prompt text bhejo
  ↓ Prompt text bhejo
  ↓ Firestore `prompts` me save -> App me live (YE 1 IMAGE PERMANENT RAHEGI!)
  ↓ Bot: "App me upload ho gaya! Ye image hamesha FIRST hogi IG carousel ki"
  ↓ Bot: "Aur 1-5 images bhejo ya /same likho"
  ↓ Extra images bhejo (1-5)
  ↓ Bot: Title bhejo?
  ↓ Title
  ↓ Bot: Caption bhejo?
  ↓ Caption
  ↓ Instagram (dusri ID) pe Carousel Post (1st = App wali fixed!)
  ↓ DELETE: Extra images DB se delete, sirf 1 App wali prompts me rahegi!
MODE 2: /onlyinsta - Only Instagram Carousel
/onlyinsta bhejo
  ↓ 2-6 images bhejo
  ↓ Title + Caption
  ↓ Instagram pe carousel
  ↓ DELETE: Sab images DB se delete (App me nahi gaya)
MODE 3: /reels - Only Instagram Reels
/reels bhejo
  ↓ Video bhejo
  ↓ Title + Caption
  ↓ Instagram pe Reel
  ↓ DELETE: Video DB se delete
Environment Variables (Render)
Key	Value
TELEGRAM_BOT_TOKEN	BotFather token
TELEGRAM_ALLOWED_CHAT_ID	Group ID (pehle empty rakho, bot batayega)
FIREBASE_SERVICE_ACCOUNT_JSON	Firebase JSON (single line)
CLOUDINARY_CLOUD_NAME	promtverse
CLOUDINARY_UPLOAD_PRESET	my_upload_preset
IG_USER_ID	Dusri IG ID (tubepilot.app nahi!)
IG_ACCESS_TOKEN	IG Access Token
ONESIGNAL_APP_ID	OneSignal App ID
ONESIGNAL_REST_API_KEY	OneSignal REST Key
NOTIFY_SHARED_SECRET	Random string (optional)
Deploy
GitHub repo me push (root me server.js, package.json)
Render -> New Web Service -> Connect repo
Build: npm install, Start: npm start
Env vars add karo
Webhook set karo:
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<your-app>.onrender.com/api/telegram-webhook
Delete Logic
telegram_uploads/{chatId} -> Har Instagram post ke baad delete (temp state)
prompts collection -> Sirf App wali 1 image permanent rahegi
onlyinsta aur reels mode me prompts me kuch save nahi hota, sab delete
