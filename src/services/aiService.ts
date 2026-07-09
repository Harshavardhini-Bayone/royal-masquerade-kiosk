// ============================================================================
// aiService.ts
// ----------------------------------------------------------------------------
// The SOLE boundary to image generation. The app calls generateMasterpiece()
// and receives a PNG data URL — the reveal screen, gallery, upload and QR all
// stay independent of how the image is produced.
//
// This uses REAL Google Gemini image generation. The participant's scribble PNG
// is sent to the Gemini image model with the Royal Masquerade prompt, and the
// returned image is handed back as a PNG data URL (exactly the shape the rest of
// the app already consumes). No procedural fallback.
// ============================================================================

// Gemini image-generation model + REST endpoint (Generative Language API).
const GEMINI_MODEL = 'gemini-2.5-flash-image-preview';
const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// The Royal Masquerade art-direction prompt. Instructs Gemini to reinterpret the
// rough scribble as an ornate royal/masquerade fine-art oil painting while keeping
// the scribble's composition — and to avoid photographic/landscape/nature output.
const ROYAL_PROMPT = [
  'You are the court painter for a royal masquerade ball.',
  'Transform the provided rough scribble into a single opulent, museum-quality OIL PAINTING',
  'in the style of an ornate Baroque royal portrait for a black-and-gold masquerade.',
  'Preserve the rough composition, gesture and layout of the scribble, reinterpreting its lines',
  'as the subject of the painting.',
  'Dramatic chiaroscuro candlelight, deep velvet background (burgundy, emerald, navy, plum or bronze),',
  'gilded gold accents, rich brushwork, a dark vignette, and a gilded fine-art atmosphere.',
  'Portrait orientation, tall composition. Elegant, regal, mysterious, luxurious.',
  'Do NOT produce a photograph, a landscape, a nature scene, plain text, a logo, or a flat digital drawing.',
  'Output only the finished painting image.',
].join(' ');

/**
 * Generate the royal masterpiece from the guest's scribble via Google Gemini.
 * @param scribbleCanvas the atelier drawing canvas
 * @returns a PNG (or image) data URL of the AI-generated artwork
 * @throws on missing key / network / non-2xx / no image in the response
 *         (the app's existing generating-screen error + retry handles this).
 */
export async function generateMasterpiece(scribbleCanvas: HTMLCanvasElement): Promise<string> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
  if (!apiKey) {
    throw new Error('Missing VITE_GEMINI_API_KEY');
  }

  // Capture the scribble as base64 PNG (strip the data-URL prefix for the API).
  const scribbleBase64 = scribbleCanvas.toDataURL('image/png').split(',')[1];

  const res = await fetch(`${GEMINI_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { text: ROYAL_PROMPT },
            { inline_data: { mime_type: 'image/png', data: scribbleBase64 } },
          ],
        },
      ],
      generationConfig: { responseModalities: ['IMAGE'] },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Gemini request failed: ${res.status} ${detail}`);
  }

  const json = await res.json();

  // Find the first image part in the response (supports both camelCase and snake_case).
  const parts = json?.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    const inline = part?.inlineData ?? part?.inline_data;
    if (inline?.data) {
      const mime = inline.mimeType ?? inline.mime_type ?? 'image/png';
      return `data:${mime};base64,${inline.data}`;
    }
  }

  throw new Error('Gemini response contained no image');
}
