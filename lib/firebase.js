
const admin = require('firebase-admin');
let dbInstance = null;

function getDb() {
  if (dbInstance) return dbInstance;
  let raw = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var is missing');
  try {
    raw = raw.trim();
    const serviceAccount = JSON.parse(raw);
    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }
    dbInstance = admin.firestore();
    return dbInstance;
  } catch (e) {
    console.error('Firebase parse error:', e.message);
    throw new Error('Invalid FIREBASE_SERVICE_ACCOUNT JSON - ' + e.message);
  }
}

module.exports = { admin, getDb };
