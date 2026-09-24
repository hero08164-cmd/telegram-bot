// server.js
//
// Entry point for the Render Web Service. This replaces the old Vercel
// serverless-function setup (which only worked when the file lived at
// api/telegram-webhook.js in the exact repo root Vercel expected — that
// path kept breaking on re-uploads). Render instead runs a normal,
// always-on Node process, so we use a small Express app that stays
// running and listens on the port Render gives us.

const express = require('express');
const telegramWebhookRouter = require('./routes/telegramWebhook');
const notifyRouter = require('./routes/notify');

const app = express();
app.use(express.json({ limit: '5mb' }));

// Render (and you, for a manual check) can hit "/" to confirm the
// service is up.
app.get('/', (req, res) => {
  res.status(200).send('Prompt Beta bot server is alive.');
});

app.use('/api/telegram-webhook', telegramWebhookRouter);
app.use('/api/notify', notifyRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
