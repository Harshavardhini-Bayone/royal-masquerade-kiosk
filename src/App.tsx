// ============================================================================
// App.tsx — Royal Masquerade Kiosk (frozen design & behaviour, ported verbatim)
// The full single-page state machine: home -> name -> atelier -> generating ->
// reveal -> qr -> submitting -> gallery. UI, layout, spacing, typography,
// colours, animations and flow are the source of truth and unchanged.
// Independent modules: aiService (generation), uploadService (Vercel Blob),
// QRious (QR generation).
// ============================================================================
import React from 'react';
import QRious from 'qrious';
import * as uploadSvc from './services/uploadService';
import { generateMasterpiece } from './services/aiService';

const h = React.createElement;

const TITLE_ADJ = ['The Gilded','The Veiled','The Crimson','The Eternal','The Whispering','The Radiant','The Sovereign','The Midnight','The Opulent','The Forgotten','The Ascendant','The Velvet','The Luminous','The Regal','The Silent','The Immortal','The Enchanted','The Resplendent','The Golden','The Nocturne'];
const TITLE_NOUN = ['Masquerade','Sovereign','Reverie','Coronation','Nocturne','Confidante','Duchess',' Balustrade','Aria','Ascension','Requiem','Courtier','Serenade','Effigy','Pavane','Rhapsody','Vesper','Oracle','Baroness','Procession'];
const STORY = [
  'The Royal Court studies your creation…',
  'The palace artists breathe life into every stroke…',
  'A masterpiece worthy of the masquerade emerges…',
  'The Royal Court bestows its title…',
  'Its royal worth is proclaimed…',
];

class App extends React.Component {
  constructor(props){
    super(props);
    this.state = {
      screen:'home', nameModalOpen:false, nameInput:'', creatorName:'',
      gallery:[], displayVals:{}, tool:'brush', brushColor:'#d4af37', brushSize:9,
      pending:null, genError:false, shareOpen:false, qrState:'idle',
      toast:'', storyIdx:0, sw:window.innerWidth, sh:window.innerHeight,
    };
    // non-reactive instance state
    this.usedTitles = new Set();
    this.lastEndorsedId = null;
    this.streak = 0;
    this.audioCtx = null;
    this.timers = {};
    this.history = []; this.histIdx = -1; this.hasStroke=false;
    this.drawing=false; this.lastPt=null; this.lastBlip=0;
    // live drawing config — mirrored synchronously so the canvas DOM handlers never read stale state
    this._tool='brush'; this._color='#d4af37'; this._size=9;
    this.busy = false; // guards rapid transitions
    this.storyTimer=null; this.genToken=0;
    this.shareUrlCache = {};
  }

  componentDidMount(){
    this._onResize = ()=> this.setState({sw:window.innerWidth, sh:window.innerHeight});
    window.addEventListener('resize', this._onResize);
    this._onActivity = ()=> this.resetIdle();
    window.addEventListener('pointerdown', this._onActivity, true);
    window.addEventListener('pointermove', this._onActivity, true);
  }
  componentWillUnmount(){
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('pointerdown', this._onActivity, true);
    window.removeEventListener('pointermove', this._onActivity, true);
    Object.values(this.timers).forEach(t=>clearTimeout(t));
    if(this.storyTimer) clearInterval(this.storyTimer);
  }

  // ---------------- AUDIO ----------------
  ac(){
    if(!this.audioCtx){ try{ this.audioCtx = new (window.AudioContext||window.webkitAudioContext)(); }catch(e){ return null; } }
    if(this.audioCtx.state==='suspended') this.audioCtx.resume();
    return this.audioCtx;
  }
  tone(freq, dur, type='triangle', when=0, vol=0.18){
    const ac=this.ac(); if(!ac) return;
    const t0=ac.currentTime+when;
    const o=ac.createOscillator(), g=ac.createGain();
    o.type=type; o.frequency.value=freq;
    g.gain.setValueAtTime(0.0001,t0);
    g.gain.exponentialRampToValueAtTime(vol,t0+0.012);
    g.gain.exponentialRampToValueAtTime(0.0001,t0+dur);
    o.connect(g).connect(ac.destination); o.start(t0); o.stop(t0+dur+0.02);
  }
  sfx(kind){
    switch(kind){
      case 'click': this.tone(880,0.12,'triangle',0,0.14); break;
      case 'generate': [523,659,784,1047].forEach((f,i)=>this.tone(f,0.3,'sine',i*0.12,0.16)); break;
      case 'reveal': [523,659,784,988,1319].forEach((f,i)=>this.tone(f,0.34,'triangle',i*0.09,0.16)); break;
      case 'submit': [659,784,988,1319].forEach((f,i)=>this.tone(f,0.3,'sine',i*0.1,0.16)); break;
      case 'endorse': this.tone(988,0.22,'triangle',0,0.15); this.tone(1319,0.26,'sine',0.02,0.1); break;
      case 'stroke': { const now=performance.now(); if(now-this.lastBlip<55) return; this.lastBlip=now; this.tone(520+Math.random()*260,0.05,'sine',0,0.04); } break;
    }
  }

  // ---------------- IDLE TIMERS ----------------
  resetIdle(){
    Object.values(this.timers).forEach(t=>clearTimeout(t)); this.timers={};
    const s=this.state;
    if(s.shareOpen){ this.timers.idle=setTimeout(()=>this.goHome(), 30000); }
    else if(s.screen==='reveal'){ this.timers.idle=setTimeout(()=>this.goHome(), 60000); }
    else if(s.screen==='gallery'){ this.timers.idle=setTimeout(()=>this.goHome(), 10000); }
  }

  goHome(){
    this.setState({ screen:'home', nameModalOpen:false, nameInput:'', shareOpen:false, qrState:'idle', genError:false, toast:'' });
    setTimeout(()=>this.resetIdle(),50);
  }

  // ---------------- SERVICES ----------------
  makeTitle(){
    for(let i=0;i<400;i++){
      const t = TITLE_ADJ[Math.floor(Math.random()*TITLE_ADJ.length)].trim()+' '+TITLE_NOUN[Math.floor(Math.random()*TITLE_NOUN.length)].trim();
      if(!this.usedTitles.has(t)){ this.usedTitles.add(t); return t; }
    }
    // fallback roman suffix
    let base = TITLE_ADJ[0].trim()+' '+TITLE_NOUN[0].trim(); let n=2, t;
    do { t = base+' '+this.roman(n++); } while(this.usedTitles.has(t));
    this.usedTitles.add(t); return t;
  }
  roman(n){ const m=[[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']]; let r=''; for(const [v,s] of m){ while(n>=v){ r+=s; n-=v; } } return r; }
  makeValuation(){ return Math.floor(650000 + Math.random()*23500000); }
  // Prestige valuation format — compact K/M/B, never long comma-separated numbers (e.g. 120K, 8M, 12M)
  crowns(n){ n=Math.round(n);
    const f=(v,suf)=>{ let s=v.toFixed(1); if(s.endsWith('.0')) s=s.slice(0,-2); return s+suf; };
    if(n>=1e9) return f(n/1e9,'B');
    if(n>=1e6) return f(n/1e6,'M');
    if(n>=1e3) return f(n/1e3,'K');
    return String(n);
  }

  // ---------------- CANVAS DRAWING ----------------
  initCanvas(el){
    if(!el || el===this._canvasEl) return;
    this._canvasEl = el;
    el.width=1140; el.height=1560;
    const ctx = el.getContext('2d');
    this._ctx = ctx;
    ctx.fillStyle='#0c0a07'; ctx.fillRect(0,0,el.width,el.height);
    ctx.lineCap='round'; ctx.lineJoin='round';
    this.history=[]; this.histIdx=-1; this.hasStroke=false;
    this.snapshot();
    const pos = (e)=>{ const r=el.getBoundingClientRect(); return { x:(e.clientX-r.left)*(el.width/r.width), y:(e.clientY-r.top)*(el.height/r.height) }; };
    const cfg = ()=>{
      // read the synchronous mirrors, not this.state, so tool/ink/size are always current at draw time
      const tool=this._tool, brushColor=this._color, brushSize=this._size;
      ctx.globalCompositeOperation='source-over'; ctx.shadowBlur=0; ctx.shadowColor='transparent';
      if(tool==='eraser'){ ctx.globalCompositeOperation='destination-out'; ctx.globalAlpha=1; ctx.strokeStyle='rgba(0,0,0,1)'; ctx.lineWidth=brushSize*2.4; }
      else if(tool==='pencil'){ ctx.globalAlpha=0.92; ctx.strokeStyle=brushColor; ctx.lineWidth=Math.max(2,brushSize*0.45); }
      else if(tool==='marker'){ ctx.globalAlpha=0.42; ctx.strokeStyle=brushColor; ctx.lineWidth=brushSize*1.9; }
      else { ctx.globalAlpha=0.96; ctx.strokeStyle=brushColor; ctx.lineWidth=brushSize; ctx.shadowBlur=brushSize*0.8; ctx.shadowColor=brushColor; }
    };
    const down=(e)=>{ el.setPointerCapture(e.pointerId); this.drawing=true; this.lastPt=pos(e); cfg(); ctx.beginPath(); ctx.moveTo(this.lastPt.x,this.lastPt.y); ctx.lineTo(this.lastPt.x+0.1,this.lastPt.y+0.1); ctx.stroke(); this.hasStroke=true; e.preventDefault(); };
    const move=(e)=>{ if(!this.drawing) return; const p=pos(e); ctx.beginPath(); ctx.moveTo(this.lastPt.x,this.lastPt.y); ctx.lineTo(p.x,p.y); ctx.stroke(); this.lastPt=p; this.sfx('stroke'); e.preventDefault(); };
    const up=(e)=>{ if(!this.drawing) return; this.drawing=false; this.snapshot(); try{el.releasePointerCapture(e.pointerId);}catch(_){} };
    el.addEventListener('pointerdown',down);
    el.addEventListener('pointermove',move);
    el.addEventListener('pointerup',up);
    el.addEventListener('pointerleave',up);
    el.addEventListener('pointercancel',up);
  }
  snapshot(){
    if(!this._ctx) return;
    const img=this._ctx.getImageData(0,0,1140,1560);
    this.history=this.history.slice(0,this.histIdx+1);
    this.history.push(img); if(this.history.length>25) this.history.shift();
    this.histIdx=this.history.length-1;
  }
  undo(){ this.sfx('click'); if(this.histIdx>0){ this.histIdx--; this._ctx.putImageData(this.history[this.histIdx],0,0);} }
  redo(){ this.sfx('click'); if(this.histIdx<this.history.length-1){ this.histIdx++; this._ctx.putImageData(this.history[this.histIdx],0,0);} }
  clearCanvas(){ this.sfx('click'); if(!this._ctx) return; this._ctx.globalCompositeOperation='source-over'; this._ctx.globalAlpha=1; this._ctx.fillStyle='#0c0a07'; this._ctx.fillRect(0,0,1140,1560); this.hasStroke=false; this.snapshot(); }

  // ---------------- AI (simulated procedural transform) ----------------
  // Sole boundary — swap this for a real Gemini call returning a data/URL string.
  async generateMasterpiece(scribbleCanvas){ return generateMasterpiece(scribbleCanvas); }

  async startGenerate(){
    if(this.busy) return; this.busy=true;
    const scribble=this._canvasEl;
    this.setState({ screen:'generating', genError:false, storyIdx:0 });
    this.sfx('generate');
    this.storyTimer && clearInterval(this.storyTimer);
    this.storyTimer=setInterval(()=>{ this.setState(s=>({storyIdx:(s.storyIdx+1)%STORY.length})); }, 950);
    const token=++this.genToken;
    const minWait=new Promise(r=>setTimeout(r,5200));
    try{
      const [imageUrl] = await Promise.all([ this.generateMasterpiece(scribble), minWait ]);
      if(token!==this.genToken) { this.busy=false; return; }
      const art={ id:'a'+Date.now()+Math.floor(Math.random()*999), title:this.makeTitle(), valuation:this.makeValuation(), creator:this.state.creatorName, imageUrl };
      this.storyTimer && clearInterval(this.storyTimer);
      this.setState({ pending:art, screen:'reveal' });
      this.sfx('reveal');
      this.busy=false;
      setTimeout(()=>this.resetIdle(),80);
    }catch(err){
      this.storyTimer && clearInterval(this.storyTimer);
      this.setState({ genError:true }); this.busy=false;
    }
  }

  // ---------------- ENDORSE ----------------
  endorse(id){
    if(this.busy) return;
    // streak cap: 5 consecutive on same painting
    if(this.lastEndorsedId===id){
      if(this.streak>=5){ this.showToast('This masterpiece must rest — endorse another first.'); return; }
      this.streak++;
    } else { this.lastEndorsedId=id; this.streak=1; }
    this.sfx('endorse');
    const art=this.state.gallery.find(a=>a.id===id); if(!art) return;
    const bump=Math.max(1200, Math.round(art.valuation*(0.04+Math.random()*0.06)));
    const from=art.valuation, to=art.valuation+bump;
    // commit new valuation + re-sort
    const gallery=this.state.gallery.map(a=>a.id===id?{...a,valuation:to}:a).sort((p,q)=>q.valuation-p.valuation);
    this.setState({ gallery });
    // animated count-up on displayVals
    const t0=performance.now(), dur=800;
    const step=(now)=>{ const k=Math.min(1,(now-t0)/dur); const e=1-Math.pow(1-k,3); const val=Math.round(from+(to-from)*e);
      this.setState(s=>({displayVals:{...s.displayVals,[id]:val}}));
      if(k<1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    // trigger shimmer via key bump
    this._shimmer=this._shimmer||{}; this._shimmer[id]=(this._shimmer[id]||0)+1; this.forceUpdate();
  }
  dv(art){ const d=this.state.displayVals[art.id]; return d!=null?d:art.valuation; }
  showToast(msg){ this.setState({toast:msg}); this.timers.toast&&clearTimeout(this.timers.toast); this.timers.toast=setTimeout(()=>this.setState({toast:''}),2600); }

  // ---------------- SUBMIT ----------------
  submitToGallery(){
    if(this.busy) return; this.busy=true;
    this.setState({ screen:'submitting', shareOpen:false });
    this.sfx('submit');
    setTimeout(()=>{
      const art=this.state.pending; if(!art){ this.busy=false; return; }
      const gallery=[...this.state.gallery, {id:art.id,title:art.title,valuation:art.valuation,creator:art.creator,imageUrl:art.imageUrl}].sort((p,q)=>q.valuation-p.valuation);
      this._newCardId=art.id;
      this.setState({ gallery, screen:'gallery' });
      this.busy=false;
      setTimeout(()=>{ this._newCardId=null; this.forceUpdate(); },1700);
      setTimeout(()=>this.resetIdle(),80);
    }, 3400);
  }

  // ---------------- QR ----------------
  openShare(){
    this.sfx('click');
    const art=this.state.pending; if(!art) return;
    this.setState({ shareOpen:true });
    setTimeout(()=>this.resetIdle(),50);
    // Reuse a URL already obtained for THIS artwork (no re-upload on reopen).
    if(this.shareUrlCache[art.id]){ this.setState({qrState:'ready'}); setTimeout(()=>this.renderQR(this.shareUrlCache[art.id]),60); return; }
    this.uploadAndShare(art);
  }
  // Lazily load the isolated upload module (all blob logic lives there, never here).
  _uploadService(){
    if(!this._uploadSvcPromise) this._uploadSvcPromise = Promise.resolve(uploadSvc);
    return this._uploadSvcPromise;
  }
  // Upload the finished PNG, then generate the QR from the REAL returned URL.
  // The QR popup never shows a code until uploadArtwork() resolves successfully;
  // on failure we surface the graceful retry state — never a placeholder QR.
  async uploadAndShare(art){
    this.setState({ qrState:'loading' });
    try{
      const svc = await this._uploadService();
      const pngBlob = svc.dataUrlToBlob(art.imageUrl);   // canvas export -> PNG Blob
      const { url } = await svc.uploadArtwork(pngBlob);  // -> public Vercel Blob URL
      if(!this.state.shareOpen) return;                  // modal closed while uploading
      this.shareUrlCache[art.id] = url;
      this.setState({ qrState:'ready' });
      setTimeout(()=>this.renderQR(url), 60);
    }catch(err){
      // Until Vercel Blob is enabled + /api/upload is deployed, this path runs.
      if(this.state.shareOpen) this.setState({ qrState:'error' });
    }
  }
  renderQR(url){
    const el=this._qrEl; if(!el) return;
    el.innerHTML='';
    new QRious({ element:el, value:url, size:360, background:'#ffffff', foreground:'#0a0a0a', level:'M' });
  }
  closeShare(){ this.sfx('click'); this.setState({shareOpen:false, qrState:'idle'}); setTimeout(()=>this.resetIdle(),50); }

  // ---------------- NAME MODAL ----------------
  openName(){ this.sfx('click'); this.setState({ nameModalOpen:true, nameInput:'' }); }
  keyPress(ch){ this.sfx('click'); this.setState(s=>{ if(s.nameInput.length>=18) return {}; return {nameInput:(s.nameInput+ch).toUpperCase()}; }); }
  backspace(){ this.sfx('click'); this.setState(s=>({nameInput:s.nameInput.slice(0,-1)})); }
  confirmName(){ const n=this.state.nameInput.trim(); if(!n) return; this.sfx('generate'); this.setState({ creatorName:n, nameModalOpen:false, screen:'canvas' }); }

  nav(screen){ this.sfx('click'); this.setState({screen}); setTimeout(()=>this.resetIdle(),60); }

  // ================= RENDER HELPERS =================
  goldTextStyle(size, extra){ return Object.assign({ fontFamily:"'Cormorant Garamond',serif", fontSize:size, backgroundImage:'linear-gradient(180deg,#fbe6a8 0%,#e7c65a 42%,#c99a2e 100%)', WebkitBackgroundClip:'text', backgroundClip:'text', color:'transparent', lineHeight:1.02 }, extra||{}); }
  label(text, extra){ return h('div',{style:Object.assign({fontFamily:"'Jost',sans-serif",fontSize:12,letterSpacing:'0.4em',textTransform:'uppercase',color:'#8a7742',fontWeight:500},extra||{})}, text); }
  dot(){ return h('span',{style:{display:'inline-block',width:7,height:7,borderRadius:'50%',background:'#e7c65a',boxShadow:'0 0 10px rgba(231,198,90,0.9)',animation:'rm-dot 2.4s ease-in-out infinite'}}); }
  crown(size,color){ color=color||'#e7c65a'; return h('svg',{width:size,height:size,viewBox:'0 0 24 24',fill:'none',stroke:color,strokeWidth:1.4,strokeLinecap:'round',strokeLinejoin:'round',style:{filter:'drop-shadow(0 0 6px rgba(231,198,90,0.5))'}}, h('path',{d:'M3 8l3.5 3L12 5l5.5 6L21 8l-1.6 10H4.6L3 8z'}), h('circle',{cx:3,cy:8,r:1.1,fill:color}), h('circle',{cx:12,cy:5,r:1.1,fill:color}), h('circle',{cx:21,cy:8,r:1.1,fill:color})); }

  goldBtn(labelText, opts){ opts=opts||{}; const dis=opts.disabled;
    return h('button',{ onClick:dis?null:opts.onClick, disabled:dis,
      style:{ fontFamily:"'Jost',sans-serif", fontWeight:600, letterSpacing:opts.ls||'0.16em', textTransform:'uppercase', fontSize:opts.fontSize||(opts.small?14:16), color:'#241906', whiteSpace:'nowrap',
        background:'linear-gradient(180deg,#f0d878 0%,#dbb64a 48%,#c39a28 100%)', border:'none', borderRadius:6, cursor:dis?'default':'pointer',
        padding:opts.small?'18px 36px':'28px 54px', height:opts.height||(opts.small?64:94), width:opts.full?'100%':'auto',
        display:'inline-flex', alignItems:'center', justifyContent:'center', gap:12, opacity:dis?0.4:1,
        animation:dis||opts.noBreathe?'none':'rm-breathe 3.6s ease-in-out infinite', transition:'transform .25s ease' },
      onMouseEnter:e=>{ if(!dis){ e.currentTarget.style.transform='translateY(-3px) scale(1.02)'; } },
      onMouseLeave:e=>{ e.currentTarget.style.transform=''; },
    }, opts.icon, labelText);
  }
  outlineBtn(labelText, opts){ opts=opts||{};
    return h('button',{ onClick:opts.onClick,
      style:{ fontFamily:"'Jost',sans-serif", fontWeight:500, letterSpacing:'0.18em', textTransform:'uppercase', fontSize:opts.small?12:14, color:'#c9b783',
        background:'rgba(212,175,55,0.04)', border:'1px solid rgba(212,175,55,0.4)', borderRadius:6, cursor:'pointer',
        padding:opts.small?'15px 26px':'22px 36px', width:opts.full?'100%':'auto', height:opts.height||(opts.small?52:66), whiteSpace:'nowrap',
        display:'inline-flex', alignItems:'center', justifyContent:'center', gap:10, transition:'all .25s ease' },
      onMouseEnter:e=>{ e.currentTarget.style.background='rgba(212,175,55,0.12)'; e.currentTarget.style.borderColor='rgba(231,198,90,0.8)'; e.currentTarget.style.color='#f2e0a6'; e.currentTarget.style.boxShadow='0 0 24px rgba(201,154,39,0.3)'; },
      onMouseLeave:e=>{ e.currentTarget.style.background='rgba(212,175,55,0.04)'; e.currentTarget.style.borderColor='rgba(212,175,55,0.4)'; e.currentTarget.style.color='#c9b783'; e.currentTarget.style.boxShadow='none'; },
    }, opts.icon, labelText);
  }
  navLink(text, onClick){
    return h('button',{ onClick,
      style:{ fontFamily:"'Jost',sans-serif", fontWeight:500, letterSpacing:'0.16em', textTransform:'uppercase', fontSize:12, color:'#a89463',
        background:'transparent', border:'none', cursor:'pointer', padding:'16px 24px', borderRadius:8, display:'inline-flex', alignItems:'center', gap:9, transition:'all .25s ease' },
      onMouseEnter:e=>{ e.currentTarget.style.color='#f2e0a6'; e.currentTarget.style.background='rgba(212,175,55,0.08)'; e.currentTarget.style.transform='translateX(4px)'; e.currentTarget.firstChild.style.transform='translateX(-4px)'; },
      onMouseLeave:e=>{ e.currentTarget.style.color='#a89463'; e.currentTarget.style.background='transparent'; e.currentTarget.style.transform=''; e.currentTarget.firstChild.style.transform=''; },
    }, h('span',{style:{transition:'transform .25s ease',fontSize:15}},'←'), text);
  }
  frame(children, opts){ opts=opts||{};
    return h('div',{style:{position:'relative', padding:opts.pad||16, background:'linear-gradient(145deg,#3a2c12,#160f06)', border:'3px solid #e6c463', borderRadius:4,
      boxShadow:'0 44px 110px rgba(0,0,0,0.8), 0 0 0 1px rgba(0,0,0,0.6) inset', ...opts.style }},
      // corner diamonds
      ...[[6,6],[6,'r'],[ 'b',6],['b','r']].map((p,i)=> h('div',{key:i,style:{position:'absolute', width:12,height:12, color:'#f0d878', fontSize:12, lineHeight:'12px', textAlign:'center',
        top:p[0]==='b'?'auto':10, bottom:p[0]==='b'?10:'auto', left:p[1]==='r'?'auto':10, right:p[1]==='r'?10:'auto', textShadow:'0 0 8px rgba(240,216,120,0.8)' }},'◆')),
      children);
  }
  ambientGlow(){ return h('div',{style:{position:'absolute',inset:0,pointerEvents:'none',background:'radial-gradient(120% 90% at 70% 20%, #16100a 0%, #0b0805 55%, #060402 100%)'}}); }

  // ---- gallery card (reusable) ----
  card(art, opts){ opts=opts||{}; const shim=(this._shimmer&&this._shimmer[art.id])||0;
    const canEndorse = !(this.lastEndorsedId===art.id && this.streak>=5);
    return h('div',{ key:art.id+'_'+(opts.tag||''), style:{ position:'relative', overflow:'hidden', background:'#0c0a07', border:opts.highlight?'1px solid rgba(231,198,90,0.9)':'1px solid rgba(212,175,55,0.16)', borderRadius:6,
      boxShadow:opts.highlight?'0 0 34px rgba(219,182,74,0.45)':'0 18px 40px rgba(0,0,0,0.5)', transition:'box-shadow 1.2s ease, border-color 1.2s ease',
      animation:opts.settle?'rm-settle 1.2s cubic-bezier(.2,.7,.2,1) both':'none' }},
      h('div',{style:{position:'relative',width:'100%',height:opts.imgH||400,overflow:'hidden'}},
        h('img',{src:art.imageUrl,style:{width:'100%',height:'100%',objectFit:'cover',display:'block'}}),
        h('div',{key:'shim'+shim,style:{position:'absolute',top:0,left:0,width:'40%',height:'100%',background:'linear-gradient(90deg,transparent,rgba(255,240,200,0.5),transparent)',animation:shim?'rm-cardshim 1s linear':'none',pointerEvents:'none'}})
      ),
      h('div',{style:{padding:'20px 22px 22px'}},
        h('div',{style:this.goldTextStyle(opts.titleSize||26,{fontStyle:'italic',fontWeight:600,marginBottom:10,minHeight:34})}, art.title),
        h('div',{style:{display:'flex',alignItems:'baseline',gap:9,marginBottom:8}}, this.crown(22),
          h('span',{style:this.goldTextStyle(30,{fontWeight:700,fontFamily:"'Jost',sans-serif"})}, this.crowns(this.dv(art))),
          h('span',{style:{fontFamily:"'Jost',sans-serif",fontSize:11,letterSpacing:'0.28em',color:'#8a7742'}},'CROWNS')),
        h('div',{style:{fontFamily:"'Cormorant Garamond',serif",fontStyle:'italic',fontSize:17,color:'#c9b783',marginBottom:16}}, 'by ',h('span',{style:{color:'#e6d3a0'}},art.creator)),
        this.outlineBtn('Grant Royal Endorsement',{full:true, onClick:()=>this.endorse(art.id), icon:this.crown(15,canEndorse?'#c9b783':'#7a6b44')})
      )
    );
  }

  // ================= SCREENS =================
  renderHome(){
    const g=[...this.state.gallery].sort((p,q)=>q.valuation-p.valuation);
    const railLoop = g.length? Math.max(20, g.length*5) : 20;
    return h('div',{key:'home',style:{position:'absolute',inset:0,display:'flex',animation:'rm-fade .8s ease'}},
      this.ambientGlow(),
      // LEFT RAIL
      h('div',{style:{position:'relative',width:'34%',height:'100%',borderRight:'1px solid rgba(212,175,55,0.14)',display:'flex',flexDirection:'column',padding:'40px 34px 28px',background:'rgba(0,0,0,0.35)'}},
        h('div',{style:{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:24}},
          h('div',{style:{display:'flex',alignItems:'center',gap:12}}, this.dot(), this.label('The Royal Gallery · Live')),
          this.dot()),
        g.length===0
          ? h('div',{style:{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',textAlign:'center',gap:16,padding:'0 20px'}},
              this.crown(46), h('div',{style:{fontFamily:"'Cormorant Garamond',serif",fontStyle:'italic',fontSize:26,color:'#e6d3a0',lineHeight:1.3}},'No masterpieces have entered the Royal Gallery yet.'),
              h('div',{style:{fontFamily:"'Jost',sans-serif",fontSize:13,color:'#8a7742',letterSpacing:'0.06em'}},'Be the first artist to create one.'))
          : h('div',{style:{flex:1,position:'relative',overflow:'hidden',WebkitMaskImage:'linear-gradient(to bottom, transparent, #000 8%, #000 92%, transparent)',maskImage:'linear-gradient(to bottom, transparent, #000 8%, #000 92%, transparent)'}},
              h('div',{style:{display:'flex',flexDirection:'column',gap:18,animation:`rm-scrollup ${railLoop}s linear infinite`}},
                ...g.map(a=>this.card(a,{tag:'r1',imgH:240,titleSize:22})),
                ...g.map(a=>this.card(a,{tag:'r2',imgH:240,titleSize:22})))),
        h('div',{style:{marginTop:22}}, this.outlineBtn('View Royal Gallery',{full:true, onClick:()=>this.nav('gallery'), icon:h('span',{style:{fontSize:15}},'▦')}))
      ),
      // RIGHT HERO
      h('div',{style:{position:'relative',flex:1,height:'100%',display:'flex',flexDirection:'column',justifyContent:'center',padding:'0 96px',overflow:'hidden'}},
        h('div',{style:{position:'absolute',top:'-10%',right:'-8%',width:520,height:520,borderRadius:'50%',background:'radial-gradient(circle, rgba(201,154,39,0.22), transparent 70%)',animation:'rm-glow 6s ease-in-out infinite',pointerEvents:'none'}}),
        h('div',{style:{position:'relative',display:'flex',alignItems:'center',gap:14,marginBottom:40,animation:'rm-rise .8s ease both'}},
          this.crown(28), h('div',{style:{fontFamily:"'Jost',sans-serif",fontSize:15,letterSpacing:'0.42em',color:'#c9b783',fontWeight:500}},'POWERED BY BAYONE SOLUTIONS')),
        h('h1',{style:{position:'relative',margin:0,animation:'rm-rise .9s ease both'}},
          h('span',{style:{display:'block',fontFamily:"'Cormorant Garamond',serif",fontStyle:'italic',fontWeight:500,fontSize:96,color:'#f5edda',lineHeight:1.0}},'Create Your'),
          h('span',{style:this.goldTextStyle(96,{display:'block',fontWeight:700})},'Royal Masterpiece.')),
        h('p',{style:{position:'relative',fontFamily:"'Cormorant Garamond',serif",fontStyle:'italic',fontSize:26,color:'#b4a479',lineHeight:1.45,margin:'34px 0 0',maxWidth:720,animation:'rm-rise 1s ease both'}},
          'One stroke. One transformation. One evening to remember.',h('br'),'The Royal masterpiece you create could become the evening\u2019s greatest treasure.'),
        h('div',{style:{position:'relative',marginTop:52,animation:'rm-rise 1.1s ease both'}},
          this.goldBtn('Create My Masterpiece',{onClick:()=>this.openName(), icon:h('svg',{width:22,height:22,viewBox:'0 0 24 24',fill:'none',stroke:'#241906',strokeWidth:1.6,strokeLinecap:'round',strokeLinejoin:'round'},h('path',{d:'M5 3v4M3 5h4M6 17v4M4 19h4M13 3l2.5 6.5L22 12l-6.5 2.5L13 21l-2.5-6.5L4 12l6.5-2.5L13 3z'}))}))
      )
    );
  }

  renderNameModal(){
    if(!this.state.nameModalOpen) return null;
    const rows=['QWERTYUIOP','ASDFGHJKL','ZXCVBNM'];
    const ni=this.state.nameInput; const enabled=ni.trim().length>0;
    const key=(ch)=>h('button',{key:ch,onClick:()=>this.keyPress(ch),
      style:{width:88,height:88,fontFamily:"'Jost',sans-serif",fontWeight:500,fontSize:26,color:'#e6d3a0',background:'rgba(20,15,8,0.7)',border:'1px solid rgba(212,175,55,0.3)',borderRadius:8,cursor:'pointer',transition:'all .1s ease'},
      onMouseDown:e=>{e.currentTarget.style.background='linear-gradient(180deg,#f0d878,#c39a28)';e.currentTarget.style.color='#241906';},
      onMouseUp:e=>{e.currentTarget.style.background='rgba(20,15,8,0.7)';e.currentTarget.style.color='#e6d3a0';},
      onMouseLeave:e=>{e.currentTarget.style.background='rgba(20,15,8,0.7)';e.currentTarget.style.color='#e6d3a0';}},ch);
    return h('div',{key:'namemodal',style:{position:'absolute',inset:0,zIndex:40,background:'radial-gradient(120% 90% at 50% 30%, #16100a, #060402)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',animation:'rm-scalein .4s ease both'}},
      h('div',{style:{position:'absolute',inset:'28px',border:'1px solid rgba(212,175,55,0.2)',borderRadius:6,pointerEvents:'none'}}),
      h('div',{style:{display:'flex',alignItems:'center',gap:16,marginBottom:26}}, this.crown(20), this.label('Announce Yourself to the Court'), this.crown(20)),
      h('div',{style:{fontFamily:"'Cormorant Garamond',serif",fontStyle:'italic',fontSize:74,color:'#f5edda',textAlign:'center',lineHeight:1.1,maxWidth:1100,marginBottom:22}},'By what name shall your masterpiece be remembered?'),
      h('div',{style:{display:'flex',alignItems:'center',gap:14,marginBottom:30}},
        h('div',{style:{width:80,height:1,background:'linear-gradient(90deg,transparent,#c99a2e)'}}), this.crown(12),
        h('div',{style:{width:80,height:1,background:'linear-gradient(90deg,#c99a2e,transparent)'}})),
      h('div',{style:{minWidth:560,maxWidth:760,height:88,borderRadius:44,border:'1px solid rgba(212,175,55,0.5)',background:'rgba(10,8,4,0.6)',display:'flex',alignItems:'center',justifyContent:'center',padding:'0 40px',marginBottom:34}},
        ni? h('span',{style:{fontFamily:"'Cormorant Garamond',serif",fontSize:44,letterSpacing:'0.14em',color:'#f8f1de'}}, ni, h('span',{style:{color:'#e7c65a',animation:'rm-caret 1s step-end infinite'}},'|'))
          : h('span',{style:{fontFamily:"'Cormorant Garamond',serif",fontStyle:'italic',fontSize:36,color:'#7a6b44'}},'Your name…')),
      h('div',{style:{display:'flex',flexDirection:'column',gap:16,alignItems:'center',marginBottom:34}},
        ...rows.map((r,i)=>h('div',{key:i,style:{display:'flex',gap:16}}, ...r.split('').map(ch=>key(ch)))),
        h('div',{style:{display:'flex',gap:16,marginTop:8}},
          h('button',{onClick:()=>this.keyPress(' '),style:{width:620,height:84,fontFamily:"'Jost',sans-serif",letterSpacing:'0.3em',fontSize:12,color:'#c9b783',background:'rgba(20,15,8,0.7)',border:'1px solid rgba(212,175,55,0.3)',borderRadius:8,cursor:'pointer'}},'SPACE'),
          h('button',{onClick:()=>this.backspace(),style:{width:170,height:84,fontFamily:"'Jost',sans-serif",fontSize:22,color:'#c9b783',background:'rgba(20,15,8,0.7)',border:'1px solid rgba(212,175,55,0.3)',borderRadius:8,cursor:'pointer'}},'⌫'))),
      h('div',{style:{display:'flex',alignItems:'center',gap:40}},
        this.navLink('Return to Foyer',()=>{this.sfx('click');this.setState({nameModalOpen:false,nameInput:''});}),
        this.goldBtn('Enter the Atelier',{onClick:enabled?()=>this.confirmName():null, disabled:!enabled, noBreathe:true}))
    );
  }

  renderCanvas(){
    const {tool,brushColor,brushSize}=this.state;
    const tools=[['brush','Brush','🖌'],['pencil','Pencil','✎'],['marker','Paint Brush','▮'],['eraser','Eraser','▱']];
    const inks=[['#d4af37','Gold'],['#f2e6c8','Ivory'],['#b08d57','Bronze'],['#ffffff','White']];
    const toolBtn=(t)=>{ const active=tool===t[0]; return h('button',{key:t[0],onClick:()=>{this.sfx('click');this._tool=t[0];this.setState({tool:t[0]});},
      style:{width:78,height:82,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:6,cursor:'pointer',borderRadius:6,
        background:active?'linear-gradient(180deg,#f0d878,#c39a28)':'rgba(20,15,8,0.6)',border:active?'none':'1px solid rgba(212,175,55,0.25)',transition:'all .2s ease'},
      onMouseEnter:e=>{if(!active)e.currentTarget.style.borderColor='rgba(231,198,90,0.7)';},
      onMouseLeave:e=>{if(!active)e.currentTarget.style.borderColor='rgba(212,175,55,0.25)';}},
      h('span',{style:{fontSize:26,color:active?'#241906':'#c9b783'}},t[2]),
      h('span',{style:{fontFamily:"'Jost',sans-serif",fontSize:9,letterSpacing:'0.14em',textTransform:'uppercase',color:active?'#241906':'#8a7742'}},t[1]));
    };
    // ---- shared alignment grid ----
    // canvas 500x684 -> frame outer 534x718 (pad 14 + 3px border). Stack width = frame width = 534.
    // Both columns are 630 wide with symmetric 220px outer margins and a 220px centre gutter.
    // Canvas top (108) aligns with the info-panel label; bottom controls align with the supporting text.
    const CANVAS_W=500, CANVAS_H=684, STACK_W=534, COL_W=630, TOP=108;
    return h('div',{key:'canvas',style:{position:'absolute',inset:0,display:'flex',justifyContent:'space-between',alignItems:'stretch',animation:'rm-fade .8s ease'}},
      this.ambientGlow(),
      // LEFT: canvas hero
      h('div',{style:{position:'relative',width:850,height:'100%',paddingLeft:220,paddingTop:48,display:'flex',flexDirection:'column'}},
        h('div',{style:{width:COL_W,height:40,display:'flex',alignItems:'center',marginBottom:20}}, this.navLink('Return to the Foyer',()=>this.goHome())),
        h('div',{style:{display:'flex',gap:18,alignItems:'flex-start'}},
          // vertical tool palette, attached to the canvas, equal buttons + equal gaps
          h('div',{style:{display:'flex',flexDirection:'column',gap:16}}, ...tools.map(toolBtn)),
          // canvas + its controls, all locked to a single 534px column
          h('div',{style:{display:'flex',flexDirection:'column',width:STACK_W}},
            h('div',{style:{position:'relative'}},
              h('div',{style:{position:'absolute',inset:'-30px',background:'radial-gradient(circle, rgba(201,154,39,0.28), transparent 70%)',animation:'rm-glow 5s ease-in-out infinite',pointerEvents:'none'}}),
              this.frame(h('canvas',{ref:el=>this.initCanvas(el),style:{display:'block',width:CANVAS_W,height:CANVAS_H,borderRadius:2,background:'#0c0a07',touchAction:'none',cursor:'crosshair'}}),{pad:14})),
            // ink + size — one strip, aligned to canvas width
            h('div',{style:{marginTop:18,display:'flex',alignItems:'center',gap:18,padding:'0 24px',height:74,border:'1px solid rgba(212,175,55,0.25)',borderRadius:6,background:'rgba(20,15,8,0.5)'}},
              this.label('Ink',{fontSize:11}),
              h('div',{style:{display:'flex',gap:16}}, ...inks.map(ik=>h('button',{key:ik[0],onClick:()=>{this.sfx('click');this._color=ik[0];this.setState({brushColor:ik[0]});},
                style:{width:38,height:38,borderRadius:'50%',background:ik[0],cursor:'pointer',border:'none',boxShadow:brushColor===ik[0]?'0 0 0 2px #060402, 0 0 0 4px #e7c65a':'0 0 0 1px rgba(0,0,0,0.4)',transition:'transform .15s ease'},
                onMouseEnter:e=>e.currentTarget.style.transform='scale(1.15)',onMouseLeave:e=>e.currentTarget.style.transform=''}))),
              h('div',{style:{width:1,height:30,background:'rgba(212,175,55,0.25)'}}),
              this.label('Size',{fontSize:11}),
              h('input',{type:'range',min:2,max:40,value:brushSize,onChange:e=>{this._size=+e.target.value;this.setState({brushSize:+e.target.value});},style:{flex:1,accentColor:'#dbb64a',cursor:'pointer'}})),
            // undo / redo / clear — one grouped control row, aligned to canvas width
            h('div',{style:{marginTop:14,display:'flex',gap:14}},
              this.outlineBtn('Undo',{full:true,height:66,onClick:()=>this.undo(),icon:h('span',{style:{fontSize:16}},'↶')}),
              this.outlineBtn('Redo',{full:true,height:66,onClick:()=>this.redo(),icon:h('span',{style:{fontSize:16}},'↷')}),
              this.outlineBtn('Clear',{full:true,height:66,onClick:()=>this.clearCanvas(),icon:h('span',{style:{fontSize:15}},'🗑')}))
          )
        )
      ),
      // RIGHT: information panel — same top grid as the canvas, CTA aligned to the bottom controls
      h('div',{style:{position:'relative',width:850,height:'100%',paddingRight:220,paddingTop:TOP,display:'flex',flexDirection:'column'}},
        h('div',{style:{width:COL_W,height:718,display:'flex',flexDirection:'column',justifyContent:'center'}},
          h('div',null,
            h('div',{style:{display:'flex',alignItems:'center',gap:12}}, this.dot(), this.label('The Atelier')),
            h('h2',{style:{fontFamily:"'Cormorant Garamond',serif",fontStyle:'italic',fontWeight:500,fontSize:90,color:'#f5edda',lineHeight:1.04,margin:'28px 0 0'}},'Trace your imagination.'),
            h('p',{style:{fontFamily:"'Cormorant Garamond',serif",fontStyle:'italic',fontSize:24,color:'#b4a479',lineHeight:1.55,margin:'34px 0 0'}},'A single gesture is all the court requires. Sketch freely — the palace artists will reinterpret your every stroke in gold, oil and candlelight.')),
          h('div',{style:{marginTop:44}},
            this.goldBtn('Generate Masterpiece',{full:true,onClick:()=>this.startGenerate(),icon:h('svg',{width:22,height:22,viewBox:'0 0 24 24',fill:'none',stroke:'#241906',strokeWidth:1.6,strokeLinecap:'round',strokeLinejoin:'round'},h('path',{d:'M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8l1.4 1.4M17.8 6.2l1.4-1.4M3 21l9-9M12.2 6.2l-1.4-1.4'}))}),
            h('div',{style:{fontFamily:"'Jost',sans-serif",fontSize:15,lineHeight:1.6,letterSpacing:'0.08em',color:'#b4a479',marginTop:22}},'The Royal Court will study your creation and return a titled masterpiece with its own valuation.'))
        )
      )
    );
  }

  renderGenerating(){
    const rays=[0,1,2,3,4].map(i=>h('div',{key:i,style:{position:'absolute',top:'50%',left:'50%',width:1400,height:200,marginLeft:-700,marginTop:-100,
      background:'linear-gradient(90deg, transparent, rgba(231,198,90,0.5), transparent)',filter:'blur(40px)',transform:`rotate(${i*37}deg)`,transformOrigin:'center',
      animation:`rm-ray ${4+i}s ease-in-out ${i*0.6}s infinite`}}));
    const parts=Array.from({length:26}).map((_,i)=>h('div',{key:i,style:{position:'absolute',bottom:0,left:(5+Math.random()*90)+'%',width:5,height:5,borderRadius:'50%',
      background:'#f0d878',boxShadow:'0 0 8px rgba(240,216,120,0.9)',animation:`rm-particle ${3+Math.random()*4}s ease-in ${Math.random()*4}s infinite`}}));
    return h('div',{key:'gen',style:{position:'absolute',inset:0,overflow:'hidden',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',animation:'rm-fade .8s ease',background:'radial-gradient(120% 90% at 50% 40%, #16100a, #060402)'}},
      ...rays, ...parts,
      this.state.genError
        ? h('div',{style:{position:'relative',textAlign:'center',maxWidth:640}},
            this.crown(52,'#c9b783'),
            h('div',{style:{fontFamily:"'Cormorant Garamond',serif",fontStyle:'italic',fontSize:44,color:'#f5edda',margin:'22px 0 12px',lineHeight:1.2}},'The Royal Court could not complete your masterpiece.'),
            h('div',{style:{fontFamily:"'Jost',sans-serif",fontSize:14,letterSpacing:'0.12em',color:'#8a7742',marginBottom:36}},'A momentary lapse in the candlelight. Please try once more.'),
            this.goldBtn('Try Again',{onClick:()=>{this.busy=false;this.startGenerate();},noBreathe:true}))
        : h(React.Fragment,null,
            h('div',{style:{position:'relative',width:220,height:220,display:'flex',alignItems:'center',justifyContent:'center',marginBottom:50}},
              h('div',{style:{position:'absolute',inset:0,borderRadius:'50%',border:'1px solid rgba(231,198,90,0.6)',borderTopColor:'transparent',borderLeftColor:'transparent',animation:'rm-spin 2.4s linear infinite'}}),
              h('div',{style:{position:'absolute',inset:26,borderRadius:'50%',border:'1px solid rgba(219,182,74,0.4)',borderBottomColor:'transparent',borderRightColor:'transparent',animation:'rm-spinrev 3.6s linear infinite'}}),
              h('div',{style:{animation:'rm-floaty 3s ease-in-out infinite'}}, this.crown(72))),
            h('div',{key:this.state.storyIdx,style:{fontFamily:"'Cormorant Garamond',serif",fontStyle:'italic',fontSize:40,color:'#f5edda',textAlign:'center',maxWidth:820,animation:'rm-fade .8s ease',minHeight:56}}, STORY[this.state.storyIdx]),
            h('div',{style:{position:'relative',width:420,height:2,background:'rgba(212,175,55,0.15)',marginTop:40,overflow:'hidden',borderRadius:2}},
              h('div',{style:{position:'absolute',top:0,left:0,width:'45%',height:'100%',background:'linear-gradient(90deg,transparent,#f0d878,transparent)',animation:'rm-progress 1.4s linear infinite'}})))
    );
  }

  renderReveal(){
    const art=this.state.pending; if(!art) return null;
    const blk=(delay,children)=>h('div',{style:{animation:`rm-rise .9s ease ${delay}s both`}},children);
    return h('div',{key:'reveal',style:{position:'absolute',inset:0,display:'flex',animation:'rm-fade .8s ease'}},
      this.ambientGlow(),
      h('div',{style:{position:'relative',width:'50%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',padding:'60px'}},
        h('div',{style:{position:'absolute',inset:'8%',background:'radial-gradient(circle, rgba(201,154,39,0.25), transparent 65%)',animation:'rm-glow 5s ease-in-out infinite',pointerEvents:'none'}}),
        h('div',{style:{animation:'rm-scalein 1.1s cubic-bezier(.2,.7,.2,1) both',height:'86%'}},
          this.frame(h('img',{src:art.imageUrl,style:{display:'block',height:'100%',width:'auto',borderRadius:2}}),{pad:16,style:{height:'100%'}}))
      ),
      h('div',{style:{position:'relative',width:'50%',height:'100%',display:'flex',flexDirection:'column',justifyContent:'center',padding:'0 90px 0 40px'}},
        blk(0.2, h('div',{style:{display:'flex',alignItems:'center',gap:12,marginBottom:24}}, this.crown(22), this.label('A Masterpiece Unveiled'))),
        blk(0.38, h('div',{style:this.goldTextStyle(72,{fontStyle:'italic',fontWeight:600,marginBottom:38})}, art.title)),
        blk(0.62, h('div',null,
          this.label('Royal Valuation',{marginBottom:12}),
          h('div',{style:{display:'flex',alignItems:'baseline',gap:16}}, this.crown(52),
            h('span',{style:this.goldTextStyle(88,{fontWeight:700,fontFamily:"'Jost',sans-serif"})}, this.crowns(art.valuation)),
            h('span',{style:{fontFamily:"'Jost',sans-serif",fontSize:16,letterSpacing:'0.3em',color:'#8a7742'}},'CROWNS')))),
        blk(0.82, h('div',{style:{marginTop:34}},
          this.label('Created By',{marginBottom:8}),
          h('div',{style:{fontFamily:"'Cormorant Garamond',serif",fontStyle:'italic',fontSize:36,color:'#f5edda'}}, art.creator))),
        blk(1.05, h('div',{style:{display:'flex',flexDirection:'column',gap:16,marginTop:44,maxWidth:600}},
          this.goldBtn('Enter the Royal Gallery & Compete for the Crown',{full:true,fontSize:13,ls:'0.1em',onClick:()=>this.submitToGallery(),icon:this.crown(18,'#241906')}),
          this.outlineBtn('Get Your Artwork',{full:true,height:84,onClick:()=>this.openShare(),icon:h('svg',{width:16,height:16,viewBox:'0 0 24 24',fill:'none',stroke:'#c9b783',strokeWidth:1.6,strokeLinecap:'round',strokeLinejoin:'round'},h('path',{d:'M12 3v12M7 10l5 5 5-5M4 21h16'}))})))
      )
    );
  }

  renderShare(){
    if(!this.state.shareOpen) return null;
    const qs=this.state.qrState;
    return h('div',{key:'share',style:{position:'absolute',inset:0,zIndex:50,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(4,3,2,0.72)',backdropFilter:'blur(10px)',animation:'rm-fade .3s ease'},onClick:e=>{if(e.target===e.currentTarget)this.closeShare();}},
      h('div',{style:{width:640,padding:'56px 60px 44px',background:'radial-gradient(120% 100% at 50% 0%, #16100a, #0b0805)',border:'1px solid rgba(212,175,55,0.35)',borderRadius:8,display:'flex',flexDirection:'column',alignItems:'center',boxShadow:'0 40px 100px rgba(0,0,0,0.8)',animation:'rm-scalein .4s ease both'}},
        this.crown(34),
        h('div',{style:{fontFamily:"'Cormorant Garamond',serif",fontStyle:'italic',fontSize:52,color:'#f5edda',margin:'18px 0 12px'}},'Scan to Download'),
        h('div',{style:{fontFamily:"'Jost',sans-serif",fontSize:14,color:'#b4a479',textAlign:'center',lineHeight:1.5,maxWidth:420,marginBottom:32}},'Scan the code with your phone to download your masterpiece. No account required.'),
        h('div',{style:{width:400,height:400,borderRadius:10,background:'#fff',display:'flex',alignItems:'center',justifyContent:'center',overflow:'hidden'}},
          qs==='loading' ? h('div',{style:{textAlign:'center'}}, h('div',{style:{width:44,height:44,margin:'0 auto 16px',borderRadius:'50%',border:'3px solid rgba(0,0,0,0.15)',borderTopColor:'#c39a28',animation:'rm-spin 1s linear infinite'}}), h('div',{style:{fontFamily:"'Jost',sans-serif",fontSize:11,letterSpacing:'0.24em',color:'#8a7742'}},'PREPARING YOUR QR…'))
          : qs==='error' ? h('div',{style:{textAlign:'center',color:'#8a2020'}}, h('div',{style:{fontSize:40}},'⚠'), h('div',{style:{fontFamily:"'Jost',sans-serif",fontSize:12,margin:'10px 0 16px',color:'#5a1420'}},'Upload failed.'), this.goldBtn('Try Again',{small:true,noBreathe:true,onClick:()=>this.openShare()}))
          : h('canvas',{ref:el=>this._qrEl=el})),
        h('div',{style:{marginTop:26}}, this.navLink('Return to Foyer',()=>this.closeShare()))
      )
    );
  }

  renderSubmitting(){
    const art=this.state.pending; if(!art) return null;
    const parts=Array.from({length:20}).map((_,i)=>h('div',{key:i,style:{position:'absolute',bottom:0,left:(5+Math.random()*90)+'%',width:5,height:5,borderRadius:'50%',background:'#f0d878',boxShadow:'0 0 8px rgba(240,216,120,0.9)',animation:`rm-particle ${3+Math.random()*4}s ease-in ${Math.random()*3}s infinite`}}));
    return h('div',{key:'submitting',style:{position:'absolute',inset:0,overflow:'hidden',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',animation:'rm-fade .6s ease',background:'radial-gradient(120% 90% at 50% 40%, #16100a, #060402)'}},
      ...parts,
      h('div',{style:{height:420,animation:'rm-flight 2.4s cubic-bezier(.55,0,.25,1) 1s both'}}, this.frame(h('img',{src:art.imageUrl,style:{display:'block',height:388,width:'auto',borderRadius:2}}),{pad:12})),
      h('div',{style:{position:'absolute',bottom:'16%',textAlign:'center'}},
        h('div',{style:{fontFamily:"'Cormorant Garamond',serif",fontStyle:'italic',fontSize:44,color:'#f5edda',marginBottom:12}},'Your masterpiece now graces the Royal Gallery.'),
        h('div',{style:{fontFamily:"'Jost',sans-serif",fontSize:13,letterSpacing:'0.16em',color:'#8a7742'}},'Visitors may now Grant Royal Endorsements.'))
    );
  }

  renderGallery(){
    const g=[...this.state.gallery].sort((p,q)=>q.valuation-p.valuation);
    return h('div',{key:'gallery',style:{position:'absolute',inset:0,display:'flex',flexDirection:'column',animation:'rm-fade .8s ease',background:'radial-gradient(120% 90% at 70% 20%, #16100a 0%, #0b0805 55%, #060402 100%)'}},
      h('div',{style:{flex:'0 0 auto',display:'flex',alignItems:'center',justifyContent:'space-between',padding:'26px 60px',borderBottom:'1px solid rgba(212,175,55,0.14)',background:'rgba(0,0,0,0.4)'}},
        h('div',{style:{width:280}}, this.navLink('Return to the Foyer',()=>this.goHome())),
        h('div',{style:{textAlign:'center'}}, this.label('The Royal Gallery',{marginBottom:6}),
          h('div',{style:{fontFamily:"'Cormorant Garamond',serif",fontStyle:'italic',fontSize:40,color:'#f5edda',lineHeight:1}},'Endorse the Worthy'),
          h('div',{style:{width:120,height:1,background:'linear-gradient(90deg,transparent,#c99a2e,transparent)',margin:'10px auto 0'}})),
        h('div',{style:{width:280,textAlign:'right'}}, this.label(g.length+' WORK'+(g.length===1?'':'S')+' ON DISPLAY'))),
      g.length===0
        ? h('div',{style:{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:20,textAlign:'center'}},
            this.crown(60), h('div',{style:{fontFamily:"'Cormorant Garamond',serif",fontStyle:'italic',fontSize:38,color:'#f5edda'}},'No masterpieces have entered the Royal Gallery yet.'),
            h('div',{style:{fontFamily:"'Jost',sans-serif",fontSize:14,letterSpacing:'0.08em',color:'#8a7742',marginBottom:14}},'Be the first artist to create one.'),
            this.goldBtn('Create My Masterpiece',{onClick:()=>{this.setState({screen:'home'});this.openName();},icon:this.crown(20,'#241906')}))
        : h('div',{style:{flex:1,overflowY:'auto',padding:'40px 60px 60px'}},
            h('div',{style:{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:28}},
              ...g.map(a=>this.card(a,{settle:this._newCardId===a.id,highlight:this._newCardId===a.id,imgH:380}))))
    );
  }

  renderToast(){
    if(!this.state.toast) return null;
    return h('div',{key:'toast',style:{position:'absolute',bottom:60,left:'50%',zIndex:60,transform:'translateX(-50%)',padding:'16px 34px',background:'rgba(12,10,7,0.95)',border:'1px solid rgba(212,175,55,0.5)',borderRadius:40,fontFamily:"'Cormorant Garamond',serif",fontStyle:'italic',fontSize:22,color:'#f0e0b0',boxShadow:'0 0 30px rgba(201,154,39,0.3)',animation:'rm-toast 2.6s ease both'}}, this.state.toast);
  }

  render(){
    const {sw,sh,screen}=this.state;
    let scr;
    if(screen==='home') scr=this.renderHome();
    else if(screen==='canvas') scr=this.renderCanvas();
    else if(screen==='generating') scr=this.renderGenerating();
    else if(screen==='reveal') scr=this.renderReveal();
    else if(screen==='submitting') scr=this.renderSubmitting();
    else if(screen==='gallery') scr=this.renderGallery();
    const stage=h('div',{style:{position:'absolute',top:0,left:0,width:1920,height:1080,transformOrigin:'top left',transform:`scale(${sw/1920},${sh/1080})`,background:'#060402',overflow:'hidden'}},
      scr,
      this.renderNameModal(),
      this.renderShare(),
      this.renderToast());
    return stage;
  }
}

export default App;
