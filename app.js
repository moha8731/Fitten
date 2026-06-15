const VERSION = 'v22-daily-loop';
const STORE_KEY = 'bulkmind_revamp_v14';
const oldKeys = ['bulkmind_revamp_v13','bulkmind:v12','bulkmind_v12','bulkmind:v13'];
const app = document.getElementById('app');

let storageMode = 'localStorage';
const memoryStore = new Map();
const storage = (() => {
  try {
    const testKey = '__bulkmind_storage_test__';
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    return window.localStorage;
  } catch (e) {
    storageMode = 'memory-only';
    console.warn('BulkMind storage fallback active:', e);
    return {
      getItem: key => memoryStore.has(key) ? memoryStore.get(key) : null,
      setItem: (key, value) => { memoryStore.set(key, String(value)); },
      removeItem: key => { memoryStore.delete(key); }
    };
  }
})();
function clone(obj){
  try { return structuredClone(obj); }
  catch(e){ return JSON.parse(JSON.stringify(obj)); }
}
function safeId(){
  try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch(e) {}
  return 'id_' + Date.now().toString(36) + Math.random().toString(36).slice(2);
}

const defaults = {
  version: VERSION,
  activeTab: 'today',
  lastFeedNudge: '',
  dailyWins: [],
  setupDone: false,
  apiKey: '',
  useServerKeys: true,
  retailerToken: '',
  model: 'gemini-2.5-flash',
  useSearch: true,
  profile: {
    name: '', age: 18, sex: 'male', height: 175, weight: 60, targetWeight: 84, months: 8,
    activity: 'moderate', trainingDays: 3, goalStyle: 'balanced', appetite: 'low', store: 'Netto', sallingStoreId: '', budget: 300,
    people: 1, units: 'metric'
  },
  diet: { halal: true, noPork: true, vegan: false, vegetarian: false, lactoseFree: false, highProtein: true, highCalorie: true, lowCalorie: false, fruitVeg: false },
  equipment: { stove: true, oven: true, airfryer: true, microwave: true, blender: true, noCook: false },
  mealsWanted: { breakfast: true, lunch: true, dinner: true, snacks: true, shake: true },
  targets: { calories: 3100, protein: 130, carbs: 410, fat: 90, weeklyGain: .6, source: 'starter' },
  logs: [], weights: [], workouts: [], products: [], savedMeals: [], plan: null, lastGenerated: null,
  pantry: [], mealDNA: {}, shoppingHistory: [],
  todayNote: '', coachTone: 'direct', aiCitations: [],
  plannerBrain: { mood:'normal', cookingEffort:'low effort', foodFatigue:true, leftovers:true, pantryFirst:true, wasteSmart:true, explainList:true, confidence:true, eatingTimes:'07:30 breakfast, 11:30 lunch, 15:30 shake/snack, 18:30 dinner, 22:00 pre-bed snack' },
  priceIntel: {
    mode: 'Nemlig + online flyers',
    sources: { nemlig: true, onlineFlyers: true, salling: false, savedProducts: true, manual: true },
    bufferPct: 10,
    sanityCheck: true,
    inflationAware: true,
    rejectCrazyPrices: true,
    preferOnlinePrices: true,
    priceRegion: 'Denmark'
  }
};

let state = loadState();
let setupStep = 0;
let planDraft = null;
let generating = false;

function loadState(){
  try{
    const raw = storage.getItem(STORE_KEY);
    if(raw) return merge(defaults, JSON.parse(raw));
    for(const k of oldKeys){
      const v = storage.getItem(k);
      if(v){ const parsed = JSON.parse(v); return merge(defaults, normalizeOld(parsed)); }
    }
  }catch(e){ console.warn(e); }
  return clone(defaults);
}
function normalizeOld(o){
  const n = {};
  if(o.apiKey) n.apiKey = o.apiKey;
  if(o.profile) n.profile = {...defaults.profile, ...o.profile};
  if(o.targets) n.targets = {...defaults.targets, ...o.targets};
  if(o.products) n.products = o.products;
  if(o.plan) n.plan = o.plan;
  return n;
}
function merge(a,b){
  if(Array.isArray(a)) return Array.isArray(b) ? b : a;
  if(typeof a !== 'object' || a === null) return b ?? a;
  const out = {...a};
  for(const k in b || {}) out[k] = k in a ? merge(a[k], b[k]) : b[k];
  return out;
}
function save(){ try{ state.version = VERSION; storage.setItem(STORE_KEY, JSON.stringify(state)); }catch(e){ console.warn('Save failed', e); toast('Storage is limited on this browser'); } }
function $(sel, root=document){ return root.querySelector(sel); }
function $all(sel, root=document){ return Array.from(root.querySelectorAll(sel)); }
function esc(v=''){ return String(v).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function num(v, fallback=0){ const n = Number(String(v).replace(',','.')); return Number.isFinite(n) ? n : fallback; }
function round(v,d=0){ return Math.round((Number(v)||0)*10**d)/10**d; }
function todayISO(){ return new Date().toISOString().slice(0,10); }
function toast(msg){ const t=document.createElement('div'); t.className='toast'; t.textContent=msg; document.body.appendChild(t); setTimeout(()=>t.remove(),2200); }
function imgFor(type){
  const t = String(type||'').toLowerCase();
  if(t.includes('shake') || t.includes('smoothie')) return 'assets/shake.svg';
  if(t.includes('grocery') || t.includes('list') || t.includes('shopping')) return 'assets/grocery.svg';
  if(t.includes('train') || t.includes('workout')) return 'assets/train.svg';
  if(t.includes('progress') || t.includes('graph')) return 'assets/progress.svg';
  return 'assets/meal.svg';
}
function mealNameIcon(name=''){
  const n=name.toLowerCase();
  if(n.includes('shake')||n.includes('smoothie')) return '🥤';
  if(n.includes('rice')||n.includes('ris')) return '🍚';
  if(n.includes('pasta')) return '🍝';
  if(n.includes('egg')||n.includes('æg')) return '🍳';
  if(n.includes('wrap')) return '🌯';
  if(n.includes('chicken')||n.includes('kylling')) return '🍗';
  return '🍽️';
}


function activePriceSources(){
  const pi = state.priceIntel || defaults.priceIntel;
  return Object.keys(pi.sources || {}).filter(k => pi.sources[k]).map(k => ({nemlig:'Nemlig', onlineFlyers:'online tilbudsaviser', salling:'Salling API', savedProducts:'saved products', manual:'manual prices'}[k] || k));
}
function priceSourceLabel(){
  const pi = state.priceIntel || defaults.priceIntel;
  return `${pi.mode || 'saved + estimates'} · +${pi.bufferPct ?? 10}% safety buffer`;
}
function basePriceCategory(name=''){
  const t = String(name).toLowerCase();
  if(/banan|banana/.test(t)) return {cat:'banana', unit:'kg', min:8, max:35, extreme:60};
  if(/mælk|milk|sødmælk|letmælk|minimælk|skummet/.test(t)) return {cat:'milk', unit:'l', min:6, max:22, extreme:35};
  if(/havre|oat|oats/.test(t)) return {cat:'oats', unit:'kg', min:8, max:35, extreme:60};
  if(/ris|rice/.test(t)) return {cat:'rice', unit:'kg', min:10, max:45, extreme:80};
  if(/pasta/.test(t)) return {cat:'pasta', unit:'kg', min:8, max:45, extreme:80};
  if(/kylling|chicken|hakket okse|beef|kød/.test(t)) return {cat:'meat', unit:'kg', min:35, max:130, extreme:220};
  if(/æg|egg/.test(t)) return {cat:'eggs', unit:'pack', min:15, max:45, extreme:80};
  if(/skyr|yoghurt|yogurt/.test(t)) return {cat:'skyr/yogurt', unit:'item', min:10, max:35, extreme:60};
  if(/whey|proteinpulver|protein powder/.test(t)) return {cat:'whey', unit:'kg', min:120, max:350, extreme:600};
  if(/peanut|jordnød|nut butter/.test(t)) return {cat:'peanut butter', unit:'jar', min:15, max:65, extreme:100};
  return {cat:'generic grocery', unit:'item', min:2, max:120, extreme:250};
}
function applyPriceBuffer(price){
  const pct = Number(state.priceIntel?.bufferPct ?? 10);
  const p = Number(price)||0;
  return p > 0 ? round(p * (1 + pct/100), 2) : 0;
}
function sanityCheckPrice(item){
  const price = Number(item.price)||0;
  const rawName = item.name || item.storeItemName || '';
  const cat = basePriceCategory(rawName);
  let warning = '';
  let blocked = false;
  if(price <= 0){ warning = 'needs price'; }
  else if(price > cat.extreme){ warning = `unrealistic for ${cat.cat}; check price/source`; blocked = true; }
  else if(price > cat.max){ warning = `high for ${cat.cat}; possible but verify`; }
  else if(price < cat.min){ warning = `low for ${cat.cat}; maybe campaign/amount issue`; }
  return { ...cat, warning, blocked };
}
function normalizePlanPrices(plan){
  if(!plan) return plan;
  const pi = state.priceIntel || defaults.priceIntel;
  const list = Array.isArray(plan.shoppingList) ? plan.shoppingList : [];
  let baseTotal = 0, bufferedTotal = 0;
  const warnings = [];
  plan.shoppingList = list.map((it)=>{
    const base = Number(it.basePrice ?? it.price ?? 0) || 0;
    const buffered = base ? applyPriceBuffer(base) : 0;
    const item = { ...it, basePrice: base, price: buffered || base, bufferPct: Number(pi.bufferPct ?? 10), buffered: !!base };
    const check = pi.sanityCheck ? sanityCheckPrice(item) : {warning:''};
    item.priceCheck = check.warning || 'ok';
    if(check.warning) warnings.push(`${item.name || 'Item'}: ${check.warning}`);
    if(check.blocked && pi.rejectCrazyPrices){ item.needsPrice = true; item.priceSource = 'blocked by sanity check'; }
    if(!item.priceSource) item.priceSource = 'AI/saved estimate';
    if(item.priceSource.toLowerCase().includes('estimate')) item.needsPrice = true;
    baseTotal += base;
    bufferedTotal += Number(item.price)||0;
    return item;
  });
  plan.baseTotalPrice = round(baseTotal,2);
  plan.totalPrice = round(bufferedTotal || Number(plan.totalPrice)||0,2);
  plan.priceAudit = {
    mode: pi.mode,
    sources: activePriceSources(),
    bufferPct: Number(pi.bufferPct ?? 10),
    baseTotal: round(baseTotal,2),
    bufferedTotal: round(bufferedTotal,2),
    warningCount: warnings.length,
    warnings: warnings.slice(0,12),
    note: `All item prices shown include a ${Number(pi.bufferPct ?? 10)}% safety buffer unless they are missing.`
  };
  return plan;
}
function compactProductForPrice(p){
  return { name:p.name, category:p.category, store:p.store, price:p.price, packageSize:p.packageSize, unit:p.unit, calories:p.calories, protein:p.protein, preferred:p.preferred, priceSource:p.priceSource };
}
function priceStatusIcon(i){
  if(i.needsPrice) return '⚠️';
  if((i.priceCheck||'').includes('high') || (i.priceCheck||'').includes('low')) return '👀';
  return '✅';
}

function selectedStoreStatus(){
  const store = state.profile.store || 'Nemlig';
  const salling = ['Netto','Føtex','Bilka'].includes(store);
  const pi = state.priceIntel || defaults.priceIntel;
  const realPriced = (state.products||[]).filter(p => p.price && p.packageSize && (p.calories || p.protein));
  const exactCount = realPriced.length;
  const online = pi.sources?.nemlig || pi.sources?.onlineFlyers;
  return {
    store,
    salling,
    exactCount,
    mode: pi.mode,
    bufferPct: pi.bufferPct,
    status: exactCount ? `${exactCount} saved real-price products + online price scout` : 'Online price scout + estimates until products are saved',
    live: salling && !!state.profile.sallingStoreId,
    text: online
      ? `Price mode is ${pi.mode}. BulkMind asks Gemini/search to find Danish online/Nemlig/flyer price candidates, then adds ${pi.bufferPct}% buffer and sanity-checks unrealistic prices. If a price cannot be verified, it is marked as estimate/scan.`
      : (salling ? `${store} can use Salling API when storeId/token is configured. Otherwise it uses saved prices and estimates.` : `${store} uses saved prices/manual prices/estimates unless you add online price scout.`)
  };
}
function priceTruth(plan){
  const list = plan?.shoppingList || [];
  const audit = plan?.priceAudit;
  const needs = list.filter(i => i.needsPrice || !i.price || String(i.priceSource||'').toLowerCase().includes('estimate') || String(i.priceCheck||'').includes('verify')).length;
  const real = list.length - needs;
  if(!list.length) return {label:'No shopping list yet', cls:'warn', note:'Generate a plan first.'};
  const buffer = audit?.bufferPct ?? state.priceIntel?.bufferPct ?? 10;
  if(needs===0) return {label:'Prices checked + buffered', cls:'', note:`All listed prices include +${buffer}% buffer and passed the sanity check.`};
  return {label:`${needs} prices need review`, cls:'warn', note:`${real} items look usable. ${needs} are estimates, missing, too high/low, or need a scan. Prices shown include +${buffer}% buffer when available.`};
}
function niceList(arr, empty='No details provided'){
  if(!arr || !arr.length) return `<p class="tiny">${empty}</p>`;
  return `<ul class="miniList">${arr.slice(0,8).map(x=>`<li>${esc(typeof x==='string'?x:(x.name||JSON.stringify(x)))}</li>`).join('')}</ul>`;
}
function planStepsCard(){
  const st = selectedStoreStatus();
  return `<section class="card guideCard">
    <div class="row between"><div><div class="eyebrow">What actually happens</div><div class="h2">Pick rules → Gemini builds meals → you shop the list.</div></div><span class="status ${st.exactCount?'':'warn'}">${st.exactCount?'Real saved prices':'Needs prices'}</span></div>
    <ol class="stepList">
      <li><b>Choose store.</b> This controls shopping style. It is not fake-live. If no official price source is connected, prices are marked as estimates.</li>
      <li><b>Set budget + people.</b> The shopping list scales for everyone, but macros stay per person.</li>
      <li><b>Choose meals/equipment/diet.</b> The plan must follow your calories, protein, carbs and fat targets.</li>
      <li><b>Generate plan.</b> The result shows every meal, ingredients, how to cook, total list, missing price data, and what to scan next.</li>
    </ol>
    <div class="truthBox"><b>${esc(st.store)} price status:</b><p class="p">${esc(st.text)}</p></div>
  </section>`;
}
function dayLog(){ const d=todayISO(); return state.logs.filter(l=>l.date===d); }
function totals(logs=dayLog()){
  return logs.reduce((a,l)=>{ a.calories += +l.calories||0; a.protein += +l.protein||0; a.carbs += +l.carbs||0; a.fat += +l.fat||0; return a; }, {calories:0,protein:0,carbs:0,fat:0});
}
function pct(v,t){ return Math.max(0, Math.min(100, Math.round((v/(t||1))*100))); }
function aiReady(){ return state.useServerKeys || (!!state.apiKey && state.apiKey.trim().length > 15); }
function aiModeLabel(){ if(state.apiKey && state.apiKey.trim().length > 15) return 'local Gemini key'; if(state.useServerKeys) return 'server AI mode'; return 'Gemini not connected'; }
function requireAI(){ if(aiReady()) return true; openSettings(true); toast('Connect Gemini or enable server key mode'); return false; }
function setTab(tab){ state.activeTab = tab; save(); render(); }

function render(){
  app.innerHTML = `
    <header class="topbar">
      <div class="brand" onclick="setTab('today')"><div class="logo">B</div><div class="title"><b>BulkMind</b><span>${esc(aiModeLabel())}${storageMode==='memory-only'?' · temporary storage':''}</span></div></div>
      <div class="spacer"></div>
      <button class="iconBtn" onclick="openSettings()">⚙️</button>
    </header>
    <main id="main">${state.setupDone ? renderTab() : renderWelcome()}</main>
    ${state.setupDone ? renderNav() : ''}
  `;
  if(!state.setupDone) bindWelcome(); else bindTab();
}
function renderNav(){
  const tabs = [['today','🏠','Today'],['food','🍽️','Food'],['planner','🛒','Plan'],['progress','📈','Progress']];
  return `<nav class="bottomNav">${tabs.map(t=>`<button class="navItem ${state.activeTab===t[0]?'active':''}" onclick="setTab('${t[0]}')"><span>${t[1]}</span><span>${t[2]}</span></button>`).join('')}</nav>`;
}
function renderWelcome(){
  return `<section class="card hero compactHero">
    <img src="assets/shake.svg" alt="BulkMind shake illustration">
    <div class="heroBody">
      <div class="eyebrow">v22 daily loop</div>
      <div class="h1">Open it. Know what to do. Done.</div>
      <p class="p">BulkMind is now built around a fast For You feed: missions, streaks, one-tap shakes, product memory and useful price decisions — not long AI chat boxes.</p>
      <div class="missionPreview">
        <div><b>🔥 Daily streak</b><span>eat + log + progress</span></div>
        <div><b>🥤 One-tap rescue</b><span>fix today fast</span></div>
        <div><b>🛒 Smart shop</b><span>buy only what matters</span></div>
      </div>
      <button class="btn" id="startSetup">Start setup</button>
      <button class="btn secondary" style="margin-top:10px" onclick="openSettings(true)">Connect Gemini first</button>
    </div>
  </section>`;
}
function bindWelcome(){ $('#startSetup')?.addEventListener('click',()=>openSetup()); }
function renderTab(){
  if(state.activeTab==='today') return renderToday();
  if(state.activeTab==='food') return renderFood();
  if(state.activeTab==='planner') return renderPlanner();
  if(state.activeTab==='progress') return renderProgress();
  return renderToday();
}
function bindTab(){
  if(state.activeTab==='food') bindFood();
  if(state.activeTab==='planner') bindPlanner();
  if(state.activeTab==='progress') bindProgress();
}

function renderToday(){
  const t = totals(); const target = state.targets;
  const gap = Math.max(0, Math.round(target.calories - t.calories));
  const proteinGap = Math.max(0, Math.round(target.protein - t.protein));
  const score = bulkScore(t);
  const next = nextMove(gap, proteinGap);
  const todayMeals = (state.plan?.days||[]).find(d=>d.date===todayISO() || d.day?.toLowerCase()==='today')?.meals || (state.plan?.days?.[0]?.meals || []);
  const feed = buildActionFeed(gap, proteinGap, t, todayMeals);
  return `
  <div class="screenTitle">For you</div>
  <section class="card dopamineHero">
    <div class="row between"><span class="status ${score>75?'':'warn'}">${score>75?'On track':'Needs move'}</span><span class="pill">🔥 ${streakDays()} day streak</span></div>
    <div class="h1">${esc(next.title)}</div>
    <p class="p">${esc(next.subtitle)}</p>
    <div class="ringRow">
      ${miniRing('Kcal', t.calories, target.calories)}
      ${miniRing('Protein', t.protein, target.protein, 'g')}
      ${miniRing('Score', score, 100)}
    </div>
    <div class="quickDock">
      <button onclick="quickShake()"><span>🥤</span><b>Fix</b></button>
      <button onclick="openQuickLog()"><span>⚡</span><b>Log</b></button>
      <button onclick="logUsualShake()"><span>⭐</span><b>Usual</b></button>
      <button onclick="setTab('planner')"><span>🛒</span><b>Plan</b></button>
    </div>
  </section>

  ${renderMissionBoard(t)}

  <div class="sectionHeader compact"><h2>Next cards</h2><span>swipe brain, tap action</span></div>
  ${renderForYouDeck(feed)}

  <div class="sectionHeader compact"><h2>Today’s food</h2><span>${dayLog().length} logs</span></div>
  ${dayLog().length ? `<div class="list compactList">${dayLog().slice().reverse().map(l=>`<div class="item row between"><div><b>${esc(l.name)}</b><div class="tiny">${Math.round(l.calories)} kcal · ${Math.round(l.protein)}g protein</div></div><button class="iconBtn danger" onclick="removeLog('${l.id}')">×</button></div>`).join('')}</div>` : `<div class="empty tight"><b>No logs yet</b><p class="p">Tap Log, Usual, or Fix. It should take under 10 seconds.</p></div>`}

  <div class="sectionHeader compact"><h2>Planned meals</h2><span>${todayMeals.length?todayMeals.length+' options':'none'}</span></div>
  ${todayMeals.length ? todayMeals.slice(0,3).map(mealCard).join('') : `<div class="empty tight"><b>No plan yet</b><p class="p">Generate a weekly plan once, then Today becomes automatic.</p><button class="btn small" onclick="setTab('planner')">Create plan</button></div>`}

  <section class="card coachBrief"><div class="row between"><div><b>Coach says</b><p class="p">${coachNote(t,gap,proteinGap)}</p></div><button class="btn small secondary" onclick="askCoachToday()">Ask</button></div></section>`;
}
function metric(label, value, target, percentage){
  const p = percentage ?? pct(Number(value)||0, Number(target)||1);
  return `<div class="metric"><span>${label}</span><b>${value}</b><span>/ ${target}</span><div class="bar"><i style="width:${p}%"></i></div></div>`;
}
function coachNote(t,gap,pg){
  if(!aiReady()) return 'Connect Gemini in settings so planning is real AI-first instead of offline estimates.';
  if(gap>1000) return `You are ${gap} kcal behind. Use a low-volume shake and one easy meal, not one insane giant shake.`;
  if(pg>35) return `Protein is the weak point. Use skyr, whey, chicken, eggs or a saved product that you already use.`;
  return 'You are close. Keep it simple: finish calories, hit protein, and log weight tomorrow morning.';
}

function firstName(){ return (state.profile.name || 'bro').trim().split(/\s+/)[0]; }
function bulkScore(t=totals()){
  return Math.round((pct(t.calories,state.targets.calories)*.44 + pct(t.protein,state.targets.protein)*.36 + (state.weights.some(w=>w.date===todayISO())?100:40)*.10 + (state.workouts.some(w=>w.date===todayISO())?100:40)*.10));
}
function nextMove(gap, proteinGap){
  if(gap > 900) return {title:`${firstName()}, fix ${gap} kcal`, subtitle:'One shake + one simple meal. No long chat. Just tap Fix.'};
  if(gap > 350) return {title:`${gap} kcal left`, subtitle:'You are close enough to finish with a snack or saved shake.'};
  if(proteinGap > 25) return {title:`Protein gap: ${proteinGap}g`, subtitle:'Use skyr, eggs, whey or a saved high-protein product.'};
  if(!state.weights.some(w=>w.date===todayISO())) return {title:'Log weight in 5 sec', subtitle:'The weekly adjustment only works if weight trend is real.'};
  return {title:'Tiny win secured', subtitle:'Keep the streak alive. Add one real log or prep tomorrow.'};
}
function miniRing(label, value, target, suffix=''){
  const p = pct(value,target); const deg = Math.min(100,p)*3.6;
  return `<div class="miniRing" style="--deg:${deg}deg"><div><b>${label==='Score'?Math.round(value):Math.round(value)}${suffix}</b><span>${esc(label)}</span></div></div>`;
}
function streakDays(){
  let streak=0;
  for(let i=0;i<90;i++){
    const d=new Date(); d.setDate(d.getDate()-i); const iso=d.toISOString().slice(0,10);
    const hasLog=state.logs.some(l=>l.date===iso);
    const hasWeight=state.weights.some(w=>w.date===iso);
    if(hasLog || hasWeight) streak++; else if(i>0) break;
  }
  return streak;
}
function renderMissionBoard(t){
  const missions = dailyMissions(t);
  const done = missions.filter(m=>m.done).length;
  return `<section class="card missionBoard"><div class="row between"><div><div class="eyebrow">Daily loop</div><div class="h2">${done}/${missions.length} wins today</div></div><span class="pill">+${done*35} XP</span></div>
    <div class="missionList">${missions.map(m=>`<button class="mission ${m.done?'done':''}" onclick="${m.action}"><span>${m.done?'✅':m.icon}</span><div><b>${esc(m.title)}</b><small>${esc(m.subtitle)}</small></div></button>`).join('')}</div>
  </section>`;
}
function dailyMissions(t){
  const hasFood = dayLog().length>0;
  const kcal80 = pct(t.calories,state.targets.calories)>=80;
  const protein80 = pct(t.protein,state.targets.protein)>=80;
  const hasWeight = state.weights.some(w=>w.date===todayISO());
  const hasPlan = !!state.plan;
  return [
    {icon:'⚡', title:'Log one thing', subtitle:'keep the app alive', done:hasFood, action:'openQuickLog()'},
    {icon:'🥤', title:'Fix calories', subtitle:kcal80?'calories mostly done':'make one rescue move', done:kcal80, action:'quickShake()'},
    {icon:'💪', title:'Protein check', subtitle:protein80?'protein handled':'close protein gap', done:protein80, action:'quickMeal()'},
    {icon:'⚖️', title:'Weight trend', subtitle:hasWeight?'logged today':'5 sec morning log', done:hasWeight, action:'openWeightLog()'},
    {icon:'🛒', title:'Plan/shop', subtitle:hasPlan?'weekly plan exists':'create real shop list', done:hasPlan, action:"setTab('planner')"}
  ];
}
function buildActionFeed(gap, proteinGap, t, meals=[]){
  const cards=[];
  if(gap>350) cards.push({type:'rescue', icon:'🥤', title:'Calorie rescue', text:`${gap} kcal left. Make a realistic shake using your saved products.`, primary:'Make shake', action:'quickShake()', secondary:'Use usual', secondaryAction:'logUsualShake()'});
  if(proteinGap>20) cards.push({type:'protein', icon:'💪', title:'Protein gap', text:`${proteinGap}g protein missing. Generate a fast high-protein meal, not a paragraph.`, primary:'Make meal', action:'quickMeal()'});
  if(!state.products.length) cards.push({type:'product', icon:'🥛', title:'Save your first product', text:'Add your real milk/whey/oats so AI stops guessing ingredients.', primary:'Add product', action:'openProductModal()'});
  else if(state.products.filter(p=>p.preferred).length===0) cards.push({type:'product', icon:'⭐', title:'Pick default products', text:'Mark your normal milk/whey as preferred so shakes become automatic.', primary:'Open products', action:"setTab('food')"});
  if(!state.plan) cards.push({type:'shop', icon:'🛒', title:'Make the week easy', text:'Generate one shopping list with budget, people, equipment and price buffer.', primary:'Create plan', action:"setTab('planner')"});
  if(!state.weights.some(w=>w.date===todayISO())) cards.push({type:'weight', icon:'⚖️', title:'5 second progress', text:'Log weight. This is what makes BulkMind better than ChatGPT.', primary:'Log weight', action:'openWeightLog()'});
  if(meals.length) cards.push({type:'meal', icon:'🍽️', title:'Use planned food', text:'Tap a planned meal and log your portion instead of thinking.', primary:'Show meals', action:"document.querySelector('.mealCard')?.scrollIntoView({behavior:'smooth'})"});
  cards.push({type:'price', icon:'💸', title:'Make it cheaper', text:'Scan one price/product. The app learns your real bulk economy.', primary:'Scan price', action:'openProductModal()'});
  return cards.slice(0,6);
}
function renderForYouDeck(cards){
  return `<div class="forYouDeck">${cards.map(c=>`<article class="feedCard ${esc(c.type)}"><div class="feedIcon">${c.icon}</div><div><b>${esc(c.title)}</b><p>${esc(c.text)}</p><div class="row wrap"><button class="btn small" onclick="${c.action}">${esc(c.primary)}</button>${c.secondary?`<button class="btn small secondary" onclick="${c.secondaryAction}">${esc(c.secondary)}</button>`:''}</div></div></article>`).join('')}</div>`;
}
function logUsualShake(){
  const milk = state.products.find(p=>p.preferred && /milk|mælk|sødmælk|letmælk|minimælk|skummet/i.test(p.name+' '+p.category)) || state.products.find(p=>/milk|mælk/i.test(p.name+' '+p.category));
  const whey = state.products.find(p=>p.preferred && /whey|protein/i.test(p.name+' '+p.category)) || state.products.find(p=>/whey|protein/i.test(p.name+' '+p.category));
  const oats = state.products.find(p=>/oat|havre/i.test(p.name+' '+p.category));
  const parts=[];
  let cal=0, pro=0, carbs=0, fat=0;
  function addProduct(prod, amount, label, fallback){
    const f=fallback || {};
    const kcal=(prod?.calories ?? f.calories ?? 0)*amount/100;
    const pr=(prod?.protein ?? f.protein ?? 0)*amount/100;
    const ca=(prod?.carbs ?? f.carbs ?? 0)*amount/100;
    const fa=(prod?.fat ?? f.fat ?? 0)*amount/100;
    cal+=kcal; pro+=pr; carbs+=ca; fat+=fa; parts.push(`${amount}${prod?.unit||f.unit||'g'} ${prod?.name||label}`);
  }
  addProduct(milk, 500, 'whole milk', {calories:64,protein:3.4,carbs:4.8,fat:3.5,unit:'ml'});
  addProduct(oats, 80, 'oats', {calories:370,protein:13,carbs:60,fat:7,unit:'g'});
  cal+=105; pro+=1.3; carbs+=27; fat+=0.4; parts.push('1 banana');
  cal+=180; pro+=7; carbs+=6; fat+=15; parts.push('30g peanut butter');
  if(whey){ addProduct(whey, 30, 'whey', {calories:400,protein:75,carbs:8,fat:7,unit:'g'}); }
  addMealToToday({name:'Usual bulk shake', calories:round(cal), protein:round(pro), carbs:round(carbs), fat:round(fat), ingredients:parts, source:'usual-shake'});
}

function renderFood(){
  const prods = state.products || [];
  return `
  <div class="screenTitle">Food</div>
  <section class="card hero"><img src="assets/shake.svg" alt="Shake"><div class="heroBody"><div class="eyebrow">One tap actions</div><div class="h2">Make eating easier.</div><p class="p">Generate shakes/meals from your calorie gap, saved products, taste, budget and macros.</p><div class="grid2"><button class="btn" onclick="quickShake()">AI shake</button><button class="btn secondary" onclick="quickMeal()">AI meal</button></div></div></section>
  <section class="card">
    <div class="h2">Quick log</div>
    <p class="p">Type rough food. Gemini estimates it and asks you to confirm.</p>
    <textarea id="lazyText" placeholder="Example: 500ml sødmælk, 80g oats, banana, peanut butter"></textarea>
    <button class="btn" id="lazyBtn">Estimate with Gemini</button>
  </section>
  <section class="card">
    <div class="row between"><div><div class="h2">Product memory</div><p class="p">Saved products become your default milk/whey/skyr in AI shakes.</p></div><button class="btn small secondary" onclick="openProductModal()">+ Product</button></div>
    ${prods.length ? prods.map(productRow).join('') : `<div class="empty"><b>No products yet</b><p class="p">Add sødmælk, letmælk, whey, oats, skyr etc. The AI will reuse them automatically.</p></div>`}
  </section>
  <section class="card">
    <div class="h2">Saved meals</div>
    ${state.savedMeals.length ? state.savedMeals.map(m=>mealCard(m, true)).join('') : `<div class="empty"><b>No saved meals</b><p class="p">Generate a meal and press save.</p></div>`}
  </section>`;
}
function bindFood(){ $('#lazyBtn')?.addEventListener('click', lazyLog); }
function productRow(p){
  const cost = p.price && p.packageSize ? ` · ${round((p.price / p.packageSize)*100,2)} kr/100${p.unit||'g'}` : '';
  return `<div class="item"><div class="row between"><div><b>${esc(p.name)}</b><div class="tiny">${esc(p.category||'product')} · ${p.calories||'?'} kcal/100${p.unit||'g'} · ${p.protein||'?'}g protein${cost}</div></div><button class="btn small secondary" onclick="togglePreferred('${p.id}')">${p.preferred?'Preferred':'Use in AI'}</button></div>${(!p.calories && !p.protein)?`<p class="p"><span class="status warn">Missing nutrition</span> Upload label photo so AI can read it.</p>`:''}</div>`;
}

function renderPlanner(){
  const p = state.profile;
  const st = selectedStoreStatus();
  const plan = state.plan;
  const truth = priceTruth(plan);
  const brain = state.plannerBrain || defaults.plannerBrain;
  const pi = state.priceIntel || defaults.priceIntel;
  const pantryText = (state.pantry||[]).map(x=>typeof x==='string'?x:(x.name||'')).filter(Boolean).join('\n');
  return `
  <div class="screenTitle">Plan</div>
  <section class="card hero compactHero"><img src="assets/grocery.svg" alt="Grocery"><div class="heroBody"><div class="eyebrow">Food operating system</div><div class="h2">Make a plan you can actually shop.</div><p class="p shortText">Store, budget, kitchen, diet, pantry and price checks. AI works in the background — the app gives actions.</p><div class="row wrap"><span class="pill">${esc(st.store)}</span><span class="pill">${p.budget} kr</span><span class="pill">${p.people} people</span><span class="status ${truth.cls}">${truth.label}</span></div></div></section>

  <section class="card" id="plannerForm">
    <div class="h2">Shopping setup</div>
    <div class="quickTiles">
      <button class="tile active" data-store-fast="Nemlig">Nemlig</button>
      <button class="tile" data-store-fast="Lidl">Lidl</button>
      <button class="tile" data-store-fast="REMA 1000">REMA</button>
      <button class="tile" data-store-fast="Netto">Netto</button>
    </div>
    <div class="grid2">
      <div class="field"><label>Store / main source</label><select id="store">${['Nemlig','Lidl','REMA 1000','Netto','Føtex','Bilka','Coop 365','Meny','Online flyers','Other'].map(s=>`<option ${p.store===s?'selected':''}>${s}</option>`).join('')}</select></div>
      <div class="field"><label>Weekly budget total</label><input id="budget" inputmode="decimal" value="${p.budget}"></div>
      <div class="field"><label>People to feed</label><input id="people" inputmode="numeric" value="${p.people}"></div>
      <div class="field"><label>Goal style</label><select id="focus"><option>high calorie bulk</option><option>high protein</option><option>cheapest possible</option><option>balanced</option><option>low calorie</option><option>vegan</option><option>fruit/veg focus</option></select></div>
    </div>

    <div class="sectionHeader compact"><h2>Price intelligence</h2><span>${esc(priceSourceLabel())}</span></div>
    <div class="grid2">
      <div class="field"><label>Price source mode</label><select id="priceMode"><option ${pi.mode==='Nemlig + online flyers'?'selected':''}>Nemlig + online flyers</option><option ${pi.mode==='Online flyers only'?'selected':''}>Online flyers only</option><option ${pi.mode==='Saved prices first'?'selected':''}>Saved prices first</option><option ${pi.mode==='Salling API + saved'?'selected':''}>Salling API + saved</option><option ${pi.mode==='Manual/estimate only'?'selected':''}>Manual/estimate only</option></select></div>
      <div class="field"><label>Safety buffer %</label><input id="priceBuffer" inputmode="decimal" value="${pi.bufferPct ?? 10}"><p class="micro">BulkMind adds this to every price before showing the total.</p></div>
    </div>
    <div class="row wrap priceSources">
      ${priceChip('nemlig','Nemlig.dk',pi.sources?.nemlig)}
      ${priceChip('onlineFlyers','Online aviser',pi.sources?.onlineFlyers)}
      ${priceChip('savedProducts','Saved scans',pi.sources?.savedProducts)}
      ${priceChip('salling','Salling API',pi.sources?.salling)}
      ${priceChip('manual','Manual prices',pi.sources?.manual)}
    </div>
    <div class="truthBox compactBox"><b>Price rules</b><p class="p shortText">The app will not accept crazy prices. A banana cannot cost 100 kr without being flagged. Missing/uncertain prices become scan tasks, not fake certainty.</p></div>

    <div class="sectionHeader compact"><h2>Real life</h2><span>less text, more decisions</span></div>
    <div class="grid2">
      <div class="field"><label>Mood</label><select id="mood"><option ${brain.mood==='normal'?'selected':''}>normal</option><option ${brain.mood==='not hungry'?'selected':''}>not hungry</option><option ${brain.mood==='lazy'?'selected':''}>lazy</option><option ${brain.mood==='broke'?'selected':''}>broke</option><option ${brain.mood==='tired'?'selected':''}>tired</option><option ${brain.mood==='gym fuel'?'selected':''}>gym fuel</option></select></div>
      <div class="field"><label>Cooking effort</label><select id="cookingEffort"><option ${brain.cookingEffort==='0 effort / no cook'?'selected':''}>0 effort / no cook</option><option ${brain.cookingEffort==='low effort'?'selected':''}>low effort</option><option ${brain.cookingEffort==='normal 20 min'?'selected':''}>normal 20 min</option><option ${brain.cookingEffort==='meal prep'?'selected':''}>meal prep</option></select></div>
    </div>
    <div class="field"><label>Pantry / already have</label><textarea id="pantryInput" placeholder="rice, oats, milk, eggs...">${esc(pantryText)}</textarea></div>
    <details class="moreDetails"><summary>Advanced rules</summary>
      <div class="field"><label>Eating times</label><textarea id="eatingTimes">${esc(brain.eatingTimes||'')}</textarea></div>
      <div class="row wrap">${autoChip('pantryFirst','Pantry first',brain.pantryFirst)}${autoChip('leftovers','Leftovers',brain.leftovers)}${autoChip('foodFatigue','Avoid repeats',brain.foodFatigue)}${autoChip('wasteSmart','Waste smart',brain.wasteSmart)}${autoChip('confidence','Confidence',brain.confidence)}</div>
      <div class="sectionHeader compact"><h2>Meals</h2><span>wanted</span></div><div class="row wrap">${chipSet('mealsWanted', state.mealsWanted)}</div>
      <div class="sectionHeader compact"><h2>Equipment</h2><span>available</span></div><div class="row wrap">${chipSet('equipment', state.equipment)}</div>
      <div class="sectionHeader compact"><h2>Diet</h2><span>rules</span></div><div class="row wrap">${chipSet('diet', state.diet, 'green')}</div>
    </details>
    <div class="stickyAction"><button class="btn" id="generatePlan">Generate usable weekly plan</button></div>
  </section>
  ${state.plan ? renderPlan(state.plan) : `<div class="empty"><b>No plan yet</b><p class="p">Generate once. The output will be cards, prices, swaps and scan tasks — not a long chat answer.</p></div>`}`;
}
function priceChip(key,label,active){ return `<button class="chip blue ${active?'active':''}" data-price-source="${key}">${active?'✓':''} ${label}</button>`; }
function autoChip(key,label,active){ return `<button class="chip purple ${active?'active':''}" data-auto="${key}">${active?'✓':''} ${label}</button>`; }
function bindPlanner(){
  $all('[data-chip]').forEach(b=>b.addEventListener('click',()=>{ const [group,key]=b.dataset.chip.split('.'); state[group][key]=!state[group][key]; save(); render(); }));
  $all('[data-auto]').forEach(b=>b.addEventListener('click',()=>{ const key=b.dataset.auto; state.plannerBrain[key]=!state.plannerBrain[key]; save(); render(); }));
  $all('[data-price-source]').forEach(b=>b.addEventListener('click',()=>{ const key=b.dataset.priceSource; state.priceIntel.sources[key]=!state.priceIntel.sources[key]; save(); render(); }));
  $all('[data-store-fast]').forEach(b=>b.addEventListener('click',()=>{ state.profile.store=b.dataset.storeFast; save(); render(); }));
  $('#generatePlan')?.addEventListener('click', generateWeeklyPlan);
}
function chipSet(group, obj, color=''){
  const labels = {breakfast:'Breakfast',lunch:'Lunch',dinner:'Dinner',snacks:'Snacks',shake:'Shake',stove:'Stove',oven:'Oven',airfryer:'Airfryer',microwave:'Microwave',blender:'Blender',noCook:'No-cook',halal:'Halal',noPork:'No pork',vegan:'Vegan',vegetarian:'Vegetarian',lactoseFree:'Lactose-free',highProtein:'High protein',highCalorie:'High calorie',lowCalorie:'Low calorie',fruitVeg:'Fruit/veg'};
  return Object.keys(obj).map(k=>`<button class="chip ${color} ${obj[k]?'active':''}" data-chip="${group}.${k}">${obj[k]?'✓':''} ${labels[k]||k}</button>`).join('');
}
function renderPlan(plan){
  plan = normalizePlanPrices(plan);
  const truth = priceTruth(plan);
  const missing = plan.missingData || plan.missingPriceData || [];
  const upgrades = plan.upgradeIdeas || plan.shoppingNotes || [];
  const conf = plan.planConfidence || plan.confidence || {};
  const deals = plan.bestDeals || [];
  const audit = plan.priceAudit || {};
  const actions = plan.nextActions || buildPlanActions(plan);
  return `<section class="card planSummary appResult">
    <div class="row between"><div><div class="eyebrow">Your week</div><div class="h2">${esc(plan.title||'Weekly plan')}</div></div><button class="btn small secondary" onclick="regeneratePlanFocused('make this easier and more realistic')">Regenerate</button></div>
    <div class="metricGrid">${metric('Budget', Math.round(plan.totalPrice||0)+' kr', state.profile.budget+' kr', pct(plan.totalPrice||0,state.profile.budget))}${metric('Buffer', '+'+(audit.bufferPct ?? state.priceIntel?.bufferPct ?? 10)+'%', 'included', 100)}${metric('Protein', Math.round(plan.avgProtein||0)+'g', state.targets.protein+'g', pct(plan.avgProtein||0,state.targets.protein))}</div>
    <div class="truthBox ${truth.cls==='warn'?'warnBox':''}"><b>${esc(truth.label)}</b><p class="p shortText">${esc(truth.note)}</p></div>
  </section>
  <section class="actionPanel">${actions.slice(0,4).map(a=>`<button class="actionCard" onclick="${esc(a.action||'')}"><span>${esc(a.icon||'✨')}</span><b>${esc(a.title||'Action')}</b><small>${esc(a.subtitle||'')}</small></button>`).join('')}</section>
  ${renderPriceAudit(audit, missing, upgrades)}
  ${Object.keys(conf||{}).length?renderConfidence(conf):''}
  ${deals.length?renderDeals(deals):''}
  <div class="sectionHeader compact"><h2>Meals</h2><span>tap meal to log or swap</span></div>
  <div class="dayGrid compactDays">${(plan.days||[]).map((d,idx)=>`<div class="dayCard"><div class="row between"><h3>${esc(d.day||'Day '+(idx+1))}</h3><button class="btn small secondary" onclick="swapDay(${idx})">Swap</button></div>${(d.meals||[]).map(m=>mealCard(m)).join('')}</div>`).join('')}</div>
  <div class="sectionHeader compact"><h2>Shopping list</h2><span>${(plan.shoppingList||[]).length} items · ${state.profile.people||1} people</span></div>
  <section class="card shoppingList appList">
    ${(plan.shoppingList||[]).map(shoppingRow).join('') || '<p class="p">No shopping list. Generate again.</p>'}
    <div class="grid2" style="margin-top:12px"><button class="btn secondary" onclick="openProductModal()">Scan price/product</button><button class="btn secondary" onclick="regeneratePlanFocused('replace expensive or uncertain items with cheaper Danish alternatives')">Cheaper swap</button></div>
  </section>`;
}
function buildPlanActions(plan){
  return [
    {icon:'🛒', title:'Shop this list', subtitle:`${round(plan.totalPrice||0,0)} kr with buffer`, action:'scrollToShopping()'},
    {icon:'⚠️', title:'Fix uncertain prices', subtitle:`${(plan.shoppingList||[]).filter(i=>i.needsPrice).length} need check`, action:'openProductModal()'},
    {icon:'🔁', title:'Cheaper swaps', subtitle:'replace expensive items', action:"regeneratePlanFocused('make the plan cheaper but keep calories and protein')"},
    {icon:'🥤', title:'Make today easy', subtitle:'quick bulk rescue', action:'quickShake()'}
  ];
}
function renderPriceAudit(audit={}, missing=[], upgrades=[]){
  return `<section class="card priceAudit"><div class="row between"><div><div class="eyebrow">Price engine</div><div class="h2">${esc(audit.mode || state.priceIntel?.mode || 'Price check')}</div></div><span class="status ${audit.warningCount?'warn':''}">${audit.warningCount||0} warnings</span></div>
    <div class="miniStats"><div><b>${round(audit.baseTotal||0,2)} kr</b><span>before buffer</span></div><div><b>${round(audit.bufferedTotal||0,2)} kr</b><span>after buffer</span></div><div><b>${esc((audit.sources||activePriceSources()).join(' + ')||'saved')}</b><span>sources</span></div></div>
    ${audit.warnings?.length?`<details class="moreDetails" open><summary>Price warnings</summary>${niceList(audit.warnings,'No warnings')}</details>`:''}
    ${(missing.length||upgrades.length)?`<div class="grid2"><div class="item"><b>Scan next</b>${niceList(missing,'Nothing missing')}</div><div class="item"><b>Suggested upgrades</b>${niceList(upgrades,'No upgrades')}</div></div>`:''}
  </section>`;
}
function renderConfidence(conf){
  return `<section class="card"><div class="h2">Plan confidence</div><div class="confidenceGrid">${['budgetFit','proteinFit','calorieFit','effortFit','variety','wasteControl'].map(k=>`<div class="confItem"><span>${esc(k.replace(/([A-Z])/g,' $1'))}</span><b>${Math.round(conf[k]||0)}%</b><div class="bar"><i style="width:${Math.max(0,Math.min(100,conf[k]||0))}%"></i></div></div>`).join('')}</div></section>`;
}
function renderDeals(deals){
  return `<section class="card"><div class="h2">Best value picks</div>${deals.slice(0,6).map(d=>`<div class="valueRow item"><div><b>${esc(d.name||d.item||'Deal')}</b><div class="tiny">${esc(d.metric||d.value||'good value')}</div></div><p class="p shortText">${esc(d.why||d.reason||'Good value for the plan')}</p></div>`).join('')}</section>`;
}
function shoppingRow(i){
  return `<div class="shoppingRow item ${i.needsPrice?'needsPrice':''}" id="shoppingList"><div><b>${priceStatusIcon(i)} ${esc(i.name||i.storeItemName||'Item')}</b><div class="tiny">${esc(i.amount||'')} · ${esc(i.reason||'used in plan')}</div><div class="micro">${esc(i.priceSource || 'source unknown')} · ${esc(i.priceCheck || i.confidence || 'unchecked')}</div></div><span class="pill">${i.price?round(i.price,2)+' kr':'scan'}</span></div>`;
}
function scrollToShopping(){ document.querySelector('.shoppingList')?.scrollIntoView({behavior:'smooth', block:'start'}); }
async function regeneratePlanFocused(instruction){
  if(!state.plan) return generateWeeklyPlan();
  if(!requireAI()) return;
  toast('Updating plan...');
  try{
    const res = await callGeminiJSON(`Update this BulkMind weekly plan as structured JSON, not chat. Instruction: ${instruction}. Keep same schema, shoppingList prices as base prices before buffer. Apply Danish realism. Existing plan: ${JSON.stringify(state.plan)} Context: ${JSON.stringify({profile:state.profile,targets:state.targets,diet:state.diet,priceIntel:state.priceIntel,products:state.products.map(compactProductForPrice)})}`, state.useSearch);
    state.plan = normalizePlanPrices(res); save(); render(); toast('Plan updated');
  }catch(e){ toast('Update failed: '+e.message); }
}
function mealCard(m, saved=false){
  const type = m.type || m.slot || m.name || 'meal';
  const ingredients = m.ingredients || m.items || [];
  const instructions = m.instructions || m.steps || [];
  return `<div class="mealCard detailedMeal">
    <img src="${imgFor(type)}" alt="${esc(type)}">
    <div><h3>${mealNameIcon(m.name)} ${esc(m.name||'Meal')}</h3><div class="meta">${Math.round(m.calories||0)} kcal · ${Math.round(m.protein||0)}g protein · ${Math.round(m.carbs||0)}g carbs · ${Math.round(m.fat||0)}g fat ${m.price?'· '+round(m.price,2)+' kr':''}</div><div class="tiny">${esc(m.why||m.timing||'Built for your target')}</div></div>
    <div class="mealDetails">
      <b>Ingredients</b>${niceList(ingredients,'No ingredients returned — ask AI to fix this meal.')}
      <b>How to make</b>${niceList(instructions,'No instructions returned — ask AI to add steps.')}
      ${m.shoppingNote?`<div class="truthBox"><b>Shopping note</b><p class="p">${esc(m.shoppingNote)}</p></div>`:''}
      ${(m.usedProducts||[]).length?`<div class="micro">Used saved products: ${esc(m.usedProducts.join(', '))}</div>`:''}
      <div class="row wrap" style="margin-top:10px"><button class="btn small secondary" onclick='addMealToToday(${JSON.stringify(m).replace(/'/g,"&#39;")})'>Log my portion</button><button class="btn small secondary" onclick='askAboutItem(${JSON.stringify(m).replace(/'/g,"&#39;")})'>Ask AI</button>${saved?'':`<button class="btn small secondary" onclick='saveMeal(${JSON.stringify(m).replace(/'/g,"&#39;")})'>Save</button>`}</div>
    </div>
  </div>`;
}

function renderProgress(){
  const w = state.weights || [];
  return `<div class="screenTitle">Progress</div>
  <section class="card hero"><img src="assets/progress.svg" alt="Progress"><div class="heroBody"><div class="h2">Keep it brutally simple.</div><p class="p">Track weight, calories and consistency. AI adjusts the plan from the trend, not from random guesses.</p><div class="grid2"><button class="btn" onclick="openWeightLog()">Log weight</button><button class="btn secondary" onclick="weeklyCheckin()">Weekly check-in</button></div></div></section>
  <section class="card"><div class="h2">Weight trend</div>${w.length?renderWeightGraph(w):`<div class="empty"><b>No weights yet</b><p class="p">Log morning weight 3-4 times/week.</p></div>`}</section>
  <section class="card"><div class="h2">Consistency</div><div class="cal">${renderCalendar()}</div></section>
  <section class="card"><div class="h2">Recent weights</div>${w.slice(-7).reverse().map(x=>`<div class="item row between"><b>${esc(x.date)}</b><span>${x.weight} kg</span></div>`).join('') || '<p class="p">No data.</p>'}</section>`;
}
function bindProgress(){}
function renderWeightGraph(w){
  const last = w.slice(-20); const vals=last.map(x=>+x.weight); const min=Math.min(...vals)-1; const max=Math.max(...vals)+1; const points=last.map((x,i)=>`${(i/(last.length-1||1))*320},${140-((x.weight-min)/(max-min||1))*110}`).join(' ');
  return `<svg viewBox="0 0 340 160" style="width:100%;height:170px"><polyline points="${points}" fill="none" stroke="#ff9b54" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><line x1="0" y1="140" x2="340" y2="140" stroke="rgba(255,255,255,.12)"/><text x="4" y="22" fill="#aaa7b6" font-size="12">${round(max,1)} kg</text><text x="4" y="154" fill="#aaa7b6" font-size="12">${round(min,1)} kg</text></svg>`;
}
function renderCalendar(){
  const days=[]; for(let i=20;i>=0;i--){ const d=new Date(); d.setDate(d.getDate()-i); const iso=d.toISOString().slice(0,10); const log=state.logs.filter(l=>l.date===iso); const cal=log.reduce((a,l)=>a+(+l.calories||0),0); const p=pct(cal,state.targets.calories); days.push(`<i class="${p>80?'good':p>40?'mid':''}" title="${iso}"></i>`); } return days.join('');
}

function openModal(html){
  const wrap=document.createElement('div'); wrap.className='modalBackdrop'; wrap.innerHTML=`<div class="modal">${html}</div>`; document.body.appendChild(wrap); wrap.addEventListener('click',e=>{ if(e.target===wrap) wrap.remove(); }); return wrap;
}
function closeModal(){ $('.modalBackdrop')?.remove(); }
function openSettings(force=false){
  const m = openModal(`<div class="modalHead"><div><b>Settings</b><div class="tiny">AI can use either a hidden Vercel server key or a local Gemini key.</div></div><button class="iconBtn" onclick="closeModal()">✕</button></div>
  <div class="aiBox"><b>Current mode: ${esc(aiModeLabel())}</b><p class="p">For a fixed key, set it in Vercel Environment Variables. Do not hardcode tokens in GitHub.</p></div>
  <button class="chip ${state.useServerKeys?'active':''}" id="serverKeyBtn">${state.useServerKeys?'✓':''} Use hidden Vercel server key</button>
  <div class="field"><label>Local Gemini API key / auth key, optional</label><input id="apiKey" value="${esc(state.apiKey)}" placeholder="Paste Gemini key from AI Studio"></div>
  <div class="field"><label>Retailer/Salling token, optional local test</label><input id="retailerToken" value="${esc(state.retailerToken||'')}" placeholder="Retailer token if used"></div>
  <div class="field"><label>Model</label><select id="model"><option ${state.model==='gemini-2.5-flash'?'selected':''}>gemini-2.5-flash</option><option ${state.model==='gemini-2.5-flash-lite'?'selected':''}>gemini-2.5-flash-lite</option><option ${state.model==='gemini-3.5-flash'?'selected':''}>gemini-3.5-flash</option></select></div>
  <button class="chip ${state.useSearch?'active':''}" id="useSearchBtn">${state.useSearch?'✓':''} Use Google Search grounding when planning</button>
  <p class="micro">Gemini now supports standard API keys and newer authorization keys from AI Studio. Paste the exact key AI Studio gives you; format can vary.</p>
  <div class="grid2" style="margin-top:14px"><button class="btn" id="saveSettings">Save</button><button class="btn secondary" id="testAI">Test AI</button></div>
  <hr style="border-color:var(--line);margin:18px 0"><button class="btn secondary" onclick="openSetup()">Redo setup</button><button class="btn secondary danger" style="margin-top:10px" onclick="resetApp()">Reset app</button>`);
  $('#serverKeyBtn',m).addEventListener('click',()=>{ state.useServerKeys=!state.useServerKeys; save(); closeModal(); openSettings(); });
  $('#useSearchBtn',m).addEventListener('click',()=>{ state.useSearch=!state.useSearch; save(); closeModal(); openSettings(); });
  $('#saveSettings',m).addEventListener('click',()=>{ state.apiKey=$('#apiKey',m).value.trim(); state.retailerToken=$('#retailerToken',m).value.trim(); state.model=$('#model',m).value; save(); closeModal(); render(); toast('Saved'); });
  $('#testAI',m).addEventListener('click',async()=>{ state.apiKey=$('#apiKey',m).value.trim(); state.retailerToken=$('#retailerToken',m).value.trim(); state.model=$('#model',m).value; save(); try{ await callGeminiText('Reply with only: BulkMind AI connected.', false); toast('Gemini works'); }catch(e){ toast('AI error: '+e.message); } });
}
function resetApp(){ if(confirm('Delete all BulkMind data on this device?')){ storage.removeItem(STORE_KEY); state=clone(defaults); closeModal(); render(); }}

function openSetup(){
  setupStep = 0;
  planDraft = structuredClone({profile: state.profile, diet: state.diet, equipment: state.equipment, mealsWanted: state.mealsWanted});
  renderSetup();
}
function renderSetup(){
  const steps = [setupAI, setupGoal, setupLifestyle, setupDiet, setupGenerate];
  const progress = Math.round(((setupStep+1)/steps.length)*100);
  const modal = $('.modalBackdrop'); if(!modal){ openModal(`<div id="setupMount"></div>`); }
  $('#setupMount').innerHTML = `<div class="modalHead"><div><b>Setup</b><div class="tiny">Step ${setupStep+1} of ${steps.length}</div></div><button class="iconBtn" onclick="closeModal()">✕</button></div><div class="progressLine"><i style="width:${progress}%"></i></div>${steps[setupStep]()}<div class="stickyAction"><div class="grid2"><button class="btn secondary" id="backSetup">Back</button><button class="btn" id="nextSetup">${setupStep===steps.length-1?'Generate plan':'Next'}</button></div></div>`;
  $('#backSetup').onclick = () => { if(setupStep>0){ setupStep--; renderSetup(); } else closeModal(); };
  $('#nextSetup').onclick = nextSetup;
  bindSetupStep();
}
function setupAI(){ return `<section class="card hero"><img src="assets/meal.svg"><div class="heroBody"><div class="eyebrow">AI setup</div><div class="h2">Use server key or paste Gemini.</div><p class="p">For your personal Vercel app, the best setup is a hidden server key. If that is not configured, paste the Gemini key/auth key that AI Studio gives you.</p><button class="chip ${state.useServerKeys?'active':''}" id="setupServerKey">${state.useServerKeys?'✓':''} Use hidden Vercel key</button><div class="field"><label>Local Gemini API key, optional</label><input id="setupApi" value="${esc(state.apiKey)}" placeholder="Paste Gemini key from AI Studio"></div><button class="btn secondary" id="setupTest">Test AI</button></div></section>`; }
function setupGoal(){ const p=planDraft.profile; return `<section class="card"><div class="h2">Your bulk goal</div><div class="grid2"><div class="field"><label>Name</label><input id="name" value="${esc(p.name)}" placeholder="Mo"></div><div class="field"><label>Age</label><input id="age" inputmode="numeric" value="${p.age}"></div><div class="field"><label>Height cm</label><input id="height" inputmode="decimal" value="${p.height}"></div><div class="field"><label>Current kg</label><input id="weight" inputmode="decimal" value="${p.weight}"></div><div class="field"><label>Target kg</label><input id="targetWeight" inputmode="decimal" value="${p.targetWeight}"></div><div class="field"><label>Months</label><input id="months" inputmode="numeric" value="${p.months}"></div></div></section>`; }
function setupLifestyle(){ const p=planDraft.profile; return `<section class="card"><div class="h2">Life & training</div><div class="grid2"><div class="field"><label>Training days/week</label><input id="trainingDays" inputmode="numeric" value="${p.trainingDays}"></div><div class="field"><label>Activity</label><select id="activity"><option>low</option><option ${p.activity==='moderate'?'selected':''}>moderate</option><option>high</option></select></div><div class="field"><label>Appetite</label><select id="appetite"><option ${p.appetite==='low'?'selected':''}>low</option><option>normal</option><option>high</option></select></div><div class="field"><label>Style</label><select id="goalStyle"><option>slow</option><option ${p.goalStyle==='balanced'?'selected':''}>balanced</option><option>aggressive</option></select></div></div></section>`; }
function setupDiet(){ return `<section class="card"><div class="h2">Food rules</div><p class="p">These rules will be sent to AI every time it makes meals/shakes.</p><div class="row wrap">${chipSet('diet', planDraft.diet, 'green')}</div><div class="sectionHeader"><h2>Equipment</h2></div><div class="row wrap">${chipSet('equipment', planDraft.equipment, 'blue')}</div><div class="grid2" style="margin-top:14px"><div class="field"><label>Default store</label><select id="storeSetup">${['Netto','Lidl','REMA 1000','Føtex','Bilka','Coop 365','Meny'].map(s=>`<option ${planDraft.profile.store===s?'selected':''}>${s}</option>`).join('')}</select></div><div class="field"><label>Weekly budget</label><input id="budgetSetup" inputmode="numeric" value="${planDraft.profile.budget}"></div></div></section>`; }
function setupGenerate(){ return `<section class="card hero"><img src="assets/grocery.svg"><div class="heroBody"><div class="h2">Ready to let Gemini build your targets.</div><p class="p">It will calculate calories/macros for your goal and make a first weekly strategy. Your goal: ${planDraft.profile.weight} → ${planDraft.profile.targetWeight} kg in ${planDraft.profile.months} months.</p><div class="aiBox"><b>AI will set:</b><p class="p">Calories, protein, carbs, fat, weekly gain, first action, and a warning if the timeline is too aggressive.</p></div></div></section>`; }
function bindSetupStep(){
  $all('[data-chip]').forEach(b=>b.addEventListener('click',()=>{ const [group,key]=b.dataset.chip.split('.'); planDraft[group][key]=!planDraft[group][key]; renderSetup(); }));
  $('#setupServerKey')?.addEventListener('click',()=>{ state.useServerKeys=!state.useServerKeys; save(); renderSetup(); });
  $('#setupTest')?.addEventListener('click',async()=>{ state.apiKey=$('#setupApi').value.trim(); save(); try{ await callGeminiText('Reply only OK', false); toast('Gemini works'); }catch(e){ toast('AI failed'); }});
}
async function nextSetup(){
  if(setupStep===0){ state.apiKey=$('#setupApi')?.value.trim() || state.apiKey; save(); if(!aiReady()){ toast('Connect server key mode or paste Gemini key'); return; } }
  if(setupStep===1){ const p=planDraft.profile; Object.assign(p,{ name:$('#name').value.trim(), age:num($('#age').value,p.age), height:num($('#height').value,p.height), weight:num($('#weight').value,p.weight), targetWeight:num($('#targetWeight').value,p.targetWeight), months:num($('#months').value,p.months) }); }
  if(setupStep===2){ const p=planDraft.profile; Object.assign(p,{ trainingDays:num($('#trainingDays').value,p.trainingDays), activity:$('#activity').value, appetite:$('#appetite').value, goalStyle:$('#goalStyle').value }); }
  if(setupStep===3){ planDraft.profile.store=$('#storeSetup').value; planDraft.profile.budget=num($('#budgetSetup').value,planDraft.profile.budget); }
  if(setupStep<4){ setupStep++; renderSetup(); return; }
  await generateInitialPlan();
}
async function generateInitialPlan(){
  if(!requireAI()) return;
  $('#nextSetup').innerHTML='<span class="loader"></span>Planning'; $('#nextSetup').disabled=true;
  try{
    const prompt = `You are BulkMind, a practical fitness nutrition coach. Create safe bulking nutrition targets and first-week strategy as JSON only.
User profile: ${JSON.stringify(planDraft.profile)}
Diet rules: ${JSON.stringify(planDraft.diet)}
Equipment: ${JSON.stringify(planDraft.equipment)}
Return JSON exactly like:
{"targets":{"calories":3100,"protein":130,"carbs":410,"fat":90,"weeklyGain":0.5,"source":"Gemini formula + user profile"},"summary":"short honest summary","warning":"if aggressive or unsafe, else empty","firstActions":["action1","action2","action3"]}
Rules: use realistic healthy calories, protein around 1.8-2.2g/kg current bodyweight unless reason, fats not too low, explain if 60 to 84kg in 8 months is aggressive. No extreme advice.`;
    const res = await callGeminiJSON(prompt, state.useSearch);
    state.profile = planDraft.profile; state.diet=planDraft.diet; state.equipment=planDraft.equipment; state.mealsWanted=planDraft.mealsWanted;
    if(res.targets) state.targets = {...state.targets, ...res.targets};
    state.setupDone = true; state.todayNote = [res.summary,res.warning,(res.firstActions||[]).join(' · ')].filter(Boolean).join(' ');
    save(); closeModal(); render(); toast('AI plan created');
  }catch(e){
    const res = localBulkTargets(planDraft.profile);
    state.profile = planDraft.profile; state.diet=planDraft.diet; state.equipment=planDraft.equipment; state.mealsWanted=planDraft.mealsWanted;
    state.targets = {...state.targets, ...res.targets};
    state.setupDone = true;
    state.todayNote = [res.summary, res.warning, `AI had an issue, so I used the safe local calculator instead: ${e.message}`].filter(Boolean).join(' ');
    save(); closeModal(); render(); toast('AI issue — safe local plan created');
  }
}

function localBulkTargets(p){
  const weight = num(p.weight,60), height = num(p.height,175), age = num(p.age,18);
  const months = Math.max(1, num(p.months,8));
  const target = num(p.targetWeight,84);
  const weeklyGain = Math.max(0, (target - weight) / (months * 4.345));
  const bmr = 10 * weight + 6.25 * height - 5 * age + 5;
  const activityFactor = p.activity === 'high' ? 1.65 : p.activity === 'low' ? 1.35 : 1.5;
  const maintenance = bmr * activityFactor;
  const surplus = weeklyGain > 0.65 ? 650 : weeklyGain > 0.45 ? 500 : 350;
  const calories = Math.round((maintenance + surplus) / 50) * 50;
  const protein = Math.round(Math.max(110, Math.min(160, weight * 2.1)) / 5) * 5;
  const fat = Math.round(Math.max(75, Math.min(110, weight * 1.35)) / 5) * 5;
  const carbs = Math.max(250, Math.round((calories - protein*4 - fat*9) / 4 / 5) * 5);
  return {
    targets: { calories, protein, carbs, fat, weeklyGain: round(weeklyGain,2), source: 'safe local calculator v16' },
    summary: `${weight} → ${target} kg in ${months} months needs about ${round(weeklyGain,2)} kg/week.`,
    warning: weeklyGain > 0.6 ? 'That timeline is aggressive. The app will still plan it, but expect some fat gain and adjust every 2 weeks.' : ''
  };
}

async function callGeminiText(prompt, useSearch=false){
  const json = await callGeminiRaw([{text: prompt}], useSearch, false);
  return extractText(json);
}
async function callGeminiJSON(prompt, useSearch=false, imageData=null){
  const jsonPrompt = `${prompt}

IMPORTANT: Return only raw valid JSON. No markdown, no code block, no comments, no extra text.`;
  const parts = [{text: jsonPrompt}];
  if(imageData) parts.push({inline_data:{mime_type:imageData.mime, data:imageData.data}});
  const json = await callGeminiRaw(parts, useSearch, true);
  const text = extractText(json);
  try { return JSON.parse(text); } catch(e){
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if(start !== -1 && end !== -1 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error('AI did not return usable JSON');
  }
}
async function callGeminiRaw(parts, useSearch=false, wantJSON=false){
  if(!aiReady()) throw new Error('Gemini key missing');
  const body = { contents: [{ role:'user', parts }], generationConfig: { temperature: .55 } };
  // Gemini currently rejects tool/search use together with response_mime_type: application/json.
  // So JSON mode is used only when tools are OFF. With search ON, the prompt still forces raw JSON and we parse it manually.
  if(wantJSON && !useSearch) body.generationConfig.response_mime_type = 'application/json';
  if(useSearch) body.tools = [{ google_search: {} }];

  // Best mode: hidden Vercel server key. This keeps the real API key out of GitHub and out of the browser.
  if(state.useServerKeys && !(state.apiKey && state.apiKey.trim().length > 15)){
    const r = await fetch('/api/gemini', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ model: state.model, body }) });
    if(!r.ok){ let msg = await r.text(); throw new Error(`Server AI ${r.status}: ${msg.slice(0,140)}`); }
    const data = await r.json();
    const gm = data.candidates?.[0]?.groundingMetadata;
    if(gm?.groundingChunks) state.aiCitations = gm.groundingChunks.map(c=>c.web).filter(Boolean).slice(0,8);
    save(); return data;
  }

  // Personal fallback: direct browser key. Only use this if the app is private and you understand it is visible to your browser.
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(state.model)}:generateContent?key=${encodeURIComponent(state.apiKey)}`;
  const r = await fetch(endpoint, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  if(!r.ok){ let msg = await r.text(); throw new Error(`Gemini ${r.status}: ${msg.slice(0,120)}`); }
  const data = await r.json();
  const gm = data.candidates?.[0]?.groundingMetadata;
  if(gm?.groundingChunks) state.aiCitations = gm.groundingChunks.map(c=>c.web).filter(Boolean).slice(0,8);
  save(); return data;
}
function extractText(data){ return data.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('\n').trim() || ''; }

async function generateWeeklyPlan(){
  if(!requireAI()) return;
  const form = $('#plannerForm');
  state.profile.store = $('#store').value; state.profile.budget = num($('#budget').value, state.profile.budget); state.profile.people = Math.max(1, Math.min(12, num($('#people').value,1)));
  state.priceIntel.mode = $('#priceMode')?.value || state.priceIntel.mode;
  state.priceIntel.bufferPct = Math.max(0, Math.min(35, num($('#priceBuffer')?.value, state.priceIntel.bufferPct ?? 10)));
  state.plannerBrain.mood = $('#mood')?.value || state.plannerBrain.mood;
  state.plannerBrain.cookingEffort = $('#cookingEffort')?.value || state.plannerBrain.cookingEffort;
  state.plannerBrain.eatingTimes = $('#eatingTimes')?.value || state.plannerBrain.eatingTimes;
  state.pantry = ($('#pantryInput')?.value || '').split(/\n|,/).map(x=>x.trim()).filter(Boolean).map(name=>({id:safeId(), name, addedAt:todayISO()}));
  save();
  const btn=$('#generatePlan'); btn.innerHTML='<span class="loader"></span>Gemini planning'; btn.disabled=true;
  try{
    const storeStatus = selectedStoreStatus();
    const prompt = `Create a practical 7-day Danish grocery meal plan as JSON only. This is a user-facing app, so the result must explain exactly what the user should eat, what ingredients go into every meal, how to cook it, and what to buy.

PRICE INTELLIGENCE RULES:
- Selected store/source: ${state.profile.store}.
- Price mode: ${state.priceIntel.mode}. Active sources: ${JSON.stringify(activePriceSources())}.
- Use Danish online prices if search is available, especially Nemlig.dk and online tilbudsaviser, but NEVER pretend a price is exact if you cannot verify it.
- Return shoppingList item price as BASE price before buffer. The app will add ${state.priceIntel.bufferPct}% buffer after generation.
- If a price is found online, set priceSource to "online price candidate: [source/name]" and confidence high/medium/low.
- If a price is from saved product memory, set priceSource to "saved product memory" and needsPrice false.
- If price is an estimate, set priceSource to "estimate" and needsPrice true.
- Do sanity checks: bananas cannot cost 100 kr, normal milk cannot cost 100 kr/L, etc. Suspicious prices must go in missingData or priceWarnings.
- Inflation aware: use current Danish grocery price level, not old/2019 prices.
- Store status: ${JSON.stringify(storeStatus)}.

USER PLAN:
Weekly budget TOTAL for ${state.profile.people} people: ${state.profile.budget} DKK.
User personal macro targets per day: ${JSON.stringify(state.targets)}.
If multiple people, shopping list scales for all people, but meal macros are per person.
Meals wanted: ${JSON.stringify(state.mealsWanted)}.
Equipment: ${JSON.stringify(state.equipment)}.
Dietary rules: ${JSON.stringify(state.diet)}.
Goal focus: ${$('#focus').value}.
Saved product memory with real prices/nutrition if any: ${JSON.stringify(state.products.slice(-50))}.

NECESSARY UX REQUIREMENTS:
- Every meal must have name, slot, calories, protein, carbs, fat, price, ingredients array, instructions array, why.
- Reuse ingredients across meals to stay within budget.
- Keep the plan realistic for Denmark and the selected store, but clearly label estimates.
- Shopping list must combine quantities for the full week and all people.
- Include missingData, upgradeIdeas and priceWarnings.
- Keep text short. This is not a chat box. Return structured cards/actions.

ADDITIONAL SMART REQUIREMENTS:
- Use pantry items before shopping if pantryFirst is true.
- Add an eatingSchedule array with exact meal times.
- Add smart leftovers, for example Monday dinner becomes Tuesday lunch.
- Avoid repeating the same boring meal too many times. If budget forces repetition, say it in foodFatigueNotes.
- Add Meal DNA notes to meals: cheapness, proteinQuality, calories, prepTime, fullness, bulkValue, dishwashing, schoolFriendly.
- Add bestDeals for cheap calories, cheap protein, best shake ingredients.
- Explain the shopping list item by item.
- Add planConfidence with budgetFit, proteinFit, calorieFit, effortFit, variety, wasteControl percentages.
- Add missingData telling user what label/price to scan next.
Planner brain: ${JSON.stringify(state.plannerBrain)}.
Pantry items user already has: ${JSON.stringify(state.pantry)}.
Meal DNA learned from ratings/history: ${JSON.stringify(state.mealDNA)}.

Return JSON exactly:
{"title":"...","summary":"max 18 words","totalPrice":295,"avgCalories":3100,"avgProtein":130,"avgFat":90,"nextActions":[{"icon":"🛒","title":"Shop list","subtitle":"short","action":"scrollToShopping()"}],"priceAudit":{"mode":"...","sources":["Nemlig","online flyers"],"baseTotal":270,"bufferedTotal":297,"bufferPct":10,"warnings":["Bananas price looks high; verify"],"warningCount":1},"planConfidence":{"budgetFit":90,"proteinFit":88,"calorieFit":95,"effortFit":80,"variety":75,"wasteControl":85},"eatingSchedule":["07:30 breakfast: ..."],"pantryUsed":["oats used in breakfast and shakes"],"leftoverPlan":["cook double rice Monday for Tuesday lunch"],"foodFatigueNotes":["oats repeated 4 times because budget is tight"],"bestDeals":[{"name":"oats","metric":"kr/1000 kcal","why":"cheap calories"}],"days":[{"day":"Monday","meals":[{"slot":"breakfast","name":"...","calories":700,"protein":35,"carbs":80,"fat":20,"price":22,"ingredients":["100g oats","300ml saved sødmælk"],"instructions":["Cook oats","Add banana"],"why":"short reason","priceSource":"saved product memory/online candidate/estimate","usedProducts":["..."],"mealDNA":{"cheapness":90,"proteinQuality":70,"prepTime":"5 min","fullness":"medium","bulkValue":95,"dishwashing":"low","schoolFriendly":true}}]}],"shoppingList":[{"name":"...","amount":"...","basePrice":20,"price":20,"priceSource":"online price candidate: Nemlig / saved product memory / estimate / missing","confidence":"high/medium/low","reason":"used in 3 meals","explanation":"max 12 words","needsPrice":false}],"explainShoppingList":["Oats: cheap calories and used in breakfast/shakes"],"missingData":["scan price for item"],"upgradeIdeas":["cheaper/better alternatives"],"priceWarnings":["..."]}`;
    const res = await callGeminiJSON(prompt, state.useSearch);
    state.plan = normalizePlanPrices(res); save(); render(); toast('Weekly plan ready');
  }catch(e){
    state.plan = normalizePlanPrices(localWeeklyPlan({ error: e.message, focus: $('#focus')?.value || 'high calorie bulk' }));
    save(); render(); toast('Gemini issue — local weekly plan made');
  }
}

function localWeeklyPlan(opts={}){
  const people = Math.max(1, state.profile.people || 1);
  const budget = state.profile.budget || 300;
  const focus = opts.focus || 'high calorie bulk';
  const wants = state.mealsWanted;
  const baseMeals = {
    breakfast:{slot:'breakfast',name:'Oats + milk + banana bowl',calories:720,protein:28,carbs:105,fat:20,price:13,ingredients:['100g oats','350ml milk','1 banana','15g peanut butter'],instructions:['Mix oats and milk','Add banana and peanut butter'],why:'Cheap calories and easy to repeat'},
    lunch:{slot:'lunch',name:'Chicken rice box',calories:850,protein:55,carbs:105,fat:18,price:28,ingredients:['150g chicken','120g rice dry','frozen veg','sauce/spices'],instructions:['Cook rice','Cook chicken','Add veg and sauce'],why:'High protein and meal-prep friendly'},
    dinner:{slot:'dinner',name:'Pasta tuna/chicken bulk dinner',calories:900,protein:50,carbs:115,fat:25,price:30,ingredients:['150g pasta','1 can tuna or chicken','tomato sauce','olive oil'],instructions:['Boil pasta','Add protein, sauce and oil'],why:'High calorie dinner with common ingredients'},
    snacks:{slot:'snack',name:'Skyr + granola snack',calories:420,protein:32,carbs:45,fat:10,price:14,ingredients:['250g skyr','50g granola','honey'],instructions:['Mix and eat'],why:'Fast protein fix'},
    shake:{slot:'shake',type:'shake',name:'Default bulk shake',calories:800,protein:42,carbs:95,fat:28,price:18,ingredients:['500ml milk','80g oats','1 banana','25g peanut butter','optional whey'],instructions:['Blend 45 seconds'],why:'Covers calorie gaps without cooking'}
  };
  const slots = Object.keys(baseMeals).filter(k => wants[k]);
  const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map((day,i)=>({
    day,
    meals: slots.map(k => ({...baseMeals[k], name: i%2 && k==='dinner' ? 'Rice chicken bulk dinner' : baseMeals[k].name}))
  }));
  const oneDayPrice = slots.reduce((a,k)=>a+(baseMeals[k].price||0),0);
  const totalPrice = Math.round(oneDayPrice * 7 * people);
  const avgCalories = slots.reduce((a,k)=>a+(baseMeals[k].calories||0),0);
  const avgProtein = slots.reduce((a,k)=>a+(baseMeals[k].protein||0),0);
  const avgFat = slots.reduce((a,k)=>a+(baseMeals[k].fat||0),0);
  const pantryNames = (state.pantry||[]).map(x=>typeof x==='string'?x:x.name).filter(Boolean);
  return {
    title: `Local ${focus} weekly plan`,
    summary: `Gemini could not generate the plan, so BulkMind made a reusable plan from cheap Danish staples with v20 decision-engine logic. ${opts.error ? 'AI issue: '+opts.error : ''}`,
    totalPrice,
    avgCalories, avgProtein, avgFat,
    planConfidence: { budgetFit: totalPrice <= budget ? 88 : 55, proteinFit: Math.min(100, Math.round((avgProtein/(state.targets.protein||130))*100)), calorieFit: Math.min(100, Math.round((avgCalories/(state.targets.calories||3100))*100)), effortFit: state.plannerBrain.cookingEffort?.includes('0') ? 70 : 85, variety: 68, wasteControl: state.plannerBrain.leftovers ? 82 : 60 },
    eatingSchedule: (state.plannerBrain.eatingTimes||'07:30 breakfast, 11:30 lunch, 15:30 shake, 18:30 dinner, 22:00 snack').split(',').map(x=>x.trim()),
    pantryUsed: pantryNames.length ? pantryNames.slice(0,8).map(x=>`${x} prioritized before new shopping`) : ['No pantry entered — shopping list assumes you start from zero.'],
    leftoverPlan: ['Cook double rice/chicken at dinner and use it for next day lunch boxes.', 'Keep oats/milk/banana for repeatable breakfast and shakes.'],
    foodFatigueNotes: ['Oats/milk appear often because they are elite bulk value. Swap two breakfasts if you get tired of them.'],
    bestDeals: [
      {name:'Oats', metric:'cheap calories', why:'High calories per krone and works in breakfast/shakes'},
      {name:'Milk', metric:'easy calories', why:'Liquid calories for low appetite'},
      {name:'Rice/pasta', metric:'cheap carbs', why:'Scales well for multiple people'}
    ],
    days,
    shoppingList: [
      {name:'Oats',amount:`${people*1} kg`,price:18*people,reason:'breakfast + shakes',explanation:'cheap calories used in both breakfast and shakes',needsPrice:false},
      {name:'Milk',amount:`${people*7} L`,price:14*people*7,reason:'breakfast + shakes',needsPrice:false},
      {name:'Bananas',amount:`${people*14} pcs`,price:22*people,reason:'breakfast + shakes',needsPrice:false},
      {name:'Rice',amount:`${people*1.5} kg`,price:25*people,reason:'lunch boxes',needsPrice:false},
      {name:'Chicken/tuna/protein source',amount:`${people*2.5} kg`,price:140*people,reason:'lunch + dinner protein',needsPrice:true},
      {name:'Pasta',amount:`${people*1} kg`,price:15*people,reason:'dinners',needsPrice:false},
      {name:'Skyr/granola',amount:`${people*2} packs`,price:45*people,reason:'snacks',needsPrice:true}
    ],
    explainShoppingList:['Oats: cheap calories and used repeatedly', 'Milk: liquid calories for low appetite', 'Rice/pasta: cheap base for multiple meals', 'Chicken/skyr: protein sources that need real prices scanned'],
    missingData:['Scan your real chicken/skyr/protein prices to make this 1:1.'],
    upgradeIdeas: totalPrice > budget ? ['Budget is tight: reduce snacks/shake extras or use more rice/oats/eggs.'] : ['Scan real store prices to find cheaper alternatives.']
  };
}

async function quickShake(){
  if(!requireAI()) return;
  const t=totals(); const gap=Math.max(400, Math.min(950, Math.round(state.targets.calories-t.calories || 750))); const pgap=Math.max(20, Math.min(60, Math.round(state.targets.protein-t.protein || 35)));
  const modal = openModal(`<div class="modalHead"><div><b>AI shake</b><div class="tiny">Uses product memory + calorie gap</div></div><button class="iconBtn" onclick="closeModal()">✕</button></div><section class="card hero"><img src="assets/shake.svg"><div class="heroBody"><div class="h2">Build a useful shake, not a random one.</div><div class="grid2"><div class="field"><label>Target kcal</label><input id="shakeKcal" value="${gap}" inputmode="numeric"></div><div class="field"><label>Protein goal</label><input id="shakeProtein" value="${pgap}" inputmode="numeric"></div></div><div class="field"><label>Ingredients you have / taste</label><textarea id="shakePrefs" placeholder="milk, oats, banana, peanut butter, whey. Make it not too thick."></textarea></div><button class="btn" id="makeShakeBtn">Generate with Gemini</button></div></section><div id="shakeResult"></div>`);
  $('#makeShakeBtn',modal).onclick=async()=>{
    const btn=$('#makeShakeBtn',modal); btn.innerHTML='<span class="loader"></span>Making'; btn.disabled=true;
    try{
      const prompt=`Create one personalized bulk shake as JSON only. Use saved products if relevant and mention if a saved product is used. If the user usually uses sødmælk or a preferred milk, use that unless it breaks dietary rules.
Targets: ${$('#shakeKcal',modal).value} kcal, ${$('#shakeProtein',modal).value}g protein. User prefs: ${$('#shakePrefs',modal).value}. Profile: ${JSON.stringify(state.profile)}. Diet: ${JSON.stringify(state.diet)}. Current targets/logs: ${JSON.stringify({targets:state.targets,today:totals()})}. Product memory: ${JSON.stringify(state.products)}.
Return {"name":"...","type":"shake","calories":800,"protein":45,"carbs":90,"fat":28,"ingredients":["500ml Arla sødmælk"],"instructions":["blend..."],"why":"...","timing":"...","shoppingNote":"if cheaper/better alternative next time","usedProducts":["product names"],"missingProductData":["product needing label photo"]}`;
      const res=await callGeminiJSON(prompt,false); state.lastGenerated=res; save(); $('#shakeResult',modal).innerHTML=`${mealCard(res)}${res.shoppingNote?`<div class="card aiBox"><b>Shopping note</b><p class="p">${esc(res.shoppingNote)}</p></div>`:''}${(res.missingProductData||[]).length?`<div class="card"><span class="status warn">Needs label</span><p class="p">${esc(res.missingProductData.join(', '))}</p><button class="btn secondary" onclick="openProductModal()">Add product data</button></div>`:''}`;
    }catch(e){ toast('AI failed: '+e.message); } finally { btn.disabled=false; btn.textContent='Generate with Gemini'; }
  };
}
async function quickMeal(){
  if(!requireAI()) return;
  const modal=openModal(`<div class="modalHead"><div><b>AI meal</b><div class="tiny">Fast custom meal</div></div><button class="iconBtn" onclick="closeModal()">✕</button></div><section class="card hero"><img src="assets/meal.svg"><div class="heroBody"><div class="field"><label>What do you want?</label><textarea id="mealPrefs" placeholder="cheap halal dinner, airfryer, high protein, 900 kcal"></textarea></div><button class="btn" id="makeMealBtn">Generate meal</button></div></section><div id="mealResult"></div>`);
  $('#makeMealBtn',modal).onclick=async()=>{
    const btn=$('#makeMealBtn',modal); btn.innerHTML='<span class="loader"></span>Generating'; btn.disabled=true;
    try{
      const prompt=`Create one practical meal as JSON only. It must follow user's macros/diet/equipment and use product memory.
Request: ${$('#mealPrefs',modal).value}. Profile ${JSON.stringify(state.profile)} Targets ${JSON.stringify(state.targets)} Diet ${JSON.stringify(state.diet)} Equipment ${JSON.stringify(state.equipment)} Products ${JSON.stringify(state.products)}.
Return {"name":"...","type":"meal","slot":"dinner","calories":900,"protein":55,"carbs":100,"fat":25,"price":35,"ingredients":["..."],"instructions":["..."],"why":"...","timing":"...","shoppingNote":"...","usedProducts":["..."]}`;
      const res=await callGeminiJSON(prompt,false); state.lastGenerated=res; save(); $('#mealResult',modal).innerHTML=mealCard(res);
    }catch(e){ toast('AI failed: '+e.message); } finally { btn.disabled=false; btn.textContent='Generate meal'; }
  };
}
async function lazyLog(){
  if(!requireAI()) return;
  const text=$('#lazyText').value.trim(); if(!text) return toast('Write what you ate');
  const btn=$('#lazyBtn'); btn.innerHTML='<span class="loader"></span>Estimating'; btn.disabled=true;
  try{
    const prompt=`Estimate nutrition for this food log as JSON only: "${text}". Use Danish common products if relevant. Return {"name":"short summary","calories":0,"protein":0,"carbs":0,"fat":0,"confidence":"low/medium/high","note":"short"}.`;
    const res=await callGeminiJSON(prompt,false); openConfirmLog(res);
  }catch(e){ toast('AI failed: '+e.message); } finally { btn.disabled=false; btn.textContent='Estimate with Gemini'; }
}
function openConfirmLog(item){
  openModal(`<div class="modalHead"><div><b>Confirm log</b><div class="tiny">AI estimate</div></div><button class="iconBtn" onclick="closeModal()">✕</button></div><section class="card"><div class="h2">${esc(item.name)}</div><div class="metricGrid">${metric('Kcal',Math.round(item.calories),state.targets.calories,pct(item.calories,state.targets.calories))}${metric('Protein',Math.round(item.protein)+'g',state.targets.protein+'g',pct(item.protein,state.targets.protein))}${metric('Fat',Math.round(item.fat)+'g',state.targets.fat+'g',pct(item.fat,state.targets.fat))}</div><p class="p">${esc(item.note||'')}</p><button class="btn" onclick='addMealToToday(${JSON.stringify(item).replace(/'/g,"&#39;")}); closeModal();'>Add to today</button></section>`);
}
function addMealToToday(m){ state.logs.push({id:safeId(), date:todayISO(), name:m.name||'Meal', calories:+m.calories||0, protein:+m.protein||0, carbs:+m.carbs||0, fat:+m.fat||0, source:'meal'}); save(); render(); toast('Logged'); }
function removeLog(id){ state.logs=state.logs.filter(l=>l.id!==id); save(); render(); }
function saveMeal(m){ state.savedMeals.unshift({...m, savedAt:new Date().toISOString()}); state.savedMeals=state.savedMeals.slice(0,40); save(); toast('Saved meal'); }
function togglePreferred(id){ const p=state.products.find(x=>x.id===id); if(p){p.preferred=!p.preferred; p.usage=(p.usage||0)+1; save(); render();} }

function openQuickLog(){
  openModal(`<div class="modalHead"><div><b>Quick log</b><div class="tiny">Manual fast entry</div></div><button class="iconBtn" onclick="closeModal()">✕</button></div><section class="card"><div class="field"><label>Name</label><input id="qlName" placeholder="Meal"></div><div class="grid2"><div class="field"><label>Calories</label><input id="qlCal" inputmode="numeric"></div><div class="field"><label>Protein</label><input id="qlPro" inputmode="numeric"></div><div class="field"><label>Carbs</label><input id="qlCarb" inputmode="numeric"></div><div class="field"><label>Fat</label><input id="qlFat" inputmode="numeric"></div></div><button class="btn" id="qlSave">Save</button></section>`);
  $('#qlSave').onclick=()=>{ addMealToToday({name:$('#qlName').value||'Food',calories:num($('#qlCal').value),protein:num($('#qlPro').value),carbs:num($('#qlCarb').value),fat:num($('#qlFat').value)}); closeModal(); };
}
function openWeightLog(){
  openModal(`<div class="modalHead"><div><b>Log weight</b></div><button class="iconBtn" onclick="closeModal()">✕</button></div><section class="card"><div class="field"><label>Morning weight kg</label><input id="w" inputmode="decimal" value="${state.profile.weight}"></div><button class="btn" id="wSave">Save weight</button></section>`);
  $('#wSave').onclick=()=>{ const w=num($('#w').value); state.profile.weight=w; state.weights.push({date:todayISO(), weight:w}); save(); closeModal(); render(); toast('Weight saved'); };
}
async function weeklyCheckin(){
  if(!requireAI()) return;
  const modal=openModal(`<div class="modalHead"><div><b>Weekly check-in</b></div><button class="iconBtn" onclick="closeModal()">✕</button></div><section class="card"><div class="field"><label>What was hard this week?</label><textarea id="hard"></textarea></div><button class="btn" id="checkBtn">Get AI adjustment</button></section><div id="checkResult"></div>`);
  $('#checkBtn').onclick=async()=>{ const btn=$('#checkBtn'); btn.innerHTML='<span class="loader"></span>Checking'; btn.disabled=true; try{ const recent={logs:state.logs.slice(-80),weights:state.weights.slice(-14),targets:state.targets,profile:state.profile}; const res=await callGeminiJSON(`Do a weekly bulk check-in as JSON only. Data ${JSON.stringify(recent)} User says hard: ${$('#hard').value}. Return {"summary":"...","changeTargets":true,"newTargets":{"calories":0,"protein":0,"carbs":0,"fat":0},"focus":"...","warning":"..."}. Only change targets if trend demands it.`,false); if(res.changeTargets && res.newTargets){ state.targets={...state.targets,...res.newTargets,source:'Gemini weekly check-in'}; save(); } $('#checkResult').innerHTML=`<section class="card aiBox"><div class="h2">AI check-in</div><p class="p">${esc(res.summary)}</p><p class="p"><b>Focus:</b> ${esc(res.focus)}</p>${res.warning?`<p class="p"><span class="status warn">Warning</span> ${esc(res.warning)}</p>`:''}</section>`; render(); }catch(e){ toast('AI failed: '+e.message); } finally{btn.disabled=false; btn.textContent='Get AI adjustment';}};
}
async function askCoachToday(){
  if(!requireAI()) return;
  const t=totals(); openAskModal('What should I do right now?', `Today log ${JSON.stringify(t)} Targets ${JSON.stringify(state.targets)} Plan ${JSON.stringify(state.plan?.days?.[0]||{})}. Give direct practical advice.`);
}
function askAboutItem(item){ openAskModal(`Ask AI about ${item.name}`, `User is asking about this generated food: ${JSON.stringify(item)}. User profile/targets: ${JSON.stringify({profile:state.profile,targets:state.targets,diet:state.diet,products:state.products})}. Answer practical questions, substitutions, taste, price, timing and whether it fits.`); }
function askAboutPlan(){ openAskModal('Ask AI about this plan', `User asks about weekly plan: ${JSON.stringify(state.plan)}. Profile/targets/diet: ${JSON.stringify({profile:state.profile,targets:state.targets,diet:state.diet})}.`); }
async function swapDay(idx){
  if(!requireAI()) return;
  const day=state.plan.days[idx]; toast('Swapping day with AI...');
  try{ const res=await callGeminiJSON(`Swap this day in the meal plan, keep same budget/diet/macros. Return one JSON day object {"day":"${day.day}","meals":[...]}. Existing day ${JSON.stringify(day)} Full context ${JSON.stringify({profile:state.profile,targets:state.targets,diet:state.diet,equipment:state.equipment,products:state.products})}`,false); state.plan.days[idx]=res; save(); render(); }catch(e){ toast('Swap failed'); }
}
function openAskModal(title, context){
  if(!requireAI()) return;
  const modal=openModal(`<div class="modalHead"><div><b>${esc(title)}</b><div class="tiny">Ask about taste, cost, substitutions, timing</div></div><button class="iconBtn" onclick="closeModal()">✕</button></div><section class="card"><textarea id="askText" placeholder="Example: make this cheaper but same protein"></textarea><button class="btn" id="askBtn">Ask Gemini</button></section><div id="askAnswer"></div>`);
  $('#askBtn',modal).onclick=async()=>{ const btn=$('#askBtn',modal); btn.innerHTML='<span class="loader"></span>Asking'; btn.disabled=true; try{ const ans=await callGeminiText(`${context}\nUser question: ${$('#askText',modal).value}\nAnswer in short practical bullets.`, false); $('#askAnswer',modal).innerHTML=`<section class="card aiBox"><p class="p">${esc(ans).replace(/\n/g,'<br>')}</p></section>`; }catch(e){ toast('AI failed: '+e.message); } finally{btn.disabled=false; btn.textContent='Ask Gemini';} };
}

function openProductModal(){
  const modal=openModal(`<div class="modalHead"><div><b>Add product</b><div class="tiny">Save it so AI can reuse it</div></div><button class="iconBtn" onclick="closeModal()">✕</button></div>
  <section class="card"><div class="seg"><button class="active" id="manualTab">Manual</button><button id="barcodeTab">Barcode/API</button></div><div id="productBody"></div></section>`);
  const body=$('#productBody',modal);
  const renderManual=()=>{ body.innerHTML=`<div class="field"><label>Product name</label><input id="pName" placeholder="Arla sødmælk 1L"></div><div class="grid2"><div class="field"><label>Category</label><select id="pCat"><option>milk</option><option>whey</option><option>oats</option><option>skyr</option><option>meat</option><option>rice/pasta</option><option>other</option></select></div><div class="field"><label>Unit</label><select id="pUnit"><option>ml</option><option>g</option></select></div><div class="field"><label>kcal/100</label><input id="pCal" inputmode="decimal"></div><div class="field"><label>protein/100</label><input id="pPro" inputmode="decimal"></div><div class="field"><label>carbs/100</label><input id="pCarb" inputmode="decimal"></div><div class="field"><label>fat/100</label><input id="pFat" inputmode="decimal"></div><div class="field"><label>Price kr</label><input id="pPrice" inputmode="decimal"></div><div class="field"><label>Package size</label><input id="pSize" inputmode="decimal" placeholder="1000"></div></div><button class="chip active" id="pPref">✓ Prefer in AI shakes/meals</button><div class="grid2" style="margin-top:12px"><button class="btn" id="saveProduct">Save product</button><button class="btn secondary" id="photoLabel">Read label photo</button></div><input type="file" accept="image/*" capture="environment" id="labelFile" class="hiddenInput">`; bindProductManual(modal); };
  const renderBarcode=()=>{ body.innerHTML=`<div class="field"><label>Barcode number / EAN</label><input id="barcode" inputmode="numeric" placeholder="571195307...."></div><div class="grid2"><div class="field"><label>Store</label><select id="lookupStore"><option>Netto</option><option>Føtex</option><option>Bilka</option><option>Lidl</option><option>REMA 1000</option><option>Coop 365</option></select></div><div class="field"><label>Salling storeId</label><input id="lookupStoreId" placeholder="required for Netto/Føtex/Bilka" value="${esc(state.profile.sallingStoreId||'')}"></div></div><button class="btn" id="lookupBarcode">Lookup nutrition + Salling price</button><p class="micro">For Netto/Føtex/Bilka: Salling price needs a storeId and SALLING_API_TOKEN in Vercel. Nutrition comes from Open Food Facts or label photo.</p><div id="barcodeResult"></div>`; $('#lookupStore',modal).value=state.profile.store||'Netto'; $('#lookupBarcode',modal).onclick=()=>lookupBarcode(modal); };
  $('#manualTab',modal).onclick=()=>{ $('#manualTab').classList.add('active'); $('#barcodeTab').classList.remove('active'); renderManual(); };
  $('#barcodeTab',modal).onclick=()=>{ $('#barcodeTab').classList.add('active'); $('#manualTab').classList.remove('active'); renderBarcode(); };
  renderManual();
}
function bindProductManual(modal){
  let preferred=true; $('#pPref',modal).onclick=()=>{ preferred=!preferred; $('#pPref',modal).classList.toggle('active',preferred); $('#pPref',modal).innerHTML=`${preferred?'✓':''} Prefer in AI shakes/meals`; };
  $('#saveProduct',modal).onclick=()=>{ const p={id:safeId(),name:$('#pName',modal).value||'Product',category:$('#pCat',modal).value,unit:$('#pUnit',modal).value,calories:num($('#pCal',modal).value),protein:num($('#pPro',modal).value),carbs:num($('#pCarb',modal).value),fat:num($('#pFat',modal).value),price:num($('#pPrice',modal).value),packageSize:num($('#pSize',modal).value),preferred,usage:0,createdAt:new Date().toISOString()}; state.products.unshift(p); save(); closeModal(); render(); toast('Product saved'); };
  $('#photoLabel',modal).onclick=()=>$('#labelFile',modal).click();
  $('#labelFile',modal).onchange=async(e)=>{ const file=e.target.files[0]; if(!file) return; if(!requireAI()) return; toast('Reading label with Gemini...'); try{ const data=await fileToBase64(file); const res=await callGeminiJSON(`Read this nutrition label/product image. Return JSON only {"name":"","category":"milk/whey/oats/skyr/meat/rice/pasta/other","unit":"g or ml","calories":0,"protein":0,"carbs":0,"fat":0,"confidence":"low/medium/high","missing":["fields"]}. Values must be per 100g/ml.`,false,{mime:file.type,data}); $('#pName',modal).value=res.name||$('#pName',modal).value; $('#pCat',modal).value=res.category||'other'; $('#pUnit',modal).value=res.unit||'g'; $('#pCal',modal).value=res.calories||''; $('#pPro',modal).value=res.protein||''; $('#pCarb',modal).value=res.carbs||''; $('#pFat',modal).value=res.fat||''; toast('Label read'); }catch(err){ toast('Label failed'); } };
}
function fileToBase64(file){ return new Promise((resolve,reject)=>{ const r=new FileReader(); r.onload=()=>resolve(String(r.result).split(',')[1]); r.onerror=reject; r.readAsDataURL(file); }); }
async function lookupBarcode(modal){
  const code=$('#barcode',modal).value.trim(); if(!code) return toast('Enter barcode');
  const store=$('#lookupStore',modal)?.value || state.profile.store || 'Netto';
  const storeId=$('#lookupStoreId',modal)?.value.trim() || state.profile.sallingStoreId || '';
  state.profile.store = store; if(storeId) state.profile.sallingStoreId = storeId; save();
  const out=$('#barcodeResult',modal); out.innerHTML='<div class="skeleton"></div>';
  const isSalling=['Netto','Føtex','Bilka'].includes(store);
  let offProduct=null, sallingProduct=null, errors=[];
  try{
    const r=await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`);
    const data=await r.json();
    if(data.product) offProduct=data.product; else errors.push('Open Food Facts: product not found');
  }catch(e){ errors.push('Open Food Facts failed'); }
  if(isSalling && storeId){
    try{
      const sr=await fetch(`/api/salling?ean=${encodeURIComponent(code)}&storeId=${encodeURIComponent(storeId)}`);
      const sd=await sr.json();
      if(!sr.ok) throw new Error(sd.error || sd.errorMessage || 'Salling lookup failed');
      sallingProduct=sd;
    }catch(e){ errors.push('Salling: '+e.message); }
  } else if(isSalling && !storeId){ errors.push('Salling price needs storeId'); }
  if(!offProduct && !sallingProduct){ out.innerHTML=`<div class="empty"><b>Not found</b><p class="p">${esc(errors.join(' · ') || 'No API data')}.</p><p class="p">Add manually or scan nutrition label.</p></div>`; return; }
  const pr=offProduct||{}; const n=pr.nutriments||{}; const sp=sallingProduct?.instore || {};
  const q=String(pr.quantity||'');
  const p={
    id:safeId(),
    name:sp.name || pr.product_name || pr.brands || 'Scanned product',
    category:guessCat((sp.name||'')+' '+(pr.product_name||'')+' '+(pr.categories||'')),
    unit:(q.toLowerCase().includes('ml') || sp.unit==='l')?'ml':'g',
    calories:round(n['energy-kcal_100g']||0),
    protein:round(n.proteins_100g||0,1),
    carbs:round(n.carbohydrates_100g||0,1),
    fat:round(n.fat_100g||0,1),
    price:round(sp.price || 0,2),
    unitPrice:round(sp.unitPrice || 0,2),
    packageSize:guessPackageSize(q, sp.contents, sp.contentsUnit),
    store, storeId,
    priceSource: sallingProduct ? `Salling API (${store}, storeId ${storeId})` : 'missing/manual',
    campaign: sp.campaign || null, deposit: sp.deposit || null,
    preferred:false, usage:0, barcode:code, createdAt:new Date().toISOString()
  };
  const missingNutrition=!p.calories&&!p.protein&&!p.carbs&&!p.fat;
  const priceLine = sallingProduct ? `${p.price} kr${p.unitPrice?` · ${p.unitPrice} kr/${esc(sp.unit||p.unit)}`:''}` : 'No live price';
  const campaignLine = p.campaign ? `<div class="micro">Campaign: ${esc(p.campaign.displayText || p.campaign.text || '')}</div>` : '';
  out.innerHTML=`<div class="item"><b>${esc(p.name)}</b><div class="tiny">${p.calories||'?'} kcal · ${p.protein||'?'}g protein · ${p.fat||'?'}g fat /100${p.unit}</div><div class="tiny">Price: ${priceLine}</div><div class="micro">${esc(p.priceSource)}</div>${campaignLine}${missingNutrition?'<p class="p"><span class="status warn">Missing nutrition</span> Save it, then scan label photo so AI can use exact macros.</p>':''}${errors.length?`<p class="micro">Notes: ${esc(errors.join(' · '))}</p>`:''}<button class="btn" id="saveLookup">Save product memory</button></div>`;
  $('#saveLookup',modal).onclick=()=>{state.products.unshift(p);save();closeModal();render();toast('Product saved with '+(sallingProduct?'Salling price':'no live price'));};
}
function guessPackageSize(quantity='', contents=0, unit=''){
  const q=String(quantity).toLowerCase().replace(',','.');
  const m=q.match(/([0-9.]+)\s*(l|ml|kg|g)/);
  if(m){ const val=Number(m[1]); const u=m[2]; if(u==='l') return val*1000; if(u==='kg') return val*1000; return val; }
  if(contents){ const val=Number(contents)||0; if(String(unit).toLowerCase()==='l') return val*1000; if(String(unit).toLowerCase()==='kg') return val*1000; return val; }
  return 0;
}
function guessCat(txt=''){ const t=txt.toLowerCase(); if(t.includes('mælk')||t.includes('milk'))return'milk'; if(t.includes('whey')||t.includes('protein'))return'whey'; if(t.includes('havre')||t.includes('oat'))return'oats'; if(t.includes('skyr'))return'skyr'; if(t.includes('kylling')||t.includes('chicken'))return'meat'; return'other'; }

if('serviceWorker' in navigator){ window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{})); }
window.addEventListener('error', (event)=>{ console.warn('BulkMind runtime error', event.error || event.message); });
try { render(); } catch (e) {
  console.error(e);
  app.innerHTML = `<main class="fatal"><div class="card"><b>BulkMind could not start</b><p class="p">The app hit a browser/storage issue. Try the hosted HTTPS Vercel link in Safari. If this is the Home Screen app, remove it and add it again from Safari.</p><button class="btn" onclick="location.reload()">Retry</button></div></main>`;
}
