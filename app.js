const APP_VERSION = 5;
const LEGACY_KEY = 'bulkmind.v1';
const DB_NAME = 'bulkmind-db';
const DB_STORE = 'kv';
const STATE_KEY = 'state';
const $ = (q, root = document) => root.querySelector(q);
const $$ = (q, root = document) => [...root.querySelectorAll(q)];
const clamp = (n, min, max) => Math.max(min, Math.min(max, Number(n) || 0));
const round = (n, digits = 0) => Number((Number(n) || 0).toFixed(digits));
const todayISO = () => new Date().toLocaleDateString('en-CA');
const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const escapeHTML = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const cap = s => String(s || '').replace(/-/g, ' ').replace(/\b\w/g, m => m.toUpperCase());

const defaultProfile = {
  name: 'Mo', age: 18, gender: 'male', height: 175, currentWeight: 60, targetWeight: 80,
  goalType: 'bulk', activityLevel: 'moderate', aggression: 'balanced', trainingDays: 3,
  trainingPlace: 'home', appetite: 'low', budget: 'budget', restrictions: 'halal',
  likedFoods: 'milk, oats, banana, peanut butter, chicken, rice, eggs, pasta, yogurt',
  dislikedFoods: '', schedule: 'School during the day, training in the evening', coachTone: 'chill'
};

const initialState = {
  version: APP_VERSION,
  profile: null,
  onboardingDraft: null,
  settings: { theme: 'dark', geminiKey: '', geminiModel: 'gemini-2.5-flash-lite' },
  logs: {},
  savedFoods: [],
  generatedFoods: [],
  workoutPlan: null,
  workoutLogs: [],
  chat: [],
  ui: { tab: 'today', foodSegment: 'generate' }
};

let state = structuredClone(initialState);
let db;
let onboardingStep = 0;
let activeWorkout = null;
let pendingWorker = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DB_STORE)) database.createObjectStore(DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function dbGet(key) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function dbSet(key, value) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
async function saveState() {
  state.version = APP_VERSION;
  await dbSet(STATE_KEY, state);
}
function mergeState(base, patch) {
  if (!patch || typeof patch !== 'object') return base;
  for (const key of Object.keys(patch)) {
    if (patch[key] && typeof patch[key] === 'object' && !Array.isArray(patch[key]) && base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      mergeState(base[key], patch[key]);
    } else base[key] = patch[key];
  }
  return base;
}
async function loadState() {
  const stored = await dbGet(STATE_KEY);
  if (stored) return mergeState(structuredClone(initialState), stored);
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY));
    if (legacy) {
      const migrated = mergeState(structuredClone(initialState), legacy);
      migrated.settings.geminiKey = legacy.settings?.geminiKey || '';
      migrated.settings.geminiModel = legacy.settings?.geminiModel || 'gemini-2.5-flash-lite';
      migrated.ui = structuredClone(initialState.ui);
      await dbSet(STATE_KEY, migrated);
      localStorage.setItem('bulkmind.v5.migrated', '1');
      return migrated;
    }
  } catch {}
  return structuredClone(initialState);
}

function calculateTargets(profile) {
  const p = { ...defaultProfile, ...profile };
  const sex = p.gender === 'female' ? -161 : 5;
  const bmr = 10 * Number(p.currentWeight) + 6.25 * Number(p.height) - 5 * Number(p.age) + sex;
  const factor = { low: 1.35, moderate: 1.55, high: 1.72, 'very-high': 1.9 }[p.activityLevel] || 1.55;
  const maintenance = Math.round(bmr * factor);
  let adjustment = 0;
  if (p.goalType === 'bulk') adjustment = { slow: 250, balanced: 400, fast: 525 }[p.aggression] || 400;
  if (p.goalType === 'lean-bulk') adjustment = { slow: 175, balanced: 275, fast: 375 }[p.aggression] || 275;
  if (p.goalType === 'cut') adjustment = -({ slow: 250, balanced: 400, fast: 525 }[p.aggression] || 400);
  if (p.goalType === 'strength') adjustment = 200;
  const calories = Math.max(1500, Math.round(maintenance + adjustment));
  const protein = Math.round(Number(p.currentWeight) * (p.goalType === 'cut' ? 2.0 : 1.8));
  const fat = Math.max(45, Math.round(Number(p.currentWeight) * .85));
  const carbs = Math.max(120, Math.round((calories - protein * 4 - fat * 9) / 4));
  const weekly = p.goalType === 'cut' ? -.4 : p.goalType === 'lean-bulk' ? .25 : p.goalType === 'bulk' ? .4 : .15;
  return { bmr: Math.round(bmr), maintenance, calories, protein, carbs, fat, weekly };
}
function getTargets() { return calculateTargets(state.profile || defaultProfile); }
function getLog(date = todayISO()) {
  if (!state.logs[date]) state.logs[date] = { date, entries: [], calories: 0, protein: 0, carbs: 0, fat: 0, weight: null, water: 0, sleep: null, appetite: null, workoutCompleted: false };
  return state.logs[date];
}
function recalcLog(log) {
  const entries = log.entries || [];
  for (const macro of ['calories','protein','carbs','fat']) log[macro] = round(entries.reduce((sum, item) => sum + Number(item[macro] || 0), 0));
}
function addEntry(food, date = todayISO()) {
  const log = getLog(date);
  log.entries.unshift({ id: uid(), at: new Date().toISOString(), name: food.name, type: food.type || 'meal', calories: round(food.calories), protein: round(food.protein), carbs: round(food.carbs), fat: round(food.fat), sourceId: food.id || null });
  recalcLog(log);
  saveState();
  toast(`${food.name} added`);
  render();
}

async function boot() {
  db = await openDB();
  state = await loadState();
  onboardingStep = clamp(state.onboardingDraft?.step || 0, 0, 2);
  applyTheme();
  setupGlobalEvents();
  setupViewportHandling();
  setupServiceWorker();
  render();
}

function applyTheme() { document.body.classList.toggle('light', state.settings.theme === 'light'); }
function render() {
  const app = $('#app');
  if (!state.profile) app.innerHTML = state.onboardingDraft ? onboardingHTML() : landingHTML();
  else app.innerHTML = shellHTML();
  bindPageEvents();
  if (state.profile && state.ui.tab === 'progress') requestAnimationFrame(drawProgressChart);
}

function landingHTML() {
  return `<main class="landing"><div class="landing-inner screen-enter">
    <div><div class="brand-badge">B</div><p class="eyebrow">Personal fitness operating system</p><h1>Eat better.<br>Train smarter.<br>Actually progress.</h1>
    <p class="landing-copy">BulkMind turns your real calorie gap, preferences, schedule and training into the next useful action — without making you dig through ten screens.</p></div>
    <div class="landing-actions"><button class="primary full" data-action="start-onboarding">Build my plan</button><button class="secondary full" data-action="use-demo">Preview with demo data</button></div>
    <div class="proof-grid"><div class="proof card"><strong>1 tap</strong><span>to log food</span></div><div class="proof card"><strong>Custom</strong><span>AI meals & shakes</span></div><div class="proof card"><strong>Private</strong><span>saved on your device</span></div></div>
    <p class="privacy-note">No account required. Your data stays on this device unless you export it.</p>
  </div></main>`;
}

const onboardingSteps = [
  { title: 'Your starting point', sub: 'Only the numbers needed to calculate a useful target.' },
  { title: 'Make it fit your life', sub: 'BulkMind should work around your appetite, money and routine.' },
  { title: 'Review your plan', sub: 'You can change everything later.' }
];
function draftProfile() { return { ...defaultProfile, ...(state.onboardingDraft?.profile || {}) }; }
function onboardingHTML() {
  const info = onboardingSteps[onboardingStep];
  return `<main class="onboarding">
    <header class="onboarding-top"><div class="onboarding-head"><button class="icon-button" data-action="onboarding-back" ${onboardingStep === 0 ? 'disabled' : ''}>←</button><div><p class="eyebrow">Step ${onboardingStep + 1} of 3</p><h2>${info.title}</h2></div><span class="pill">${Math.round((onboardingStep + 1)/3*100)}%</span></div><div class="progress"><div style="width:${(onboardingStep + 1)/3*100}%"></div></div></header>
    <section class="onboarding-scroll"><div class="onboarding-content"><p class="subtle">${info.sub}</p>${onboardingStepContent()}</div></section>
    <footer class="onboarding-footer"><button class="ghost" data-action="cancel-onboarding">Cancel</button><button class="primary" data-action="onboarding-next">${onboardingStep === 2 ? 'Start using BulkMind' : 'Continue'}</button></footer>
  </main>`;
}
function onboardingStepContent() {
  const p = draftProfile();
  if (onboardingStep === 0) return `<div class="form-grid">
    ${field('name','Name','text',p.name,'What should the coach call you?')}
    ${field('age','Age','number',p.age)}
    ${field('height','Height (cm)','number',p.height)}
    ${field('currentWeight','Current weight (kg)','number',p.currentWeight)}
    ${field('targetWeight','Target weight (kg)','number',p.targetWeight)}
    ${selectField('goalType','Main goal',p.goalType,[['bulk','Bulk / gain weight'],['lean-bulk','Lean bulk'],['cut','Lose fat'],['strength','Get stronger'],['maintain','Maintain']])}
    ${selectField('activityLevel','Daily activity',p.activityLevel,[['low','Mostly sitting'],['moderate','Normal student/work day'],['high','Very active'],['very-high','Physical job + training']])}
    ${selectField('aggression','Plan speed',p.aggression,[['slow','Slow and easy'],['balanced','Balanced'],['fast','Fast but sensible']])}
  </div>`;
  if (onboardingStep === 1) return `<div class="form-grid">
    ${selectField('appetite','Appetite',p.appetite,[['low','Low — eating enough is hard'],['normal','Normal'],['high','High']])}
    ${selectField('budget','Food budget',p.budget,[['budget','Keep it cheap'],['normal','Normal'],['premium','Premium is fine']])}
    ${selectField('trainingPlace','Training setup',p.trainingPlace,[['home','Home'],['gym','Gym'],['both','Home + gym']])}
    ${field('trainingDays','Training days/week','number',p.trainingDays)}
    ${field('restrictions','Food rules','text',p.restrictions,'Example: halal, lactose-free')}
    ${field('schedule','Typical day','text',p.schedule,'Example: school 8–15, gym at 18','full')}
    ${areaField('likedFoods','Foods you like',p.likedFoods,'milk, oats, rice, chicken...')}
    ${areaField('dislikedFoods','Foods you dislike',p.dislikedFoods,'Anything the AI should avoid')}
  </div>`;
  const t = calculateTargets(p);
  return `<div class="stack">
    <div class="summary-target card"><p class="eyebrow">Starting daily target</p><strong>${t.calories}</strong> <span>kcal</span><div class="macro-grid" style="margin-top:14px"><div class="macro-card card"><strong>${t.protein}g</strong><span>protein</span></div><div class="macro-card card"><strong>${t.carbs}g</strong><span>carbs</span></div><div class="macro-card card"><strong>${t.fat}g</strong><span>fat</span></div></div></div>
    <div class="card card-pad"><h3>${escapeHTML(p.currentWeight)} kg → ${escapeHTML(p.targetWeight)} kg</h3><p class="subtle">BulkMind will use your actual weekly weight trend to tell you whether this target should stay the same or change.</p></div>
    <div class="card card-pad"><h3>Built around you</h3><p class="subtle">${cap(p.budget)} food · ${cap(p.appetite)} appetite · ${cap(p.trainingPlace)} training · ${escapeHTML(p.restrictions || 'No restrictions')}</p></div>
  </div>`;
}
function field(name,label,type,value,hint='',cls='') { return `<div class="field ${cls}"><label for="${name}">${label}</label><input class="input" id="${name}" name="${name}" type="${type}" value="${escapeHTML(value)}" ${type==='number'?'inputmode="decimal"':''}>${hint?`<small>${hint}</small>`:''}<small id="${name}-error" class="field-error"></small></div>`; }
function areaField(name,label,value,placeholder='') { return `<div class="field full"><label for="${name}">${label}</label><textarea id="${name}" name="${name}" placeholder="${escapeHTML(placeholder)}">${escapeHTML(value)}</textarea><small id="${name}-error" class="field-error"></small></div>`; }
function selectField(name,label,value,options) { return `<div class="field"><label for="${name}">${label}</label><select id="${name}" name="${name}">${options.map(([v,l])=>`<option value="${v}" ${String(v)===String(value)?'selected':''}>${l}</option>`).join('')}</select><small id="${name}-error" class="field-error"></small></div>`; }

function shellHTML() {
  const tab = state.ui.tab || 'today';
  return `<main class="shell">
    <header class="app-header"><div><p class="eyebrow">${headerEyebrow(tab)}</p><h2>${headerTitle(tab)}</h2></div><div class="header-actions"><span class="pill"><i class="sync-dot"></i> Local</span><button class="icon-button" data-action="open-settings" aria-label="Settings">⚙</button></div></header>
    <div class="screen-scroll"><section class="screen screen-enter">${screenContent(tab)}</section></div>
    <button class="quick-fab" data-action="open-quick-log" aria-label="Quick add">+</button>
    <nav class="bottom-nav" aria-label="Main navigation">${navButton('today','⌂','Today')}${navButton('food','◉','Food')}${navButton('train','◆','Train')}${navButton('progress','↗','Progress')}</nav>
  </main>`;
}
function navButton(tab,icon,label) { return `<button class="nav-button ${state.ui.tab===tab?'active':''}" data-action="switch-tab" data-tab="${tab}"><span>${icon}</span><small>${label}</small></button>`; }
function headerEyebrow(tab) { return {today:new Date().toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric'}),food:'Nutrition',train:'Training',progress:'Analytics'}[tab]; }
function headerTitle(tab) { return {today:`Hey, ${escapeHTML(state.profile.name || 'there')}`,food:'Food that fits the gap',train:'Do the next workout',progress:'Is the plan working?'}[tab]; }
function screenContent(tab) { return ({today:todayScreen,food:foodScreen,train:trainScreen,progress:progressScreen}[tab] || todayScreen)(); }

function todayScreen() {
  const log = getLog();
  const t = getTargets();
  const pct = clamp(Math.round(log.calories / t.calories * 100), 0, 100);
  const gap = Math.max(0, t.calories - log.calories);
  const proteinGap = Math.max(0, t.protein - log.protein);
  return `<div class="hero-status card"><div class="calorie-big"><p class="eyebrow">Today</p><strong>${round(log.calories)}</strong><span>of ${t.calories} kcal · ${gap} remaining</span></div><div class="goal-ring" style="--progress:${pct}%"><div><strong>${pct}%</strong><span>complete</span></div></div></div>
    <div class="macro-grid">${macroCard('Protein',log.protein,t.protein,'g')}${macroCard('Carbs',log.carbs,t.carbs,'g')}${macroCard('Fat',log.fat,t.fat,'g')}</div>
    <div class="quick-grid"><button class="quick-action" data-action="smart-shake"><span class="icon">🥤</span><strong>Fill the gap</strong><small>Make a ${gap || 500} kcal shake</small></button><button class="quick-action" data-action="smart-meal"><span class="icon">🍛</span><strong>Make a meal</strong><small>Built for ${proteinGap}g protein left</small></button><button class="quick-action" data-action="open-coach"><span class="icon">✦</span><strong>Ask coach</strong><small>Use all your saved context</small></button><button class="quick-action" data-action="log-weight"><span class="icon">⚖</span><strong>Log weight</strong><small>${latestWeightText()}</small></button></div>
    <div class="insight card"><div class="insight-icon">✦</div><div><p class="eyebrow">Best next action</p><p>${dailyInsight(log,t)}</p></div></div>
    <div><div class="section-title"><div><p class="eyebrow">Timeline</p><h3>Today’s log</h3></div>${log.entries.length?`<button class="link-button" data-action="edit-log">Edit</button>`:''}</div>${entryList(log)}</div>`;
}
function macroCard(name,current,target,unit) { const pct=clamp(current/target*100,0,100); return `<div class="macro-card card"><strong>${round(current)}${unit}</strong><span>${name} / ${target}${unit}</span><div class="bar"><i style="width:${pct}%"></i></div></div>`; }
function dailyInsight(log,t) {
  const gap=t.calories-log.calories, pg=t.protein-log.protein;
  if (!log.entries.length) return `Start with the easiest win: log your first meal, even if it is only a rough estimate.`;
  if (gap > 700 && state.profile.appetite === 'low') return `You still need about ${round(gap)} kcal. A low-volume shake is easier than forcing another large meal.`;
  if (pg > 35) return `Protein is the main gap now. Your next meal should carry roughly ${round(pg)}g across one meal or two snacks.`;
  if (gap <= 200) return `You are close enough. Finish normally instead of forcing calories just to hit a perfect number.`;
  return `You are on track. One simple ${round(gap)} kcal meal or shake would complete the day.`;
}
function latestWeightText() { const weights=Object.values(state.logs).filter(l=>l.weight).sort((a,b)=>a.date.localeCompare(b.date)); return weights.length?`Last: ${weights.at(-1).weight} kg`:`Track the trend`; }
function entryList(log) {
  if (!log.entries.length) return `<div class="empty card">Nothing logged yet. Tap + or use one of the quick actions.</div>`;
  return `<div class="entry-list">${log.entries.map(e=>`<div class="entry"><div class="entry-icon">${e.type==='shake'?'🥤':'🍽'}</div><div><strong>${escapeHTML(e.name)}</strong><small>${round(e.protein)}g protein · ${new Date(e.at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</small></div><div class="kcal">${round(e.calories)}</div></div>`).join('')}</div>`;
}

function foodScreen() {
  const seg=state.ui.foodSegment || 'generate';
  return `<div class="segmented"><button data-action="food-segment" data-segment="generate" class="${seg==='generate'?'active':''}">Generate</button><button data-action="food-segment" data-segment="log" class="${seg==='log'?'active':''}">Quick log</button><button data-action="food-segment" data-segment="saved" class="${seg==='saved'?'active':''}">Saved</button></div>${seg==='generate'?foodGenerateHTML():seg==='log'?foodLogHTML():savedFoodHTML()}`;
}
function foodGenerateHTML() {
  const {calorieGap,proteinGap}=currentGaps();
  return `<div class="generator-card card"><div class="generator-hero"><div><p class="eyebrow">Fastest option</p><h3>Generate exactly what is missing</h3><p class="subtle">Current gap: ${calorieGap} kcal and ${proteinGap}g protein.</p></div><span class="emoji">⚡</span></div><button class="primary full" data-action="smart-meal">Make the best meal now</button><div class="preset-row"><button class="preset" data-action="preset-generate" data-preset="shake">🥤 Shake</button><button class="preset" data-action="preset-generate" data-preset="cheap">💸 Cheap</button><button class="preset" data-action="preset-generate" data-preset="low-volume">🪶 Low volume</button><button class="preset" data-action="preset-generate" data-preset="school">🎒 Portable</button><button class="preset" data-action="preset-generate" data-preset="fridge">🧊 Use ingredients</button></div></div>
    <div class="section-title"><div><p class="eyebrow">Recently generated</p><h3>Ready to reuse</h3></div></div>${recentGeneratedHTML()}`;
}
function foodLogHTML() {
  return `<div class="card card-pad stack"><div><h3>Lazy log</h3><p class="subtle">Type what you ate normally. BulkMind estimates it and lets you confirm.</p></div><textarea id="lazyLogText" placeholder="Example: 2 eggs, 3 pieces of toast, milk and a chicken wrap"></textarea><button class="primary full" data-action="lazy-log">Estimate and add</button></div><button class="secondary full" data-action="manual-log">Enter calories and macros manually</button>`;
}
function savedFoodHTML() {
  if (!state.savedFoods.length) return `<div class="empty card">Save a generated meal or shake and it will appear here for one-tap reuse.</div>`;
  return `<div class="stack">${state.savedFoods.map(foodCardHTML).join('')}</div>`;
}
function recentGeneratedHTML() {
  const foods=state.generatedFoods.slice(0,5);
  return foods.length?`<div class="stack">${foods.map(foodCardHTML).join('')}</div>`:`<div class="empty card">Your generated meals and shakes will appear here.</div>`;
}
function foodCardHTML(food) {
  return `<article class="food-card card"><div class="food-top"><div class="food-title"><strong>${escapeHTML(food.name)}</strong><span>${escapeHTML(food.summary || food.timing || cap(food.type))}</span></div><span class="pill ${food.source==='gemini'?'good':''}">${food.source==='gemini'?'AI':'Smart local'}</span></div><div class="food-macros"><div><strong>${round(food.calories)}</strong><span>kcal</span></div><div><strong>${round(food.protein)}g</strong><span>protein</span></div><div><strong>${round(food.carbs)}g</strong><span>carbs</span></div><div><strong>${round(food.fat)}g</strong><span>fat</span></div></div><details class="ingredients"><summary>Ingredients & steps</summary><ul>${(food.ingredients||[]).map(i=>`<li>${escapeHTML(typeof i==='string'?i:`${i.amount} ${i.item}`)}</li>`).join('')}</ul>${food.instructions?.length?`<ol>${food.instructions.map(s=>`<li>${escapeHTML(s)}</li>`).join('')}</ol>`:''}</details><div class="food-actions"><button class="primary" data-action="add-food" data-id="${food.id}">Add to today</button><button class="secondary" data-action="ask-food" data-id="${food.id}">Ask AI / change it</button></div><div class="row between"><button class="link-button" data-action="save-food" data-id="${food.id}">${state.savedFoods.some(f=>f.id===food.id)?'Saved ✓':'Save for later'}</button><button class="link-button" data-action="delete-generated" data-id="${food.id}">Remove</button></div></article>`;
}

function trainScreen() {
  if (!state.workoutPlan) return `<div class="workout-summary card"><p class="eyebrow">No plan yet</p><h3>Create a simple plan you can actually follow</h3><p class="subtle">It uses your training place and number of weekly sessions. You can regenerate it later.</p><button class="primary full" data-action="generate-workout">Create my workout plan</button></div>`;
  if (!activeWorkout) activeWorkout = nextWorkout();
  const workout = activeWorkout;
  return `<div class="workout-summary card"><div class="row between"><div><p class="eyebrow">Next session</p><h3>${escapeHTML(workout.name)}</h3></div><span class="pill">${workout.exercises.length} exercises</span></div><div class="workout-meta"><span class="pill">${state.profile.trainingPlace}</span><span class="pill">~${workout.exercises.length*8} min</span><span class="pill">${state.profile.trainingDays}× / week</span></div></div>
    <div class="exercise-list">${workout.exercises.map((ex,exIndex)=>exerciseHTML(ex,exIndex)).join('')}</div>
    <button class="primary full" data-action="finish-workout">Finish workout</button><button class="ghost full" data-action="generate-workout">Regenerate plan</button>`;
}
function nextWorkout() { const done=state.workoutLogs.length; return structuredClone(state.workoutPlan.sessions[done % state.workoutPlan.sessions.length]); }
function exerciseHTML(ex,exIndex) {
  const sets=ex.sets || Array.from({length:3},()=>({reps:ex.reps||'8-12',weight:'',done:false})); ex.sets=sets;
  return `<div class="exercise"><div class="exercise-head"><div><h3>${escapeHTML(ex.name)}</h3><span class="subtle small">${escapeHTML(ex.note || ex.muscle || '')}</span></div><span class="pill">${sets.filter(s=>s.done).length}/${sets.length}</span></div>${sets.map((set,setIndex)=>`<div class="set-row"><span>${setIndex+1}</span><input class="input" inputmode="decimal" data-action="workout-input" data-ex="${exIndex}" data-set="${setIndex}" data-field="weight" placeholder="kg" value="${escapeHTML(set.weight||'')}"><input class="input" inputmode="numeric" data-action="workout-input" data-ex="${exIndex}" data-set="${setIndex}" data-field="reps" placeholder="reps" value="${escapeHTML(set.reps||'')}"><button class="set-check ${set.done?'done':''}" data-action="toggle-set" data-ex="${exIndex}" data-set="${setIndex}">${set.done?'✓':'○'}</button></div>`).join('')}</div>`;
}

function progressScreen() {
  const stats=progressStats();
  return `<div class="metric-grid"><div class="metric card"><strong>${stats.latestWeight ?? '—'}</strong><span>Latest weight kg</span></div><div class="metric card"><strong>${stats.change === null ? '—' : `${stats.change>0?'+':''}${stats.change}`}</strong><span>Change in 30 days kg</span></div><div class="metric card"><strong>${stats.avgCalories}</strong><span>7-day avg kcal</span></div><div class="metric card"><strong>${stats.consistency}%</strong><span>Calorie consistency</span></div></div>
    <div class="chart-card card"><div class="section-title"><div><p class="eyebrow">Weight trend</p><h3>${progressMessage(stats)}</h3></div><button class="link-button" data-action="log-weight">Add</button></div><canvas id="weightChart" class="chart" width="700" height="360"></canvas></div>
    <div class="card card-pad"><div class="section-title"><div><p class="eyebrow">Last 28 days</p><h3>Consistency map</h3></div></div><div class="heatmap">${heatmapHTML()}</div></div>
    <div class="card card-pad stack"><h3>Weekly check-in</h3><p class="subtle">Tell BulkMind how the week felt. The AI can use this together with your logs.</p><button class="secondary full" data-action="weekly-checkin">Start check-in</button></div>`;
}
function progressStats() {
  const logs=Object.values(state.logs).sort((a,b)=>a.date.localeCompare(b.date));
  const weights=logs.filter(l=>Number(l.weight));
  const latest=weights.at(-1)?.weight ?? null;
  const cutoff=new Date();cutoff.setDate(cutoff.getDate()-30); const older=weights.find(l=>new Date(l.date)>=cutoff) || weights[0];
  const change=latest&&older?round(latest-older.weight,1):null;
  const last7=lastNDates(7).map(d=>state.logs[d]).filter(Boolean);
  const avg=last7.length?Math.round(last7.reduce((s,l)=>s+l.calories,0)/last7.length):0;
  const target=getTargets().calories;
  const consistency=last7.length?Math.round(last7.filter(l=>l.calories>=target*.85).length/7*100):0;
  return {latestWeight:latest,change,avgCalories:avg,consistency};
}
function progressMessage(stats) { if(stats.change===null)return 'Log weight 3× per week'; const target=getTargets().weekly; if(Math.abs(stats.change)<.2)return 'Trend is nearly flat'; if(stats.change>target*4*1.5)return 'Gaining faster than planned'; if(stats.change>0)return 'Moving in the right direction'; return 'Weight is moving down'; }
function lastNDates(n) { return Array.from({length:n},(_,i)=>{const d=new Date();d.setDate(d.getDate()-(n-1-i));return d.toLocaleDateString('en-CA')}); }
function heatmapHTML() { const target=getTargets().calories; return lastNDates(28).map(d=>{const l=state.logs[d]; const r=l?l.calories/target:0; const level=r>=.95?'l4':r>=.75?'l3':r>=.4?'l2':r>0?'l1':''; return `<div class="heat-cell ${level}" title="${d}: ${l?.calories||0} kcal"></div>`}).join(''); }
function drawProgressChart() {
  const canvas=$('#weightChart'); if(!canvas)return; const ctx=canvas.getContext('2d'); const ratio=devicePixelRatio||1; const rect=canvas.getBoundingClientRect(); canvas.width=rect.width*ratio;canvas.height=180*ratio;ctx.scale(ratio,ratio);
  const data=Object.values(state.logs).filter(l=>Number(l.weight)).sort((a,b)=>a.date.localeCompare(b.date)).slice(-30); ctx.clearRect(0,0,rect.width,180);
  const styles=getComputedStyle(document.body), line=styles.getPropertyValue('--accent-2').trim(), muted=styles.getPropertyValue('--muted').trim(), grid=styles.getPropertyValue('--line').trim();
  ctx.strokeStyle=grid;ctx.lineWidth=1;for(let i=0;i<4;i++){const y=20+i*42;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(rect.width,y);ctx.stroke()}
  if(data.length<2){ctx.fillStyle=muted;ctx.font='13px -apple-system';ctx.textAlign='center';ctx.fillText('Add at least two weight entries to see the trend.',rect.width/2,92);return}
  const vals=data.map(d=>Number(d.weight)),min=Math.min(...vals)-.5,max=Math.max(...vals)+.5;ctx.strokeStyle=line;ctx.lineWidth=3;ctx.lineJoin='round';ctx.beginPath();data.forEach((d,i)=>{const x=8+i*(rect.width-16)/(data.length-1);const y=160-(Number(d.weight)-min)/(max-min)*130;i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke();
}

function setupGlobalEvents() {
  $('#closeSheet').addEventListener('click', closeSheet);
  $('#sheet').addEventListener('click', e => { if(e.target.id==='sheet') closeSheet(); });
  $('#reloadApp').addEventListener('click', () => { pendingWorker?.postMessage({type:'SKIP_WAITING'}); location.reload(); });
  document.addEventListener('click', handleClick);
  document.addEventListener('input', handleInput);
}
function bindPageEvents() {}
async function handleClick(event) {
  const button=event.target.closest('[data-action]'); if(!button)return;
  const action=button.dataset.action;
  const actions={
    'start-onboarding':()=>startOnboarding(false),'use-demo':useDemo,'onboarding-back':onboardingBack,'onboarding-next':onboardingNext,'cancel-onboarding':cancelOnboarding,
    'switch-tab':()=>switchTab(button.dataset.tab),'open-settings':openSettings,'open-quick-log':openQuickLog,'smart-shake':()=>openGenerator('shake'),'smart-meal':()=>openGenerator('meal'),'open-coach':()=>openCoach(),'log-weight':openWeightLog,
    'food-segment':()=>{state.ui.foodSegment=button.dataset.segment;saveState();render()},'preset-generate':()=>openGenerator(button.dataset.preset),'lazy-log':lazyLog,'manual-log':openManualLog,
    'add-food':()=>{const f=findFood(button.dataset.id);if(f){addEntry(f);closeSheet()}},'save-food':()=>saveFood(button.dataset.id),'ask-food':()=>openFoodChat(button.dataset.id),'delete-generated':()=>deleteGenerated(button.dataset.id),
    'generate-workout':generateWorkoutPlan,'toggle-set':()=>toggleSet(button.dataset.ex,button.dataset.set),'finish-workout':finishWorkout,'weekly-checkin':openWeeklyCheckin,'edit-log':openEditLog,
    'save-settings':saveSettings,'toggle-theme':toggleTheme,'export-data':exportData,'import-data':()=>$('#importFile')?.click(),'reset-app':resetApp,'install-help':openInstallHelp,'edit-profile':openProfileEditor,
    'submit-generator':submitGenerator,'send-chat':()=>sendChat(button),'submit-weight':submitWeight,'submit-manual-log':submitManualLog,'submit-checkin':submitCheckin,'remove-entry':()=>removeEntry(button.dataset.id)
  };
  if(actions[action]) await actions[action]();
}
function handleInput(event) {
  const el=event.target;
  if (el.closest('.onboarding')) {
    state.onboardingDraft ||= { profile: structuredClone(defaultProfile) };
    state.onboardingDraft.profile[el.name]=el.value;
    saveState();
  }
  if(el.dataset.action==='workout-input' && activeWorkout){ const ex=activeWorkout.exercises[Number(el.dataset.ex)],set=ex.sets[Number(el.dataset.set)];set[el.dataset.field]=el.value; }
  if(el.id==='importFile') importData(el.files?.[0]);
}


async function useDemo(){
  state.profile=normalizeProfile({...defaultProfile,name:'Mo'});
  state.onboardingDraft=null;
  state.workoutPlan=buildWorkoutPlan(state.profile);
  const log=getLog();
  if(!log.entries.length){
    log.entries=[
      {id:uid(),at:new Date(Date.now()-3600000).toISOString(),name:'Chicken rice bowl',type:'meal',calories:720,protein:45,carbs:88,fat:18},
      {id:uid(),at:new Date(Date.now()-7200000).toISOString(),name:'Oats and milk',type:'meal',calories:510,protein:23,carbs:72,fat:15}
    ];
    recalcLog(log);
  }
  await saveState();
  render();
  toast('Demo ready');
}

function startOnboarding(demo=false) {
  state.onboardingDraft={step:0,profile:demo?{...defaultProfile}:{...defaultProfile,name:'',likedFoods:'',dislikedFoods:''}};
  onboardingStep=0;saveState();render();
}
function onboardingBack(){collectOnboarding();if(onboardingStep>0)onboardingStep--;state.onboardingDraft.step=onboardingStep;saveState();render()}
function cancelOnboarding(){state.onboardingDraft=null;saveState();render()}
function collectOnboarding(){ $$('.onboarding [name]').forEach(el=>{state.onboardingDraft.profile[el.name]=el.value});state.onboardingDraft.step=onboardingStep;saveState(); }
function validateOnboardingStep(){collectOnboarding();const p=state.onboardingDraft.profile;let errors={};if(onboardingStep===0){if(!String(p.name).trim())errors.name='Add your name.';for(const key of ['age','height','currentWeight','targetWeight'])if(!(Number(p[key])>0))errors[key]='Enter a valid number.';if(Number(p.targetWeight)===Number(p.currentWeight)&&['bulk','lean-bulk','cut'].includes(p.goalType))errors.targetWeight='Choose a different target weight.'}Object.entries(errors).forEach(([key,msg])=>{const el=$(`#${key}-error`);if(el)el.textContent=msg});const first=Object.keys(errors)[0];if(first)$(`#${first}`)?.focus();return !first}
async function onboardingNext(){if(!validateOnboardingStep())return;if(onboardingStep<2){onboardingStep++;state.onboardingDraft.step=onboardingStep;await saveState();render();return}state.profile=normalizeProfile(state.onboardingDraft.profile);state.onboardingDraft=null;state.workoutPlan=buildWorkoutPlan(state.profile);await saveState();render();toast('Your plan is ready')}
function normalizeProfile(p){return {...defaultProfile,...p,age:Number(p.age),height:Number(p.height),currentWeight:Number(p.currentWeight),targetWeight:Number(p.targetWeight),trainingDays:clamp(p.trainingDays,1,7)}}
function switchTab(tab){state.ui.tab=tab;saveState();render()}

function openSheet(title,eyebrow,html){const sheet=$('#sheet');$('#sheetTitle').textContent=title;$('#sheetEyebrow').textContent=eyebrow||'';$('#sheetBody').innerHTML=html;if(!sheet.open)sheet.showModal();requestAnimationFrame(()=>$('#sheetBody').scrollTop=0)}
function closeSheet(){if($('#sheet').open)$('#sheet').close()}
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),2300)}

function openQuickLog(){openSheet('Quick add','Fast actions',`<div class="quick-grid"><button class="quick-action" data-action="manual-log"><span class="icon">123</span><strong>Manual macros</strong><small>Fastest exact entry</small></button><button class="quick-action" data-action="log-weight"><span class="icon">⚖</span><strong>Weight</strong><small>Track the trend</small></button><button class="quick-action" data-action="smart-shake"><span class="icon">🥤</span><strong>Generate shake</strong><small>Fill the calorie gap</small></button><button class="quick-action" data-action="open-coach"><span class="icon">✦</span><strong>Ask coach</strong><small>Get a quick answer</small></button></div>`) }

function currentGaps(){const l=getLog(),t=getTargets();return{calorieGap:Math.max(0,round(t.calories-l.calories)),proteinGap:Math.max(0,round(t.protein-l.protein))}}
function openGenerator(kind='meal') {
  const gaps=currentGaps(); const isShake=kind==='shake'||kind==='low-volume';
  const title=isShake?'Build my shake':'Build my meal';
  openSheet(title,'Personal generator',`<form class="sheet-form" id="generatorForm">
    <div class="form-grid">${field('targetCalories','Target calories','number',gaps.calorieGap||700)}${field('targetProtein','Target protein (g)','number',gaps.proteinGap||35)}
    ${selectField('mode','Priority',kind,[['meal','Balanced meal'],['shake','Drinkable shake'],['cheap','Cheapest possible'],['low-volume','Low volume'],['school','Portable'],['fridge','Use my ingredients']])}
    ${selectField('speed','Time available','fast',[['fast','Under 10 minutes'],['normal','Up to 25 minutes'],['prep','Meal prep is okay']])}
    ${areaField('ingredients','Ingredients available',kind==='fridge'?'':'','Leave blank and BulkMind will choose')}
    <div class="field full"><label for="request">Anything else?</label><textarea id="request" name="request" placeholder="Example: no protein powder, make it sweet, I need to take it to school"></textarea></div></div>
    <div class="form-actions"><button type="button" class="primary full" data-action="submit-generator">Generate for me</button><p class="privacy-note">${state.settings.geminiKey?'Gemini AI is connected.':'No API key: the smart local generator will be used.'}</p></div></form>`);
}
async function submitGenerator(){const form=$('#generatorForm');if(!form)return;const data=Object.fromEntries(new FormData(form));openSheet('Creating it','Using your real context',`<div class="loading"><div><div class="spinner" style="margin:0 auto 14px"></div><p class="subtle">Matching calories, protein, preferences and restrictions…</p></div></div>`);try{const food=state.settings.geminiKey?await generateWithGemini(data):generateLocalFood(data);state.generatedFoods.unshift(food);state.generatedFoods=state.generatedFoods.slice(0,30);await saveState();openSheet(food.name,food.source==='gemini'?'Generated by Gemini':'Smart local generator',foodCardHTML(food));}catch(err){console.error(err);const fallback=generateLocalFood(data);state.generatedFoods.unshift(fallback);await saveState();openSheet(fallback.name,'AI failed — local result ready',`<div class="card card-pad"><p class="subtle">Gemini could not answer, so BulkMind made a local version instead.</p></div>${foodCardHTML(fallback)}`)}}

const INGREDIENTS={
  milk:{name:'whole milk',unit:'ml',step:100,kcal:64,p:3.3,c:4.8,f:3.6},oats:{name:'oats',unit:'g',step:20,kcal:76,p:2.6,c:12.4,f:1.4},banana:{name:'banana',unit:'piece',step:1,kcal:105,p:1.3,c:27,f:.3},pb:{name:'peanut butter',unit:'g',step:15,kcal:90,p:3.8,c:3,f:7.5},honey:{name:'honey',unit:'g',step:15,kcal:46,p:0,c:12.4,f:0},skyr:{name:'skyr',unit:'g',step:100,kcal:64,p:11,c:4,f:.2},oil:{name:'olive oil',unit:'tbsp',step:1,kcal:119,p:0,c:0,f:13.5},rice:{name:'cooked rice',unit:'g',step:100,kcal:130,p:2.7,c:28,f:.3},chicken:{name:'cooked chicken',unit:'g',step:100,kcal:165,p:31,c:0,f:3.6},eggs:{name:'eggs',unit:'piece',step:1,kcal:78,p:6.3,c:.6,f:5.3},pasta:{name:'cooked pasta',unit:'g',step:100,kcal:158,p:5.8,c:31,f:.9},bread:{name:'bread',unit:'slice',step:1,kcal:95,p:3.5,c:17,f:1.2},cheese:{name:'cheese',unit:'g',step:20,kcal:80,p:5,c:.3,f:6.5},yogurt:{name:'Greek yogurt',unit:'g',step:100,kcal:97,p:9,c:3.9,f:5},tuna:{name:'tuna',unit:'g',step:100,kcal:116,p:26,c:0,f:1}
};
function generateLocalFood(data){const mode=data.mode||'meal',target=clamp(Number(data.targetCalories)||700,250,1400),proteinTarget=clamp(Number(data.targetProtein)||35,10,100);return mode==='shake'||mode==='low-volume'?buildLocalShake(target,proteinTarget,data):buildLocalMeal(target,proteinTarget,data)}
function addIngredient(result,key,mult=1){const item=INGREDIENTS[key];const amount=item.step*mult;result.ingredients.push({item:item.name,amount:`${round(amount,amount<10?1:0)} ${item.unit}`});result.calories+=item.kcal*mult;result.protein+=item.p*mult;result.carbs+=item.c*mult;result.fat+=item.f*mult}
function buildLocalShake(target,proteinTarget,data){const r={id:uid(),type:'shake',source:'local',name:data.mode==='low-volume'?'Low-volume calorie rescue':'Personal bulk shake',summary:`Built near ${target} kcal for your current gap`,calories:0,protein:0,carbs:0,fat:0,ingredients:[],instructions:['Add liquid first, then dry ingredients.','Blend for 40–60 seconds. Add water if it is too thick.'],timing:'After training, after school or before bed'};addIngredient(r,'milk',4);addIngredient(r,'skyr',1);addIngredient(r,'banana',1);while(r.protein<proteinTarget-5&&r.calories<target-120)addIngredient(r,'skyr',1);while(r.calories<target-150)addIngredient(r,'oats',1);while(r.calories<target-60)addIngredient(r,'pb',1);if(r.calories<target-30)addIngredient(r,data.mode==='low-volume'?'oil':'honey',1);normalizeFood(r);r.why=`It targets your remaining calories without forcing another full meal. ${state.profile.appetite==='low'?'Liquid calories should be easier with your low appetite.':''}`;return r}
function buildLocalMeal(target,proteinTarget,data){const text=`${data.ingredients||''} ${state.profile.likedFoods||''}`.toLowerCase();let template;if(data.mode==='school')template=['bread','chicken','cheese','yogurt'];else if(text.includes('pasta'))template=['pasta','chicken','cheese','oil'];else if(text.includes('egg'))template=['eggs','bread','cheese','milk'];else template=['rice','chicken','eggs','oil'];const r={id:uid(),type:'meal',source:'local',name:data.mode==='cheap'?'Budget power bowl':data.mode==='school'?'Portable protein meal':'Balanced calorie-gap meal',summary:`Fast meal matched near ${target} kcal`,calories:0,protein:0,carbs:0,fat:0,ingredients:[],instructions:['Prepare the main carb and protein.','Combine, season to taste and add the calorie-dense topping last.'],timing:data.mode==='school'?'Pack it for school or work':'Lunch, dinner or post-workout'};for(const key of template)addIngredient(r,key,1);while(r.protein<proteinTarget-4&&r.calories<target-140)addIngredient(r,template.includes('chicken')?'chicken':'eggs',.5);while(r.calories<target-100)addIngredient(r,template.includes('rice')?'rice':template.includes('pasta')?'pasta':'bread',1);if(r.calories<target-35)addIngredient(r,'oil',.5);normalizeFood(r);r.why=`This uses simple foods, keeps preparation low and closes most of your current macro gap.`;return r}
function normalizeFood(food){for(const k of ['calories','protein','carbs','fat'])food[k]=round(food[k],k==='calories'?0:1);return food}
async function generateWithGemini(data){
  const p=state.profile,t=getTargets(),g=currentGaps();
  const prompt=`You are the food engine inside BulkMind. Create ONE realistic ${data.mode==='shake'||data.mode==='low-volume'?'shake':'meal'} for this exact user.\nUser: ${JSON.stringify({age:p.age,height:p.height,currentWeight:p.currentWeight,targetWeight:p.targetWeight,goal:p.goalType,appetite:p.appetite,budget:p.budget,restrictions:p.restrictions,likedFoods:p.likedFoods,dislikedFoods:p.dislikedFoods,schedule:p.schedule})}\nDaily targets: ${JSON.stringify(t)}\nCurrent gaps: ${JSON.stringify(g)}\nRequested target: ${data.targetCalories} kcal and ${data.targetProtein} g protein. Mode: ${data.mode}. Time: ${data.speed}. Available ingredients: ${data.ingredients||'not specified'}. Extra request: ${data.request||'none'}.\nReturn ONLY valid JSON with this shape: {"name":"","summary":"","calories":0,"protein":0,"carbs":0,"fat":0,"ingredients":[{"item":"","amount":""}],"instructions":[""],"timing":"","why":""}. Keep macros realistic, ingredient quantities precise, halal-friendly when relevant, and do not claim medical certainty.`;
  const json=await geminiRequest(prompt,true);const food=typeof json==='string'?JSON.parse(stripJSON(json)):json;return normalizeFood({id:uid(),type:data.mode==='shake'||data.mode==='low-volume'?'shake':'meal',source:'gemini',...food});
}
function stripJSON(text){return String(text).replace(/^```json\s*/i,'').replace(/```$/,'').trim()}
async function geminiRequest(prompt,wantJSON=false){const key=state.settings.geminiKey?.trim();if(!key)throw new Error('No Gemini key');const model=state.settings.geminiModel||'gemini-2.5-flash-lite';const res=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:.55,maxOutputTokens:1200,...(wantJSON?{responseMimeType:'application/json'}:{})}})});if(!res.ok)throw new Error(`Gemini ${res.status}: ${await res.text()}`);const data=await res.json();const text=data.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')?.trim();if(!text)throw new Error('Empty AI response');return wantJSON?JSON.parse(stripJSON(text)):text}

function findFood(id){return [...state.generatedFoods,...state.savedFoods].find(f=>f.id===id)}
async function saveFood(id){const f=findFood(id);if(!f)return;if(!state.savedFoods.some(x=>x.id===id)){state.savedFoods.unshift(f);toast('Saved for one-tap reuse')}else{state.savedFoods=state.savedFoods.filter(x=>x.id!==id);toast('Removed from saved')}await saveState();render();if($('#sheet').open)openSheet(f.name,'Saved item',foodCardHTML(f))}
async function deleteGenerated(id){state.generatedFoods=state.generatedFoods.filter(f=>f.id!==id);await saveState();render();closeSheet()}
function openFoodChat(id){const food=findFood(id);if(!food)return;openSheet('Change or understand it','AI knows this item',`<div class="card card-pad"><h3>${escapeHTML(food.name)}</h3><p class="subtle">${round(food.calories)} kcal · ${round(food.protein)}g protein</p></div><div id="foodChat" class="chat"><div class="bubble ai">Ask me to make it cheaper, tastier, lower-volume, dairy-free, more portable, or explain why it fits you.</div></div><div class="preset-row" style="margin:12px 0"><button class="preset" data-food-question="Make it cheaper">Cheaper</button><button class="preset" data-food-question="Make it less filling">Less filling</button><button class="preset" data-food-question="What can I replace?">Replacements</button><button class="preset" data-food-question="Is this good before training?">Timing</button></div><div class="chat-compose"><textarea id="foodQuestion" placeholder="Ask about this meal…"></textarea><button class="primary" data-action="send-chat" data-context="food" data-id="${id}">Send</button></div>`);$$('[data-food-question]').forEach(b=>b.addEventListener('click',()=>{$('#foodQuestion').value=b.dataset.foodQuestion;sendChat($('[data-action="send-chat"]'))}))}
function openCoach(prefill=''){openSheet('BulkMind Coach','Uses your profile and logs',`<div id="coachChat" class="chat">${state.chat.slice(-12).map(m=>`<div class="bubble ${m.role==='user'?'user':'ai'}">${escapeHTML(m.text)}</div>`).join('')||'<div class="bubble ai">Tell me what is difficult today. I can use your calorie gap, food preferences, weight trend and training plan.</div>'}</div><div class="preset-row" style="margin:12px 0"><button class="preset" data-coach-prompt="What should I eat now?">Eat now</button><button class="preset" data-coach-prompt="I have no appetite. Help me hit calories.">No appetite</button><button class="preset" data-coach-prompt="Am I progressing at the right speed?">Progress check</button></div><div class="chat-compose"><textarea id="coachQuestion" placeholder="Ask anything…">${escapeHTML(prefill)}</textarea><button class="primary" data-action="send-chat" data-context="coach">Send</button></div>`);$$('[data-coach-prompt]').forEach(b=>b.addEventListener('click',()=>{$('#coachQuestion').value=b.dataset.coachPrompt;sendChat($('[data-action="send-chat"]'))}))}
async function sendChat(button){const context=button.dataset.context;const input=context==='food'?$('#foodQuestion'):$('#coachQuestion');const q=input?.value.trim();if(!q)return;const chat=context==='food'?$('#foodChat'):$('#coachChat');chat.insertAdjacentHTML('beforeend',`<div class="bubble user">${escapeHTML(q)}</div><div class="bubble ai" id="typingBubble">Thinking…</div>`);input.value='';chat.scrollTop=chat.scrollHeight;let answer;try{if(state.settings.geminiKey){const food=context==='food'?findFood(button.dataset.id):null;answer=await geminiRequest(coachPrompt(q,food),false)}else answer=localCoachAnswer(q,context==='food'?findFood(button.dataset.id):null)}catch{answer=localCoachAnswer(q,context==='food'?findFood(button.dataset.id):null)+'\n\nGemini was unavailable, so this answer came from the local coach.'}$('#typingBubble')?.remove();chat.insertAdjacentHTML('beforeend',`<div class="bubble ai">${escapeHTML(answer)}</div>`);if(context==='coach'){state.chat.push({role:'user',text:q},{role:'assistant',text:answer});state.chat=state.chat.slice(-40);saveState()}chat.scrollTop=chat.scrollHeight}
function coachPrompt(q,food=null){const l=getLog(),t=getTargets();return `You are BulkMind, a practical personal fitness and nutrition coach. Be concise, specific and friendly. Never shame the user. Do not diagnose. User profile: ${JSON.stringify(state.profile)}. Today's log: ${JSON.stringify({calories:l.calories,protein:l.protein,carbs:l.carbs,fat:l.fat,entries:l.entries.map(e=>e.name)})}. Targets: ${JSON.stringify(t)}. ${food?`The user is asking about this generated item: ${JSON.stringify(food)}.`:''} Question: ${q}`}
function localCoachAnswer(q,food){const s=q.toLowerCase(),g=currentGaps();if(food){if(s.includes('cheap'))return `Keep the same macro idea but replace premium ingredients with oats, whole milk, eggs, rice, pasta, chicken thighs or store-brand yogurt. Aim to stay within about 10% of ${food.calories} kcal.`;if(s.includes('less filling')||s.includes('volume'))return `Reduce bulky ingredients and move calories toward liquid milk, peanut butter, honey or a small amount of oil. Drink it slowly instead of forcing it.`;if(s.includes('replace'))return `Match the function: replace a protein with another protein, a carb with another carb, and a fat with another fat. Keep the quantity similar, then check calories.`;return `${food.name} gives about ${food.calories} kcal and ${food.protein}g protein. It fits best when you still need a large calorie gap. Adjust portion size rather than forcing the full amount.`}if(s.includes('appetite'))return `You still need roughly ${g.calorieGap} kcal. Split it into two small wins: a drinkable shake now and a compact snack later. Do not wait until bedtime for the whole gap.`;if(s.includes('eat'))return `Your current gap is about ${g.calorieGap} kcal and ${g.proteinGap}g protein. Use “Make a meal” on Today and BulkMind will build around those exact numbers.`;if(s.includes('progress'))return progressMessage(progressStats())+'. Log weight three mornings per week and judge the weekly average, not one day.';return `Focus on the next action, not the whole goal: close part of today's ${g.calorieGap} kcal gap, get your protein closer, and complete the next planned workout.`}

function lazyLog(){const text=$('#lazyLogText')?.value.trim();if(!text){toast('Write what you ate first');return}const estimate=estimateTextFood(text);openSheet('Confirm estimate','Lazy log',`<div class="food-card card"><h3>${escapeHTML(estimate.name)}</h3><div class="food-macros"><div><strong>${estimate.calories}</strong><span>kcal</span></div><div><strong>${estimate.protein}g</strong><span>protein</span></div><div><strong>${estimate.carbs}g</strong><span>carbs</span></div><div><strong>${estimate.fat}g</strong><span>fat</span></div></div><p class="subtle">This is a rough estimate. Edit it manually if the portion was very different.</p><div class="food-actions"><button class="primary" data-action="add-food" data-id="${estimate.id}">Add estimate</button><button class="secondary" data-action="manual-log">Edit numbers</button></div></div>`);state.generatedFoods.unshift(estimate);saveState()}
function estimateTextFood(text){const s=text.toLowerCase();let calories=0,protein=0,carbs=0,fat=0;const rules=[[/egg/g,78,6,1,5],[/toast|bread/g,95,4,17,1],[/milk/g,150,8,12,8],[/chicken/g,250,40,5,7],[/rice/g,260,5,56,1],[/wrap/g,350,20,38,13],[/banana/g,105,1,27,0],[/oat/g,300,10,50,6],[/peanut butter/g,180,8,6,15],[/yogurt|skyr/g,150,18,10,3],[/pasta/g,350,12,70,5],[/cheese/g,120,7,1,10]];for(const [re,k,p,c,f] of rules){const matches=s.match(re);if(matches){calories+=k*matches.length;protein+=p*matches.length;carbs+=c*matches.length;fat+=f*matches.length}}if(!calories){calories=500;protein=20;carbs=60;fat=18}return{id:uid(),type:'meal',source:'local',name:`Estimate: ${text.slice(0,42)}`,summary:'Rough lazy-log estimate',calories,protein,carbs,fat,ingredients:[text],instructions:[],timing:'Logged meal'}}
function openManualLog(){openSheet('Manual food log','Fast exact entry',`<form class="sheet-form" id="manualLogForm">${field('name','Name','text','Meal or snack')}${field('calories','Calories','number','500')}${field('protein','Protein (g)','number','25')}${field('carbs','Carbs (g)','number','60')}${field('fat','Fat (g)','number','18')}<div class="form-actions"><button type="button" class="primary full" data-action="submit-manual-log">Add to today</button></div></form>`)}
function submitManualLog(){const data=Object.fromEntries(new FormData($('#manualLogForm')));const food={id:uid(),type:'meal',source:'manual',name:data.name||'Manual entry',calories:Number(data.calories),protein:Number(data.protein),carbs:Number(data.carbs),fat:Number(data.fat)};addEntry(food);closeSheet()}
function openWeightLog(){openSheet('Log weight','Use the same conditions each time',`<form class="sheet-form" id="weightForm">${field('weight','Weight (kg)','number',state.profile.currentWeight,'Morning after bathroom is easiest to compare.')}<div class="form-actions"><button type="button" class="primary full" data-action="submit-weight">Save weight</button></div></form>`)}
async function submitWeight(){const weight=Number($('#weight')?.value);if(!weight||weight<30||weight>300){toast('Enter a valid weight');return}getLog().weight=weight;state.profile.currentWeight=weight;await saveState();closeSheet();render();toast('Weight saved')}
function openEditLog(){const log=getLog();openSheet('Edit today','Remove accidental entries',`<div class="stack">${log.entries.map(e=>`<div class="entry"><div class="entry-icon">${e.type==='shake'?'🥤':'🍽'}</div><div><strong>${escapeHTML(e.name)}</strong><small>${e.calories} kcal</small></div><button class="icon-button" data-action="remove-entry" data-id="${e.id}">×</button></div>`).join('')||'<div class="empty card">No entries.</div>'}</div>`)}
async function removeEntry(id){const log=getLog();log.entries=log.entries.filter(e=>e.id!==id);recalcLog(log);await saveState();openEditLog();render();toast('Entry removed')}

function buildWorkoutPlan(p){const home=p.trainingPlace==='home';const sessions=Number(p.trainingDays)<=2?[fullBody(home,'Full body A'),fullBody(home,'Full body B')]:Number(p.trainingDays)===3?[push(home),pull(home),legs(home)]:[upper(home),lower(home),upper(home,'Upper B'),lower(home,'Lower B')];return{id:uid(),createdAt:new Date().toISOString(),sessions}}
function ex(name,reps='8-12',note='Controlled reps'){return{name,reps,note,sets:Array.from({length:3},()=>({reps:'',weight:'',done:false}))}}
function fullBody(h,name){return{name,exercises:[ex(h?'Push-ups':'Bench press'),ex(h?'Backpack row':'Lat pulldown'),ex(h?'Bulgarian split squat':'Leg press'),ex(h?'Pike push-up':'Shoulder press'),ex(h?'Backpack curl':'Cable curl')]}}
function push(h){return{name:'Push',exercises:[ex(h?'Push-ups':'Bench press'),ex(h?'Pike push-ups':'Incline press'),ex(h?'Chair dips':'Triceps pushdown'),ex(h?'Bottle lateral raise':'Lateral raise')]}}
function pull(h){return{name:'Pull',exercises:[ex(h?'Backpack row':'Lat pulldown'),ex(h?'Towel row':'Seated row'),ex(h?'Backpack curl':'Dumbbell curl'),ex(h?'Reverse snow angels':'Rear-delt fly')]}}
function legs(h){return{name:'Legs',exercises:[ex(h?'Bulgarian split squat':'Squat or leg press'),ex(h?'Backpack Romanian deadlift':'Romanian deadlift'),ex(h?'Bodyweight squat':'Leg extension'),ex(h?'Single-leg calf raise':'Calf raise')]}}
function upper(h,name='Upper A'){return{name,exercises:[ex(h?'Push-ups':'Bench press'),ex(h?'Backpack row':'Cable row'),ex(h?'Pike push-up':'Shoulder press'),ex(h?'Backpack curl':'Curl'),ex(h?'Chair dips':'Triceps pushdown')]}}
function lower(h,name='Lower A'){return{name,exercises:[ex(h?'Bulgarian split squat':'Leg press'),ex(h?'Backpack RDL':'Romanian deadlift'),ex(h?'Walking lunge':'Leg extension'),ex(h?'Calf raise':'Calf raise')]}}
async function generateWorkoutPlan(){state.workoutPlan=buildWorkoutPlan(state.profile);activeWorkout=null;await saveState();closeSheet();render();toast('Workout plan updated')}
function ensureActiveWorkout(){if(!activeWorkout)activeWorkout=nextWorkout()}
function toggleSet(exIndex,setIndex){ensureActiveWorkout();const set=activeWorkout.exercises[Number(exIndex)].sets[Number(setIndex)];set.done=!set.done;render()}
async function finishWorkout(){ensureActiveWorkout();const completed=activeWorkout.exercises.reduce((s,e)=>s+e.sets.filter(x=>x.done).length,0);if(completed===0){toast('Complete at least one set first');return}state.workoutLogs.push({id:uid(),date:todayISO(),at:new Date().toISOString(),name:activeWorkout.name,completedSets:completed,session:activeWorkout});getLog().workoutCompleted=true;activeWorkout=null;await saveState();render();toast('Workout saved')}

function openWeeklyCheckin(){openSheet('Weekly check-in','Takes about 30 seconds',`<form class="sheet-form" id="checkinForm">${selectField('weekFeeling','How did the week feel?','okay',[['hard','Hard'],['okay','Okay'],['good','Good']])}${selectField('appetite','Appetite','normal',[['low','Low'],['normal','Normal'],['high','High']])}${selectField('sleep','Sleep','okay',[['poor','Poor'],['okay','Okay'],['good','Good']])}${areaField('problem','What got in the way?','','Skipped meals, no time, low appetite…')}<div class="form-actions"><button type="button" class="primary full" data-action="submit-checkin">Get my weekly advice</button></div></form>`)}
async function submitCheckin(){const data=Object.fromEntries(new FormData($('#checkinForm')));const stats=progressStats();let advice=`Your main focus next week: `;if(data.appetite==='low')advice+='use one planned shake before the day gets late.';else if(stats.consistency<60)advice+='make logging and one repeatable breakfast automatic.';else advice+='keep the same calories and repeat what worked.';openSheet('Your next-week focus','Weekly summary',`<div class="insight card"><div class="insight-icon">✦</div><div><p>${escapeHTML(advice)}</p></div></div><div class="card card-pad"><p class="subtle">Average calories: ${stats.avgCalories}. Consistency: ${stats.consistency}%. ${escapeHTML(data.problem||'No specific problem added.')}</p></div><button class="primary full" data-action="open-coach">Discuss this with AI</button>`)}

function openSettings(){openSheet('Settings','Personal and private',`<div class="stack">
  <div class="card card-pad stack"><div><h3>Gemini AI</h3><p class="subtle">Required for fully custom AI answers. Without it, BulkMind uses its local generator.</p></div>${field('geminiKey','Gemini API key','password',state.settings.geminiKey,'Stored only in this app on this device.','full')}${field('geminiModel','Model','text',state.settings.geminiModel,'Default: gemini-2.5-flash-lite','full')}<button class="primary full" data-action="save-settings">Save AI settings</button></div>
  <div class="card card-pad stack"><h3>App</h3><button class="secondary full" data-action="toggle-theme">Switch to ${state.settings.theme==='dark'?'light':'dark'} mode</button><button class="secondary full" data-action="edit-profile">Edit profile and targets</button><button class="secondary full" data-action="install-help">Add to iPhone Home Screen</button></div>
  <div class="card card-pad stack"><h3>Your data</h3><button class="secondary full" data-action="export-data">Export backup</button><input id="importFile" type="file" accept="application/json" class="hidden"><button class="secondary full" onclick="document.getElementById('importFile').click()">Import backup</button><button class="danger-button full" data-action="reset-app">Reset app</button></div>
  <p class="privacy-note">BulkMind v5 · Data stored in IndexedDB on this device.</p></div>`)}
async function saveSettings(){state.settings.geminiKey=$('#geminiKey')?.value.trim()||'';state.settings.geminiModel=$('#geminiModel')?.value.trim()||'gemini-2.5-flash-lite';await saveState();toast('AI settings saved');closeSheet()}
async function toggleTheme(){state.settings.theme=state.settings.theme==='dark'?'light':'dark';applyTheme();await saveState();openSettings()}
function openProfileEditor(){const p=state.profile;openSheet('Edit profile','Recalculates targets',`<form id="profileForm" class="sheet-form"><div class="form-grid">${field('name','Name','text',p.name)}${field('age','Age','number',p.age)}${field('height','Height','number',p.height)}${field('currentWeight','Current weight','number',p.currentWeight)}${field('targetWeight','Target weight','number',p.targetWeight)}${field('trainingDays','Training days','number',p.trainingDays)}${selectField('goalType','Goal',p.goalType,[['bulk','Bulk'],['lean-bulk','Lean bulk'],['cut','Lose fat'],['strength','Strength'],['maintain','Maintain']])}${selectField('activityLevel','Activity',p.activityLevel,[['low','Low'],['moderate','Moderate'],['high','High'],['very-high','Very high']])}${field('restrictions','Food rules','text',p.restrictions,'','full')}${areaField('likedFoods','Liked foods',p.likedFoods)}${areaField('dislikedFoods','Disliked foods',p.dislikedFoods)}</div><div class="form-actions"><button type="button" class="primary full" id="saveProfileButton">Save profile</button></div></form>`);$('#saveProfileButton').addEventListener('click',async()=>{const data=Object.fromEntries(new FormData($('#profileForm')));state.profile=normalizeProfile({...state.profile,...data});await saveState();closeSheet();render();toast('Profile updated')})}
function openInstallHelp(){openSheet('Add to Home Screen','iPhone Safari',`<div class="stack"><div class="card card-pad"><h3>1. Open the Vercel link in Safari</h3><p class="subtle">This does not work the same way from an in-app browser.</p></div><div class="card card-pad"><h3>2. Tap Share ↑</h3><p class="subtle">Scroll down and choose “Add to Home Screen”.</p></div><div class="card card-pad"><h3>3. Keep “Open as Web App” enabled</h3><p class="subtle">Then tap Add. BulkMind will launch without Safari controls.</p></div></div>`)}
function exportData(){const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`bulkmind-backup-${todayISO()}.json`;a.click();URL.revokeObjectURL(a.href)}
async function importData(file){if(!file)return;try{const imported=JSON.parse(await file.text());state=mergeState(structuredClone(initialState),imported);await saveState();applyTheme();closeSheet();render();toast('Backup imported')}catch{toast('That backup file could not be read')}}
async function resetApp(){if(!confirm('Delete all BulkMind data on this device?'))return;state=structuredClone(initialState);await saveState();closeSheet();render()}

function setupViewportHandling(){const vv=window.visualViewport;if(!vv)return;const update=()=>{const keyboard=Math.max(0,window.innerHeight-vv.height-vv.offsetTop);document.documentElement.style.setProperty('--keyboard',`${keyboard}px`);document.body.classList.toggle('keyboard-open',keyboard>110)};vv.addEventListener('resize',update,{passive:true});vv.addEventListener('scroll',update,{passive:true});document.addEventListener('focusin',e=>{if(e.target.matches('input,textarea,select'))setTimeout(()=>e.target.scrollIntoView({block:'center',behavior:'smooth'}),180)});update()}
async function setupServiceWorker(){if(!navigator.serviceWorker?.register)return;try{const reg=await navigator.serviceWorker.register('./sw.js');if(reg.waiting)showUpdate(reg.waiting);reg.addEventListener('updatefound',()=>{const worker=reg.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)showUpdate(worker)})});navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload())}catch(err){console.warn('SW registration failed',err)}}
function showUpdate(worker){pendingWorker=worker;$('#updateBar').classList.remove('hidden')}

boot().catch(err=>{console.error(err);$('#app').innerHTML=`<main class="landing"><div class="landing-inner"><h1>BulkMind could not start</h1><p class="landing-copy">Your browser blocked local storage. Open the hosted HTTPS version in Safari or Chrome.</p></div></main>`});
