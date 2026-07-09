// ============================================================================
// uploadService.ts
// ----------------------------------------------------------------------------
// The ONE and ONLY module that talks to blob storage.
//
// The UI never uploads anything itself. It calls uploadArtwork(imageBlob) and
// receives { url } — a real, public HTTPS URL. QR generation, the reveal
// screen, generation and the gallery all stay independent of this file.
//
// PRODUCTION FLOW (Vercel):
//   artwork PNG -> uploadArtwork(blob) -> POST /api/upload
//     -> api/upload.js runs @vercel/blob put() -> returns { url }
//     -> QR code is generated from that url -> phone scans -> opens artwork.
//
// No fake uploads. Never returns a placeholder URL. Until Vercel Blob is
// enabled and /api/upload is deployed, uploadArtwork() rejects and the UI
// shows its graceful retry state.
// ============================================================================

// Upload route. On Vercel this resolves to /api/upload (see api/upload.js).
const UPLOAD_ENDPOINT: string =
  (typeof window !== 'undefined' && window.__UPLOAD_ENDPOINT__) ||
  (import.meta.env.VITE_UPLOAD_ENDPOINT as string) ||
  '/api/upload';

/**
 * Upload the finished masterpiece and return its PUBLIC url.
 * Resolves ONLY with a real public https URL; throws otherwise (caller shows retry).
 *
 * ▶ VERCEL BLOB INTEGRATION POINT
 * POSTs the raw PNG bytes to UPLOAD_ENDPOINT; api/upload.js runs @vercel/blob
 * put() and returns { url }. Nothing here changes to go live.
 */
export async function uploadArtwork(imageBlob: Blob): Promise<{ url: string }> {
  if (!(imageBlob instanceof Blob)) {
    throw new Error('uploadArtwork expects a PNG Blob');
  }
  const res = await fetch(UPLOAD_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png' },
    body: imageBlob,
  });
  if (!res.ok) {
    throw new Error('Artwork upload failed with status ' + res.status);
  }
  const data = await res.json().catch(() => null);
  if (!data || typeof data.url !== 'string' || !/^https:\/\//i.test(data.url)) {
    throw new Error('Upload endpoint did not return a valid public https URL');
  }
  return { url: data.url };
}

/** Turn a canvas toDataURL('image/png') string into a PNG Blob. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = String(dataUrl).split(',');
  const mime = (meta.match(/:(.*?);/) || [])[1] || 'image/png';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
