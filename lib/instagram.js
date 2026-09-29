
// lib/instagram.js - Instagram posting helper for carousel and reels

const axios = require('axios');

const IG_USER_ID = process.env.IG_USER_ID;
const IG_ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN;

async function createImageContainer(imageUrl, isCarouselItem = false) {
  const params = {
    image_url: imageUrl,
    access_token: IG_ACCESS_TOKEN
  };
  if (isCarouselItem) params.is_carousel_item = true;
  
  const res = await axios.post(`https://graph.facebook.com/v20.0/${IG_USER_ID}/media`, null, { params });
  return res.data.id;
}

async function createCarouselContainer(childrenIds, caption) {
  const res = await axios.post(`https://graph.facebook.com/v20.0/${IG_USER_ID}/media`, null, {
    params: {
      media_type: 'CAROUSEL',
      children: childrenIds.join(','),
      caption: caption,
      access_token: IG_ACCESS_TOKEN
    }
  });
  return res.data.id;
}

async function createReelContainer(videoUrl, caption) {
  const res = await axios.post(`https://graph.facebook.com/v20.0/${IG_USER_ID}/media`, null, {
    params: {
      media_type: 'REELS',
      video_url: videoUrl,
      caption: caption,
      access_token: IG_ACCESS_TOKEN
    }
  });
  return res.data.id;
}

async function checkMediaStatus(creationId, maxAttempts = 12) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 5000));
    try {
      const res = await axios.get(`https://graph.facebook.com/v20.0/${creationId}`, {
        params: { fields: 'status_code', access_token: IG_ACCESS_TOKEN }
      });
      console.log(`[IG] Status check ${i}: ${res.data.status_code}`);
      if (res.data.status_code === 'FINISHED') return true;
      if (res.data.status_code === 'ERROR') throw new Error('Media processing failed');
    } catch (e) {
      console.log(`[IG] Status check error: ${e.message}`);
    }
  }
  return false; // timeout but try publish anyway
}

async function publishMedia(creationId) {
  const res = await axios.post(`https://graph.facebook.com/v20.0/${IG_USER_ID}/media_publish`, null, {
    params: { creation_id: creationId, access_token: IG_ACCESS_TOKEN }
  });
  return res.data.id;
}

async function postCarouselToInstagram(imageUrls, caption) {
  if (!IG_USER_ID || !IG_ACCESS_TOKEN) throw new Error('IG_USER_ID / IG_ACCESS_TOKEN missing');
  
  const containerIds = [];
  for (let i = 0; i < imageUrls.length; i++) {
    const url = imageUrls[i];
    console.log(`[IG] Creating container ${i+1}/${imageUrls.length}: ${url.substring(0,100)}`);
    const id = await createImageContainer(url, imageUrls.length > 1);
    containerIds.push(id);
    await new Promise(r => setTimeout(r, 1500));
  }

  let creationId;
  if (imageUrls.length > 1) {
    creationId = await createCarouselContainer(containerIds, caption);
  } else {
    creationId = containerIds[0];
    // For single image, add caption via update
    await axios.post(`https://graph.facebook.com/v20.0/${creationId}`, null, {
      params: { caption, access_token: IG_ACCESS_TOKEN }
    });
  }

  await new Promise(r => setTimeout(r, 3000));
  const publishId = await publishMedia(creationId);
  return publishId;
}

async function postReelToInstagram(videoUrl, caption) {
  if (!IG_USER_ID || !IG_ACCESS_TOKEN) throw new Error('IG_USER_ID / IG_ACCESS_TOKEN missing');
  
  console.log(`[IG] Creating reel container: ${videoUrl.substring(0,100)}`);
  const creationId = await createReelContainer(videoUrl, caption);
  console.log(`[IG] Reel container: ${creationId}`);
  
  await checkMediaStatus(creationId);
  
  const publishId = await publishMedia(creationId);
  return publishId;
}

module.exports = { postCarouselToInstagram, postReelToInstagram };
