const APP_VERSION = 12;
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
  dislikedFoods: '', schedule: 'School during the day, training in the evening', coachTone: 'chill',
  targetMode: 'auto', customCalories: '', customProtein: '', customCarbs: '', customFat: '',
  targetMonths: 8, lastGoalPlan: null
};

const initialState = {
  version: APP_VERSION,
  profile: null,
  onboardingDraft: null,
  settings: { theme: 'dark', geminiKey: '', geminiModel: 'gemini-2.5-flash-lite', sallingApiKey: '', sallingStoreId: '', priceCountry: 'DK', defaultStore: 'Netto' },
  logs: {},
  savedFoods: [],
  generatedFoods: [],
  products: [],
  mealPlans: [],
  activeMealPlan: null,
  workoutPlan: null,
  workoutLogs: [],
  chat: [],
  ui: { tab: 'today', foodSegment: 'planner' }
};

let state = structuredClone(initialState);
let db;
let onboardingStep = 0;
let activeWorkout = null;
let pendingWorker = null;
let pendingGoalPlan = null;
let pendingProduct = null;
let pendingLabelProductId = null;
let pendingCameraStream = null;

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
  const auto = { bmr: Math.round(bmr), maintenance, calories, protein, carbs, fat, weekly, mode: 'auto' };
  if (p.targetMode === 'custom') {
    const customCalories = clamp(Number(p.customCalories) || auto.calories, 1500, 6000);
    const customProtein = clamp(Number(p.customProtein) || auto.protein, 40, 300);
    const customFat = clamp(Number(p.customFat) || auto.fat, 25, 220);
    const customCarbs = clamp(Number(p.customCarbs) || Math.round((customCalories - customProtein * 4 - customFat * 9) / 4), 50, 900);
    return { ...auto, calories: customCalories, protein: customProtein, carbs: customCarbs, fat: customFat, mode: 'custom' };
  }
  return auto;
}
function recommendedTargets(profile = state.profile || defaultProfile) {
  return calculateTargets({ ...profile, targetMode: 'auto' });
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
  log.entries.unshift({ id: uid(), at: new Date().toISOString(), name: food.name, type: food.type || 'meal', calories: round(food.calories), protein: round(food.protein), carbs: round(food.carbs), fat: round(food.fat), sourceId: food.id || null, productIds: food.usedProducts || [] });
  recalcLog(log);
  recordProductUsageFromFood(food);
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
    <div class="quick-grid"><button class="quick-action" data-action="smart-shake"><span class="icon">🥤</span><strong>Start with a shake</strong><small>${gap > 1200 ? 'Make a 800 kcal shake' : `Make a ${gap || 500} kcal shake`}</small></button><button class="quick-action" data-action="smart-meal"><span class="icon">🍛</span><strong>Make a meal</strong><small>Built for ${proteinGap}g protein left</small></button><button class="quick-action" data-action="open-coach"><span class="icon">✦</span><strong>Ask coach</strong><small>Use all your saved context</small></button><button class="quick-action" data-action="log-weight"><span class="icon">⚖</span><strong>Log weight</strong><small>${latestWeightText()}</small></button></div>
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
  return `<div class="segmented"><button data-action="food-segment" data-segment="planner" class="${seg==='planner'?'active':''}">Planner</button><button data-action="food-segment" data-segment="generate" class="${seg==='generate'?'active':''}">Generate</button><button data-action="food-segment" data-segment="log" class="${seg==='log'?'active':''}">Log</button><button data-action="food-segment" data-segment="prices" class="${seg==='prices'?'active':''}">Prices</button><button data-action="food-segment" data-segment="products" class="${seg==='products'?'active':''}">Products</button><button data-action="food-segment" data-segment="saved" class="${seg==='saved'?'active':''}">Saved</button></div>${seg==='planner'?weeklyPlannerHTML():seg==='generate'?foodGenerateHTML():seg==='log'?foodLogHTML():seg==='prices'?pricePlannerHTML():seg==='products'?productLibraryHTML():savedFoodHTML()}`;
}
function foodGenerateHTML() {
  const {calorieGap,proteinGap}=currentGaps();
  return `<div class="generator-card card"><div class="generator-hero"><div><p class="eyebrow">Fastest option</p><h3>Generate exactly what is missing</h3><p class="subtle">Current gap: ${calorieGap} kcal and ${proteinGap}g protein. Saved products are reused automatically.</p></div><span class="emoji">⚡</span></div><button class="primary full" data-action="smart-meal">Make the best meal now</button><button class="secondary full" data-action="scan-food">Scan product / label</button><button class="secondary full" data-action="open-weekly-planner">Plan my week</button><button class="secondary full" data-action="open-dk-prices">DK price planner</button><div class="preset-row"><button class="preset" data-action="preset-generate" data-preset="shake">🥤 Shake</button><button class="preset" data-action="preset-generate" data-preset="cheap">💸 Cheap</button><button class="preset" data-action="preset-generate" data-preset="low-volume">🪶 Low volume</button><button class="preset" data-action="preset-generate" data-preset="school">🎒 Portable</button><button class="preset" data-action="preset-generate" data-preset="fridge">🧊 Use ingredients</button></div></div>
    <div class="section-title"><div><p class="eyebrow">Recently generated</p><h3>Ready to reuse</h3></div></div>${recentGeneratedHTML()}`;
}

function weeklyPlannerHTML() {
  const plan = state.activeMealPlan || state.mealPlans?.[0];
  const priced = (state.products || []).filter(p => pricePer100(p) > 0).length;
  const store = state.settings.defaultStore || 'Netto';
  return `<div class="generator-card card"><div class="generator-hero"><div><p class="eyebrow">Mise-style DK planner</p><h3>Build a week around your real life</h3><p class="subtle">Choose store, kitchen tools, dietary rules, meals and weekly budget. Product Memory + exact saved prices are reused across meals.</p></div><span class="emoji">🛒</span></div><button class="primary full" data-action="open-weekly-planner">Create weekly meal plan</button><div class="quick-grid tight"><button class="quick-action" data-action="scan-price-label"><span class="icon">🧾</span><strong>Scan prices</strong><small>${priced} priced products saved</small></button><button class="quick-action" data-action="scan-food"><span class="icon">▣</span><strong>Add food product</strong><small>Nutrition + barcode</small></button></div><p class="privacy-note">Current default store: ${escapeHTML(store)}. Exact prices only come from saved product prices, receipts, shelf labels or working retailer APIs.</p></div>
  ${plan ? weeklyPlanCardHTML(plan) : `<div class="empty card">No weekly plan yet. Build one and BulkMind will create meals + one combined shopping list that reuses ingredients.</div>`}`;
}
function storeOptions(){return [['Netto','Netto'],['Lidl','Lidl'],['REMA 1000','REMA 1000'],['Føtex','Føtex'],['Bilka','Bilka'],['Coop 365','Coop 365'],['Meny','Meny'],['Aldi/Other','Other / custom']];}
function openWeeklyPlanner(){
  const p=state.profile||defaultProfile;
  openSheet('Weekly meal planner','Store + budget + people',`<form id="weekPlanForm" class="sheet-form stack">
    <div class="card card-pad"><h3>Make a real weekly plan</h3><p class="subtle">Pick where you shop, how many people you need to feed, what equipment you have, what meals you want, and the total weekly budget. BulkMind scales the shopping list for everyone but keeps calories/macros shown per person.</p></div>
    <div class="form-grid">
      ${selectField('store','Store',state.settings.defaultStore||'Netto',storeOptions())}
      ${field('weeklyBudget','Total weekly budget (kr)','number','300','Total for everyone, example: 300, 500, 900')}
      ${field('servings','People to feed','number','1','Example: 1 for only you, 2 for you + friend, 4 for family')}
      ${selectField('plannerStyle','Main priority','high-calorie',[['high-calorie','High calorie bulk'],['high-protein','High protein'],['cheap','Cheapest possible'],['balanced','Balanced'],['low-calorie','Low calorie'],['vegan','Vegan'],['fruit-veg','More fruit/veg']])}
    </div>
    <div class="card card-pad mini-explain"><strong>How people scaling works</strong><p class="subtle">Meals show macros per person. The shopping list and total cost are scaled for everyone you feed, so 4 people means roughly 4× ingredients.</p></div>
    <div class="card card-pad stack"><h3>Meals included</h3><div class="check-grid">${plannerCheckboxes('meals',['breakfast','lunch','dinner','snack','shake'],['Breakfast','Lunch','Dinner','Snack','Bulk shake'],['breakfast','lunch','dinner','shake'])}</div></div>
    <div class="card card-pad stack"><h3>Kitchen tools</h3><div class="check-grid">${plannerCheckboxes('tools',['stove','oven','airfryer','microwave','blender','no-cook'],['Komfur','Ovn','Airfryer','Mikroovn','Blender','No-cook'],['stove','airfryer','blender'])}</div></div>
    <div class="card card-pad stack"><h3>Dietary rules</h3><div class="check-grid">${plannerCheckboxes('rules',['halal','vegan','vegetarian','lactose-free','no-pork','no-fish','fruit'],['Halal','Vegan','Vegetarian','Lactose-free','No pork','No fish','Fruit/veg focus'],String(p.restrictions||'').toLowerCase().includes('halal')?['halal','no-pork']:[])}</div></div>
    ${areaField('extraPlannerNotes','Extra notes','','Example: I hate tuna, I want school lunch, I only want dinner, I need easy airfryer food')}
    <div class="form-actions"><button type="button" class="primary full" data-action="generate-week-plan">Generate weekly plan</button><p class="privacy-note">${state.settings.geminiKey?'Gemini can help with variety.':'No Gemini key: local planner still works using your saved products.'}</p></div>
  </form>`)
}
function plannerCheckboxes(name, values, labels, checked=[]){return values.map((v,i)=>`<label class="check-row"><input type="checkbox" name="${name}" value="${v}" ${checked.includes(v)?'checked':''}> <span>${escapeHTML(labels[i])}</span></label>`).join('')}
async function generateWeeklyPlan(){
  const form=$('#weekPlanForm'); if(!form)return;
  const fd=new FormData(form);
  const data={store:fd.get('store')||'Netto',weeklyBudget:Number(fd.get('weeklyBudget')||300),servings:clamp(Number(fd.get('servings')||1),1,12),plannerStyle:fd.get('plannerStyle')||'high-calorie',meals:fd.getAll('meals'),tools:fd.getAll('tools'),rules:fd.getAll('rules'),extraPlannerNotes:fd.get('extraPlannerNotes')||''};
  if(!data.meals.length){toast('Choose at least one meal');return}
  state.settings.defaultStore=data.store;
  openSheet('Building your week','Budget + reuse + products',`<div class="loading"><div><div class="spinner" style="margin:0 auto 14px"></div><p class="subtle">Creating a combined plan for ${data.servings} ${data.servings===1?'person':'people'} at ${escapeHTML(data.store)}…</p></div></div>`);
  try{
    const plan=state.settings.geminiKey?await generateWeekPlanWithGemini(data):generateLocalWeekPlan(data);
    state.activeMealPlan=plan; state.mealPlans=[plan,...(state.mealPlans||[])].slice(0,10);
    await saveState(); render(); openSheet(plan.name,plan.source==='gemini'?'Gemini weekly plan':'Local weekly plan',weeklyPlanCardHTML(plan,true));
  }catch(err){console.error(err);const plan=generateLocalWeekPlan(data);state.activeMealPlan=plan;state.mealPlans=[plan,...(state.mealPlans||[])].slice(0,10);await saveState();render();openSheet(plan.name,'Gemini failed — local plan ready',`<div class="card card-pad"><p class="subtle">Gemini could not make the plan, so BulkMind made a local plan from your saved prices/products instead.</p></div>${weeklyPlanCardHTML(plan,true)}`)}
}
async function generateWeekPlanWithGemini(data){
  const prompt=`You are BulkMind's Denmark weekly meal planner. Build a practical 7-day meal plan for ${data.servings} ${data.servings===1?'person':'people'}.
User profile for the primary user who logs meals: ${JSON.stringify(state.profile)}
Primary user's personal targets: ${JSON.stringify(getTargets())}
Planner settings, including people/servings count and total weekly budget for everyone: ${JSON.stringify(data)}
Saved product memory with exact nutrition and saved Danish prices: ${JSON.stringify((state.products||[]).map(p=>({id:p.id,name:p.name,brand:p.brand,category:p.category,unit:p.unit,defaultAmount:p.defaultAmount,retailer:p.retailer,pricePer100:pricePer100(p),packageAmount:p.packageAmount,pricePackage:p.pricePackage,per100:p.per100,incomplete:isProductIncomplete(p)})).slice(0,50))}
Rules:
- Respect selected store, dietary rules, tools, number of people and total budget.
- IMPORTANT: calories/protein/carbs/fat per meal must be PER PERSON/SERVING for the primary user. Ingredient amounts, shopping list amounts, and costs must be TOTAL for all people.
- Reuse ingredients across days to reduce waste and cost.
- Use saved products/prices when available. If exact price/nutrition is missing, mark it in missingData; do not pretend it is exact.
- If the budget is unrealistic, still make the cheapest close plan and explain the gap.
- Return ONLY JSON with this shape: {"name":"","store":"","budget":0,"servings":1,"totalCost":0,"costPerPerson":0,"exactPriceCoverage":0,"notes":[""],"missingData":[""],"days":[{"day":"Monday","meals":[{"id":"","type":"breakfast|lunch|dinner|snack|shake","name":"","calories":0,"protein":0,"carbs":0,"fat":0,"cost":0,"ingredients":[{"name":"","amount":0,"unit":"g/ml/piece","productId":"optional saved id"}],"instructions":[""]}]}],"shoppingList":[{"name":"","amount":0,"unit":"g/ml/piece","estimatedCost":0,"productId":"optional saved id","missingPrice":false,"missingNutrition":false,"usedIn":[""]}]}.`;
  const plan=await geminiRequestLong(prompt,true,5200);
  return normalizeWeekPlan({...plan,id:uid(),createdAt:new Date().toISOString(),source:'gemini'},data);
}
async function geminiRequestLong(prompt,wantJSON=false,maxOutputTokens=5200){const key=state.settings.geminiKey?.trim();if(!key)throw new Error('No Gemini key');const model=state.settings.geminiModel||'gemini-2.5-flash-lite';const res=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:.35,maxOutputTokens,...(wantJSON?{responseMimeType:'application/json'}:{})}})});if(!res.ok)throw new Error(`Gemini ${res.status}: ${await res.text()}`);const data=await res.json();const text=data.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')?.trim();if(!text)throw new Error('Empty AI response');return wantJSON?JSON.parse(stripJSON(text)):text}
const WEEK_DAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const FALLBACK_PRODUCTS={
  milk:{name:'milk',unit:'ml',category:'milk',per100:{calories:64,protein:3.4,carbs:4.8,fat:3.5},pricePer100:1.3},oats:{name:'oats',unit:'g',category:'oats',per100:{calories:380,protein:13,carbs:62,fat:7},pricePer100:.9},banana:{name:'banana',unit:'g',category:'fruit',per100:{calories:89,protein:1.1,carbs:23,fat:.3},pricePer100:2.2},pb:{name:'peanut butter',unit:'g',category:'peanut-butter',per100:{calories:600,protein:25,carbs:16,fat:50},pricePer100:3.0},rice:{name:'rice',unit:'g',category:'rice',per100:{calories:360,protein:7,carbs:78,fat:.8},pricePer100:1.1},pasta:{name:'pasta',unit:'g',category:'pasta',per100:{calories:360,protein:12,carbs:72,fat:2},pricePer100:1.2},chicken:{name:'chicken',unit:'g',category:'chicken',per100:{calories:165,protein:31,carbs:0,fat:4},pricePer100:6.5},eggs:{name:'eggs',unit:'piece',category:'eggs',per100:{calories:78,protein:6.3,carbs:.6,fat:5.3},pricePer100:2.5},skyr:{name:'skyr/yogurt',unit:'g',category:'skyr-yogurt',per100:{calories:65,protein:11,carbs:4,fat:.2},pricePer100:2.8},beans:{name:'beans/lentils',unit:'g',category:'beans',per100:{calories:120,protein:8,carbs:20,fat:1},pricePer100:1.8},veg:{name:'frozen vegetables',unit:'g',category:'vegetables',per100:{calories:45,protein:2,carbs:8,fat:.5},pricePer100:2.0},whey:{name:'protein powder',unit:'g',category:'protein-powder',per100:{calories:390,protein:75,carbs:8,fat:7},pricePer100:15}
};
function generateLocalWeekPlan(data){
  const people=clamp(Number(data.servings)||1,1,12);
  const plan={id:uid(),createdAt:new Date().toISOString(),source:'local',name:`${data.store} ${data.weeklyBudget} kr week for ${people}`,store:data.store,budget:data.weeklyBudget,servings:people,settings:{...data,servings:people},days:[],notes:[],missingData:[]};
  for(const day of WEEK_DAYS){const meals=[];for(const type of data.meals){meals.push(buildPlannerMeal(type,{...data,servings:people},day,meals.length))}plan.days.push({day,meals})}
  const totals=buildShoppingList(plan); plan.shoppingList=totals.items; plan.totalCost=round(totals.cost,2); plan.costPerPerson=round(plan.totalCost/people,2); plan.exactPriceCoverage=totals.coverage;
  if(plan.totalCost>data.weeklyBudget) plan.notes.push(`This plan is about ${round(plan.totalCost-data.weeklyBudget,2)} kr over the total budget for ${people} ${people===1?'person':'people'}. Per person it is about ${round(plan.costPerPerson,2)} kr.`);
  if(totals.missing.length) plan.missingData=[...new Set(totals.missing)].slice(0,8);
  if(!plan.notes.length) plan.notes.push(`Ingredients are reused across days and scaled for ${people} ${people===1?'person':'people'}. Macros are shown per person.`);
  return normalizeWeekPlan(plan,data);
}
function buildPlannerMeal(type,data,day,index){
  const vegan=data.rules.includes('vegan')||data.plannerStyle==='vegan'; const cheap=data.plannerStyle==='cheap'||data.weeklyBudget<=250; const highCal=data.plannerStyle==='high-calorie'; const highProtein=data.plannerStyle==='high-protein'||highCal;
  let defs=[]; let name=''; let instructions=['Prep once if possible and reuse leftovers.'];
  if(type==='breakfast'){name=highCal?'Oats bulk bowl':'Oats breakfast'; defs=[['oats',90],['milk',300],['banana',120], ...(highCal?[['pb',30]]:[])]; if(vegan) defs=[['oats',90],['banana',120],['pb',25]]; instructions=['Mix oats with milk/yogurt or water. Add banana and peanut butter.']}
  if(type==='lunch'){name=data.tools.includes('no-cook')?'Portable bulk lunch':'Rice protein box'; defs=vegan?[['rice',110],['beans',250],['veg',150]]:cheap?[['rice',120],['eggs',2],['veg',150]]:[['rice',120],['chicken',180],['veg',150]]; instructions=['Cook a larger batch and box it for school/work.']}
  if(type==='dinner'){name=data.tools.includes('airfryer')?'Airfryer protein dinner':'Simple dinner bowl'; defs=vegan?[['pasta',120],['beans',250],['veg',200]]:[['pasta',120],['chicken',200],['veg',200]]; instructions=[data.tools.includes('airfryer')?'Airfry protein, cook carb, add vegetables.':'Cook carb and protein on stove. Add vegetables.']}
  if(type==='snack'){name=highProtein?'Skyr protein snack':'Cheap calorie snack'; defs=vegan?[['banana',120],['pb',30]]:[['skyr',250],['banana',120]]; instructions=['Eat between meals so the dinner gap is not too big.']}
  if(type==='shake'){name='Default bulk shake'; defs=vegan?[['oats',80],['banana',120],['pb',35]]:[['milk',500],['oats',80],['banana',120],['pb',25], ...(highProtein?[['whey',30]]:[])]; instructions=['Blend everything. Add water if too thick.']}
  const people=clamp(Number(data.servings)||1,1,12);
  const meal={id:uid(),type,name,servings:people,ingredients:[],instructions,calories:0,protein:0,carbs:0,fat:0,cost:0,costPerServing:0,usedProducts:[],missingData:[]};
  for(const [key,amount] of defs) addPlannerIngredient(meal,key,amount,data.store,people);
  for(const k of ['calories','protein','carbs','fat','cost']) meal[k]=round(meal[k],k==='cost'?2:0);
  meal.costPerServing=round(meal.cost/people,2);
  return meal;
}
function plannerProductByKey(key,store){
  const category=FALLBACK_PRODUCTS[key]?.category || key;
  const products=(state.products||[]).map(p=>sanitizeProduct(p)).filter(p=>(p.category||inferProductCategory(p.name))===category && !isProductIncomplete(p));
  const same=products.filter(p=>String(p.retailer||'').toLowerCase().includes(String(store||'').toLowerCase()) && pricePer100(p)>0).sort(priceSort)[0];
  if(same) return same;
  const priced=products.filter(p=>pricePer100(p)>0).sort(priceSort)[0]; if(priced) return priced;
  return products.sort(productSort)[0] || null;
}
function addPlannerIngredient(meal,key,amountPerServing,store,servings=1){
  const people=clamp(Number(servings)||1,1,12);
  const saved=plannerProductByKey(key,store); const fb=FALLBACK_PRODUCTS[key]||FALLBACK_PRODUCTS.oats; const p=saved||fb;
  const unit=p.unit||fb.unit||'g'; const per=p.per100||fb.per100; const isPiece=unit==='piece'; const factorPerPerson=isPiece?amountPerServing:amountPerServing/100; const totalAmount=round(amountPerServing*people);
  meal.ingredients.push({name:p.name||fb.name,amount:totalAmount,amountPerServing,servings:people,unit,productId:saved?.id||'',category:fb.category,exact:!!saved,missingPrice:!saved||!pricePer100(saved),missingNutrition:!saved&&true});
  // Macros shown in the meal card are per person/serving, while shopping list amounts and costs are total for everyone.
  meal.calories+=Number(per.calories||0)*factorPerPerson; meal.protein+=Number(per.protein||0)*factorPerPerson; meal.carbs+=Number(per.carbs||0)*factorPerPerson; meal.fat+=Number(per.fat||0)*factorPerPerson;
  const price=saved?pricePer100(saved):Number(fb.pricePer100||0); if(price) meal.cost+=price*totalAmount/100;
  if(saved) meal.usedProducts.push(saved.id); else meal.missingData.push(`Scan exact ${fb.name} for ${store}`);
  if(saved && !pricePer100(saved)) meal.missingData.push(`Add price for ${saved.name}`);
}
function buildShoppingList(plan){
  const map=new Map(); let cost=0, exactUnits=0, allUnits=0; const missing=[];
  for(const d of plan.days||[]) for(const m of d.meals||[]) for(const ing of m.ingredients||[]){
    const key=ing.productId || `${ing.name}|${ing.unit}`; const row=map.get(key)||{name:ing.name,amount:0,unit:ing.unit,estimatedCost:0,productId:ing.productId||'',missingPrice:false,missingNutrition:false,usedIn:[]};
    row.amount+=Number(ing.amount)||0; row.usedIn.push(`${d.day} ${m.type}`);
    const prod=ing.productId?findProduct(ing.productId):null; const price=prod?pricePer100(prod):(FALLBACK_PRODUCTS[ing.category]?.pricePer100||0);
    row.estimatedCost+=price*(Number(ing.amount)||0)/100; row.missingPrice=!prod||!pricePer100(prod); row.missingNutrition=!prod||isProductIncomplete(prod);
    if(row.missingPrice) missing.push(`Price for ${ing.name}`); if(row.missingNutrition) missing.push(`Nutrition for ${ing.name}`);
    cost+=price*(Number(ing.amount)||0)/100; allUnits++; if(prod&&pricePer100(prod)&&!isProductIncomplete(prod)) exactUnits++;
    map.set(key,row);
  }
  return {items:[...map.values()].map(x=>({...x,amount:round(x.amount),estimatedCost:round(x.estimatedCost,2),usedIn:[...new Set(x.usedIn)].slice(0,5)})),cost,coverage:allUnits?round(exactUnits/allUnits*100):0,missing};
}
function normalizeWeekPlan(plan,data={}){plan.id=plan.id||uid();plan.createdAt=plan.createdAt||new Date().toISOString();plan.store=plan.store||data.store||'Netto';plan.budget=Number(plan.budget||data.weeklyBudget||0);plan.servings=clamp(Number(plan.servings||data.servings||plan.settings?.servings||1),1,12);plan.settings={...(plan.settings||data||{}),servings:plan.servings};plan.days=(plan.days||[]).slice(0,7).map(d=>({...d,meals:(d.meals||[]).map(m=>({...m,servings:m.servings||plan.servings,costPerServing:round(Number(m.costPerServing)||Number(m.cost||0)/plan.servings,2)}))}));plan.shoppingList=plan.shoppingList||buildShoppingList(plan).items;plan.totalCost=round(Number(plan.totalCost)||plan.shoppingList.reduce((s,i)=>s+Number(i.estimatedCost||0),0),2);plan.costPerPerson=round(Number(plan.costPerPerson)||plan.totalCost/plan.servings,2);plan.exactPriceCoverage=round(Number(plan.exactPriceCoverage)||0);plan.notes=Array.isArray(plan.notes)?plan.notes:[String(plan.notes||'')].filter(Boolean);plan.missingData=[...new Set(plan.missingData||[])];return plan}
function weeklyPlanCardHTML(plan,inSheet=false){
  const over=Number(plan.totalCost)>Number(plan.budget); const days=(plan.days||[]).map(dayPlanHTML).join('');
  return `<div class="stack"><div class="card card-pad"><div class="row between"><div><p class="eyebrow">${escapeHTML(plan.store)} weekly plan · ${plan.servings||1} ${(plan.servings||1)===1?'person':'people'}</p><h3>${escapeHTML(plan.name||'Meal plan')}</h3></div><span class="pill ${over?'warn':'good'}">${round(plan.totalCost,2)} / ${round(plan.budget,2)} kr</span></div><div class="product-stats"><div><strong>${round(plan.exactPriceCoverage||0)}%</strong><span>exact price/nutrition</span></div><div><strong>${(plan.days||[]).reduce((s,d)=>s+(d.meals||[]).length,0)}</strong><span>meals</span></div><div><strong>${(plan.shoppingList||[]).length}</strong><span>items</span></div><div><strong>${round(plan.costPerPerson||0,2)} kr</strong><span>per person</span></div></div>${(plan.notes||[]).length?`<p class="subtle">${escapeHTML(plan.notes.join(' '))}</p>`:''}${(plan.missingData||[]).length?`<div class="missing-box"><strong>Missing exact data</strong><p class="subtle">${escapeHTML(plan.missingData.slice(0,5).join(', '))}. Scan product label/receipt so next plan becomes 1:1.</p><button class="secondary full" data-action="scan-food">Scan product data</button></div>`:''}</div><div class="section-title"><div><p class="eyebrow">Shopping list</p><h3>One combined list</h3></div><button class="link-button" data-action="scan-price-label">Add real prices</button></div>${shoppingListHTML(plan)}<div class="section-title"><div><p class="eyebrow">7 days</p><h3>Meals</h3></div></div>${days}</div>`;
}
function dayPlanHTML(d){return `<div class="plan-day card"><h3>${escapeHTML(d.day)}</h3><div class="plan-meals">${(d.meals||[]).map(m=>planMealHTML(d.day,m)).join('')}</div></div>`}
function planMealHTML(day,m){const people=m.servings||state.activeMealPlan?.servings||1;return `<div class="plan-meal"><div><strong>${escapeHTML(m.name)}</strong><small>${escapeHTML(cap(m.type))} · ${round(m.calories)} kcal/person · ${round(m.protein)}g protein/person · ${round(m.cost,2)} kr total${people>1?` · ${people} people`:''}</small></div><div class="row"><button class="icon-button" data-action="log-plan-meal" data-day="${escapeHTML(day)}" data-id="${m.id}">+</button><button class="icon-button" data-action="swap-plan-meal" data-day="${escapeHTML(day)}" data-id="${m.id}">↻</button></div></div>`}
function shoppingListHTML(plan){const people=plan.servings||1;return `<div class="shopping-list card"><div class="shop-row muted-row"><div><strong>Shopping list total</strong><small>Scaled for ${people} ${people===1?'person':'people'} · about ${round((plan.totalCost||0)/(people||1),2)} kr per person</small></div></div>${(plan.shoppingList||[]).map(i=>`<div class="shop-row"><div><strong>${escapeHTML(i.name)}</strong><small>${round(i.amount)} ${escapeHTML(i.unit)} total · ${round(i.estimatedCost,2)} kr · used ${i.usedIn?.length||0}×</small></div><span class="pill ${i.missingPrice||i.missingNutrition?'warn':'good'}">${i.missingPrice||i.missingNutrition?'scan':'exact'}</span></div>`).join('')||'<div class="empty">No shopping items.</div>'}</div>`}
function findPlanMeal(plan,mealId){for(const d of plan.days||[]){const m=(d.meals||[]).find(x=>x.id===mealId);if(m)return{day:d,meal:m}}return null}
function planMealToFood(m){return normalizeFood({id:uid(),type:m.type==='shake'?'shake':'meal',source:'meal-plan',name:m.name,summary:'From weekly meal plan',calories:m.calories,protein:m.protein,carbs:m.carbs,fat:m.fat,ingredients:m.ingredients||[],instructions:m.instructions||[],usedProducts:[...new Set((m.ingredients||[]).map(i=>i.productId).filter(Boolean))],shoppingNote:`Logged as one serving from a plan for ${m.servings||state.activeMealPlan?.servings||1} ${(m.servings||state.activeMealPlan?.servings||1)===1?'person':'people'}. Total dish cost was about ${round(m.cost,2)} kr.`})}
function logPlanMeal(id){const found=findPlanMeal(state.activeMealPlan,id);if(!found){toast('Meal not found');return}addEntry(planMealToFood(found.meal));closeSheet()}
async function swapPlanMeal(id){const found=findPlanMeal(state.activeMealPlan,id);if(!found){toast('Meal not found');return}const data=state.activeMealPlan.settings||{store:state.activeMealPlan.store,weeklyBudget:state.activeMealPlan.budget,plannerStyle:'cheap',rules:[],tools:[],meals:[]};const replacement=buildPlannerMeal(found.meal.type,data,found.day.day,0);replacement.name=`Swap: ${replacement.name}`;found.day.meals=found.day.meals.map(m=>m.id===id?replacement:m);const totals=buildShoppingList(state.activeMealPlan);state.activeMealPlan.shoppingList=totals.items;state.activeMealPlan.totalCost=round(totals.cost,2);state.activeMealPlan.exactPriceCoverage=totals.coverage;state.activeMealPlan.missingData=[...new Set([...(state.activeMealPlan.missingData||[]),...totals.missing])].slice(0,8);state.mealPlans=(state.mealPlans||[]).map(p=>p.id===state.activeMealPlan.id?state.activeMealPlan:p);await saveState();render();openSheet(state.activeMealPlan.name,'Meal swapped',weeklyPlanCardHTML(state.activeMealPlan,true));toast('Meal swapped')}
function askPlan(){const plan=state.activeMealPlan;if(!plan)return;openCoach(`Help me improve this weekly meal plan for ${plan.store}. It feeds ${plan.servings||1} people. Total budget ${plan.budget} kr, current estimate ${plan.totalCost} kr, about ${round((plan.totalCost||0)/(plan.servings||1),2)} kr per person. Tell me what to scan or swap first.`)}
function foodLogHTML() {
  return `<div class="card card-pad stack"><div><h3>Lazy log</h3><p class="subtle">Type what you ate normally. BulkMind estimates it and lets you confirm.</p></div><textarea id="lazyLogText" placeholder="Example: 2 eggs, 3 pieces of toast, milk and a chicken wrap"></textarea><button class="primary full" data-action="lazy-log">Estimate and add</button></div><div class="quick-grid tight"><button class="quick-action" data-action="scan-food"><span class="icon">▣</span><strong>Scan product</strong><small>Barcode, API or label photo</small></button><button class="quick-action" data-action="manual-log"><span class="icon">123</span><strong>Manual macros</strong><small>Enter exact numbers</small></button></div>`;
}
function savedFoodHTML() {
  if (!state.savedFoods.length) return `<div class="empty card">Save a generated meal or shake and it will appear here for one-tap reuse.</div>`;
  return `<div class="stack">${state.savedFoods.map(foodCardHTML).join('')}</div>`;
}
function productLibraryHTML() {
  const products=(state.products||[]).slice().sort(productSort);
  const missing=products.filter(isProductIncomplete).length;
  const preferred=products.filter(p=>p.preferredForShakes).length;
  return `<div class="card card-pad stack"><div><h3>Product Memory</h3><p class="subtle">Scan once, then BulkMind remembers it. Saved milk, protein powder, skyr and cheap products are used automatically when generating shakes and meals.</p></div><div class="product-stats"><div><strong>${products.length}</strong><span>saved</span></div><div><strong>${preferred}</strong><span>preferred</span></div><div><strong>${missing}</strong><span>need label</span></div></div><button class="primary full" data-action="scan-food">Add product by scan/API</button></div>${products.length?`<div class="stack">${products.map(productCardHTML).join('')}</div>`:`<div class="empty card">No products saved yet. Add your actual milk or protein powder so BulkMind stops guessing. After saving, the shake maker can reuse your normal products automatically.</div>`}`;
}

function pricePlannerHTML() {
  const products = (state.products || []).map(p => sanitizeProduct(p));
  const priced = products.filter(p => pricePer100(p) > 0);
  const missing = products.filter(p => !pricePer100(p)).length;
  const best = bestPriceByCategory();
  const weekly = estimateWeeklyBasket(products);
  return `<div class="card card-pad stack"><div><p class="eyebrow">Denmark price planner</p><h3>Real prices for your bulk</h3><p class="subtle">Save the exact product + exact price once. Then BulkMind uses your actual milk, whey, rice, skyr etc. in meals and compares cost next time.</p></div><div class="product-stats"><div><strong>${priced.length}</strong><span>priced</span></div><div><strong>${missing}</strong><span>need price</span></div><div><strong>${weekly ? `${weekly} kr` : '—'}</strong><span>sample day</span></div></div><div class="quick-grid tight"><button class="quick-action" data-action="scan-price-label"><span class="icon">🧾</span><strong>Scan receipt/price</strong><small>Gemini extracts real Danish prices</small></button><button class="quick-action" data-action="manual-price"><span class="icon">kr</span><strong>Add price</strong><small>Exact package price</small></button><button class="quick-action" data-action="open-salling-search"><span class="icon">S</span><strong>Salling lookup</strong><small>Netto/Føtex/Bilka API key</small></button><button class="quick-action" data-action="find-cheaper-products"><span class="icon">↘</span><strong>Find swaps</strong><small>Cheaper per protein/kcal</small></button></div><p class="privacy-note">1:1 prices only work from sources you give the app: a saved receipt/price label, manual package price, or a retailer API key.</p></div>
  ${priceWarningsHTML()}
  <div class="section-title"><div><p class="eyebrow">Best saved buys</p><h3>Use these by default</h3></div></div>${Object.keys(best).length ? `<div class="stack">${Object.entries(best).map(([cat,p])=>priceBestCardHTML(cat,p)).join('')}</div>` : `<div class="empty card">No priced products yet. Scan a receipt/price label or add package prices manually.</div>`}
  <div class="section-title"><div><p class="eyebrow">All product prices</p><h3>Cost database</h3></div></div>${products.length ? `<div class="stack">${products.sort((a,b)=>priceSort(a,b)).map(priceProductRowHTML).join('')}</div>` : `<div class="empty card">Your product memory is empty. Add milk, whey, oats, skyr, rice and chicken first.</div>`}`;
}
function priceWarningsHTML(){
  const incomplete=(state.products||[]).filter(p=>isProductIncomplete(p));
  const noPrice=(state.products||[]).filter(p=>!pricePer100(p));
  const a=[];
  if(incomplete.length) a.push(`<div class="missing-box"><strong>Nutrition missing</strong><p class="subtle">${escapeHTML(incomplete.slice(0,3).map(p=>p.name).join(', '))} need a nutrition label before BulkMind can calculate cost per protein/kcal properly.</p><button class="secondary full" data-action="scan-label">Send nutrition label photo</button></div>`);
  if(noPrice.length) a.push(`<div class="shopping-note"><strong>Prices missing</strong><p>${escapeHTML(noPrice.slice(0,3).map(p=>p.name).join(', '))} need package price + package size. After that the app can compare cheap/better swaps.</p></div>`);
  return a.join('');
}
function priceBestCardHTML(category, p){
  const costProtein=costPerProtein(p); const costKcal=costPer1000kcal(p);
  return `<article class="food-card card"><div class="food-top"><div class="food-title"><strong>${escapeHTML(cap(category))}</strong><span>${escapeHTML(p.name)}${p.retailer?` · ${escapeHTML(p.retailer)}`:''}</span></div><span class="pill good">Best saved</span></div><div class="food-macros"><div><strong>${round(pricePer100(p),2)}</strong><span>kr/100${escapeHTML(p.unit)}</span></div><div><strong>${costProtein ? round(costProtein,2) : '—'}</strong><span>kr/10g protein</span></div><div><strong>${costKcal ? round(costKcal,2) : '—'}</strong><span>kr/1000 kcal</span></div><div><strong>${p.usageCount||0}</strong><span>uses</span></div></div><div class="food-actions"><button class="primary" data-action="prefer-product" data-id="${p.id}">Use by default</button><button class="secondary" data-action="manual-price" data-id="${p.id}">Update price</button></div></article>`;
}
function priceProductRowHTML(p){
  const price=pricePer100(p); const proteinCost=costPerProtein(p); const kcalCost=costPer1000kcal(p);
  const source=p.priceSource?` · ${p.priceSource}`:''; const checked=p.lastPriceCheck?` · checked ${new Date(p.lastPriceCheck).toLocaleDateString()}`:'';
  return `<article class="food-card card compact-price"><div class="food-top"><div class="food-title"><strong>${escapeHTML(p.name)}</strong><span>${escapeHTML(p.brand||p.category||'Product')}${escapeHTML(source)}${escapeHTML(checked)}</span></div><span class="pill ${price?'good':'warn'}">${price?`${round(price,2)} kr/100${escapeHTML(p.unit)}`:'Need price'}</span></div><div class="product-memory"><span>${proteinCost?`${round(proteinCost,2)} kr/10g protein`:'protein cost —'}</span><span>${kcalCost?`${round(kcalCost,2)} kr/1000 kcal`:'kcal cost —'}</span><span>${p.retailer?escapeHTML(p.retailer):'No store'}</span></div><div class="food-actions"><button class="secondary" data-action="manual-price" data-id="${p.id}">Set price</button><button class="secondary" data-action="ask-product" data-id="${p.id}">Ask AI compare</button></div></article>`;
}
function bestPriceByCategory(){
  const out={};
  for(const p of (state.products||[]).map(x=>sanitizeProduct(x)).filter(p=>pricePer100(p)>0 && !isProductIncomplete(p))){
    const cat=p.category||inferProductCategory(p.name); const score=priceScore(p);
    if(!out[cat] || score<priceScore(out[cat])) out[cat]=p;
  }
  return out;
}
function priceScore(p){
  const cat=p.category||inferProductCategory(p.name);
  if(['protein-powder','skyr-yogurt','chicken','eggs'].includes(cat)) return costPerProtein(p) || 9999;
  return costPer1000kcal(p) || pricePer100(p) || 9999;
}
function priceSort(a,b){return (pricePer100(a)?0:1)-(pricePer100(b)?0:1) || priceScore(a)-priceScore(b)}
function costPerProtein(p){const protein=Number(p.per100?.protein||0); const price=pricePer100(p); return protein>0&&price>0 ? price/protein*10 : 0}
function costPer1000kcal(p){const kcal=Number(p.per100?.calories||0); const price=pricePer100(p); return kcal>0&&price>0 ? price/kcal*1000 : 0}
function estimateWeeklyBasket(products){
  const by=bestPriceByCategory();
  const milk=by.milk, oats=by.oats, pb=by['peanut-butter'], protein=by['protein-powder']||by['skyr-yogurt'];
  const sample=[milk&&{p:milk,amount:500}, oats&&{p:oats,amount:80}, pb&&{p:pb,amount:30}, protein&&{p:protein,amount:protein.category==='protein-powder'?30:200}].filter(Boolean);
  const day=sample.reduce((s,x)=>s+pricePer100(x.p)*x.amount/100,0);
  return day?round(day):0;
}
function openManualPrice(id=''){
  const p=id?findProduct(id):null;
  const productOptions=(state.products||[]).map(x=>`<option value="${x.id}" ${p?.id===x.id?'selected':''}>${escapeHTML(x.name)}${x.brand?` — ${escapeHTML(x.brand)}`:''}</option>`).join('');
  openSheet('Add exact Danish price','Package price',`<form id="manualPriceForm" class="sheet-form"><div class="card card-pad"><h3>Use the real shelf/receipt price</h3><p class="subtle">Example: sødmælk 1 liter costs 13.95 kr → price 13.95, package size 1000 ml. This makes the planner 1:1 for the products you actually buy.</p></div><div class="field full"><label for="priceProductId">Product</label><select id="priceProductId" name="priceProductId">${productOptions}</select></div>${field('pricePackage','Package price (kr)','number',p?.pricePackage||'','Example: 13.95','full')}${field('packageAmount',`Package size (${p?.unit||'g/ml'})`,'number',p?.packageAmount||'','Example: 1000','full')}${field('retailer','Store','text',p?.retailer||'','Example: Netto, REMA 1000, Føtex','full')}${field('priceSource','Source','text',p?.priceSource||'manual','manual, receipt, shelf label, Salling API','full')}<div class="form-actions"><button type="button" class="primary full" data-action="save-manual-price">Save price</button></div></form>`);
}
async function saveManualPrice(){
  const data=Object.fromEntries(new FormData($('#manualPriceForm'))); const p=findProduct(data.priceProductId); if(!p){toast('Choose a product first');return}
  p.pricePackage=Number(data.pricePackage)||0; p.packageAmount=Number(data.packageAmount)||p.packageAmount||0; p.retailer=data.retailer||p.retailer||''; p.priceSource=data.priceSource||'manual'; p.lastPriceCheck=new Date().toISOString(); p.pricePer100=pricePer100(p);
  await saveState(); closeSheet(); state.ui.foodSegment='prices'; render(); toast('Price saved');
}
function openPriceLabelScan(){
  openSheet('Scan receipt or price label','Gemini price OCR',`<div class="stack"><div class="card card-pad"><h3>Make prices real</h3><p class="subtle">Take a photo of a receipt or shelf label. Gemini extracts product names, package sizes and prices. You confirm before saving.</p></div><input id="pricePhoto" class="input" type="file" accept="image/*" capture="environment"><button class="primary full" data-action="process-price-label">Extract prices</button><button class="secondary full" data-action="manual-price">Type price manually</button></div>`);
}
async function processPriceLabelPhoto(){
  const file=$('#pricePhoto')?.files?.[0]; if(!file){toast('Choose a photo first');return} if(!state.settings.geminiKey){toast('Add Gemini key first');return}
  openSheet('Reading prices','Gemini vision',`<div class="loading"><div><div class="spinner" style="margin:0 auto 14px"></div><p class="subtle">Looking for Danish product prices, package size and store names…</p></div></div>`);
  try{
    const prompt='Read this Danish grocery receipt or shelf price label. Return ONLY JSON: {"items":[{"name":"product name","brand":"brand if visible","retailer":"store if visible","pricePackage":number,"packageAmount":number,"unit":"g or ml","priceSource":"receipt/photo","confidence":"low/medium/high"}]}. Extract normal DKK price, not pant/deposit. If package size is 1 liter use 1000 ml. If 1 kg use 1000 g. If unsure, still return best estimate with low confidence.';
    const data=await geminiVisionRequest(prompt,file,true); const items=(data.items||[]).map(priceCandidateFromOCR).filter(Boolean);
    window.__bulkPriceCandidates=items;
    openSheet('Confirm extracted prices','Save to product memory',`<div class="stack">${items.length?items.map(priceCandidateHTML).join(''):'<div class="empty card">No prices found. Try a clearer photo or type manually.</div>'}<button class="secondary full" data-action="manual-price">Type manually instead</button></div>`);
  }catch(err){console.error(err);openSheet('Could not read prices','Try again',`<div class="card card-pad"><p class="subtle">Gemini could not extract prices clearly. Try a close-up photo of the receipt or shelf label.</p></div><button class="primary full" data-action="scan-price-label">Try another photo</button><button class="secondary full" data-action="manual-price">Add manually</button>`)}
}
function priceCandidateFromOCR(x){
  if(!x?.name || !(Number(x.pricePackage)>0)) return null;
  const unit=x.unit==='ml'?'ml':'g'; const existing=findClosestProduct(x.name, unit);
  return {id:uid(),productId:existing?.id||'',name:x.name,brand:x.brand||'',retailer:x.retailer||'',pricePackage:Number(x.pricePackage)||0,packageAmount:Number(x.packageAmount)||0,unit,priceSource:x.priceSource||'price photo',confidence:x.confidence||'medium'};
}
function priceCandidateHTML(c){
  const existing=c.productId?findProduct(c.productId):null;
  const per100=c.packageAmount?round(c.pricePackage/c.packageAmount*100,2):'—';
  return `<article class="food-card card"><div class="food-top"><div class="food-title"><strong>${escapeHTML(c.name)}</strong><span>${existing?`Matched: ${escapeHTML(existing.name)}`:'New product / no match'}${c.retailer?` · ${escapeHTML(c.retailer)}`:''}</span></div><span class="pill good">${escapeHTML(c.confidence)}</span></div><div class="product-memory"><span>${round(c.pricePackage,2)} kr/package</span><span>${c.packageAmount||'—'} ${escapeHTML(c.unit)}</span><span>${per100} kr/100${escapeHTML(c.unit)}</span></div><div class="food-actions"><button class="primary" data-action="apply-price-suggestion" data-id="${c.id}">Save this price</button></div></article>`;
}
function findClosestProduct(name,unit){
  const words=String(name||'').toLowerCase().split(/\W+/).filter(w=>w.length>2);
  return (state.products||[]).filter(p=>p.unit===unit).map(p=>({p,score:words.filter(w=>String(p.name).toLowerCase().includes(w)||String(p.brand).toLowerCase().includes(w)).length})).sort((a,b)=>b.score-a.score)[0]?.score? (state.products||[]).filter(p=>p.unit===unit).map(p=>({p,score:words.filter(w=>String(p.name).toLowerCase().includes(w)||String(p.brand).toLowerCase().includes(w)).length})).sort((a,b)=>b.score-a.score)[0].p : null;
}
window.__bulkPriceCandidates=[];
function cachePriceCandidates(){ const cards=$$('.food-card'); return cards; }
async function applyPriceSuggestion(id){
  // Re-read the visible card is not reliable, so store latest candidates globally when rendering.
  const c=(window.__bulkPriceCandidates||[]).find(x=>x.id===id); if(!c){toast('Price candidate expired. Scan again.');return}
  let p=c.productId?findProduct(c.productId):null;
  if(!p){ p=sanitizeProduct({id:uid(),type:'product',source:'price-photo',name:c.name,brand:c.brand,unit:c.unit,category:inferProductCategory(`${c.name} ${c.brand}`),defaultAmount:inferDefaultAmount(c.name,c.unit),per100:{calories:0,protein:0,carbs:0,fat:0}}); state.products.unshift(p); }
  p.pricePackage=c.pricePackage; p.packageAmount=c.packageAmount; p.retailer=c.retailer; p.priceSource=c.priceSource; p.lastPriceCheck=new Date().toISOString(); p.pricePer100=pricePer100(p);
  await saveState(); state.ui.foodSegment='prices'; render(); toast('Real price saved');
}
function findCheaperProducts(){
  const groups=bestPriceByCategory();
  const notes=Object.entries(groups).map(([cat,best])=>`${cap(cat)}: ${best.name} is your best saved option right now at ${round(pricePer100(best),2)} kr/100${best.unit}. ${costPerProtein(best)?`${round(costPerProtein(best),2)} kr per 10g protein.`:`${round(costPer1000kcal(best),2)} kr per 1000 kcal.`}`).join('\n');
  openSheet('Cheapest saved swaps','Based on your product memory',`<div class="card card-pad"><p class="subtle">${escapeHTML(notes || 'Add prices first. Then this will tell you which milk, whey, skyr, oats etc. are actually cheapest for your bulk.')}</p></div><button class="primary full" data-action="scan-price-label">Scan more prices</button>`);
}
function openSallingSearch(){
  openSheet('Salling lookup','Netto/Føtex/Bilka connector',`<form id="sallingForm" class="sheet-form"><div class="card card-pad"><h3>Real retailer API source</h3><p class="subtle">Use this only if you have a Salling Group developer API key. It can help with Salling-owned stores, but not REMA/Coop/Lidl unless those stores expose data or you scan prices yourself.</p></div>${field('sallingApiKey','Salling API key','password',state.settings.sallingApiKey||'','','full')}${field('sallingStoreId','Store ID / zip','text',state.settings.sallingStoreId||'','Optional','full')}${field('sallingQuery','Search product','text','sødmælk','Example: sødmælk, skyr, havregryn','full')}<div class="form-actions"><button type="button" class="primary full" data-action="run-salling-search">Search / test connector</button></div></form>`);
}
async function runSallingSearch(){
  const data=Object.fromEntries(new FormData($('#sallingForm'))); state.settings.sallingApiKey=data.sallingApiKey||''; state.settings.sallingStoreId=data.sallingStoreId||''; await saveState();
  openSheet('Testing Salling connector','Live API',`<div class="loading"><div><div class="spinner" style="margin:0 auto 14px"></div><p class="subtle">Trying to reach Salling Group APIs…</p></div></div>`);
  try{
    const result=await fetchSallingCandidate(data.sallingQuery);
    openSheet('Salling result','Review before saving',`<div class="card card-pad"><h3>${escapeHTML(result.name)}</h3><p class="subtle">${escapeHTML(result.note)}</p></div><button class="primary full" data-action="manual-price">Save price manually from result</button>`);
  }catch(err){console.warn(err);openSheet('Connector needs setup','Use scan/manual for now',`<div class="card card-pad"><h3>Could not get a usable price</h3><p class="subtle">The public Salling portal requires an API key and not every API can be called directly from a front-end app. For exact 1:1 prices today, scan a receipt/shelf label or type the package price. The app will still use those prices automatically afterwards.</p></div><button class="primary full" data-action="scan-price-label">Scan price instead</button><button class="secondary full" data-action="manual-price">Type price manually</button>`)}
}
async function fetchSallingCandidate(query){
  const key=state.settings.sallingApiKey?.trim(); if(!key) throw new Error('No Salling key');
  // Public Salling API access can depend on the app/key. This adapter is intentionally conservative.
  const url=`https://api.sallinggroup.com/v1/product-suggestions/suggestions?query=${encodeURIComponent(query||'')}`;
  const res=await fetch(url,{headers:{'Authorization':`Bearer ${key}`,'Accept':'application/json'}});
  if(!res.ok) throw new Error(`Salling ${res.status}`);
  const body=await res.json();
  return {name:body?.[0]?.title || body?.suggestions?.[0]?.title || query, note:'API answered, but confirm current shelf price before saving.'};
}

function recentGeneratedHTML() {
  const foods=state.generatedFoods.slice(0,5);
  return foods.length?`<div class="stack">${foods.map(foodCardHTML).join('')}</div>`:`<div class="empty card">Your generated meals and shakes will appear here.</div>`;
}
function foodCardHTML(food) {
  const used=(food.usedProducts||[]).map(id=>findProduct(id)).filter(Boolean);
  const missing=(food.missingProducts||[]).filter(Boolean);
  const productLine=used.length?`<div class="used-products"><strong>Using your products</strong>${used.map(p=>`<span>${escapeHTML(p.name)}${p.preferredForShakes?' · preferred':''}</span>`).join('')}</div>`:'';
  const missingLine=missing.length?`<div class="missing-box"><strong>Needs your product data</strong><p class="subtle">${escapeHTML(missing.join(', '))}. Scan the product or send a nutrition label photo so next shake is exact.</p><button class="secondary full" data-action="scan-food">Add product data</button></div>`:'';
  const shopping=food.shoppingNote?`<div class="shopping-note"><strong>Shopping note</strong><p>${escapeHTML(food.shoppingNote)}</p></div>`:'';
  return `<article class="food-card card"><div class="food-top"><div class="food-title"><strong>${escapeHTML(food.name)}</strong><span>${escapeHTML(food.summary || food.timing || cap(food.type))}</span></div><span class="pill ${food.source==='gemini'?'good':''}">${food.source==='gemini'?'AI':'Smart local'}</span></div><div class="food-macros"><div><strong>${round(food.calories)}</strong><span>kcal</span></div><div><strong>${round(food.protein)}g</strong><span>protein</span></div><div><strong>${round(food.carbs)}g</strong><span>carbs</span></div><div><strong>${round(food.fat)}g</strong><span>fat</span></div></div>${productLine}${shopping}${missingLine}<details class="ingredients"><summary>Ingredients & steps</summary><ul>${(food.ingredients||[]).map(i=>`<li>${escapeHTML(typeof i==='string'?i:`${i.amount} ${i.item}`)}</li>`).join('')}</ul>${food.instructions?.length?`<ol>${food.instructions.map(s=>`<li>${escapeHTML(s)}</li>`).join('')}</ol>`:''}</details><div class="food-actions"><button class="primary" data-action="add-food" data-id="${food.id}">Add to today</button><button class="secondary" data-action="ask-food" data-id="${food.id}">Ask AI / change it</button></div><div class="row between"><button class="link-button" data-action="save-food" data-id="${food.id}">${state.savedFoods.some(f=>f.id===food.id)?'Saved ✓':'Save for later'}</button><button class="link-button" data-action="delete-generated" data-id="${food.id}">Remove</button></div></article>`;
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
    'switch-tab':()=>switchTab(button.dataset.tab),'open-settings':openSettings,'open-quick-log':openQuickLog,'smart-shake':()=>openGenerator('shake'),'smart-meal':()=>openGenerator('meal'),'open-coach':()=>openCoach(),'log-weight':openWeightLog,'open-dk-prices':()=>{state.ui.foodSegment='prices';saveState();render()},'open-weekly-planner':openWeeklyPlanner,'generate-week-plan':generateWeeklyPlan,'log-plan-meal':()=>logPlanMeal(button.dataset.id),'swap-plan-meal':()=>swapPlanMeal(button.dataset.id),'ask-plan':askPlan,'scan-food':openScanHub,'manual-barcode':openManualBarcode,'lookup-barcode':lookupBarcodeFromForm,'start-camera-scan':startBarcodeCamera,'scan-label':()=>openLabelScan(),'process-label-photo':processLabelPhoto,'manual-product':openManualProduct,'save-product-manual':saveManualProduct,'add-product-portion':()=>addProductPortion(button.dataset.id),'save-product-from-review':saveProductFromReview,'review-product':()=>reviewSavedProduct(button.dataset.id),'delete-product':()=>deleteProduct(button.dataset.id),'prefer-product':()=>togglePreferredProduct(button.dataset.id),'complete-product':()=>completeProductNutrition(button.dataset.id),'ask-product':()=>openProductCoach(button.dataset.id),'manual-price':()=>openManualPrice(button.dataset.id),'save-manual-price':saveManualPrice,'scan-price-label':openPriceLabelScan,'process-price-label':processPriceLabelPhoto,'find-cheaper-products':findCheaperProducts,'open-salling-search':openSallingSearch,'run-salling-search':runSallingSearch,'apply-price-suggestion':()=>applyPriceSuggestion(button.dataset.id),
    'food-segment':()=>{state.ui.foodSegment=button.dataset.segment;saveState();render()},'preset-generate':()=>openGenerator(button.dataset.preset),'lazy-log':lazyLog,'manual-log':openManualLog,
    'add-food':()=>{const f=findFood(button.dataset.id);if(f){addEntry(f);closeSheet()}},'save-food':()=>saveFood(button.dataset.id),'ask-food':()=>openFoodChat(button.dataset.id),'delete-generated':()=>deleteGenerated(button.dataset.id),
    'generate-workout':generateWorkoutPlan,'toggle-set':()=>toggleSet(button.dataset.ex,button.dataset.set),'finish-workout':finishWorkout,'weekly-checkin':openWeeklyCheckin,'edit-log':openEditLog,
    'save-settings':saveSettings,'toggle-theme':toggleTheme,'export-data':exportData,'import-data':()=>$('#importFile')?.click(),'reset-app':resetApp,'install-help':openInstallHelp,'edit-profile':openProfileEditor,'edit-targets':openTargetEditor,'save-targets':saveTargets,'open-goal-planner':openGoalPlanner,'calculate-goal-targets':calculateGoalTargets,'apply-goal-targets':applyGoalTargets,
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
function normalizeProfile(p){const merged={...defaultProfile,...p};return {...merged,age:Number(merged.age),height:Number(merged.height),currentWeight:Number(merged.currentWeight),targetWeight:Number(merged.targetWeight),trainingDays:clamp(merged.trainingDays,1,7),targetMode:merged.targetMode==='custom'?'custom':'auto',customCalories:merged.customCalories===''?'':Number(merged.customCalories),customProtein:merged.customProtein===''?'':Number(merged.customProtein),customCarbs:merged.customCarbs===''?'':Number(merged.customCarbs),customFat:merged.customFat===''?'':Number(merged.customFat),targetMonths:clamp(merged.targetMonths||8,1,36),lastGoalPlan:merged.lastGoalPlan||null}}
function switchTab(tab){state.ui.tab=tab;saveState();render()}

function openSheet(title,eyebrow,html){const sheet=$('#sheet');$('#sheetTitle').textContent=title;$('#sheetEyebrow').textContent=eyebrow||'';$('#sheetBody').innerHTML=html;if(!sheet.open)sheet.showModal();requestAnimationFrame(()=>$('#sheetBody').scrollTop=0)}
function closeSheet(){stopCameraStream();if($('#sheet').open)$('#sheet').close()}
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),2300)}

function openQuickLog(){openSheet('Quick add','Fast actions',`<div class="quick-grid"><button class="quick-action" data-action="manual-log"><span class="icon">123</span><strong>Manual macros</strong><small>Fastest exact entry</small></button><button class="quick-action" data-action="scan-food"><span class="icon">▣</span><strong>Scan product</strong><small>Use exact nutrition</small></button><button class="quick-action" data-action="log-weight"><span class="icon">⚖</span><strong>Weight</strong><small>Track the trend</small></button><button class="quick-action" data-action="smart-shake"><span class="icon">🥤</span><strong>Generate shake</strong><small>Fill the calorie gap</small></button><button class="quick-action" data-action="open-coach"><span class="icon">✦</span><strong>Ask coach</strong><small>Get a quick answer</small></button></div>`) }

function currentGaps(){const l=getLog(),t=getTargets();return{calorieGap:Math.max(0,round(t.calories-l.calories)),proteinGap:Math.max(0,round(t.protein-l.protein))}}
function generatorDefaults(kind='meal') {
  const gaps = currentGaps();
  const isShake = kind === 'shake' || kind === 'low-volume';
  const calories = gaps.calorieGap <= 0 ? 500 : gaps.calorieGap > 1200 ? (isShake ? 800 : 700) : gaps.calorieGap;
  const protein = gaps.proteinGap <= 0 ? 25 : gaps.proteinGap > 60 ? (isShake ? 35 : 45) : gaps.proteinGap;
  return { calories, protein };
}
function openGenerator(kind='meal') {
  const gaps=currentGaps(); const defaults=generatorDefaults(kind); const isShake=kind==='shake'||kind==='low-volume';
  const productSummary = productLibrarySummary();
  const title=isShake?'Build my shake':'Build my meal';
  openSheet(title,'Personal generator',`<form class="sheet-form" id="generatorForm">
    <div class="card card-pad"><strong>Suggested portion</strong><p class="subtle">You still need ${gaps.calorieGap} kcal today, but this will build a realistic ${defaults.calories} kcal ${isShake?'shake':'meal'} instead of trying to force your whole day at once.</p></div>
    <div class="form-grid">${field('targetCalories','Target calories','number',defaults.calories)}${field('targetProtein','Target protein (g)','number',defaults.protein)}
    ${selectField('mode','Priority',kind,[['meal','Balanced meal'],['shake','Drinkable shake'],['cheap','Cheapest possible'],['low-volume','Low volume'],['school','Portable'],['fridge','Use my ingredients']])}
    ${selectField('speed','Time available','fast',[['fast','Under 10 minutes'],['normal','Up to 25 minutes'],['prep','Meal prep is okay']])}
    ${areaField('ingredients','Ingredients available',kind==='fridge'?productSummary:'','Leave blank and BulkMind will choose')}
    ${productSummary?`<div class="card card-pad full"><strong>Saved products available</strong><p class="subtle">${escapeHTML(productSummary)}</p></div>`:''}
    <div class="field full"><label for="request">Anything else?</label><textarea id="request" name="request" placeholder="Example: no protein powder, make it sweet, I need to take it to school"></textarea></div></div>
    <div class="form-actions"><button type="button" class="primary full" data-action="submit-generator">Generate for me</button><p class="privacy-note">${state.settings.geminiKey?'Gemini AI is connected.':'No API key: the smart local generator will be used.'}</p></div></form>`);
}
async function submitGenerator(){const form=$('#generatorForm');if(!form)return;const data=Object.fromEntries(new FormData(form));openSheet('Creating it','Using your real context',`<div class="loading"><div><div class="spinner" style="margin:0 auto 14px"></div><p class="subtle">Matching calories, protein, preferences and restrictions…</p></div></div>`);try{const food=state.settings.geminiKey?await generateWithGemini(data):generateLocalFood(data);state.generatedFoods.unshift(food);state.generatedFoods=state.generatedFoods.slice(0,30);await saveState();openSheet(food.name,food.source==='gemini'?'Generated by Gemini':'Smart local generator',foodCardHTML(food));}catch(err){console.error(err);const fallback=generateLocalFood(data);state.generatedFoods.unshift(fallback);await saveState();openSheet(fallback.name,'AI failed — local result ready',`<div class="card card-pad"><p class="subtle">Gemini could not answer, so BulkMind made a local version instead.</p></div>${foodCardHTML(fallback)}`)}}

const INGREDIENTS={
  milk:{name:'whole milk',unit:'ml',step:100,kcal:64,p:3.3,c:4.8,f:3.6},oats:{name:'oats',unit:'g',step:20,kcal:76,p:2.6,c:12.4,f:1.4},banana:{name:'banana',unit:'piece',step:1,kcal:105,p:1.3,c:27,f:.3},pb:{name:'peanut butter',unit:'g',step:15,kcal:90,p:3.8,c:3,f:7.5},honey:{name:'honey',unit:'g',step:15,kcal:46,p:0,c:12.4,f:0},skyr:{name:'skyr',unit:'g',step:100,kcal:64,p:11,c:4,f:.2},oil:{name:'olive oil',unit:'tbsp',step:1,kcal:119,p:0,c:0,f:13.5},rice:{name:'cooked rice',unit:'g',step:100,kcal:130,p:2.7,c:28,f:.3},chicken:{name:'cooked chicken',unit:'g',step:100,kcal:165,p:31,c:0,f:3.6},eggs:{name:'eggs',unit:'piece',step:1,kcal:78,p:6.3,c:.6,f:5.3},pasta:{name:'cooked pasta',unit:'g',step:100,kcal:158,p:5.8,c:31,f:.9},bread:{name:'bread',unit:'slice',step:1,kcal:95,p:3.5,c:17,f:1.2},cheese:{name:'cheese',unit:'g',step:20,kcal:80,p:5,c:.3,f:6.5},yogurt:{name:'Greek yogurt',unit:'g',step:100,kcal:97,p:9,c:3.9,f:5},tuna:{name:'tuna',unit:'g',step:100,kcal:116,p:26,c:0,f:1}
};
function generateLocalFood(data){const mode=data.mode||'meal',target=clamp(Number(data.targetCalories)||700,250,1400),proteinTarget=clamp(Number(data.targetProtein)||35,10,100);return mode==='shake'||mode==='low-volume'?buildLocalShake(target,proteinTarget,data):buildLocalMeal(target,proteinTarget,data)}
function addIngredient(result,key,mult=1){const item=INGREDIENTS[key];const amount=item.step*mult;result.ingredients.push({item:item.name,amount:`${round(amount,amount<10?1:0)} ${item.unit}`});result.calories+=item.kcal*mult;result.protein+=item.p*mult;result.carbs+=item.c*mult;result.fat+=item.f*mult}
function buildLocalShake(target,proteinTarget,data){
  const r={id:uid(),type:'shake',source:'local',name:data.mode==='low-volume'?'Low-volume calorie rescue':'Personal bulk shake',summary:`Built near ${target} kcal for your current gap`,calories:0,protein:0,carbs:0,fat:0,ingredients:[],instructions:['Add liquid first, then dry ingredients.','Blend for 40–60 seconds. Add water if it is too thick.'],timing:'After training, after school or before bed',usedProducts:[],missingProducts:[]};
  const milk=chooseProduct('milk',{preferShake:true});
  const yogurt=chooseProduct('skyr-yogurt',{preferShake:true});
  const protein=chooseProduct('protein-powder',{preferShake:true});
  const oats=chooseProduct('oats',{preferShake:true});
  const pb=chooseProduct('peanut-butter',{preferShake:true});
  if(!addProductIngredient(r,milk,400)){addIngredient(r,'milk',4); if(productsNeedingNutritionFor('milk').length) r.missingProducts.push(...productsNeedingNutritionFor('milk'));}
  if(protein && proteinTarget>35) addProductIngredient(r,protein,protein.defaultAmount||30);
  if(!protein && yogurt && proteinTarget>25) addProductIngredient(r,yogurt,200); else if(!protein) addIngredient(r,'skyr',1);
  addIngredient(r,'banana',1);
  while(r.protein<proteinTarget-5&&r.calories<target-120){ if(yogurt) addProductIngredient(r,yogurt,150); else addIngredient(r,'skyr',1); }
  while(r.calories<target-150){ if(oats) addProductIngredient(r,oats,40); else addIngredient(r,'oats',1); }
  while(r.calories<target-60){ if(pb) addProductIngredient(r,pb,20); else addIngredient(r,'pb',1); }
  if(r.calories<target-30)addIngredient(r,data.mode==='low-volume'?'oil':'honey',1);
  r.missingProducts=[...new Set(r.missingProducts)];
  normalizeFood(r);
  const usedNames=(r.usedProducts||[]).map(id=>findProduct(id)?.name).filter(Boolean);
  r.why=`It targets your remaining calories without forcing another full meal. ${usedNames.length?`I used your saved products: ${usedNames.join(', ')}.`:''} ${state.profile.appetite==='low'?'Liquid calories should be easier with your low appetite.':''}`;
  if(!r.shoppingNote && usedNames.length) r.shoppingNote='I reused the products you normally save/use. Add prices to compare cheaper alternatives automatically.';
  return r
}
function buildLocalMeal(target,proteinTarget,data){
  const text=`${data.ingredients||''} ${state.profile.likedFoods||''}`.toLowerCase();let template;if(data.mode==='school')template=['bread','chicken','cheese','yogurt'];else if(text.includes('pasta'))template=['pasta','chicken','cheese','oil'];else if(text.includes('egg'))template=['eggs','bread','cheese','milk'];else template=['rice','chicken','eggs','oil'];
  const r={id:uid(),type:'meal',source:'local',name:data.mode==='cheap'?'Budget power bowl':data.mode==='school'?'Portable protein meal':'Balanced calorie-gap meal',summary:`Fast meal matched near ${target} kcal`,calories:0,protein:0,carbs:0,fat:0,ingredients:[],instructions:['Prepare the main carb and protein.','Combine, season to taste and add the calorie-dense topping last.'],timing:data.mode==='school'?'Pack it for school or work':'Lunch, dinner or post-workout',usedProducts:[],missingProducts:[]};
  for(const key of template){ const product=chooseProduct(key,{preferShake:false}); if(!addProductIngredient(r,product,product?.defaultAmount||100)) addIngredient(r,key,1); }
  while(r.protein<proteinTarget-4&&r.calories<target-140){ const key=template.includes('chicken')?'chicken':'eggs'; const product=chooseProduct(key); if(!addProductIngredient(r,product,(product?.defaultAmount||100)/2)) addIngredient(r,key,.5); }
  while(r.calories<target-100){ const key=template.includes('rice')?'rice':template.includes('pasta')?'pasta':'bread'; const product=chooseProduct(key); if(!addProductIngredient(r,product,product?.defaultAmount||100)) addIngredient(r,key,1); }
  if(r.calories<target-35)addIngredient(r,'oil',.5);
  normalizeFood(r);
  const usedNames=(r.usedProducts||[]).map(id=>findProduct(id)?.name).filter(Boolean);
  r.why=`This uses simple foods, keeps preparation low and closes most of your current macro gap. ${usedNames.length?`I used your saved product memory: ${usedNames.join(', ')}.`:''}`;
  if(!r.shoppingNote && usedNames.length) r.shoppingNote='Add prices to saved products and BulkMind can recommend cheaper alternatives when you shop.';
  return r
}
function normalizeFood(food){for(const k of ['calories','protein','carbs','fat'])food[k]=round(food[k],k==='calories'?0:1);return food}
async function generateWithGemini(data){
  const p=state.profile,t=getTargets(),g=currentGaps();
  const prompt=`You are the food engine inside BulkMind. Create ONE realistic ${data.mode==='shake'||data.mode==='low-volume'?'shake':'meal'} for this exact user.\nUser: ${JSON.stringify({age:p.age,height:p.height,currentWeight:p.currentWeight,targetWeight:p.targetWeight,goal:p.goalType,appetite:p.appetite,budget:p.budget,restrictions:p.restrictions,likedFoods:p.likedFoods,dislikedFoods:p.dislikedFoods,schedule:p.schedule})}
Saved product memory with exact nutrition/history and real saved Danish prices: ${JSON.stringify((state.products||[]).slice().sort(productSort).map(x=>({id:x.id,name:x.name,brand:x.brand,category:x.category,unit:x.unit,defaultAmount:x.defaultAmount,per100:x.per100,barcode:x.barcode,preferredForShakes:!!x.preferredForShakes,usageCount:x.usageCount||0,lastUsed:x.lastUsed||null,pricePer100:x.pricePer100||0,incomplete:isProductIncomplete(x)})).slice(0,30))}. Rules for product memory: use preferred/recently-used saved products by default for milk, protein powder, skyr/yogurt, oats and peanut butter. If a matching saved product has incomplete nutrition, do NOT invent exact macros for it; add it to missingProducts and ask the user to scan/send a nutrition label. If a cheaper saved alternative exists in the same category, include it in shoppingNote. Prioritize actual saved products/prices over generic ingredients. If price/nutrition is missing, ask for a label/receipt photo rather than inventing exact numbers.\nDaily targets: ${JSON.stringify(t)}\nCurrent gaps: ${JSON.stringify(g)}\nRequested target: ${data.targetCalories} kcal and ${data.targetProtein} g protein. Mode: ${data.mode}. Time: ${data.speed}. Available ingredients: ${data.ingredients||'not specified'}. Extra request: ${data.request||'none'}.\nReturn ONLY valid JSON with this shape: {"name":"","summary":"","calories":0,"protein":0,"carbs":0,"fat":0,"usedProducts":["saved product id if used"],"missingProducts":["product/category needing nutrition label"],"shoppingNote":"short note or blank","ingredients":[{"item":"","amount":""}],"instructions":[""],"timing":"","why":""}. Keep macros realistic, ingredient quantities precise, halal-friendly when relevant, and do not claim medical certainty.`;
  const json=await geminiRequest(prompt,true);const food=typeof json==='string'?JSON.parse(stripJSON(json)):json;const normalized=normalizeFood({id:uid(),type:data.mode==='shake'||data.mode==='low-volume'?'shake':'meal',source:'gemini',...food});normalized.usedProducts=(normalized.usedProducts||[]).filter(id=>findProduct(id));normalized.missingProducts=[...new Set([...(normalized.missingProducts||[]),...productsNeedingNutritionFor(JSON.stringify(normalized.ingredients||[]))])];if(!normalized.shoppingNote&&normalized.usedProducts?.length){const note=normalized.usedProducts.map(id=>betterProductSuggestion(findProduct(id))).filter(Boolean)[0];if(note) normalized.shoppingNote=note;}return normalized;
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


function inferProductCategory(text=''){
  const s=String(text).toLowerCase();
  if(/whey|protein|pulver|powder/.test(s)) return 'protein-powder';
  if(/mælk|milk|kakao|chocolate milk|proteinmælk/.test(s)) return 'milk';
  if(/skyr|yogurt|yoghurt|kvark|greek/.test(s)) return 'skyr-yogurt';
  if(/oat|havre|gryn/.test(s)) return 'oats';
  if(/peanut|jordnød|nøddecreme/.test(s)) return 'peanut-butter';
  if(/banana|banan/.test(s)) return 'banana';
  if(/olive|oil|olie/.test(s)) return 'oil';
  if(/rice|ris/.test(s)) return 'rice';
  if(/chicken|kylling/.test(s)) return 'chicken';
  if(/egg|æg/.test(s)) return 'eggs';
  if(/pasta/.test(s)) return 'pasta';
  if(/bread|toast|brød|bolle/.test(s)) return 'bread';
  if(/cheese|ost/.test(s)) return 'cheese';
  return 'other';
}
function productCategoryOptions(){return [['milk','Milk / drink'],['protein-powder','Protein powder'],['skyr-yogurt','Skyr / yogurt'],['oats','Oats'],['peanut-butter','Peanut butter'],['banana','Banana'],['oil','Oil'],['rice','Rice'],['chicken','Chicken'],['eggs','Eggs'],['pasta','Pasta'],['bread','Bread'],['cheese','Cheese'],['other','Other']]}
function isProductIncomplete(product){
  const p=product?.per100||{};
  return !(Number(p.calories)>0) || (Number(p.protein)===0 && Number(p.carbs)===0 && Number(p.fat)===0);
}
function pricePer100(product){
  const price=Number(product.pricePackage||product.price||0), amount=Number(product.packageAmount||0);
  if(price>0 && amount>0) return price/amount*100;
  return Number(product.pricePer100)||0;
}
function chooseProduct(category,{preferShake=false, allowIncomplete=false}={}){
  const cats=Array.isArray(category)?category:[category];
  const matches=(state.products||[]).filter(p=>cats.includes(p.category||inferProductCategory(`${p.name} ${p.brand}`)) && (allowIncomplete || !isProductIncomplete(p)));
  if(!matches.length) return null;
  return matches.sort((a,b)=>
    Number(preferShake&&b.preferredForShakes)-Number(preferShake&&a.preferredForShakes) ||
    Number(b.usageCount||0)-Number(a.usageCount||0) ||
    String(b.lastUsed||'').localeCompare(String(a.lastUsed||'')) ||
    Number(a.pricePer100||9999)-Number(b.pricePer100||9999)
  )[0];
}
function betterProductSuggestion(product){
  if(!product) return '';
  const cat=product.category||inferProductCategory(product.name);
  const currentPrice=pricePer100(product);
  const alternatives=(state.products||[]).filter(p=>p.id!==product.id && (p.category||inferProductCategory(p.name))===cat && !isProductIncomplete(p) && pricePer100(p)>0);
  if(currentPrice>0){
    const cheaper=alternatives.filter(p=>pricePer100(p)<currentPrice*.92).sort((a,b)=>pricePer100(a)-pricePer100(b))[0];
    if(cheaper) return `Next time you shop, ${cheaper.name} looks cheaper than ${product.name} (${round(pricePer100(cheaper),2)} vs ${round(currentPrice,2)} kr/100${product.unit}).`;
  }
  if(!currentPrice) return `Add the price for ${product.name} and BulkMind can compare it against future products when you shop.`;
  return '';
}
function recordProductUsage(productId,{amount=null, context='used'}={}){
  const p=findProduct(productId); if(!p) return;
  p.usageCount=Number(p.usageCount||0)+1;
  p.lastUsed=new Date().toISOString();
  if(context==='shake') p.shakeUseCount=Number(p.shakeUseCount||0)+1;
  if(amount) p.lastAmount=amount;
}
function recordProductUsageFromFood(food){
  const ids=new Set(food.usedProducts||[]);
  const text=JSON.stringify(food.ingredients||[]).toLowerCase();
  for(const p of state.products||[]) if(text.includes(String(p.name||'').toLowerCase())) ids.add(p.id);
  ids.forEach(id=>recordProductUsage(id,{context:food.type==='shake'?'shake':'meal'}));
}
function addProductIngredient(result, product, amount){
  if(!product || isProductIncomplete(product)) return false;
  amount=Number(amount||product.defaultAmount||100);
  const factor=amount/100;
  result.ingredients.push({item:product.name,amount:`${round(amount)} ${product.unit||'g'}`,productId:product.id});
  result.usedProducts ||= [];
  if(!result.usedProducts.includes(product.id)) result.usedProducts.push(product.id);
  result.calories += Number(product.per100.calories||0)*factor;
  result.protein += Number(product.per100.protein||0)*factor;
  result.carbs += Number(product.per100.carbs||0)*factor;
  result.fat += Number(product.per100.fat||0)*factor;
  const note=betterProductSuggestion(product);
  if(note) result.shoppingNote = result.shoppingNote ? `${result.shoppingNote} ${note}` : note;
  return true;
}
function productsNeedingNutritionFor(text){
  const s=String(text||'').toLowerCase();
  return (state.products||[]).filter(p=>isProductIncomplete(p) && (s.includes(String(p.name).toLowerCase()) || s.includes(p.category||''))).map(p=>p.name).slice(0,3);
}
function productLibrarySummary(limit=12){
  const products=(state.products||[]).slice().sort(productSort).slice(0,limit);
  if(!products.length) return '';
  return products.map(p=>{
    const price=p.pricePer100?`, ${round(p.pricePer100,2)} kr/100${p.unit}`:'';
    const memory=p.usageCount?`, used ${p.usageCount}×${p.preferredForShakes?' and preferred':''}`:(p.preferredForShakes?', preferred':'');
    const missing=isProductIncomplete(p)?', nutrition incomplete — ask user for label photo':'';
    return `${p.name}${p.brand?` (${p.brand})`:''} [${p.category||inferProductCategory(p.name)}]: ${round(p.per100.calories)} kcal, ${round(p.per100.protein,1)}g protein, ${round(p.per100.carbs,1)}g carbs, ${round(p.per100.fat,1)}g fat per 100${p.unit||'g'}${price}${memory}${missing}`;
  }).join('; ');
}
function productSort(a,b){
  return Number(b.preferredForShakes||0)-Number(a.preferredForShakes||0) || Number(b.usageCount||0)-Number(a.usageCount||0) || String(b.lastUsed||'').localeCompare(String(a.lastUsed||''));
}
function productStatusText(p){
  if(isProductIncomplete(p)) return 'Needs label photo';
  if(p.preferredForShakes) return 'Used automatically in shakes';
  if(p.usageCount) return `Used ${p.usageCount}×`;
  return 'Saved for later';
}
function productCardHTML(product){
  const p=sanitizeProduct({...product});
  const price=p.pricePer100?`${round(p.pricePer100,2)} kr /100${escapeHTML(p.unit)}`:'Add price to compare';
  const status=isProductIncomplete(p)?'warn':'good';
  return `<article class="food-card card"><div class="food-top"><div class="food-title"><strong>${escapeHTML(p.name)}</strong><span>${escapeHTML(p.brand || p.source || 'Saved product')}</span></div><span class="pill ${status}">${escapeHTML(productStatusText(p))}</span></div><div class="food-macros"><div><strong>${round(p.per100.calories)}</strong><span>kcal /100${escapeHTML(p.unit||'g')}</span></div><div><strong>${round(p.per100.protein,1)}g</strong><span>protein</span></div><div><strong>${round(p.per100.carbs,1)}g</strong><span>carbs</span></div><div><strong>${round(p.per100.fat,1)}g</strong><span>fat</span></div></div><div class="product-memory"><span>${escapeHTML(cap(p.category||'other'))}</span><span>${escapeHTML(price)}</span><span>${p.lastUsed?`Last used ${escapeHTML(new Date(p.lastUsed).toLocaleDateString())}`:'Not used yet'}</span></div>${isProductIncomplete(p)?`<div class="missing-box"><strong>Nutrition missing</strong><p class="subtle">BulkMind cannot use this properly yet. Send a photo of the nutrition table and it will complete the product.</p><button class="secondary full" data-action="complete-product" data-id="${p.id}">Add nutrition photo</button></div>`:''}<div class="food-actions"><button class="primary" data-action="review-product" data-id="${p.id}">Use / edit</button><button class="secondary" data-action="prefer-product" data-id="${p.id}">${p.preferredForShakes?'Preferred ✓':'Prefer in shakes'}</button></div><div class="row between"><button class="link-button" data-action="ask-product" data-id="${p.id}">Ask AI compare</button><button class="link-button" data-action="delete-product" data-id="${p.id}">Remove</button></div></article>`;
}
function openScanHub(){
  openSheet('Add real product','Barcode, API or label scan',`<div class="stack">
    <div class="card card-pad"><h3>Best flow</h3><p class="subtle">For milk, protein powder and packaged foods: scan/enter the barcode first. If it is missing or wrong, take a photo of the nutrition label and Gemini will extract it.</p></div>
    <div class="quick-grid tight"><button class="quick-action" data-action="start-camera-scan"><span class="icon">📷</span><strong>Camera barcode</strong><small>Works only if browser supports it</small></button><button class="quick-action" data-action="manual-barcode"><span class="icon">▣</span><strong>Enter barcode</strong><small>Open Food Facts lookup</small></button><button class="quick-action" data-action="scan-label"><span class="icon">🧾</span><strong>Photo label</strong><small>Gemini reads nutrition</small></button><button class="quick-action" data-action="manual-product"><span class="icon">✎</span><strong>Add manually</strong><small>Fallback for anything</small></button></div>
    <p class="privacy-note">Barcodes use Open Food Facts. Label photos are sent to Gemini only when you choose that option and have an API key saved.</p>
  </div>`);
}
function openManualBarcode(){
  openSheet('Barcode lookup','Open Food Facts API',`<form id="barcodeForm" class="sheet-form"><div class="card card-pad"><p class="subtle">Use the EAN/UPC barcode number under the black lines. QR codes usually just open brand websites, but normal food barcodes are what nutrition databases use.</p></div>${field('barcode','Barcode number','text','','Example: 5711953001234')}<div class="form-actions"><button type="button" class="primary full" data-action="lookup-barcode">Find product</button></div></form>`);
}
async function lookupBarcodeFromForm(){
  const code=String($('#barcode')?.value||'').replace(/\D/g,'');
  if(!code || code.length<6){toast('Enter a valid barcode');return}
  openSheet('Searching product','Open Food Facts',`<div class="loading"><div><div class="spinner" style="margin:0 auto 14px"></div><p class="subtle">Looking up barcode ${escapeHTML(code)}…</p></div></div>`);
  try{ const product=await fetchOpenFoodFacts(code); reviewProduct(product,'Found in Open Food Facts'); }
  catch(err){ console.warn(err); openSheet('Product not found','Add another way',`<div class="card card-pad"><h3>Could not find that barcode</h3><p class="subtle">Try a nutrition label photo with Gemini, or add the numbers manually from the back of the product.</p></div><div class="quick-grid tight"><button class="quick-action" data-action="scan-label"><span class="icon">🧾</span><strong>Photo label</strong><small>Use Gemini OCR</small></button><button class="quick-action" data-action="manual-product"><span class="icon">✎</span><strong>Add manually</strong><small>Type per 100g/ml</small></button></div>`); }
}
async function fetchOpenFoodFacts(barcode){
  const url=`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=product_name,brands,nutriments,quantity,serving_size,categories,code`;
  const res=await fetch(url,{headers:{'Accept':'application/json'}});
  if(!res.ok) throw new Error('Product API failed');
  const data=await res.json();
  if(data.status!==1 || !data.product) throw new Error('Product not found');
  return productFromOpenFoodFacts(data.product,barcode);
}
function productFromOpenFoodFacts(raw,barcode){
  const n=raw.nutriments||{};
  const name=raw.product_name||`Barcode ${barcode}`;
  const unit=inferProductUnit(`${name} ${raw.categories||''} ${raw.quantity||''}`);
  const packageAmount=inferPackageAmount(raw.quantity||raw.serving_size||'',unit);
  const product={id:uid(),type:'product',source:'openfoodfacts',name,brand:raw.brands||'',barcode,unit,category:inferProductCategory(`${name} ${raw.brands||''} ${raw.categories||''}`),defaultAmount:inferDefaultAmount(name,unit),packageAmount,per100:{
    calories:Number(n['energy-kcal_100g'] ?? n['energy-kcal'] ?? 0),
    protein:Number(n['proteins_100g'] ?? 0),
    carbs:Number(n['carbohydrates_100g'] ?? 0),
    fat:Number(n['fat_100g'] ?? 0)
  }};
  return sanitizeProduct(product);
}
function inferPackageAmount(text='',unit='g'){
  const s=String(text).toLowerCase().replace(',', '.');
  const m=s.match(/(\d+(?:\.\d+)?)\s*(l|liter|litre|ml|kg|g)/);
  if(!m) return 0; const n=Number(m[1]); const u=m[2];
  if(u==='l'||u==='liter'||u==='litre') return unit==='ml'?n*1000:n*1000;
  if(u==='kg') return n*1000; if(u==='ml'||u==='g') return n; return 0;
}
function inferProductUnit(text=''){text=String(text).toLowerCase();return /(milk|mælk|drink|juice|soda|water|ml|liter|litre|shake|kakao)/.test(text)?'ml':'g'}
function inferDefaultAmount(name='',unit='g'){const s=String(name).toLowerCase();if(/protein|whey|pulver|powder/.test(s))return 30;if(unit==='ml')return 250;if(/skyr|yogurt|yoghurt|kvark/.test(s))return 200;return 100}
function sanitizeProduct(p){
  p.name=String(p.name||'Saved product').trim(); p.brand=String(p.brand||'').trim(); p.unit=p.unit==='ml'?'ml':'g'; p.category=p.category||inferProductCategory(`${p.name} ${p.brand}`); p.defaultAmount=clamp(Number(p.defaultAmount)||inferDefaultAmount(p.name,p.unit),1,2000);
  p.per100={calories:clamp(Number(p.per100?.calories)||0,0,900),protein:clamp(Number(p.per100?.protein)||0,0,100),carbs:clamp(Number(p.per100?.carbs)||0,0,100),fat:clamp(Number(p.per100?.fat)||0,0,100)};
  p.packageAmount=clamp(Number(p.packageAmount)||0,0,100000); p.pricePackage=clamp(Number(p.pricePackage)||0,0,100000); p.pricePer100=pricePer100(p); p.retailer=String(p.retailer||''); p.priceSource=String(p.priceSource||''); p.lastPriceCheck=p.lastPriceCheck||null; p.usageCount=Number(p.usageCount||0); p.shakeUseCount=Number(p.shakeUseCount||0); p.preferredForShakes=!!p.preferredForShakes; p.lastUsed=p.lastUsed||null; p.notes=String(p.notes||'');
  return p;
}
function reviewProduct(product,eyebrow='Review product'){
  pendingProduct=sanitizeProduct(product);
  const missing=isProductIncomplete(pendingProduct);
  openSheet(pendingProduct.name,eyebrow,`<form id="productPortionForm" class="sheet-form"><div class="food-card card"><div class="food-top"><div class="food-title"><strong>${escapeHTML(pendingProduct.name)}</strong><span>${escapeHTML(pendingProduct.brand || pendingProduct.source)}</span></div><span class="pill ${missing?'warn':'good'}">${missing?'needs nutrition':`per 100${escapeHTML(pendingProduct.unit)}`}</span></div><div class="food-macros"><div><strong>${round(pendingProduct.per100.calories)}</strong><span>kcal</span></div><div><strong>${round(pendingProduct.per100.protein,1)}g</strong><span>protein</span></div><div><strong>${round(pendingProduct.per100.carbs,1)}g</strong><span>carbs</span></div><div><strong>${round(pendingProduct.per100.fat,1)}g</strong><span>fat</span></div></div></div>${missing?`<div class="missing-box"><strong>I need the nutrition table</strong><p class="subtle">This product can be saved now, but BulkMind will not use it accurately in shakes until calories/protein/carbs/fat are added.</p><button type="button" class="secondary full" data-action="scan-label">Send label photo</button></div>`:''}<div class="form-grid">${field('portionAmount',`Portion (${pendingProduct.unit})`,'number',pendingProduct.defaultAmount,'Example: milk 250 ml, protein powder 30 g')}${selectField('productCategory','Category',pendingProduct.category||'other',productCategoryOptions())}${field('pricePackage','Price paid (kr)','number',pendingProduct.pricePackage||'','Optional, used for cheaper shopping suggestions')}${field('packageAmount',`Package size (${pendingProduct.unit})`,'number',pendingProduct.packageAmount||'','Example: 1000 ml or 900 g')}<label class="check-row full"><input type="checkbox" id="preferredForShakes" name="preferredForShakes" ${pendingProduct.preferredForShakes?'checked':''}> <span>Use this automatically in my bulk shakes when it fits</span></label>${areaField('productNotes','Notes',pendingProduct.notes||'','Example: tastes good, too expensive, bought in Netto')}</div><div class="food-actions"><button type="button" class="primary" data-action="save-product-from-review">Save to Product Memory</button><button type="button" class="secondary" data-action="add-product-portion">Add portion to today</button></div></form>`);
}
function productPortionFood(product,amount){
  const factor=Number(amount)/100; const p=sanitizeProduct(product);
  return {id:uid(),type:'product',source:p.source||'product',name:`${round(amount)}${p.unit} ${p.name}`,summary:`Logged from saved product`,calories:p.per100.calories*factor,protein:p.per100.protein*factor,carbs:p.per100.carbs*factor,fat:p.per100.fat*factor,usedProducts:p.id?[p.id]:[],ingredients:[`${round(amount)} ${p.unit} ${p.name}${p.brand?` (${p.brand})`:''}`],instructions:[],timing:'Logged product'};
}
function updatePendingProductFromReviewForm(){
  if(!pendingProduct) return null;
  const form=$('#productPortionForm'); if(!form) return pendingProduct;
  const data=Object.fromEntries(new FormData(form));
  pendingProduct.category=data.productCategory || pendingProduct.category || inferProductCategory(pendingProduct.name);
  pendingProduct.pricePackage=Number(data.pricePackage)||0;
  pendingProduct.packageAmount=Number(data.packageAmount)||0;
  pendingProduct.pricePer100=pricePer100(pendingProduct);
  pendingProduct.preferredForShakes=!!$('#preferredForShakes')?.checked;
  pendingProduct.notes=data.productNotes || '';
  pendingProduct.defaultAmount=Number(data.portionAmount)||pendingProduct.defaultAmount;
  return sanitizeProduct(pendingProduct);
}
function addProductPortion(id){
  let product=id?findProduct(id):updatePendingProductFromReviewForm(); if(!product){toast('No product selected');return}
  const amount=Number($('#portionAmount')?.value || product.defaultAmount || 100); if(!(amount>0)){toast('Enter a portion amount');return}
  addEntry(normalizeFood(productPortionFood(product,amount))); closeSheet();
}
async function saveProductFromReview(){
  if(!pendingProduct){toast('No product to save');return}
  pendingProduct=updatePendingProductFromReviewForm() || sanitizeProduct(pendingProduct);
  state.products ||= [];
  const key=pendingProduct.barcode || `${pendingProduct.name}|${pendingProduct.brand}`.toLowerCase();
  const existing=state.products.findIndex(p=>(p.barcode&&p.barcode===pendingProduct.barcode) || (`${p.name}|${p.brand}`.toLowerCase()===key) || (pendingProduct.id&&p.id===pendingProduct.id));
  if(existing>=0) state.products[existing]=sanitizeProduct({...state.products[existing],...pendingProduct,id:state.products[existing].id}); else state.products.unshift(sanitizeProduct(pendingProduct));
  state.products=state.products.slice(0,80); await saveState(); toast(isProductIncomplete(pendingProduct)?'Product saved — add nutrition when ready':'Product saved to memory'); render();
}
function findProduct(id){return (state.products||[]).find(p=>p.id===id)}
function reviewSavedProduct(id){const product=findProduct(id); if(product) reviewProduct(product,'Saved product')}
async function deleteProduct(id){state.products=(state.products||[]).filter(p=>p.id!==id); await saveState(); render(); toast('Product removed')}
async function togglePreferredProduct(id){
  const product=findProduct(id); if(!product) return;
  product.preferredForShakes=!product.preferredForShakes; product.category=product.category||inferProductCategory(product.name);
  await saveState(); render(); toast(product.preferredForShakes?'Will use it in shakes':'Preference removed');
}
function completeProductNutrition(id){
  const product=findProduct(id); if(!product){toast('Product not found');return}
  pendingProduct=sanitizeProduct({...product}); pendingLabelProductId=product.id; openLabelScan(product.id);
}
function openProductCoach(id){
  const product=findProduct(id); if(!product) return;
  const same=(state.products||[]).filter(p=>p.id!==id && (p.category||inferProductCategory(p.name))===(product.category||inferProductCategory(product.name)));
  const question=`Compare this product for my bulk and tell me if I should keep using it in shakes or buy a cheaper/better alternative next time. Product: ${JSON.stringify(product)}. Same-category saved products: ${JSON.stringify(same)}.`;
  openCoach(question);
}
function openManualProduct(){
  openSheet('Add product manually','Per 100g/ml from label',`<form id="manualProductForm" class="sheet-form"><div class="form-grid">${field('productName','Product name','text',pendingProduct?.name||'Letmælk / whey / skyr','', 'full')}${field('productBrand','Brand','text',pendingProduct?.brand||'')}${selectField('productUnit','Unit',pendingProduct?.unit||'g',[['g','grams'],['ml','ml']])}${selectField('productCategory','Category',pendingProduct?.category||'other',productCategoryOptions())}${field('defaultAmount','Default portion','number',pendingProduct?.defaultAmount||'100')}${field('pricePackage','Price paid (kr)','number',pendingProduct?.pricePackage||'')}${field('packageAmount','Package size','number',pendingProduct?.packageAmount||'')}${field('calories100','Calories per 100','number',pendingProduct?.per100?.calories||'')}${field('protein100','Protein per 100','number',pendingProduct?.per100?.protein||'')}${field('carbs100','Carbs per 100','number',pendingProduct?.per100?.carbs||'')}${field('fat100','Fat per 100','number',pendingProduct?.per100?.fat||'')}</div><label class="check-row"><input type="checkbox" id="manualPreferred" ${pendingProduct?.preferredForShakes?'checked':''}> <span>Use automatically in bulk shakes</span></label><div class="form-actions"><button type="button" class="primary full" data-action="save-product-manual">Save product</button></div></form>`);
}
async function saveManualProduct(){
  const data=Object.fromEntries(new FormData($('#manualProductForm')));
  const product=sanitizeProduct({id:pendingProduct?.id||uid(),type:'product',source:'manual',name:data.productName,brand:data.productBrand,unit:data.productUnit,category:data.productCategory,defaultAmount:data.defaultAmount,pricePackage:data.pricePackage,packageAmount:data.packageAmount,preferredForShakes:!!$('#manualPreferred')?.checked,per100:{calories:data.calories100,protein:data.protein100,carbs:data.carbs100,fat:data.fat100}});
  pendingProduct=product; await saveProductFromReview(); reviewProduct(product,'Manual product saved');
}
function openLabelScan(productId=null){
  if(productId) pendingLabelProductId=productId;
  const product=pendingLabelProductId?findProduct(pendingLabelProductId):pendingProduct;
  openSheet('Scan nutrition label','Gemini vision OCR',`<div class="stack"><div class="card card-pad"><h3>${product?`Complete ${escapeHTML(product.name)}`:'Take a clear photo of the nutrition table'}</h3><p class="subtle">Make sure calories, protein, carbs and fat per 100g/ml are visible. This needs your Gemini key. If the barcode/API was missing data, this completes the saved product so it can be used automatically later.</p></div><input id="labelPhoto" class="input" type="file" accept="image/*" capture="environment"><button class="primary full" data-action="process-label-photo">Extract nutrition</button><button class="secondary full" data-action="manual-product">Type it manually instead</button></div>`);
}
async function processLabelPhoto(){
  const file=$('#labelPhoto')?.files?.[0]; if(!file){toast('Choose a photo first');return} if(!state.settings.geminiKey){toast('Add Gemini key first');return}
  openSheet('Reading label','Gemini vision',`<div class="loading"><div><div class="spinner" style="margin:0 auto 14px"></div><p class="subtle">Extracting nutrition facts from the photo…</p></div></div>`);
  try{
    const prompt='Read this nutrition label. Return ONLY JSON: {"name":"product name if visible or generic","brand":"brand if visible or blank","unit":"g or ml","defaultAmount":100,"per100":{"calories":number,"protein":number,"carbs":number,"fat":number},"note":"short uncertainty note"}. Use per 100g or per 100ml values. If the label shows kJ only, convert kcal = kJ / 4.184. If unsure, set the note but still return best numeric estimates.';
    const ai=await geminiVisionRequest(prompt,file,true);
    const base=pendingLabelProductId?findProduct(pendingLabelProductId):(pendingProduct||{});
    const product=sanitizeProduct({...base,id:base.id||uid(),type:'product',source:base.source?`${base.source}+gemini-label`:'gemini-label',name:base.name||ai.name||'Scanned product',brand:base.brand||ai.brand||'',unit:ai.unit||base.unit||'g',defaultAmount:ai.defaultAmount||base.defaultAmount||100,per100:ai.per100||ai});
    pendingLabelProductId=null;
    reviewProduct(product,`Extracted by Gemini${ai.note?` — ${ai.note}`:''}`);
  } catch(err){console.error(err);openSheet('Could not read label','Try manual',`<div class="card card-pad"><p class="subtle">Gemini could not extract the label clearly. Try a sharper photo or enter the per-100 values manually.</p></div><button class="primary full" data-action="scan-label">Try another photo</button><button class="secondary full" data-action="manual-product">Add manually</button>`)}
}
async function geminiVisionRequest(prompt,file,wantJSON=false){
  const key=state.settings.geminiKey?.trim(); if(!key) throw new Error('No Gemini key');
  const model=state.settings.geminiModel||'gemini-2.5-flash-lite';
  const dataUrl=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(r.error);r.readAsDataURL(file)});
  const base64=dataUrl.split(',')[1];
  const res=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:prompt},{inlineData:{mimeType:file.type||'image/jpeg',data:base64}}]}],generationConfig:{temperature:.15,maxOutputTokens:900,...(wantJSON?{responseMimeType:'application/json'}:{})}})});
  if(!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const body=await res.json(); const text=body.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')?.trim(); if(!text) throw new Error('Empty AI response'); return wantJSON?JSON.parse(stripJSON(text)):text;
}
async function startBarcodeCamera(){
  if(!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia){toast('Camera barcode scan is not supported here. Use Enter barcode.');openManualBarcode();return}
  openSheet('Camera barcode','Point at the barcode',`<div class="stack"><video id="barcodeVideo" class="camera-preview" autoplay muted playsinline></video><p class="subtle">Hold the barcode steady. If it does not detect, use manual barcode entry.</p><button class="secondary full" data-action="manual-barcode">Enter barcode instead</button></div>`);
  try{
    const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}}}); pendingCameraStream=stream; const video=$('#barcodeVideo'); video.srcObject=stream; await video.play();
    const detector=new BarcodeDetector({formats:['ean_13','ean_8','upc_a','upc_e','qr_code']});
    let active=true; const loop=async()=>{ if(!active || !pendingCameraStream) return; try{ const codes=await detector.detect(video); if(codes.length){ active=false; const value=String(codes[0].rawValue||'').replace(/\D/g,''); stopCameraStream(); if(value) { openManualBarcode(); $('#barcode').value=value; lookupBarcodeFromForm(); return; } toast('That looked like a QR/link, not a food barcode. Use the number under the barcode.'); openManualBarcode(); return; } }catch{} requestAnimationFrame(loop);}; loop();
  }catch(err){console.warn(err);toast('Camera blocked. Use barcode number.');openManualBarcode()}
}
function stopCameraStream(){ if(pendingCameraStream){ pendingCameraStream.getTracks().forEach(t=>t.stop()); pendingCameraStream=null; } }

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
  <div class="card card-pad stack"><div><h3>Gemini AI</h3><p class="subtle">Required for fully custom AI answers and nutrition/price label OCR. Without it, BulkMind uses its local generator.</p></div>${field('geminiKey','Gemini API key','password',state.settings.geminiKey,'Stored only in this app on this device.','full')}${field('geminiModel','Model','text',state.settings.geminiModel,'Default: gemini-2.5-flash-lite','full')}<button class="primary full" data-action="save-settings">Save AI settings</button></div>
  <div class="card card-pad stack"><div><h3>Danish price sources</h3><p class="subtle">Optional. Salling covers Salling-owned stores when your API access works. For all other stores, use receipt/shelf-label scan or manual package prices.</p></div>${selectField('defaultStore','Default grocery store',state.settings.defaultStore||'Netto',storeOptions())}${field('sallingApiKey','Salling API key','password',state.settings.sallingApiKey||'','Optional','full')}${field('sallingStoreId','Salling store ID / zip','text',state.settings.sallingStoreId||'','Optional','full')}<button class="secondary full" data-action="open-salling-search">Test Salling lookup</button></div>
  <div class="card card-pad stack"><h3>App</h3><button class="secondary full" data-action="toggle-theme">Switch to ${state.settings.theme==='dark'?'light':'dark'} mode</button><button class="secondary full" data-action="edit-targets">Nutrition targets</button><button class="secondary full" data-action="edit-profile">Edit profile</button><button class="secondary full" data-action="install-help">Add to iPhone Home Screen</button></div>
  <div class="card card-pad stack"><h3>Your data</h3><button class="secondary full" data-action="export-data">Export backup</button><input id="importFile" type="file" accept="application/json" class="hidden"><button class="secondary full" onclick="document.getElementById('importFile').click()">Import backup</button><button class="danger-button full" data-action="reset-app">Reset app</button></div>
  <p class="privacy-note">BulkMind v11 · Data stored in IndexedDB on this device.</p></div>`)}
async function saveSettings(){state.settings.geminiKey=$('#geminiKey')?.value.trim()||'';state.settings.geminiModel=$('#geminiModel')?.value.trim()||'gemini-2.5-flash-lite';state.settings.sallingApiKey=$('#sallingApiKey')?.value.trim()||state.settings.sallingApiKey||'';state.settings.sallingStoreId=$('#sallingStoreId')?.value.trim()||state.settings.sallingStoreId||'';state.settings.defaultStore=$('#defaultStore')?.value||state.settings.defaultStore||'Netto';await saveState();toast('Settings saved');closeSheet()}
async function toggleTheme(){state.settings.theme=state.settings.theme==='dark'?'light':'dark';applyTheme();await saveState();openSettings()}

function targetPreviewHTML(targets, label='Current') {
  return `<div class="food-macros"><div><strong>${round(targets.calories)}</strong><span>kcal</span></div><div><strong>${round(targets.protein)}g</strong><span>protein</span></div><div><strong>${round(targets.carbs)}g</strong><span>carbs</span></div><div><strong>${round(targets.fat)}g</strong><span>fat</span></div></div><p class="subtle">${label} · estimated maintenance ${round(targets.maintenance)} kcal.</p>`;
}
function openTargetEditor(){
  const p=state.profile; const auto=recommendedTargets(p); const current=getTargets();
  openSheet('Nutrition targets','Change calories and macros directly',`<form id="targetForm" class="sheet-form stack">
    <div class="card card-pad stack"><div><h3>Goal planner</h3><p class="subtle">Tell BulkMind your target weight and deadline. Gemini can help explain it, but the app still validates the numbers before applying them.</p></div><button type="button" class="primary full" data-action="open-goal-planner">Plan my bulk from goal</button></div>
    <div class="card card-pad stack"><div><h3>Recommended for your bulk</h3><p class="subtle">For 60 → 84 kg, start around 3000–3400 kcal depending on deadline and weekly trend. More protein and fat makes it easier than pushing carbs crazy high.</p></div>${targetPreviewHTML(auto,'Auto target')}</div>
    <div class="card card-pad stack"><h3>Your target mode</h3>${selectField('targetMode','Mode',p.targetMode||'auto',[['auto','Automatic — app calculates it'],['custom','Custom — I choose numbers']])}<p class="subtle">Automatic changes when your weight/profile changes. Custom keeps your exact numbers.</p></div>
    <div class="form-grid">${field('customCalories','Calories','number',p.customCalories||current.calories,'Example: 3200')}${field('customProtein','Protein (g)','number',p.customProtein||130,'Example: 130')}${field('customCarbs','Carbs (g)','number',p.customCarbs||450,'Example: 450')}${field('customFat','Fat (g)','number',p.customFat||90,'Example: 90')}</div>
    <div class="card card-pad"><h3>How to judge it</h3><p class="subtle">Log morning weight 3× per week. If your weekly average does not move for 2 weeks, add 150–250 kcal. If it jumps too fast, reduce 150–250 kcal.</p></div>
    <div class="form-actions"><button type="button" class="primary full" data-action="save-targets">Save targets</button></div>
  </form>`)
}

async function saveTargets(){
  const data=Object.fromEntries(new FormData($('#targetForm')));
  state.profile=normalizeProfile({...state.profile,...data});
  await saveState(); closeSheet(); render(); toast(state.profile.targetMode==='custom'?'Custom targets saved':'Automatic targets enabled');
}

function openGoalPlanner(){
  const p=state.profile || defaultProfile;
  openSheet('AI goal planner','Set targets from your deadline',`<form id="goalPlannerForm" class="sheet-form stack">
    <div class="card card-pad"><h3>Tell me the goal</h3><p class="subtle">Example: 60 kg to 84 kg in 8 months. BulkMind will calculate calories/macros, then Gemini can explain the plan if your key is connected.</p></div>
    <div class="form-grid">
      ${field('currentWeight','Current weight (kg)','number',p.currentWeight,'')}
      ${field('targetWeight','Target weight (kg)','number',p.targetWeight || 84,'')}
      ${field('months','Deadline (months)','number',p.targetMonths || 8,'Example: 8')}
      ${selectField('goalStyle','Style','balanced',[['lean','Leanest possible'],['balanced','Balanced bulk'],['aggressive','Aggressive deadline']])}
      ${selectField('activityLevel','Activity',p.activityLevel,[['low','Mostly sitting'],['moderate','Normal student/work day'],['high','Very active'],['very-high','Physical job + training']])}
      ${field('trainingDays','Training days/week','number',p.trainingDays,'')}
    </div>
    <div class="card card-pad"><h3>What happens after</h3><p class="subtle">It will set your app to Custom targets, update your target weight/deadline, and save the plan. You can change it anytime.</p></div>
    <div class="form-actions"><button type="button" class="primary full" data-action="calculate-goal-targets">Generate & apply plan</button></div>
  </form>`)
}

async function calculateGoalTargets(){
  const form=$('#goalPlannerForm'); if(!form)return;
  const data=Object.fromEntries(new FormData(form));
  openSheet('Planning your bulk','Calculating safe targets',`<div class="loading"><div><div class="spinner" style="margin:0 auto 14px"></div><p class="subtle">Using your goal, deadline, activity, training days and saved profile…</p></div></div>`);
  try{
    const local=buildGoalPlanLocal(data);
    let plan=local;
    if(state.settings.geminiKey){
      try{ plan=await generateGoalPlanWithGemini(data, local); }
      catch(err){ console.warn(err); plan={...local, source:'local', note: local.note + ' Gemini was unavailable, so this is the validated local plan.'}; }
    }
    pendingGoalPlan=validateGoalPlan(plan, data, local);
    openSheet('Your bulk targets',pendingGoalPlan.source==='gemini'?'Gemini + safety validation':'Smart local calculation',goalPlanHTML(pendingGoalPlan));
  }catch(err){console.error(err);toast('Could not create plan')}
}

function buildGoalPlanLocal(data){
  const current=clamp(Number(data.currentWeight)||state.profile.currentWeight,30,250);
  const target=clamp(Number(data.targetWeight)||state.profile.targetWeight,30,300);
  const months=clamp(Number(data.months)||8,1,36);
  const diff=round(target-current,1);
  const weeks=months*4.345;
  const requiredWeekly=diff/weeks;
  const goalType=diff>0?'bulk':diff<0?'cut':'maintain';
  const tempProfile=normalizeProfile({...state.profile,currentWeight:current,targetWeight:target,activityLevel:data.activityLevel||state.profile.activityLevel,trainingDays:data.trainingDays||state.profile.trainingDays,goalType:goalType==='cut'?'cut':'bulk',targetMode:'auto'});
  const base=calculateTargets(tempProfile);
  let plannedWeekly=requiredWeekly;
  let warning='';
  if(goalType==='bulk'){
    if(requiredWeekly>0.75){plannedWeekly=0.75;warning=`${target} kg in ${months} months requires about ${round(requiredWeekly,2)} kg/week, which is very aggressive. I set the plan at about 0.75 kg/week and you should expect some fat gain.`}
    else if(requiredWeekly>0.5){warning=`This deadline needs about ${round(requiredWeekly,2)} kg/week. That is aggressive, so judge it by weekly averages and expect some fat gain.`}
    else if(requiredWeekly<0.2){plannedWeekly=0.25;warning='Your deadline is relaxed. I set a minimum useful surplus so progress does not stall.'}
  }
  if(goalType==='cut') plannedWeekly=Math.max(requiredWeekly,-0.75);
  const surplus=goalType==='bulk'?plannedWeekly*7700/7:plannedWeekly*7700/7;
  let calories=Math.round((base.maintenance+surplus)/25)*25;
  if(goalType==='bulk') calories=clamp(calories,base.maintenance+200,base.maintenance+900);
  if(goalType==='cut') calories=clamp(calories,1500,base.maintenance-150);
  const protein=roundTo5(clamp(current*(goalType==='cut'?2.2:2.1),100,190));
  let fat=roundTo5(clamp(current*(goalType==='bulk'?1.45:0.9),55,115));
  let carbs=Math.round((calories-protein*4-fat*9)/4);
  if(carbs>500){fat=roundTo5(Math.min(115,fat+15));carbs=Math.round((calories-protein*4-fat*9)/4)}
  if(carbs<180){fat=roundTo5(Math.max(55,fat-10));carbs=Math.round((calories-protein*4-fat*9)/4)}
  const projectedMonths=diff>0?round(diff/Math.max(plannedWeekly,.05)/4.345,1):months;
  return {source:'local',currentWeight:current,targetWeight:target,months,goalStyle:data.goalStyle||'balanced',maintenance:base.maintenance,calories,protein,carbs:Math.max(120,carbs),fat,weeklyGain:round(plannedWeekly,2),requiredWeekly:round(requiredWeekly,2),projectedMonths,warning,note:`Start here for 14 days, then adjust based on weekly average weight.`,focus:'Hit calories 5/7 days, protein daily, and train consistently.'};
}
function roundTo5(n){return Math.round(Number(n)/5)*5}
async function generateGoalPlanWithGemini(data, local){
  const prompt=`You are the target planner inside BulkMind. Create a realistic nutrition target for this user. Return JSON only. Do not give medical diagnosis. Validate against the local baseline and avoid extreme targets.\nUser profile: ${JSON.stringify(state.profile)}\nUser goal form: ${JSON.stringify(data)}\nLocal validated baseline: ${JSON.stringify(local)}\nReturn this JSON shape exactly: {"calories":number,"protein":number,"carbs":number,"fat":number,"weeklyGain":number,"warning":"string","note":"string","focus":"string"}. Keep protein in grams/day, carbs grams/day, fat grams/day. For a bulk, calories should be close to local baseline unless you have a clear reason.`;
  const ai=await geminiRequest(prompt,true);
  return {...local,...ai,source:'gemini'};
}
function validateGoalPlan(plan,data,local){
  const base=local || buildGoalPlanLocal(data);
  const maintenance=Number(base.maintenance)||calculateTargets(state.profile).maintenance;
  const calories=clamp(Number(plan.calories)||base.calories,maintenance-700,maintenance+950);
  const protein=roundTo5(clamp(Number(plan.protein)||base.protein,90,200));
  const fat=roundTo5(clamp(Number(plan.fat)||base.fat,50,125));
  let carbs=Math.round((calories-protein*4-fat*9)/4);
  if(Number(plan.carbs)>0 && Math.abs(Number(plan.carbs)-carbs)<80) carbs=round(Number(plan.carbs));
  carbs=clamp(carbs,120,560);
  return {...base,...plan,calories:round(calories),protein,carbs,fat,weeklyGain:round(clamp(Number(plan.weeklyGain)||base.weeklyGain,-0.8,0.8),2),warning:String(plan.warning||base.warning||''),note:String(plan.note||base.note||''),focus:String(plan.focus||base.focus||''),source:plan.source||base.source};
}
function goalPlanHTML(plan){
  return `<div class="stack">
    <div class="summary-target card"><p class="eyebrow">Daily target</p><strong>${plan.calories}</strong> <span>kcal</span><div class="macro-grid" style="margin-top:14px"><div class="macro-card card"><strong>${plan.protein}g</strong><span>protein</span></div><div class="macro-card card"><strong>${plan.carbs}g</strong><span>carbs</span></div><div class="macro-card card"><strong>${plan.fat}g</strong><span>fat</span></div></div></div>
    <div class="card card-pad"><h3>${plan.currentWeight} kg → ${plan.targetWeight} kg in ${plan.months} months</h3><p class="subtle">Needed pace: ${plan.requiredWeekly} kg/week. Planned pace: ${plan.weeklyGain} kg/week. Estimated timeline with this plan: ${plan.projectedMonths} months.</p></div>
    ${plan.warning?`<div class="card card-pad"><h3>Honest warning</h3><p class="subtle">${escapeHTML(plan.warning)}</p></div>`:''}
    <div class="card card-pad"><h3>Why this target</h3><p class="subtle">${escapeHTML(plan.note)}</p><p class="subtle"><strong>Focus:</strong> ${escapeHTML(plan.focus)}</p></div>
    <div class="food-actions"><button class="primary" data-action="apply-goal-targets">Apply to app</button><button class="secondary" data-action="open-goal-planner">Change goal</button></div>
  </div>`;
}
async function applyGoalTargets(){
  if(!pendingGoalPlan){toast('Generate a plan first');return}
  state.profile=normalizeProfile({...state.profile,currentWeight:pendingGoalPlan.currentWeight,targetWeight:pendingGoalPlan.targetWeight,targetMonths:pendingGoalPlan.months,targetMode:'custom',customCalories:pendingGoalPlan.calories,customProtein:pendingGoalPlan.protein,customCarbs:pendingGoalPlan.carbs,customFat:pendingGoalPlan.fat,lastGoalPlan:pendingGoalPlan});
  await saveState(); closeSheet(); render(); toast('AI goal targets applied');
}

function openProfileEditor(){const p=state.profile;openSheet('Edit profile','Recalculates targets',`<form id="profileForm" class="sheet-form"><div class="form-grid">${field('name','Name','text',p.name)}${field('age','Age','number',p.age)}${field('height','Height','number',p.height)}${field('currentWeight','Current weight','number',p.currentWeight)}${field('targetWeight','Target weight','number',p.targetWeight)}${field('trainingDays','Training days','number',p.trainingDays)}${selectField('goalType','Goal',p.goalType,[['bulk','Bulk'],['lean-bulk','Lean bulk'],['cut','Lose fat'],['strength','Strength'],['maintain','Maintain']])}${selectField('activityLevel','Activity',p.activityLevel,[['low','Low'],['moderate','Moderate'],['high','High'],['very-high','Very high']])}${field('restrictions','Food rules','text',p.restrictions,'','full')}${areaField('likedFoods','Liked foods',p.likedFoods)}${areaField('dislikedFoods','Disliked foods',p.dislikedFoods)}</div><div class="form-actions"><button type="button" class="primary full" id="saveProfileButton">Save profile</button></div></form>`);$('#saveProfileButton').addEventListener('click',async()=>{const data=Object.fromEntries(new FormData($('#profileForm')));state.profile=normalizeProfile({...state.profile,...data});await saveState();closeSheet();render();toast('Profile updated')})}
function openInstallHelp(){openSheet('Add to Home Screen','iPhone Safari',`<div class="stack"><div class="card card-pad"><h3>1. Open the Vercel link in Safari</h3><p class="subtle">This does not work the same way from an in-app browser.</p></div><div class="card card-pad"><h3>2. Tap Share ↑</h3><p class="subtle">Scroll down and choose “Add to Home Screen”.</p></div><div class="card card-pad"><h3>3. Keep “Open as Web App” enabled</h3><p class="subtle">Then tap Add. BulkMind will launch without Safari controls.</p></div></div>`)}
function exportData(){const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`bulkmind-backup-${todayISO()}.json`;a.click();URL.revokeObjectURL(a.href)}
async function importData(file){if(!file)return;try{const imported=JSON.parse(await file.text());state=mergeState(structuredClone(initialState),imported);await saveState();applyTheme();closeSheet();render();toast('Backup imported')}catch{toast('That backup file could not be read')}}
async function resetApp(){if(!confirm('Delete all BulkMind data on this device?'))return;state=structuredClone(initialState);await saveState();closeSheet();render()}

function setupViewportHandling(){const vv=window.visualViewport;if(!vv)return;const update=()=>{const keyboard=Math.max(0,window.innerHeight-vv.height-vv.offsetTop);document.documentElement.style.setProperty('--keyboard',`${keyboard}px`);document.body.classList.toggle('keyboard-open',keyboard>110)};vv.addEventListener('resize',update,{passive:true});vv.addEventListener('scroll',update,{passive:true});document.addEventListener('focusin',e=>{if(e.target.matches('input,textarea,select'))setTimeout(()=>e.target.scrollIntoView({block:'center',behavior:'smooth'}),180)});update()}
async function setupServiceWorker(){if(!navigator.serviceWorker?.register)return;try{const reg=await navigator.serviceWorker.register('./sw.js');if(reg.waiting)showUpdate(reg.waiting);reg.addEventListener('updatefound',()=>{const worker=reg.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)showUpdate(worker)})});navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload())}catch(err){console.warn('SW registration failed',err)}}
function showUpdate(worker){pendingWorker=worker;$('#updateBar').classList.remove('hidden')}

boot().catch(err=>{console.error(err);$('#app').innerHTML=`<main class="landing"><div class="landing-inner"><h1>BulkMind could not start</h1><p class="landing-copy">Your browser blocked local storage. Open the hosted HTTPS version in Safari or Chrome.</p></div></main>`});
