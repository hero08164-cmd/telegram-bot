
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
      res.status(400).json({ ok: false, error: 'title and body required' });
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
