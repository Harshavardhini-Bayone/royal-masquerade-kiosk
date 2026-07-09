# Royal Masquerade — Scribble to Masterpiece

Production Vite + React + TypeScript build of the Royal Masquerade kiosk. A guest
enters a name, draws a scribble, and the artwork is transformed into an ornate
"royal" masterpiece with a prestige title and Crown valuation, then submitted to a
live communal gallery. Runs full-screen on a 1920×1080 touchscreen kiosk.

## Requirements
- Node.js 18+

## Getting started
```bash
npm install
npm run dev      # local dev server
npm run build    # production build -> dist/
npm run preview  # preview the production build
```

## Project structure
```
index.html                # Vite entry (Google Fonts: Cormorant Garamond + Jost)
vite.config.ts
tsconfig.json
vercel.json
api/
  upload.js               # Vercel serverless — @vercel/blob (blob storage)
public/
src/
  main.tsx                # React entry
  App.tsx                 # full kiosk state machine + screens (frozen UI/behaviour)
  index.css               # global resets + all keyframes
  services/
    aiService.ts          # image generation boundary (GEMINI INTEGRATION POINT)
    uploadService.ts      # the only module that talks to blob storage
  vite-env.d.ts
```

## Deploy to Vercel
1. Push to GitHub and import the repo into Vercel (framework auto-detected: Vite).
2. **Storage → create a Blob store** — injects `BLOB_READ_WRITE_TOKEN` automatically.
3. Redeploy.

That is all that is required for the QR download flow to go live — no UI changes.

## Upload / QR flow
Artwork PNG → `uploadArtwork(blob)` (`src/services/uploadService.ts`) → `POST /api/upload`
→ `@vercel/blob put()` → `{ url }` → QR generated from the real URL → phone scans → opens
the artwork. Until Blob is enabled the QR popup shows a graceful retry; it never renders a
placeholder QR.

## Image generation
`src/services/aiService.ts` is the single generation boundary. It currently produces the
frozen procedural royal-painting transform; swap in Google Gemini at the marked
`GEMINI INTEGRATION POINT` (reads `VITE_GEMINI_API_KEY`) without touching any UI.

## Environment variables
See `.env.example`. All optional for local dev; Blob storage is configured in the Vercel
dashboard rather than via a local key.
