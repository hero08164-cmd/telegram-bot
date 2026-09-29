
const express = require('express');
const telegramWebhookRouter = require('./routes/telegramWebhook');
const notifyRouter = require('./routes/notify');
const { getDb } = require('./lib/firebase');

const app = express();
app.use(express.json({ limit: '10mb' }));

app.get('/', (req, res) => {
  res.status(200).send('Prompt Beta bot server is alive - App+Instagram Combined Mode');
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), mode: 'app+instagram+onlyinsta+reels' });
});

app.get('/api/prompts', async (req, res) => {
  try {
    const db = getDb();
    const snap = await db.collection('prompts').orderBy('createdAt','desc').limit(50).get();
    res.json({ total: snap.size, prompts: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/admin', async (req, res) => {
  try {
    const db = getDb();
    const snap = await db.collection('prompts').orderBy('createdAt','desc').limit(100).get();
    const prompts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    let html = `<!DOCTYPE html><html><head><title>Prompt Beta Admin</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:sans-serif;background:#0f0f0f;color:#fff;padding:20px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:20px}.card{background:#1a1a1a;border-radius:12px;overflow:hidden}.card img{width:100%;height:200px;object-fit:cover}.card-body{padding:15px}.badge{background:#ff0050;padding:3px 10px;border-radius:20px;font-size:12px}</style></head><body><h1>🚀 Prompt Beta Admin (${prompts.length}) - App Images (Permanent)</h1><p>Note: Only 1 image per prompt is kept permanently. Extra carousel images are auto-deleted after IG post.</p><div class="grid">`;
    for (const p of prompts) {
      const date = p.createdAt?.toDate ? p.createdAt.toDate().toLocaleString('en-IN') : '';
      html += `<div class="card"><img src="${p.imageUrl}" onerror="this.src='https://via.placeholder.com/300x200?text=No+Image'"/><div class="card-body"><span class="badge">${p.category}</span> <small>${date}</small><p>${(p.prompt||'').substring(0,120)}</p><small>ID:${p.id}</small></div></div>`;
    }
    html += `</div></body></html>`;
    res.send(html);
  } catch(e) { res.status(500).send(e.message); }
});

app.use('/api/telegram-webhook', telegramWebhookRouter);
app.use('/api/notify', notifyRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT} - App+Instagram Combined Mode`);
});
