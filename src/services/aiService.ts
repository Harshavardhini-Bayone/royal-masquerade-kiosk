// ============================================================================
// aiService.ts
// ----------------------------------------------------------------------------
// The SOLE boundary to image generation. The app calls generateMasterpiece()
// and receives a PNG data URL. Everything else (reveal, gallery, upload, QR)
// is independent of how the image is produced.
//
// Current behaviour is the frozen source of truth: a procedural royal
// oil-painting transform of the guest's scribble. It is intentionally kept
// exactly as-is.
//
// ▶ GEMINI INTEGRATION POINT
// To swap in Google Gemini image generation later, replace the body below with
// a call to the Gemini image model (reading import.meta.env.VITE_GEMINI_API_KEY),
// sending the scribble PNG + an ornate-royal-portrait prompt, and returning the
// resulting image as a data/URL string. No other file needs to change.
// ============================================================================

const PALETTES = [
  { name:'burgundy', a:'#5a1420', b:'#2a0d12', hi:'#e6c463' },
  { name:'emerald',  a:'#0f4033', b:'#08201a', hi:'#e6c463' },
  { name:'navy',     a:'#1b2f66', b:'#0a1330', hi:'#f2e6c8' },
  { name:'plum',     a:'#4a1e55', b:'#26102e', hi:'#e6c463' },
  { name:'bronze',   a:'#5a3312', b:'#2b1608', hi:'#fbe6a8' },
];

export async function generateMasterpiece(scribbleCanvas: HTMLCanvasElement): Promise<string> {
    // simulate latency + occasional failure could be added; here always succeeds
    await new Promise(r=>setTimeout(r,400));
    const pal = PALETTES[Math.floor(Math.random()*PALETTES.length)];
    const W=1140,H=1560; const c=document.createElement('canvas'); c.width=W; c.height=H; const x=c.getContext('2d');
    // base gradient
    const g=x.createRadialGradient(W*0.5,H*0.42,120, W*0.5,H*0.5,H*0.75);
    g.addColorStop(0,pal.a); g.addColorStop(1,pal.b); x.fillStyle=g; x.fillRect(0,0,W,H);
    // painterly noise
    for(let i=0;i<2600;i++){ const rx=Math.random()*W, ry=Math.random()*H, rr=Math.random()*26+4; x.globalAlpha=Math.random()*0.06; x.fillStyle=Math.random()<0.5?'#000':pal.hi; x.beginPath(); x.arc(rx,ry,rr,0,7); x.fill(); }
    x.globalAlpha=1;
    // draw the scribble as luminous gold, blurred + sharp layers
    x.save(); x.filter='blur(7px)'; x.globalAlpha=0.55; x.globalCompositeOperation='lighter';
    x.drawImage(scribbleCanvas,0,0,W,H); x.restore();
    x.save(); x.globalCompositeOperation='lighter'; x.globalAlpha=0.9; x.drawImage(scribbleCanvas,0,0,W,H); x.restore();
    // gold tint pass over strokes
    x.save(); x.globalCompositeOperation='overlay'; x.globalAlpha=0.4; x.fillStyle=pal.hi; x.fillRect(0,0,W,H); x.restore();
    // vignette
    const v=x.createRadialGradient(W*0.5,H*0.44,H*0.28, W*0.5,H*0.5,H*0.72);
    v.addColorStop(0,'rgba(0,0,0,0)'); v.addColorStop(1,'rgba(0,0,0,0.82)'); x.fillStyle=v; x.fillRect(0,0,W,H);
    // top light wash
    const lw=x.createLinearGradient(0,0,0,H); lw.addColorStop(0,'rgba(255,240,200,0.12)'); lw.addColorStop(0.4,'rgba(0,0,0,0)'); x.fillStyle=lw; x.fillRect(0,0,W,H);
    return c.toDataURL('image/png');
  }
