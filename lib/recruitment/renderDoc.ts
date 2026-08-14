// Renders the football-scouting interview-desk HTML doc (same template as the
// hand-committed docs in content/recruitment/) from structured candidate data.
// Output is a fully standalone HTML file — scores/notes persist via
// localStorage under `recruitment:<slug>` on the viewer's device.

export interface ScoutCandidate {
  id: string; // kebab-case short id, unique within the doc
  code: string; // jersey/application code, digits preferred (e.g. "0394")
  name: string;
  pos: string; // football-position metaphor for the profile
  meta: string; // "~5 yrs · Chennai · MA Social Work, Loyola"
  attrs: number[]; // 6 values 0–100, matching the doc's axes
  flags: [string, string][]; // [severity "r"|"y", text (may contain <b>)]
  scout: string; // prose scout report (may contain <b>)
  qs: string[]; // interview questions
  // Persisted-only (stripped by cleanCandidate before HTML rendering).
  // Populated server-side after LLM output by pairing on cvIndex → the CV
  // text extract this candidate came from. Enables high-fidelity regenerate
  // (see lib/recruitment/scoutingDayOps.ts). Never rendered to HTML.
  cvIndex?: number;
  cvText?: string;
}

export interface ScoutDocData {
  docTitle: string; // <title>
  matchday: string; // "Matchday · Thu 30 July 2026"
  titleA: string; // h1 line 1, e.g. "RP Trials"
  titleB: string; // h1 line 2, e.g. "Chennai Urban FC"
  sub: string; // "8 trialists · 1 shirt · position: <b>…</b>"
  selector: string; // name shown on the crest line
  axes: string[]; // 6 short radar axis labels
  headlines: string[]; // ticker items
  everyone: string[]; // "ask every trialist" paragraphs (may contain <b>)
  candidates: ScoutCandidate[];
}

const escHtml = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Escape everything, then re-allow <b>/</b> — the only markup the template uses.
const inline = (s: string) => escHtml(s).replace(/&lt;(\/?)b&gt;/gi, "<$1b>");

// Safe to embed inside a <script> block.
const js = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

function cleanCandidate(c: ScoutCandidate, i: number): ScoutCandidate {
  const id = (c.id || `cand-${i + 1}`).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "") || `cand-${i + 1}`;
  const attrs = Array.from({ length: 6 }, (_, k) => {
    const v = Number(c.attrs?.[k]);
    return Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 50;
  });
  return {
    id,
    code: String(c.code || i + 1).replace(/[^a-zA-Z0-9]/g, "").slice(0, 6) || String(i + 1),
    name: inline(c.name || "Unknown"),
    pos: inline(c.pos || ""),
    meta: inline(c.meta || ""),
    attrs,
    flags: (c.flags || []).slice(0, 4).map(([sev, text]) => [sev === "r" ? "r" : "y", inline(text || "")]),
    scout: inline(c.scout || ""),
    qs: (c.qs || []).slice(0, 10).map((q) => inline(q)),
  };
}

export function renderScoutingDoc(slug: string, d: ScoutDocData): string {
  const axes = (d.axes?.length === 6 ? d.axes : ["FIELD", "RANGE", "DOCS", "DEPTH", "STABLE", "FIT"]).map((a) =>
    escHtml(String(a).toUpperCase().slice(0, 8)),
  );
  const candidates = d.candidates.map(cleanCandidate);
  const headlines = (d.headlines || []).map((h) => String(h));
  const everyone = (d.everyone || []).map((p) => `<p>${inline(p)}</p>`).join("\n  ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(d.docTitle)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Bungee&family=Outfit:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
:root{
  --pitch:#0A2A1D; --pitch2:#0F3626; --pitch3:#144232;
  --chalk:#F4EFDF; --gold:#FFB424; --sky:#7FC7E8; --red:#E5484D;
  --dim:#9DB8AA; --line:rgba(244,239,223,.14);
}
*{margin:0;padding:0;box-sizing:border-box}
html{scroll-behavior:smooth}
body{
  background:var(--pitch); color:var(--chalk);
  font-family:'Outfit',sans-serif; overflow-x:hidden;
  background-image:
    radial-gradient(ellipse 1200px 600px at 50% -200px, rgba(127,199,232,.08), transparent),
    repeating-linear-gradient(0deg, transparent 0 119px, rgba(244,239,223,.035) 119px 120px);
}
/* chalk centre circle */
body::before{
  content:''; position:fixed; top:38%; left:50%; transform:translate(-50%,-50%);
  width:min(90vw,720px); height:min(90vw,720px); border-radius:50%;
  border:2px dashed rgba(244,239,223,.06); pointer-events:none; z-index:0;
}
.wrap{position:relative; z-index:1; max-width:1100px; margin:0 auto; padding:0 16px 80px}

/* ============ HEADER ============ */
header{padding:34px 0 10px; text-align:center}
.matchday{
  font-family:'Space Mono',monospace; font-size:12px; letter-spacing:.32em;
  color:var(--gold); text-transform:uppercase;
}
h1{
  font-family:'Bungee',cursive; font-size:clamp(34px,7.5vw,72px); line-height:1.02;
  margin:10px 0 4px; text-transform:uppercase;
}
h1 .a{color:var(--chalk)} h1 .b{color:var(--sky)}
.sub{font-family:'Space Mono',monospace; font-size:13px; color:var(--dim); letter-spacing:.08em}
.sub b{color:var(--gold); font-weight:700}
.crest{
  display:inline-flex; align-items:center; gap:10px; margin-top:14px;
  border:1.5px solid var(--line); border-radius:999px; padding:7px 18px;
  font-family:'Space Mono',monospace; font-size:11px; letter-spacing:.18em; color:var(--dim);
}
.crest .dot{width:8px;height:8px;border-radius:50%;background:var(--red);animation:blink 1.4s infinite}
@keyframes blink{50%{opacity:.25}}

/* ============ TICKER ============ */
.ticker{
  margin:26px -16px 34px; background:var(--gold); color:#20180A;
  font-family:'Space Mono',monospace; font-weight:700; font-size:13px;
  overflow:hidden; white-space:nowrap; transform:rotate(-1deg); border:2px solid #20180A;
  box-shadow:0 4px 0 rgba(0,0,0,.35);
}
.ticker-inner{display:inline-block; padding:9px 0; animation:tick 46s linear infinite}
@keyframes tick{from{transform:translateX(0)}to{transform:translateX(-50%)}}

/* ============ SECTION HEADS ============ */
.secHead{display:flex; align-items:baseline; gap:14px; margin:44px 0 16px; flex-wrap:wrap}
.secHead h2{font-family:'Bungee',cursive; font-size:clamp(20px,3.6vw,30px); color:var(--gold); text-transform:uppercase}
.secHead .rule{flex:1; height:2px; background:var(--line); min-width:60px}
.secHead .tag{font-family:'Space Mono',monospace; font-size:11px; color:var(--dim); letter-spacing:.2em}

/* ============ LEAGUE TABLE ============ */
.tableCard{
  background:var(--pitch2); border:1.5px solid var(--line); border-radius:18px;
  overflow:hidden; box-shadow:0 12px 40px rgba(0,0,0,.35);
}
table{width:100%; border-collapse:collapse; font-size:14px}
th{
  font-family:'Space Mono',monospace; font-size:10px; letter-spacing:.18em; text-transform:uppercase;
  color:var(--dim); text-align:left; padding:12px 14px; border-bottom:1.5px solid var(--line);
  background:rgba(0,0,0,.18);
}
td{padding:12px 14px; border-bottom:1px solid rgba(244,239,223,.07); vertical-align:middle}
tr:last-child td{border-bottom:none}
tbody tr{transition:background .3s; cursor:pointer}
tbody tr:hover{background:rgba(127,199,232,.07)}
tr.flash{animation:rowflash 1s}
@keyframes rowflash{0%{background:rgba(255,180,36,.25)}100%{background:transparent}}
.rk{font-family:'Bungee',cursive; color:var(--sky); font-size:16px; width:40px}
.tn{font-weight:700}
.tn small{display:block; font-weight:400; color:var(--dim); font-size:11px; font-family:'Space Mono',monospace}
.si{font-family:'Space Mono',monospace; font-weight:700; color:var(--gold)}
.ys{font-family:'Bungee',cursive; font-size:16px}
.ys.empty{color:var(--dim); font-family:'Space Mono',monospace; font-size:11px; font-weight:400}
.vchip{font-family:'Space Mono',monospace; font-size:10px; font-weight:700; letter-spacing:.12em; padding:3px 9px; border-radius:6px; border:1.5px solid}
.v-SIGN{color:#7CE0A5; border-color:#7CE0A5}
.v-TRIAL{color:var(--gold); border-color:var(--gold)}
.v-PASS{color:var(--red); border-color:var(--red)}
.v-none{color:var(--dim); border-color:var(--line); font-weight:400}

/* ============ CARDS ============ */
.grid{display:grid; grid-template-columns:1fr; gap:26px}
.card{
  background:linear-gradient(160deg,var(--pitch3),var(--pitch2) 55%);
  border:2px solid var(--line); border-radius:22px; padding:22px 20px 20px;
  position:relative; overflow:hidden;
  box-shadow:0 14px 44px rgba(0,0,0,.4);
  opacity:0; transform:translateY(28px) rotate(-.6deg);
  animation:cardIn .7s cubic-bezier(.2,.9,.3,1.2) forwards;
}
.card:nth-child(even){transform:translateY(28px) rotate(.6deg)}
@keyframes cardIn{to{opacity:1; transform:translateY(0) rotate(0)}}
.card::after{
  content:attr(data-code); position:absolute; right:-8px; top:-22px;
  font-family:'Bungee',cursive; font-size:110px; color:rgba(244,239,223,.045);
  pointer-events:none; letter-spacing:-4px;
}
.chead{display:flex; gap:14px; align-items:flex-start; flex-wrap:wrap}
.jersey{
  width:62px; height:62px; flex:0 0 62px; border-radius:14px;
  background:var(--sky); color:#0A2A1D; display:flex; flex-direction:column;
  align-items:center; justify-content:center; font-family:'Bungee',cursive;
  border:2.5px solid var(--chalk); transform:rotate(-3deg);
  box-shadow:3px 4px 0 rgba(0,0,0,.35);
}
.jersey span{font-size:20px; line-height:1}
.jersey small{font-family:'Space Mono',monospace; font-size:8px; letter-spacing:.08em; font-weight:700}
.cwho{flex:1; min-width:200px}
.cname{font-family:'Bungee',cursive; font-size:clamp(19px,3.4vw,26px); text-transform:uppercase; line-height:1.05}
.cpos{font-family:'Space Mono',monospace; font-size:11px; color:var(--gold); letter-spacing:.1em; margin-top:5px; text-transform:uppercase}
.cmeta{font-size:12.5px; color:var(--dim); margin-top:4px}
.sindex{text-align:center; flex:0 0 auto}
.sindex .n{font-family:'Bungee',cursive; font-size:34px; color:var(--gold)}
.sindex .l{font-family:'Space Mono',monospace; font-size:9px; letter-spacing:.18em; color:var(--dim)}

.cbody{display:grid; grid-template-columns:220px 1fr; gap:18px; margin-top:18px; align-items:start}
@media(max-width:640px){.cbody{grid-template-columns:1fr}}
.radarBox{display:flex; justify-content:center}
svg.radar{width:100%; max-width:230px; overflow:visible}
.radar .grid-line{fill:none; stroke:var(--line); stroke-width:1}
.radar .axis{stroke:var(--line); stroke-width:1}
.radar .val{
  fill:rgba(127,199,232,.22); stroke:var(--sky); stroke-width:2.5; stroke-linejoin:round;
  transform-origin:center; transform:scale(0); animation:radarPop .9s .35s cubic-bezier(.2,.9,.3,1.25) forwards;
}
@keyframes radarPop{to{transform:scale(1)}}
.radar text{fill:var(--dim); font-family:'Space Mono',monospace; font-size:8.5px; letter-spacing:.04em}
.radar .vdot{fill:var(--gold)}

.flags{display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px}
.flag{
  display:inline-flex; align-items:center; gap:7px; font-size:12px; line-height:1.3;
  padding:6px 10px; border-radius:10px; border:1.5px solid; max-width:100%;
}
.flag .fc{width:11px; height:15px; border-radius:2.5px; flex:0 0 11px; transform:rotate(-8deg)}
.flag.y{border-color:rgba(255,180,36,.5); color:#FFD98A}
.flag.y .fc{background:var(--gold)}
.flag.r{border-color:rgba(229,72,77,.6); color:#FFA7AA}
.flag.r .fc{background:var(--red)}
.scoutTxt{font-size:14.5px; line-height:1.62; color:#DCE7DE}
.scoutTxt b{color:var(--chalk)}

details{margin-top:12px; border:1.5px solid var(--line); border-radius:14px; overflow:hidden; background:rgba(0,0,0,.16)}
summary{
  cursor:pointer; list-style:none; padding:11px 14px; font-family:'Space Mono',monospace;
  font-size:11.5px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; color:var(--sky);
  display:flex; justify-content:space-between; align-items:center; user-select:none;
}
summary::-webkit-details-marker{display:none}
summary::after{content:'+'; font-family:'Bungee',cursive; color:var(--gold); transition:transform .25s}
details[open] summary::after{transform:rotate(45deg)}
.dbody{padding:2px 14px 14px}
.qs{list-style:none}
.qs li{display:flex; gap:10px; padding:9px 0; border-top:1px dashed rgba(244,239,223,.12); font-size:14px; line-height:1.5; align-items:flex-start}
.qs li:first-child{border-top:none}
.qs input[type=checkbox]{
  appearance:none; width:20px; height:20px; flex:0 0 20px; margin-top:1px;
  border:2px solid var(--sky); border-radius:6px; cursor:pointer; position:relative; transition:.2s;
}
.qs input[type=checkbox]:checked{background:var(--sky)}
.qs input[type=checkbox]:checked::after{
  content:'✓'; position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  color:#0A2A1D; font-weight:900; font-size:13px;
}
.qs li.done label{opacity:.45; text-decoration:line-through}
.qs label{cursor:pointer}

/* ============ SCORING PANEL ============ */
.panel{
  margin-top:16px; border:2px dashed rgba(255,180,36,.45); border-radius:16px;
  padding:16px 14px 14px; background:rgba(255,180,36,.05);
}
.panel .pl{font-family:'Space Mono',monospace; font-size:10.5px; letter-spacing:.22em; color:var(--gold); text-transform:uppercase; margin-bottom:12px}
.scoreRow{display:flex; align-items:center; gap:16px; flex-wrap:wrap}
.bigScore{font-family:'Bungee',cursive; font-size:44px; color:var(--chalk); min-width:96px; line-height:1}
.bigScore small{font-size:16px; color:var(--dim)}
input[type=range]{flex:1; min-width:160px; accent-color:var(--gold); height:34px; cursor:pointer}
.stamps{display:flex; gap:10px; margin-top:14px; flex-wrap:wrap}
.stamp{
  font-family:'Bungee',cursive; font-size:14px; letter-spacing:.06em; padding:9px 18px;
  border-radius:10px; border:2.5px solid; background:transparent; cursor:pointer;
  transition:transform .15s; text-transform:uppercase;
}
.stamp:active{transform:scale(.92)}
.stamp.sign{color:#7CE0A5; border-color:#7CE0A5}
.stamp.trial{color:var(--gold); border-color:var(--gold)}
.stamp.pass{color:var(--red); border-color:var(--red)}
.stamp.on{transform:rotate(-4deg) scale(1.06); box-shadow:0 0 0 3px rgba(244,239,223,.15), 3px 4px 0 rgba(0,0,0,.4)}
.stamp.on.sign{background:#7CE0A5; color:#0A2A1D}
.stamp.on.trial{background:var(--gold); color:#20180A}
.stamp.on.pass{background:var(--red); color:#fff}
@keyframes thump{0%{transform:rotate(-14deg) scale(1.7); opacity:0}60%{transform:rotate(-4deg) scale(.98); opacity:1}100%{transform:rotate(-4deg) scale(1.06)}}
.stamp.thump{animation:thump .4s cubic-bezier(.2,.9,.3,1.3)}
textarea{
  width:100%; margin-top:14px; background:rgba(0,0,0,.28); border:1.5px solid var(--line);
  border-radius:12px; color:var(--chalk); font-family:'Outfit',sans-serif; font-size:14px;
  padding:11px 12px; min-height:74px; resize:vertical;
}
textarea:focus{outline:2px solid var(--sky); border-color:transparent}
textarea::placeholder{color:rgba(157,184,170,.7)}
.savenote{font-family:'Space Mono',monospace; font-size:10px; color:var(--dim); margin-top:6px; letter-spacing:.1em; min-height:14px}

/* ============ EVERYONE PANEL ============ */
.everyone{
  margin-top:48px; border:2px solid var(--sky); border-radius:20px; padding:22px 20px;
  background:linear-gradient(160deg, rgba(127,199,232,.1), rgba(127,199,232,.03));
}
.everyone h3{font-family:'Bungee',cursive; color:var(--sky); text-transform:uppercase; font-size:19px; margin-bottom:10px}
.everyone p{font-size:14.5px; line-height:1.65; color:#DCE7DE; margin-top:8px}
.everyone b{color:var(--gold)}

footer{margin-top:44px; text-align:center; font-family:'Space Mono',monospace; font-size:11px; color:var(--dim); letter-spacing:.12em}
.resetBtn{
  margin-top:12px; background:none; border:1.5px solid var(--line); color:var(--dim);
  font-family:'Space Mono',monospace; font-size:10.5px; letter-spacing:.15em; padding:8px 16px;
  border-radius:999px; cursor:pointer; text-transform:uppercase;
}
.resetBtn:hover{border-color:var(--red); color:var(--red)}

.confetti{position:fixed; top:-14px; z-index:99; pointer-events:none; border-radius:2px; animation:fall linear forwards}
@keyframes fall{to{transform:translateY(110vh) rotate(720deg)}}

@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{animation:none!important; transition:none!important}
  .card{opacity:1; transform:none}
  .radar .val{transform:scale(1)}
}
</style>
</head>
<body>
<div class="wrap">

<header>
  <div class="matchday">${escHtml(d.matchday)}</div>
  <h1><span class="a">${escHtml(d.titleA)}</span><br><span class="b">${escHtml(d.titleB)}</span></h1>
  <div class="sub">${inline(d.sub)}</div>
  <div class="crest"><span class="dot"></span> LIVE SCOUTING DESK · SELECTOR: ${escHtml(d.selector.toUpperCase())}</div>
</header>

<div class="ticker"><div class="ticker-inner" id="ticker"></div></div>

<div class="secHead"><h2>League Table</h2><div class="rule"></div><span class="tag">SORTS LIVE AS YOU SCORE</span></div>
<div class="tableCard">
  <table>
    <thead><tr><th>#</th><th>Trialist</th><th>Scout Index</th><th>Your Score</th><th>Verdict</th></tr></thead>
    <tbody id="ltable"></tbody>
  </table>
</div>

<div class="secHead"><h2>Scout Cards</h2><div class="rule"></div><span class="tag">TAP A TABLE ROW TO JUMP</span></div>
<div class="grid" id="cards"></div>

<div class="everyone">
  <h3>⚽ Ask every trialist</h3>
  ${everyone}
</div>

<footer>
  <div>SCOUTING DESK · JANADHIKARA · SCORES &amp; NOTES SAVE AUTOMATICALLY ON THIS DEVICE</div>
  <button class="resetBtn" id="resetBtn">Reset all scores &amp; notes</button>
</footer>

</div>

<script>
/* ================= DATA ================= */
const AXES = ${js(axes)};
const C = ${js(candidates)};

/* ================= STATE ================= */
const KEY=${js(`recruitment:${slug}`)};
let S={}; C.forEach(c=>S[c.id]={score:null,verdict:null,notes:'',asked:{}});

function load(){
  try{
    const r = localStorage.getItem(KEY);
    if(r){ const p=JSON.parse(r); C.forEach(c=>{ if(p[c.id]) S[c.id]={...S[c.id],...p[c.id]}; }); }
  }catch(e){/* first run — nothing saved yet */}
}
let saveT=null;
function save(id){
  markSave(id,'saving…');
  clearTimeout(saveT);
  saveT=setTimeout(()=>{
    try{ localStorage.setItem(KEY, JSON.stringify(S)); markSave(id,'saved ✓'); }
    catch(e){ markSave(id,'save failed — will retry on next change'); }
  },500);
}
function markSave(id,msg){ if(!id) return; const el=document.getElementById('sv-'+id); if(el){el.textContent=msg;} }

/* ================= RENDER ================= */
const idx = a => Math.round(a.reduce((x,y)=>x+y,0)/a.length);

function radarSVG(attrs){
  const cx=110, cy=104, R=76, n=6;
  const pt=(i,r)=>{const a=-Math.PI/2 + i*2*Math.PI/n; return [cx+r*Math.cos(a), cy+r*Math.sin(a)];};
  const ring=f=>Array.from({length:n},(_,i)=>pt(i,R*f).map(v=>v.toFixed(1)).join(',')).join(' ');
  const valPts=attrs.map((v,i)=>pt(i,R*v/100));
  const val=valPts.map(p=>p.map(v=>v.toFixed(1)).join(',')).join(' ');
  let axes='', labels='', dots='';
  for(let i=0;i<n;i++){
    const [x,y]=pt(i,R); axes+=\`<line class="axis" x1="\${cx}" y1="\${cy}" x2="\${x.toFixed(1)}" y2="\${y.toFixed(1)}"/>\`;
    const [lx,ly]=pt(i,R+16);
    labels+=\`<text x="\${lx.toFixed(1)}" y="\${(ly+3).toFixed(1)}" text-anchor="middle">\${AXES[i]}</text>\`;
    dots+=\`<circle class="vdot" cx="\${valPts[i][0].toFixed(1)}" cy="\${valPts[i][1].toFixed(1)}" r="3"/>\`;
  }
  return \`<svg class="radar" viewBox="0 0 220 210">
    <polygon class="grid-line" points="\${ring(1)}"/><polygon class="grid-line" points="\${ring(.66)}"/><polygon class="grid-line" points="\${ring(.33)}"/>
    \${axes}<polygon class="val" points="\${val}"/>\${dots}\${labels}</svg>\`;
}

function renderCards(){
  document.getElementById('cards').innerHTML = C.map((c,i)=>\`
  <article class="card" id="card-\${c.id}" data-code="\${c.code}" style="animation-delay:\${i*0.09}s">
    <div class="chead">
      <div class="jersey"><small>APPRF</small><span>\${c.code.replace(/^0+/,'')}</span></div>
      <div class="cwho">
        <div class="cname">\${c.name}</div>
        <div class="cpos">\${c.pos}</div>
        <div class="cmeta">\${c.meta}</div>
      </div>
      <div class="sindex"><div class="n">\${idx(c.attrs)}</div><div class="l">SCOUT<br>INDEX</div></div>
    </div>
    <div class="cbody">
      <div class="radarBox">\${radarSVG(c.attrs)}</div>
      <div>
        <div class="flags">\${c.flags.map(f=>\`<span class="flag \${f[0]}"><span class="fc"></span>\${f[1]}</span>\`).join('')}</div>
        <p class="scoutTxt">\${c.scout}</p>
      </div>
    </div>
    <details><summary>Press-conference questions <span style="color:var(--dim);font-weight:400" id="qc-\${c.id}"></span></summary>
      <div class="dbody"><ul class="qs">\${c.qs.map((q,qi)=>\`
        <li id="q-\${c.id}-\${qi}"><input type="checkbox" id="cb-\${c.id}-\${qi}" data-c="\${c.id}" data-q="\${qi}"><label for="cb-\${c.id}-\${qi}">\${q}</label></li>\`).join('')}
      </ul></div>
    </details>
    <div class="panel">
      <div class="pl">⚖ Selector's call — \${c.name.split(' ')[0]}</div>
      <div class="scoreRow">
        <div class="bigScore" id="bs-\${c.id}">–<small>/10</small></div>
        <input type="range" min="0" max="10" step="0.5" value="5" id="rg-\${c.id}" data-c="\${c.id}" aria-label="Score for \${c.name}">
      </div>
      <div class="stamps">
        <button class="stamp sign" data-c="\${c.id}" data-v="SIGN">✍ Sign</button>
        <button class="stamp trial" data-c="\${c.id}" data-v="TRIAL">⏳ Trial</button>
        <button class="stamp pass" data-c="\${c.id}" data-v="PASS">✕ Pass</button>
      </div>
      <textarea id="nt-\${c.id}" data-c="\${c.id}" placeholder="Interview notes — what they said, how it landed, gut read…"></textarea>
      <div class="savenote" id="sv-\${c.id}"></div>
    </div>
  </article>\`).join('');
}

function renderTable(flashId){
  const rows=[...C].sort((a,b)=>{
    const sa=S[a.id].score, sb=S[b.id].score;
    if(sa!=null&&sb!=null&&sb!==sa) return sb-sa;
    if(sa!=null&&sb==null) return -1;
    if(sb!=null&&sa==null) return 1;
    return idx(b.attrs)-idx(a.attrs);
  });
  document.getElementById('ltable').innerHTML = rows.map((c,i)=>{
    const st=S[c.id];
    return \`<tr data-c="\${c.id}" class="\${c.id===flashId?'flash':''}">
      <td class="rk">\${i+1}</td>
      <td class="tn">\${c.name}<small>\${c.pos}</small></td>
      <td class="si">\${idx(c.attrs)}</td>
      <td>\${st.score!=null?\`<span class="ys">\${st.score}</span>\`:\`<span class="ys empty">unscored</span>\`}</td>
      <td>\${st.verdict?\`<span class="vchip v-\${st.verdict}">\${st.verdict}</span>\`:\`<span class="vchip v-none">—</span>\`}</td>
    </tr>\`;
  }).join('');
}

function syncUI(){
  C.forEach(c=>{
    const st=S[c.id];
    if(st.score!=null){ document.getElementById('rg-'+c.id).value=st.score; document.getElementById('bs-'+c.id).innerHTML=st.score+'<small>/10</small>'; }
    document.getElementById('nt-'+c.id).value=st.notes||'';
    document.querySelectorAll(\`.stamp[data-c="\${c.id}"]\`).forEach(b=>b.classList.toggle('on', b.dataset.v===st.verdict));
    c.qs.forEach((_,qi)=>{
      const on=!!st.asked[qi];
      const cb=document.getElementById(\`cb-\${c.id}-\${qi}\`); if(cb){cb.checked=on; document.getElementById(\`q-\${c.id}-\${qi}\`).classList.toggle('done',on);}
    });
    updateQC(c.id);
  });
}
function updateQC(id){
  const c=C.find(x=>x.id===id); const n=Object.values(S[id].asked).filter(Boolean).length;
  document.getElementById('qc-'+id).textContent=\` \${n}/\${c.qs.length} asked\`;
}

/* ================= EVENTS ================= */
function wire(){
  document.getElementById('cards').addEventListener('input',e=>{
    const id=e.target.dataset.c; if(!id) return;
    if(e.target.type==='range'){
      S[id].score=parseFloat(e.target.value);
      document.getElementById('bs-'+id).innerHTML=S[id].score+'<small>/10</small>';
      renderTable(id); save(id);
    }else if(e.target.tagName==='TEXTAREA'){ S[id].notes=e.target.value; save(id); }
  });
  document.getElementById('cards').addEventListener('change',e=>{
    if(e.target.type==='checkbox'){
      const id=e.target.dataset.c, qi=e.target.dataset.q;
      S[id].asked[qi]=e.target.checked;
      document.getElementById(\`q-\${id}-\${qi}\`).classList.toggle('done',e.target.checked);
      updateQC(id); save(id);
    }
  });
  document.getElementById('cards').addEventListener('click',e=>{
    const b=e.target.closest('.stamp'); if(!b) return;
    const id=b.dataset.c, v=b.dataset.v;
    S[id].verdict = (S[id].verdict===v)? null : v;
    document.querySelectorAll(\`.stamp[data-c="\${id}"]\`).forEach(x=>{x.classList.remove('on','thump');});
    if(S[id].verdict){ b.classList.add('on','thump'); if(v==='SIGN') confetti(); }
    renderTable(id); save(id);
  });
  document.getElementById('ltable').addEventListener('click',e=>{
    const tr=e.target.closest('tr'); if(!tr) return;
    document.getElementById('card-'+tr.dataset.c)?.scrollIntoView({behavior:'smooth',block:'start'});
  });
  document.getElementById('resetBtn').addEventListener('click',()=>{
    if(!confirm('Wipe all scores, verdicts, checkmarks and notes?')) return;
    C.forEach(c=>S[c.id]={score:null,verdict:null,notes:'',asked:{}});
    try{ localStorage.setItem(KEY, JSON.stringify(S)); }catch(e){}
    renderCards(); renderTable(); syncUI();
  });
}

function confetti(){
  if(matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cols=['#FFB424','#7FC7E8','#F4EFDF','#7CE0A5','#E5484D'];
  for(let i=0;i<70;i++){
    const d=document.createElement('div'); d.className='confetti';
    const s=6+Math.random()*8;
    d.style.cssText=\`left:\${Math.random()*100}vw;width:\${s}px;height:\${s*0.5}px;background:\${cols[i%5]};animation-duration:\${1.6+Math.random()*1.6}s;animation-delay:\${Math.random()*0.4}s\`;
    document.body.appendChild(d); setTimeout(()=>d.remove(),3600);
  }
}

/* ================= TICKER ================= */
const headlines=${js(headlines)};
(function(){
  const s=headlines.map(h=>\` ⚽ \${h} \`).join('');
  document.getElementById('ticker').textContent=s+s;
})();

/* ================= BOOT ================= */
renderCards(); renderTable(); wire();
load(); syncUI(); renderTable();
</script>
</body>
</html>
`;
}
