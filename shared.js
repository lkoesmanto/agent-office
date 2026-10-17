/* =========================================================================
   Agent office: shared runtime for index.html (Pixel) and 3d.html (3D)
   - Agents, demo generator, status.json data layer, handoff queue
   - Header chrome: Pixel | 3D switch, badge, Refresh / Pause, settings
   - Live controls: paused by default; Refresh goes live (polls every 60 s)
     and optionally POSTs a webhook; auto-pause 2 h after the last Refresh.
   Webhook settings live ONLY in this browser's localStorage.
   Query params: ?demo=1  ?status=<url>  ?autopause=<minutes>  ?hour=<0-23>
   ========================================================================= */
(function(){
"use strict";
const params = new URLSearchParams(location.search);
const FORCE_DEMO = params.get("demo") === "1";
const STATUS_URL = params.get("status") || "status.json";
const POLL_MS = 60000;
const AP = parseFloat(params.get("autopause"));
const AUTOPAUSE_MS = (AP > 0 ? AP : 120) * 60000;
const COOLDOWN_MS = 5 * 60000, UPDATING_MAX_MS = 5 * 60000;
const LS_SETTINGS = "agentOffice.settings.v1", LS_LASTREQ = "agentOffice.lastUpdateRequest";
const STATES = ["working", "thinking", "idle", "stretching"];
const MAX_WALKERS = 3;

const AGENTS = [
  {id:"archangel",name:"Archangel",role:"Chief of Staff",look:{hair:"#2C2C2E",shirt:"#0071E3",skin:"#E0AC69",pants:"#1D1D1F"}},
  {id:"waktu",name:"Waktu",role:"Time Keeper",look:{hair:"#5A3825",shirt:"#34C759",skin:"#C68642",pants:"#3A3A3C"}},
  {id:"willow",name:"Willow",role:"Marketing",look:{hair:"#C8553D",shirt:"#FF9F0A",skin:"#FFDBAC",pants:"#48484A",long:1}},
  {id:"atlas",name:"Atlas",role:"Researcher",look:{hair:"#1D1D1F",shirt:"#5E5CE6",skin:"#8D5524",pants:"#2C2C2E"}},
  {id:"wish",name:"Wish",role:"Strategy",look:{hair:"#8E5A2B",shirt:"#AF52DE",skin:"#F1C27D",pants:"#1D1D1F",long:1}},
  {id:"altmodei",name:"AltModei",role:"AI Strategist",look:{hair:"#3A3A3C",shirt:"#0A84FF",skin:"#FFDBAC",pants:"#48484A"}},
  {id:"brin",name:"Brin",role:"CPO · Product",look:{hair:"#D9A066",shirt:"#FF375F",skin:"#E0AC69",pants:"#2C2C2E"}},
  {id:"lake",name:"Lake",role:"Finance",look:{hair:"#2C2C2E",shirt:"#30D158",skin:"#F1C27D",pants:"#1D1D1F"}},
  {id:"ote2",name:"Ote2",role:"Legal review",look:{hair:"#8E8E93",shirt:"#30B0C7",skin:"#FFDBAC",pants:"#1D1D1F"}},
  {id:"luke",name:"Luke",role:"HR & Hiring",look:{hair:"#6B4423",shirt:"#FFD60A",skin:"#C68642",pants:"#3A3A3C"}},
  {id:"alx",name:"Alx",role:"IT",look:{hair:"#1D1D1F",shirt:"#64D2FF",skin:"#E0AC69",pants:"#2C2C2E"}},
  {id:"kate",name:"Kate",role:"Travel",look:{hair:"#F2C46D",shirt:"#FF2D55",skin:"#FFDBAC",pants:"#48484A",long:1}},
  {id:"coach",name:"Presentation Coach",role:"Decks & talks",look:{hair:"#4A2C2A",shirt:"#BF5AF2",skin:"#8D5524",pants:"#1D1D1F"}},
];
const DEMO_TASKS = {
  archangel:["Triaging the inbox, 3 items flagged for Leo","Drafting replies for review","Reordering today's top 3 priorities","Preparing tomorrow's morning brief","Summarizing a long thread into 4 bullets"],
  waktu:["Logging hours to this week's timesheet","Resolving a calendar conflict","Compiling the weekly hours summary","Blocking focus time this afternoon"],
  willow:["Drafting a LinkedIn post on AI teams","Writing 3 hook variations","Scheduling Tuesday's post for 08:00 WIB","Turning a talk into a carousel"],
  atlas:["Scanning sources on agent workflows","Compiling a market landscape brief","Fact-checking stats for a draft","Summarizing industry reports"],
  wish:["Mapping options for Q4 priorities","Pressure-testing a pricing idea","Drafting a one-page strategy memo","Scoring opportunities on impact/effort"],
  altmodei:["Reviewing this week's model releases","Picking the next workflow to automate","Benchmarking two approaches","Weighing cost vs. quality trade-offs"],
  brin:["Prioritizing the product backlog","Drafting a feature spec","Writing user stories for next sprint","Reviewing feedback themes"],
  lake:["Categorizing this week's expenses","Updating the cash-flow forecast","Preparing an invoice draft","Budget vs. actuals summary"],
  ote2:["Reviewing a standard NDA template","Flagging clauses for a closer look","Summarizing terms in plain language","Checking terms against a checklist"],
  luke:["Drafting a job description","Screening applications vs. criteria","Preparing interview questions","Updating the onboarding checklist"],
  alx:["Checking backups: all green","Updating apps to latest versions","Auditing connected app permissions","Setting up a new integration"],
  kate:["Comparing flight options","Shortlisting hotels near the venue","Building a day-by-day itinerary","Checking entry requirements"],
  coach:["Restructuring a keynote into 3 acts","Tightening 18 slides down to 12","Writing speaker notes","Polishing the deck, minimal style"],
};
const DEMO_HANDOFFS = [
  ["atlas","wish","research brief ready"],["wish","brin","Q4 priorities memo"],["archangel","waktu","reschedule request"],
  ["willow","archangel","post draft for review"],["altmodei","alx","new automation to set up"],["lake","archangel","invoice for approval"],
  ["ote2","archangel","redline summary"],["luke","waktu","book candidate calls"],["kate","waktu","add trip to calendar"],
  ["atlas","willow","stats fact-checked"],["coach","willow","carousel from the talk"],["brin","atlas","research feedback themes"],
  ["archangel","coach","deck needed for Friday"],["wish","altmodei","which workflow next?"],["waktu","lake","hours for monthly report"],
  ["alx","archangel","access review complete"],["atlas","coach","data points for slide 6"],["altmodei","wish","model cost comparison"],
];

/* ---------- helpers ---------- */
const TZ = "Asia/Jakarta";
const fmtHM = new Intl.DateTimeFormat("en-GB",{timeZone:TZ,hour:"2-digit",minute:"2-digit",hour12:false});
const fmtHMS = new Intl.DateTimeFormat("en-GB",{timeZone:TZ,hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});
const pick = a => a[Math.floor(Math.random()*a.length)];
const hash = n => { const x = Math.sin(n*12.9898+78.233)*43758.5453; return x-Math.floor(x); };
const nowS = () => performance.now()/1000;
const $ = id => document.getElementById(id);
function jakartaHour(){
  if (params.has("hour")) return parseFloat(params.get("hour"));
  const [h,m] = fmtHM.format(new Date()).split(":").map(Number); return h + m/60;
}
function fmtLeft(ms){
  const s = Math.max(0, Math.floor(ms/1000)), h = Math.floor(s/3600), m = Math.floor(s%3600/60), sec = s%60;
  if (h > 0) return `${h}h${String(m).padStart(2,"0")}m`;
  if (m >= 2) return `${m}m`;
  return `${m}m${String(sec).padStart(2,"0")}s`;
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

/* Effective animation state: "stretching" if set explicitly, or if a working agent's task mentions "stretch". */
function effState(a){
  if (a.state === "stretching" || (a.state === "working" && /stretch/i.test(a.task || ""))) return "stretching";
  return a.state;
}

const byId = {};
AGENTS.forEach((a,i)=>{ Object.assign(a,{index:i,phase:hash(i+1)*10,seed:i*17+3,state:"idle",task:"",
  walker:null,folderUntil:0,nextDemo:0,flashUntil:0}); byId[a.id]=a; });

/* ---------- labels (nameplate + caption); renderer positions them ---------- */
function makeLabel(a){
  const el = document.createElement("div");
  el.className = "lab";
  el.innerHTML = `<div class="np"><i></i><b></b><span></span></div><div class="cap"></div>`;
  a.el=el; a.capEl=el.querySelector(".cap"); a.nameEl=el.querySelector("b"); a.roleEl=el.querySelector(".np span");
  return el;
}
function renderLabel(a){
  if (!a.el) return;
  const s = a.walker ? "handoff" : effState(a);
  if (a.el.dataset.s!==s) a.el.dataset.s=s;
  if (a.nameEl.textContent!==a.name) a.nameEl.textContent=a.name;
  if (a.roleEl.textContent!==a.role) a.roleEl.textContent=a.role;
  let cap = a.task;
  if (a.walker) cap = a.walker.phase==="back" ? "Back to desk…" : `→ ${byId[a.walker.to].name}: ${a.walker.label}`;
  if (a.shownCap!==cap){
    a.shownCap=cap; a.capEl.classList.add("out");
    clearTimeout(a.capT); a.capT=setTimeout(()=>{a.capEl.textContent=cap;a.capEl.classList.remove("out");},300);
  }
  a.el.classList.toggle("flash", nowS()<a.flashUntil);
}

/* ---------- feed ---------- */
function feedAdd(from,to,label,atDate){
  const stream=$("stream"); if(!stream) return;
  const li=document.createElement("li");
  li.innerHTML=`<span class="t"></span><b></b><span class="arr">→</span><b></b><span class="msg"></span>`;
  li.querySelector(".t").textContent=fmtHM.format(atDate&&!isNaN(atDate)?atDate:new Date())+" WIB";
  li.querySelectorAll("b")[0].textContent=byId[from]?.name||from;
  li.querySelectorAll("b")[1].textContent=byId[to]?.name||to;
  li.querySelector(".msg").textContent=label;
  stream.prepend(li);
  while(stream.children.length>3) stream.lastChild.remove();
}

/* ---------- handoff queue (renderers own the walking) ---------- */
const queue=[], walkers=[];
function enqueueHandoff(h){ if(byId[h.from]&&byId[h.to]&&h.from!==h.to) queue.push(h); }
function busy(id){ return !!byId[id].walker || walkers.some(w=>w.to===id||w.from===id); }
function nextHandoff(){
  if (walkers.length>=MAX_WALKERS) return null;
  for (let i=0;i<queue.length;i++){ const h=queue[i]; if(busy(h.from)||busy(h.to)) continue; queue.splice(i,1); return h; }
  return null;
}
function beginWalk(w){ byId[w.from].walker=w; walkers.push(w); }
function deliver(w){
  const b=byId[w.to]; b.folderUntil=nowS()+8; b.flashUntil=nowS()+1.6;
  if (w.addFeed!==false) feedAdd(w.from,w.to,w.label,w.at?new Date(w.at):new Date());
}
function endWalk(w){ byId[w.from].walker=null; const i=walkers.indexOf(w); if(i>=0) walkers.splice(i,1); }

/* ---------- demo generator ---------- */
let demoRunning=false, nextDemoHandoff=0;
function startDemoData(){
  demoRunning=true; queue.length=0;
  const init=["working","thinking","working","working","idle","thinking","working","working","idle","thinking","working","idle","working"];
  AGENTS.forEach((a,i)=>{ a.state=init[i]; a.task=DEMO_TASKS[a.id][i%DEMO_TASKS[a.id].length]; a.nextDemo=nowS()+2+hash(i)*5; });
  nextDemoHandoff=nowS()+0.4;
  const st=$("stream"); if(st) st.innerHTML="";
  const t0=Date.now();
  [["lake","archangel","invoice for approval",190000],["ote2","archangel","redline summary",95000]]
    .forEach(h=>feedAdd(h[0],h[1],h[2],new Date(t0-h[3])));
}
function demoTick(){
  if(!demoRunning) return;
  const t=nowS();
  AGENTS.forEach(a=>{
    if(a.walker||t<a.nextDemo) return;
    const pool=DEMO_TASKS[a.id]; a.task=pool[(pool.indexOf(a.task)+1)%pool.length];
    if(Math.random()<.4) a.state=pick(["working","working","working","thinking","thinking","idle","stretching"]);
    a.nextDemo=t+4+Math.random()*4;
  });
  if(t>=nextDemoHandoff){
    const opts=DEMO_HANDOFFS.filter(h=>!busy(h[0])&&!busy(h[1]));
    if(opts.length && walkers.length+queue.length<MAX_WALKERS){ const h=pick(opts); enqueueHandoff({from:h[0],to:h[1],label:h[2]}); }
    nextDemoHandoff=t+3.5+Math.random()*2.5;
  }
}

/* ---------- live data ---------- */
let mode="paused";              // "paused" | "live" | "demo" (forced via ?demo=1)
let liveUntil=0, pollTimer=null, autoTimer=null, liveLoadedOnce=false, lastUpdatedAt=null, updating=null, pollSeq=0;
const seen=new Set();
function applyStatus(j){
  for(const s of j.agents){
    if(!s) continue;
    const a = byId[s.id] || AGENTS.find(x=>x.name.toLowerCase()===String(s.name||"").toLowerCase());
    if(!a) continue;
    if(typeof s.name==="string" && s.name) a.name=s.name.slice(0,40);
    if(typeof s.role==="string" && s.role) a.role=s.role.slice(0,40);
    if(STATES.includes(s.state)) a.state=s.state;
    if(typeof s.task==="string") a.task=s.task.slice(0,140);
  }
  const hs=(Array.isArray(j.handoffs)?j.handoffs:[]).filter(h=>h&&byId[h.from]&&byId[h.to]&&h.from!==h.to)
     .sort((x,y)=>new Date(x.at||0)-new Date(y.at||0));
  const fresh=hs.filter(h=>{const k=`${h.from}|${h.to}|${h.at}|${h.label}`; if(seen.has(k))return false; seen.add(k); return true;});
  const lab=h=>String(h.label||"handoff").slice(0,80);
  if(!liveLoadedOnce){
    demoRunning=false; queue.length=0; $("stream").innerHTML="";
    walkers.forEach(w=>w.addFeed=false);           // demo walks in flight don't land in the live feed
    fresh.forEach(h=>feedAdd(h.from,h.to,lab(h),h.at?new Date(h.at):null));
    fresh.slice(-2).forEach(h=>enqueueHandoff({from:h.from,to:h.to,label:lab(h),at:h.at,addFeed:false}));
  } else {
    fresh.forEach(h=>enqueueHandoff({from:h.from,to:h.to,label:lab(h),at:h.at}));
  }
  liveLoadedOnce=true;
}
async function poll(){
  if(mode!=="live") return;
  const seq=++pollSeq;
  try{
    const r=await fetch(STATUS_URL+(STATUS_URL.includes("?")?"&":"?")+"t="+Date.now(),{cache:"no-store"});
    if(!r.ok) throw new Error("HTTP "+r.status);
    const j=await r.json();
    if(!j || !Array.isArray(j.agents)) throw new Error("bad schema");
    if(mode!=="live" || seq!==pollSeq) return;          // paused (or superseded) while fetching
    applyStatus(j);
    const u=String(j.updated_at||"");
    if(updating){
      const ut=Date.parse(u);
      if(updating.baseline==null && !(ut>=updating.since-5000)) updating.baseline=u;
      else if((updating.baseline!=null && u!==updating.baseline) || ut>=updating.since-5000){ updating=null; setNote("Fresh snapshot received"); }
    }
    lastUpdatedAt=u;
  }catch(e){
    if(mode==="live" && !liveLoadedOnce) setNote("No snapshot published yet, showing demo until one is available",true);
  }
  updateUI();
}

/* ---------- settings (localStorage only) ---------- */
function loadSettings(){ try{ return JSON.parse(localStorage.getItem(LS_SETTINGS))||{}; }catch(e){ return {}; } }
function saveSettings(s){ try{ localStorage.setItem(LS_SETTINGS,JSON.stringify(s)); return true; }catch(e){ return false; } }
function clearSettings(){ try{ localStorage.removeItem(LS_SETTINGS); localStorage.removeItem(LS_LASTREQ); }catch(e){} }
function lastReq(){ try{ return +localStorage.getItem(LS_LASTREQ)||0; }catch(e){ return 0; } }
function cooldownLeft(){ return loadSettings().webhook ? Math.max(0,lastReq()+COOLDOWN_MS-Date.now()) : 0; }

async function requestUpdate(){
  const s=loadSettings();
  if(!s.webhook) return;
  if(cooldownLeft()>0){ setNote("An update was requested in the last 5 minutes, showing the latest snapshot"); return; }
  try{ localStorage.setItem(LS_LASTREQ,String(Date.now())); }catch(e){}
  updating={since:Date.now(), baseline:lastUpdatedAt};
  updateUI();
  const name=(s.header||"").trim()||"Authorization";
  const headers={"Content-Type":"application/json"};
  if(s.key) headers[name] = name.toLowerCase()==="authorization" ? "Bearer "+s.key : s.key;
  try{
    const r=await fetch(s.webhook,{method:"POST",mode:"cors",credentials:"omit",cache:"no-store",referrerPolicy:"no-referrer",
      headers, body:JSON.stringify({action:"refresh_status",requested_at:new Date().toISOString()})});
    if(!r.ok) throw new Error("HTTP "+r.status);
  }catch(e){
    if(e instanceof TypeError){ try{ localStorage.removeItem(LS_LASTREQ); }catch(_){} } // network/CORS: allow a retry
    updating=null; setNote("Couldn't request an update, showing the last snapshot",true); updateUI();
  }
}

/* ---------- modes ---------- */
function stopPolling(){ clearInterval(pollTimer); pollTimer=null; clearTimeout(autoTimer); autoTimer=null; pollSeq++; }
function enterPaused(){
  stopPolling();
  mode = FORCE_DEMO ? "demo" : "paused";
  liveUntil=0; updating=null; liveLoadedOnce=false; seen.clear();
  walkers.forEach(w=>w.addFeed=false);
  document.body.classList.remove("is-live");
  startDemoData(); updateUI();
}
function goLive(){
  if(FORCE_DEMO) return;
  if(mode!=="live"){ mode="live"; liveLoadedOnce=false; seen.clear(); document.body.classList.add("is-live"); }
  liveUntil=Date.now()+AUTOPAUSE_MS;                       // (re)start the auto-pause window
  clearTimeout(autoTimer); autoTimer=setTimeout(checkAutoPause, AUTOPAUSE_MS);
  requestUpdate();
  clearInterval(pollTimer); pollTimer=setInterval(poll,POLL_MS); poll();
  updateUI();
}
function checkAutoPause(){
  if(mode==="live" && Date.now()>=liveUntil){ enterPaused(); setNote(`Auto-paused ${fmtLeft(AUTOPAUSE_MS).replace("h00m","h")} after the last Refresh`); }
}

/* ---------- UI ---------- */
let noteT;
function setNote(msg,warn){
  const n=$("note"); if(!n) return;
  n.textContent=msg; n.classList.toggle("warn",!!warn);
  clearTimeout(noteT); noteT=setTimeout(()=>{n.textContent="";},10000);
}
function updateUI(){
  checkAutoPause();
  const badge=$("badge"), bt=$("badgeText"), br=$("btnRefresh"), bp=$("btnPause"), eb=$("eyebrowText");
  if(!badge) return;
  const live=mode==="live";
  badge.classList.toggle("live",live);
  eb.textContent = live ? "Live · Jakarta HQ" : "Jakarta HQ";
  if(mode==="demo") bt.textContent="Demo data";
  else if(mode==="paused") bt.textContent="Paused · demo";
  else {
    const ud=Date.parse(lastUpdatedAt);
    const head = liveLoadedOnce ? `Live · updated ${isNaN(ud)?"–":fmtHM.format(new Date(ud))} WIB` : "Live · waiting for snapshot";
    bt.textContent = `${head} · auto-pause in ${fmtLeft(liveUntil-Date.now())}`;
  }
  if(updating && Date.now()-updating.since>UPDATING_MAX_MS){ updating=null; setNote("No new snapshot yet, showing the last one"); }
  const cd=cooldownLeft();
  let html="Refresh", dis=false, title="Go live: load the latest snapshot and poll every minute";
  if(FORCE_DEMO){ dis=true; title="Demo mode (?demo=1)"; }
  else if(updating){ dis=true; html='<span class="spin"></span>Updating…'; }
  else if(live && cd>0){ dis=true; const s=Math.ceil(cd/1000); html=`Refresh in ${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`; title="An update can be requested once every 5 minutes"; }
  if(br.innerHTML!==html) br.innerHTML=html;
  br.disabled=dis; br.title=title;
  bp.disabled=!live;
}

const GEAR='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

function mount(view){
  const q=esc(location.search);
  $("officeHeader").innerHTML=`
    <div>
      <div class="eyebrow"><span class="live-dot"></span><span id="eyebrowText">Jakarta HQ</span></div>
      <h1>I didn't hire tools. I staffed roles.</h1>
      <p class="sub">Leo's one-person company, staffed by AI agents</p>
    </div>
    <div class="side">
      <div class="row">
        <nav class="seg" aria-label="View"><a href="index.html${q}" class="${view==="pixel"?"on":""}">Pixel</a><a href="3d.html${q}" class="${view==="3d"?"on":""}">3D</a></nav>
        <span class="badge" id="badge"><i></i><span id="badgeText">Paused · demo</span></span>
      </div>
      <div class="row">
        <div class="legend">
          <span><i style="background:var(--working)"></i>Working</span><span><i style="background:var(--thinking)"></i>Thinking</span>
          <span><i style="background:var(--handoff)"></i>Handoff</span><span><i style="background:var(--stretching)"></i>Stretching</span><span><i style="background:var(--idle)"></i>Idle</span>
        </div>
        <button class="btn primary" id="btnRefresh" type="button">Refresh</button>
        <button class="btn grey" id="btnPause" type="button" disabled>Pause</button>
        <button class="btn icon" id="btnGear" type="button" aria-label="Settings" title="Live update settings" aria-expanded="false">${GEAR}</button>
      </div>
      <div class="note" id="note" aria-live="polite"></div>
      <div class="settings" id="settings" role="dialog" aria-label="Live update settings">
        <h3>Live update settings</h3>
        <p>Saved only in this browser (localStorage), never in the site or its source.</p>
        <label for="sWebhook">Webhook URL</label>
        <input id="sWebhook" type="url" placeholder="https://… (optional)" autocomplete="off" spellcheck="false">
        <label for="sKey">Sender key</label>
        <input id="sKey" type="password" placeholder="optional" autocomplete="off">
        <label for="sHeader">Key header name</label>
        <input id="sHeader" type="text" placeholder="Authorization" autocomplete="off" spellcheck="false">
        <p style="margin:6px 0 0">Authorization is sent as “Bearer &lt;key&gt;”. Any other header name sends the raw key.</p>
        <div class="acts"><button class="btn grey" id="sClear" type="button">Clear</button><span class="saved" id="sSaved"></span><button class="btn primary" id="sSave" type="button">Save</button></div>
      </div>
    </div>`;
  $("officeFeed").innerHTML=`<h2>Handoffs<small>Agent → agent</small></h2><ul class="stream" id="stream"></ul>`;
  $("officeFooter").innerHTML=`<span>Leo Koesmanto · 1 human, 13 agents · task lines are generic</span><span id="clock"></span>`;

  $("btnRefresh").addEventListener("click",goLive);
  $("btnPause").addEventListener("click",()=>{ enterPaused(); setNote("Paused · polling stopped"); });
  const panel=$("settings"), gear=$("btnGear");
  const fill=()=>{ const s=loadSettings(); $("sWebhook").value=s.webhook||""; $("sKey").value=s.key||""; $("sHeader").value=s.header||"Authorization"; $("sSaved").textContent=""; };
  const open=v=>{ panel.classList.toggle("open",v); gear.setAttribute("aria-expanded",String(v)); if(v) fill(); };
  gear.addEventListener("click",e=>{ e.stopPropagation(); open(!panel.classList.contains("open")); });
  panel.addEventListener("click",e=>e.stopPropagation());
  document.addEventListener("click",()=>open(false));
  document.addEventListener("keydown",e=>{ if(e.key==="Escape") open(false); });
  $("sSave").addEventListener("click",()=>{
    const webhook=$("sWebhook").value.trim();
    if(webhook && !/^https?:\/\//i.test(webhook)){ $("sSaved").textContent="URL must start with https://"; $("sSaved").style.color="#B25E00"; return; }
    const ok=saveSettings({webhook, key:$("sKey").value, header:($("sHeader").value.trim()||"Authorization")});
    $("sSaved").style.color=""; $("sSaved").textContent=ok?"Saved in this browser":"Couldn't save (storage blocked)"; updateUI();
  });
  $("sClear").addEventListener("click",()=>{ clearSettings(); fill(); $("sSaved").textContent="Cleared"; updateUI(); });

  const clock=$("clock"), tc=()=>clock.textContent="Jakarta · "+fmtHMS.format(new Date())+" WIB";
  tc(); setInterval(tc,1000); setInterval(updateUI,500);
  enterPaused();                                            // default: paused, demo, no fetch
}

function tick(){ demoTick(); AGENTS.forEach(renderLabel); }

window.Office = { AGENTS, byId, effState, params, fmtHM, fmtHMS, hash, nowS, jakartaHour, makeLabel, renderLabel,
  walkers, nextHandoff, beginWalk, deliver, endWalk, busy, tick, mount,
  _debug:{ get mode(){return mode;}, get liveUntil(){return liveUntil;}, AUTOPAUSE_MS, get updating(){return updating;}, get pollTimer(){return pollTimer;} } };
})();
