// routes/notify.js
//
// Small internal endpoint that admin_panel/app.js calls after a
// successful Single/Bulk upload, instead of calling OneSignal directly
// from the browser (which OneSignal's REST API blocks via CORS anyway,
// and which would otherwise expose the REST API key in public JS).
//
// Protected by an optional shared secret — set NOTIFY_SHARED_SECRET as
// an env var here AND as the NOTIFY_SHARED_SECRET constant in
// admin_panel/app.js if you want basic protection against random
// people spamming this endpoint. Note this is a soft deterrent only:
// admin_panel is public client-side code, so a determined person could
// still read the secret out of it — it just stops casual abuse.

const express = require('express');
const router = express.Router();
const { sendPushNotification } = require('../lib/onesignal');

const SHARED_SECRET = process.env.NOTIFY_SHARED_SECRET;

router.post('/', async (req, res) => {
  try {
    if (SHARED_SECRET && req.headers['x-notify-secret'] !== SHARED_SECRET) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }

    const { title, body } = req.body || {};
    if (!title || !body) {
      res.status(400).json({ ok: false, error: 'title and body are required' });
      return;
    }

    const result = await sendPushNotification(title, body);
    res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error('notify route error:', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

module.exports = router;
