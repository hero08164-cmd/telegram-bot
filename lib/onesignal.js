// lib/onesignal.js
//
// Sends a push notification through OneSignal's REST API. This runs
// SERVER-SIDE ONLY (Render) — deliberately. Two reasons:
//   1. OneSignal's REST API rejects direct cross-origin calls from a
//      browser (CORS), so calling it straight from admin_panel/app.js
//      (like the old, broken code implied) would never have worked.
//   2. The REST API key must never be shipped inside public,
//      client-side JavaScript — anyone could read it from the page
//      source and send push notifications to your users.
//
// Both admin_panel (via /api/notify) and the Telegram bot itself call
// this same function, so notification behavior is now consistent
// everywhere a prompt gets added.

const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY;

async function sendPushNotification(title, body) {
  if (!ONESIGNAL_APP_ID || !ONESIGNAL_REST_API_KEY) {
    console.warn('ONESIGNAL_APP_ID / ONESIGNAL_REST_API_KEY missing — skipping push notification.');
    return { skipped: true };
  }

  const res = await fetch('https://api.onesignal.com/notifications', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}`,
    },
    body: JSON.stringify({
      app_id: ONESIGNAL_APP_ID,
      included_segments: ['Subscribed Users'],
      headings: { en: title },
      contents: { en: body },
    }),
  });

  const json = await res.json();
  if (!res.ok || json.errors) {
    console.error('OneSignal push failed:', json);
  }
  return json;
}

module.exports = { sendPushNotification };
