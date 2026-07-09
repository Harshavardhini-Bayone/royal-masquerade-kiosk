// ============================================================================
// api/upload.js  —  Vercel Serverless Function (Node runtime)
// ----------------------------------------------------------------------------
// Receives a raw PNG (POST body, Content-Type: image/png), stores it in
// Vercel Blob, and returns its public URL as JSON: { url }.
// The server side of uploadService.ts's uploadArtwork(). The ONLY place that
// touches Vercel Blob.
//
// DEPLOYMENT (GitHub -> Vercel):
//   1. Import the repo into Vercel.
//   2. Storage -> create a Blob store (injects BLOB_READ_WRITE_TOKEN).
//   3. Redeploy. No front-end changes required.
// ============================================================================
import { put } from '@vercel/blob';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    // Read the raw PNG bytes (Vercel may pre-buffer non-JSON bodies).
    let buffer;
    if (Buffer.isBuffer(req.body)) {
      buffer = req.body;
    } else {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      buffer = Buffer.concat(chunks);
    }
    if (!buffer || !buffer.length) {
      res.status(400).json({ error: 'Empty upload body' });
      return;
    }

    // ▶ VERCEL BLOB WRITE — the single server-side integration point.
    const filename =
      'royal-masquerade/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.png';
    const blob = await put(filename, buffer, {
      access: 'public',
      contentType: 'image/png',
    });

    res.status(200).json({ url: blob.url });
  } catch (err) {
    res.status(500).json({ error: 'Upload failed', detail: String((err && err.message) || err) });
  }
}
