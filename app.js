/* BulkMind personal PWA v4. No backend required. Optional Gemini API key is stored locally for personal use only. */
const STORE_KEY = 'bulkmind.v1';
const $ = (sel, parent = document) => parent.querySelector(sel);
const $$ = (sel, parent = document) => [...parent.querySelectorAll(sel)];
const todayISO = () => new Date().toISOString().slice(0, 10);
const clamp = (n, min, max) => Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
const round = (n, d = 0) => Number((n || 0).toFixed(d));
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

const emptyState = {
  profile: null,
  theme: 'dark',
  logs: {},
  meals: [],
  shakes: [],
  workouts: [],
  checkins: [],
  aiMemory: {
    likedFoods: [], dislikedFoods: [], struggles: [], wins: [], usualSchedule: '', strategies: [], coachTone: 'chill'
  },
  settings: { geminiKey: '', geminiModel: 'gemini-2.5-flash-lite', localOnly: true },
  chat: []
};

let state = loadState();
let currentSetupStep = 0;
let setupDraft = {};
let deferredInstallPrompt = null;
let currentCoachMode = 'coach';

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORE_KEY));
    return deepMerge(structuredClone(emptyState), stored || {});
  } catch {
    return structuredClone(emptyState);
  }
}
function saveState() { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object') return base;
  for (const key of Object.keys(patch)) {
    if (patch[key] && typeof patch[key] === 'object' && !Array.isArray(patch[key]) && base[key] && typeof base[key] === 'object') {
      deepMerge(base[key], patch[key]);
    } else base[key] = patch[key];
  }
  return base;
}

const setupSteps = [
  {
    title: 'Tell BulkMind who you are',
    fields: [
      { key: 'name', label: 'Name', type: 'text', placeholder: 'Mo' },
      { key: 'age', label: 'Age', type: 'number', placeholder: '18' },
      { key: 'gender', label: 'Gender', type: 'select', options: ['male', 'female', 'other'] },
      { key: 'height', label: 'Height (cm)', type: 'number', placeholder: '175' },
      { key: 'currentWeight', label: 'Current weight (kg)', type: 'number', placeholder: '60' },
      { key: 'targetWeight', label: 'Target weight (kg)', type: 'number', placeholder: '80' }
    ]
  },
  {
    title: 'Choose your main mission',
    choices: [
      { key: 'goalType', value: 'bulk', title: 'Bulk / gain weight', sub: 'Gain size and mass' },
      { key: 'goalType', value: 'lean-bulk', title: 'Lean bulk', sub: 'Gain slower, stay leaner' },
      { key: 'goalType', value: 'cut', title: 'Cut / lose fat', sub: 'Lose weight carefully' },
      { key: 'goalType', value: 'strength', title: 'Strength', sub: 'Lift heavier over time' },
      { key: 'goalType', value: 'maintain', title: 'Maintain', sub: 'Stay consistent' },
      { key: 'goalType', value: 'custom', title: 'Custom', sub: 'Build my own plan' }
    ]
  },
  {
    title: 'Set the strategy',
    fields: [
      { key: 'timeframeMonths', label: 'Goal timeframe in months', type: 'number', placeholder: '12' },
      { key: 'aggression', label: 'Speed', type: 'select', options: ['slow', 'balanced', 'fast'] },
      { key: 'bulkStyle', label: 'Bulk style', type: 'select', options: ['clean bulk', 'normal bulk', 'dirty bulk'] },
      { key: 'activityLevel', label: 'Activity level', type: 'select', options: ['low', 'moderate', 'high', 'very high'] },
      { key: 'trainingDays', label: 'Training days/week', type: 'number', placeholder: '3' },
      { key: 'experience', label: 'Experience', type: 'select', options: ['beginner', 'intermediate', 'advanced'] }
    ]
  },
  {
    title: 'Life, appetite and schedule',
    fields: [
      { key: 'wakeTime', label: 'Wake time', type: 'time', placeholder: '07:00' },
      { key: 'sleepTime', label: 'Sleep time', type: 'time', placeholder: '23:30' },
      { key: 'schedule', label: 'School/work schedule', type: 'text', placeholder: 'School 8-15, gym evening' },
      { key: 'appetite', label: 'Appetite', type: 'select', options: ['low', 'normal', 'high'] },
      { key: 'budget', label: 'Budget', type: 'select', options: ['broke', 'normal', 'premium'] },
      { key: 'kitchen', label: 'Kitchen access', type: 'select', options: ['none', 'basic', 'full'] }
    ]
  },
  {
    title: 'Food rules and preferences',
    fields: [
      { key: 'likedFoods', label: 'Foods you like', type: 'textarea', placeholder: 'milk, oats, chicken, rice, eggs, banana, peanut butter' },
      { key: 'dislikedFoods', label: 'Foods you hate', type: 'textarea', placeholder: 'fish, beans, etc.' },
      { key: 'restrictions', label: 'Restrictions', type: 'textarea', placeholder: 'halal, lactose issues, allergies, etc.' },
      { key: 'mealsPerDay', label: 'Meals/day', type: 'number', placeholder: '4' },
      { key: 'wantsShakes', label: 'Use shakes?', type: 'select', options: ['yes', 'sometimes', 'no'] },
      { key: 'milkOk', label: 'Can drink milk?', type: 'select', options: ['yes', 'no', 'lactose-free'] }
    ]
  },
  {
    title: 'Training setup',
    fields: [
      { key: 'trainingPlace', label: 'Training place', type: 'select', options: ['gym', 'home', 'both'] },
      { key: 'equipment', label: 'Equipment', type: 'textarea', placeholder: 'gym, dumbbells, barbell, machines' },
      { key: 'injuries', label: 'Injuries/limitations', type: 'textarea', placeholder: 'none' },
      { key: 'favoriteExercises', label: 'Favorite exercises', type: 'textarea', placeholder: 'bench press, curls, pullups' },
      { key: 'coachTone', label: 'Coach tone', type: 'select', options: ['chill', 'strict', 'balanced'] },
      { key: 'reminderStyle', label: 'Motivation style', type: 'select', options: ['soft', 'direct', 'funny'] }
    ]
  }
];

function defaults() {
  return {
    name: 'Mo', age: 18, gender: 'male', height: 175, currentWeight: 60, targetWeight: 80,
    goalType: 'bulk', timeframeMonths: 12, aggression: 'balanced', bulkStyle: 'normal bulk',
    activityLevel: 'moderate', trainingDays: 3, experience: 'beginner', wakeTime: '07:00', sleepTime: '23:30',
    schedule: 'School/work during the day, gym in the evening', appetite: 'low', budget: 'broke', kitchen: 'basic',
    likedFoods: 'milk, oats, banana, peanut butter, chicken, rice, eggs, pasta, yogurt, honey',
    dislikedFoods: '', restrictions: 'halal-friendly', mealsPerDay: 4, wantsShakes: 'yes', milkOk: 'yes',
    trainingPlace: 'gym', equipment: 'full gym', injuries: 'none', favoriteExercises: 'bench press, curls, pullups',
    coachTone: 'chill', reminderStyle: 'direct'
  };
}

function hydrateProfile(draft) {
  const p = { ...defaults(), ...draft };
  p.age = Number(p.age) || 18;
  p.height = Number(p.height) || 175;
  p.currentWeight = Number(p.currentWeight) || 60;
  p.targetWeight = Number(p.targetWeight) || 80;
  p.trainingDays = clamp(Number(p.trainingDays) || 3, 1, 7);
  p.timeframeMonths = clamp(Number(p.timeframeMonths) || 12, 1, 60);
  p.mealsPerDay = clamp(Number(p.mealsPerDay) || 4, 2, 8);
  p.createdAt = p.createdAt || new Date().toISOString();
  p.updatedAt = new Date().toISOString();
  const targets = calculateTargets(p);
  return { ...p, targets };
}

function calculateTargets(p) {
  const genderAdj = p.gender === 'female' ? -161 : 5;
  const bmr = 10 * p.currentWeight + 6.25 * p.height - 5 * p.age + genderAdj;
  const mult = { low: 1.35, moderate: 1.55, high: 1.72, 'very high': 1.9 }[p.activityLevel] || 1.55;
  const maintenance = Math.round(bmr * mult);
  const surplusMap = { slow: 250, balanced: 400, fast: 550 };
  const deficitMap = { slow: -250, balanced: -400, fast: -550 };
  let surplus = p.goalType === 'cut' ? (deficitMap[p.aggression] || -350) : 0;
  if (['bulk', 'lean-bulk'].includes(p.goalType)) surplus = p.goalType === 'lean-bulk' ? Math.max(200, (surplusMap[p.aggression] || 350) - 120) : (surplusMap[p.aggression] || 400);
  if (p.goalType === 'strength') surplus = 200;
  const calories = Math.max(1600, Math.round(maintenance + surplus));
  const protein = Math.round(p.currentWeight * (p.goalType === 'cut' ? 2.1 : 1.9));
  const fat = Math.round(p.currentWeight * 0.9);
  const carbs = Math.max(130, Math.round((calories - protein * 4 - fat * 9) / 4));
  const weeklyGain = p.goalType === 'lean-bulk' ? 0.25 : p.goalType === 'bulk' ? ({ slow: 0.25, balanced: 0.4, fast: 0.55 }[p.aggression] || 0.4) : p.goalType === 'cut' ? -0.45 : 0.15;
  const kgToGoal = p.targetWeight - p.currentWeight;
  const weeks = weeklyGain !== 0 ? Math.abs(kgToGoal / weeklyGain) : 0;
  return { bmr: Math.round(bmr), maintenance, calories, protein, fat, carbs, weeklyGain, weeksToGoal: Math.round(weeks), surplus };
}

function getLog(date = todayISO()) {
  if (!state.logs[date]) state.logs[date] = { date, weight: null, calories: 0, protein: 0, carbs: 0, fat: 0, water: 0, meals: [], workoutsDone: 0, sleep: null, mood: null, appetite: null, notes: '' };
  return state.logs[date];
}
function getRecentLogs(days = 30) {
  const arr = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0,10);
    if (state.logs[iso]) arr.push(state.logs[iso]);
  }
  return arr;
}
function showView(id) {
  $$('.view').forEach(v => v.classList.remove('active'));
  const view = $('#' + id);
  view.classList.add('active');
  requestAnimationFrame(() => {
    if (id === 'mainApp') { const c = $('.content-scroll'); if (c) c.scrollTop = 0; }
    if (id === 'onboarding') scrollSetupToTop();
  });
}
function showMain() {
  showView('mainApp');
  renderAll();
}
function showToast(message) {
  const t = $('#toast');
  t.textContent = message;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
}
function openModal(html) {
  $('#modalBody').innerHTML = html;
  $('#modal').showModal();
}
function closeModal() { $('#modal').close(); }
function scrollSetupToTop() {
  const form = $('#setupForm');
  const card = $('.onboarding-card');
  if (form) form.scrollTo({ top: 0, behavior: 'smooth' });
  if (card) card.scrollTo?.({ top: 0, behavior: 'smooth' });
}

function init() {
  document.body.classList.toggle('light', state.theme === 'light');
  $('#themeBtn')?.addEventListener('click', () => { state.theme = state.theme === 'light' ? 'dark' : 'light'; saveState(); document.body.classList.toggle('light', state.theme === 'light'); renderTop(); });
  $('#startBtn').addEventListener('click', () => { setupDraft = defaults(); currentSetupStep = 0; showView('onboarding'); renderSetupStep(); });
  $('#demoBtn').addEventListener('click', useDemo);
  $('#nextStep').addEventListener('click', nextSetupStep);
  $('#backStep').addEventListener('click', prevSetupStep);
  $('#skipOnboarding').addEventListener('click', useDemo);
  $('#closeModal').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  $$('.nav-item').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstallPrompt = e; $('#installBtn').style.display = 'grid'; });
  $('#installBtn')?.addEventListener('click', async () => { if (deferredInstallPrompt) { deferredInstallPrompt.prompt(); deferredInstallPrompt = null; } else showToast('Use browser menu → Add to Home Screen'); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  $('#todayLabel').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  if (state.profile) showMain(); else showView('landing');
}

function renderSetupStep() {
  const step = setupSteps[currentSetupStep];
  $('#stepTitle').textContent = step.title;
  $('#stepCount').textContent = `${currentSetupStep + 1}/${setupSteps.length}`;
  $('#setupProgress').style.width = `${((currentSetupStep + 1) / setupSteps.length) * 100}%`;
  $('#backStep').style.opacity = currentSetupStep === 0 ? .35 : 1;
  $('#nextStep').textContent = currentSetupStep === setupSteps.length - 1 ? 'Create my plan' : 'Next';
  const form = $('#setupForm');
  if (step.choices) {
    form.innerHTML = `<div class="choice-grid full">${step.choices.map(c => `<button type="button" class="choice ${setupDraft[c.key] === c.value ? 'selected' : ''}" data-key="${c.key}" data-value="${c.value}">${c.title}<small>${c.sub}</small></button>`).join('')}</div>`;
    $$('.choice', form).forEach(btn => btn.addEventListener('click', () => { setupDraft[btn.dataset.key] = btn.dataset.value; renderSetupStep(); }));
    requestAnimationFrame(scrollSetupToTop);
    return;
  }
  form.innerHTML = `<div class="form-grid">${step.fields.map(fieldHTML).join('')}</div>`;
  $$('input, select, textarea', form).forEach(el => {
    el.addEventListener('input', () => setupDraft[el.name] = el.value);
  });
  requestAnimationFrame(scrollSetupToTop);
}
function fieldHTML(f) {
  const val = setupDraft[f.key] ?? defaults()[f.key] ?? '';
  if (f.type === 'select') return `<label>${f.label}<select name="${f.key}">${f.options.map(o => `<option value="${o}" ${String(val) === String(o) ? 'selected' : ''}>${cap(o)}</option>`).join('')}</select></label>`;
  if (f.type === 'textarea') return `<label class="full">${f.label}<textarea name="${f.key}" placeholder="${f.placeholder || ''}">${val}</textarea></label>`;
  return `<label>${f.label}<input name="${f.key}" type="${f.type}" value="${val}" placeholder="${f.placeholder || ''}" /></label>`;
}
function collectStepFields() {
  const form = $('#setupForm');
  $$('input, select, textarea', form).forEach(el => setupDraft[el.name] = el.value);
}
function nextSetupStep() {
  collectStepFields();
  if (currentSetupStep < setupSteps.length - 1) { currentSetupStep++; renderSetupStep(); return; }
  state.profile = hydrateProfile(setupDraft);
  state.aiMemory.coachTone = state.profile.coachTone || 'chill';
  seedFirstLog();
  saveState();
  showMain();
  showToast('Your personal plan is ready');
}
function prevSetupStep() { if (currentSetupStep > 0) { collectStepFields(); currentSetupStep--; renderSetupStep(); } }
function useDemo() {
  state = structuredClone(emptyState);
  state.profile = hydrateProfile(defaults());
  state.aiMemory.coachTone = state.profile.coachTone;
  seedFirstLog();
  saveState();
  showMain();
}
function seedFirstLog() {
  const log = getLog(todayISO());
  if (!log.weight) log.weight = state.profile.currentWeight;
  if (!state.workouts.length) state.workouts = generateWorkoutPlan(state.profile);
}
function cap(s) { return String(s).replace(/-/g, ' ').replace(/\b\w/g, m => m.toUpperCase()); }

function renderAll() {
  if (!state.profile) return;
  renderTop(); renderHome(); renderFood(); renderTraining(); renderProgress(); renderCoach(); renderProfile();
}
function renderTop() {
  if (!state.profile) return;
  $('#greeting').textContent = `Hey ${state.profile.name}, build the body.`;
  $('#themeBtn').textContent = state.theme === 'light' ? '☀' : '☾';
  $('#heroCurrent').textContent = state.profile?.currentWeight || 60;
  $('#heroTarget').textContent = state.profile?.targetWeight || 80;
}
function switchTab(tabId) {
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  $$('.tab-view').forEach(v => v.classList.toggle('active', v.id === tabId));
  if (tabId === 'progressView') setTimeout(drawCharts, 80);
}

function dayScore(log, targets) {
  const c = clamp(log.calories / targets.calories, 0, 1.2);
  const p = clamp(log.protein / targets.protein, 0, 1.2);
  const w = clamp((log.workoutsDone || 0) / 1, 0, 1);
  const water = clamp((log.water || 0) / 2, 0, 1);
  return Math.round((Math.min(c,1)*.42 + Math.min(p,1)*.28 + w*.16 + water*.14) * 100);
}
function renderHome() {
  const p = state.profile, t = p.targets, log = getLog();
  const calPct = clamp((log.calories / t.calories) * 100, 0, 100);
  const gap = Math.max(0, t.calories - log.calories);
  const bulkScore = dayScore(log, t);
  $('#homeView').innerHTML = `
    <section class="card glass glow elevated">
      <div class="card-head"><div><p class="eyebrow">Daily cockpit</p><h3>${p.currentWeight} → ${p.targetWeight} kg</h3></div><span class="pill">Score ${bulkScore}</span></div>
      <div class="metric-grid">
        <div class="big-ring"><div class="ring-bg" style="--p:${calPct}"><div class="ring-inner"><div><strong>${Math.round(calPct)}%</strong><span>${log.calories}/${t.calories} kcal</span></div></div></div></div>
        <div class="side-metrics">
          <div class="mini-stat"><strong>${gap}</strong><span>kcal left</span></div>
          <div class="mini-stat"><strong>${Math.max(0,t.protein-log.protein)}g</strong><span>protein left</span></div>
          <div class="mini-stat"><strong>${t.weeklyGain > 0 ? '+' : ''}${t.weeklyGain}kg</strong><span>weekly target</span></div>
        </div>
      </div>
    </section>
    <section class="quick-actions">
      ${action('🥤','Make a shake',`${gap || 650} kcal gap shake`,'quickShake')}
      ${action('🚑','Rescue today','Catch up without stress','rescueDay')}
      ${action('⚖️','Log weight','Update trend graph','logWeight')}
      ${action('🍽','What to eat?','Meal based on now','whatEat')}
    </section>
    <section class="card glass">
      <div class="card-head"><h3>Macros</h3><span class="pill">Target ${t.calories} kcal</span></div>
      ${macroRows(log, t)}
    </section>
    <section class="card glass">
      <div class="card-head"><div><p class="eyebrow">Coach note</p><h3>${coachNote(log, p)}</h3></div></div>
      <p>${coachExplain(log, p)}</p>
      <button class="ghost" onclick="switchTab('coachView')">Open coach</button>
    </section>`;
  bindHomeActions();
}
function action(icon, title, sub, id) { return `<button class="action-card" id="${id}"><span>${icon}</span><strong>${title}</strong><small>${sub}</small></button>`; }
function macroRows(log, t) {
  return `<div class="macro-list">
    ${macro('Calories', log.calories, t.calories, 'kcal', '')}
    ${macro('Protein', log.protein, t.protein, 'g', 'protein')}
    ${macro('Carbs', log.carbs, t.carbs, 'g', 'carbs')}
    ${macro('Fat', log.fat, t.fat, 'g', 'fat')}
  </div>`;
}
function macro(name, current, target, unit, cls) {
  const pct = clamp((current / target) * 100, 0, 100);
  return `<div class="macro-row"><div class="macro-label"><span class="dot ${cls}"></span>${name}</div><div class="track"><div style="width:${pct}%"></div></div><small class="subtle">${Math.round(current)}/${Math.round(target)} ${unit}</small></div>`;
}
function coachNote(log, p) {
  const gap = p.targets.calories - log.calories;
  if (gap > 900) return 'You need liquid calories today.';
  if (log.protein < p.targets.protein * .5 && new Date().getHours() > 14) return 'Protein is behind. Fix that first.';
  if (dayScore(log, p.targets) > 80) return 'Good day. Keep it boring and consistent.';
  return 'Small win: hit the next meal.';
}
function coachExplain(log, p) {
  const gap = p.targets.calories - log.calories;
  if (gap > 0) return `You are ${gap} kcal behind. Best fix: a simple shake or one dense meal, not random snacks all night.`;
  return 'Calories are handled today. Focus on protein, water, sleep and logging your weight tomorrow morning.';
}
function bindHomeActions() {
  $('#quickShake')?.addEventListener('click', () => generateShakeFlow());
  $('#rescueDay')?.addEventListener('click', () => rescueDayFlow());
  $('#logWeight')?.addEventListener('click', () => logWeightFlow());
  $('#whatEat')?.addEventListener('click', () => mealFlow('What should I eat right now?'));
}

function renderFood() {
  const p = state.profile, t = p.targets, log = getLog();
  $('#foodView').innerHTML = `
    <section class="card glass glow">
      <div class="card-head"><div><p class="eyebrow">Food engine</p><h3>Build the day around your life</h3></div><span class="pill">${log.calories}/${t.calories}</span></div>
      ${macroRows(log, t)}
    </section>
    <section class="card glass">
      <div class="card-head"><h3>Quick log</h3><span class="pill">Rough is okay</span></div>
      <div class="input-row">
        <label>Calories<input id="addCalories" type="number" placeholder="600"></label>
        <label>Protein g<input id="addProtein" type="number" placeholder="35"></label>
        <button class="primary" id="quickAddFood">Add</button>
      </div>
      <label class="full">Lazy log text<textarea id="lazyText" placeholder="I ate 2 eggs, toast, 500ml milk and rice with chicken"></textarea></label>
      <button class="ghost" id="lazyLogBtn">Estimate lazy log</button>
    </section>
    <section class="quick-actions">
      ${action('🥤','Calorie gap shake','Build exact shake','foodShake')}
      ${action('🥘','Meal plan','Cheap daily plan','mealPlan')}
      ${action('🧊','Fridge-to-bulk','Use what you have','fridgeBulk')}
      ${action('💸','Broke mode','Cheapest calories','brokeMode')}
    </section>
    <section class="card glass">
      <div class="card-head"><h3>Today’s meals</h3><button class="ghost" id="clearMeals">Clear</button></div>
      <div class="list">${log.meals.length ? log.meals.map(mealCard).join('') : '<div class="empty">No meals logged yet. Use quick log or ask AI.</div>'}</div>
    </section>
    <section class="card glass">
      <div class="card-head"><h3>Saved shakes/meals</h3><span class="pill">${state.shakes.length + state.meals.length}</span></div>
      <div class="list">${[...state.shakes, ...state.meals].slice(-5).reverse().map(savedCard).join('') || '<div class="empty">Generated food will appear here.</div>'}</div>
    </section>`;
  $('#quickAddFood')?.addEventListener('click', quickAddFood);
  $('#lazyLogBtn')?.addEventListener('click', lazyLog);
  $('#foodShake')?.addEventListener('click', () => generateShakeFlow());
  $('#mealPlan')?.addEventListener('click', () => mealFlow('Create a full cheap student meal plan for the rest of today.'));
  $('#fridgeBulk')?.addEventListener('click', fridgeFlow);
  $('#brokeMode')?.addEventListener('click', () => mealFlow('I am broke. Create the cheapest high-calorie meals for today.'));
  $('#clearMeals')?.addEventListener('click', () => { getLog().meals = []; Object.assign(getLog(), { calories:0, protein:0, carbs:0, fat:0 }); saveState(); renderAll(); });
}
function quickAddFood() {
  const cal = Number($('#addCalories').value) || 0;
  const protein = Number($('#addProtein').value) || 0;
  if (!cal && !protein) return showToast('Add calories or protein first');
  const meal = { id: uid(), type: 'quick', name: 'Quick logged food', calories: cal, protein, carbs: Math.max(0, Math.round((cal - protein*4) * .55 / 4)), fat: Math.max(0, Math.round((cal - protein*4) * .25 / 9)), why: 'Fast rough tracking. Better than forgetting.' };
  addMealToToday(meal);
  showToast('Food logged');
}
function lazyLog() {
  const text = $('#lazyText').value.trim();
  if (!text) return showToast('Write what you ate first');
  const estimate = estimateFoodText(text);
  const meal = { id: uid(), type: 'lazy', name: 'Lazy log estimate', ...estimate, instructions: text, why: 'Estimated from your text. You can edit later.' };
  addMealToToday(meal);
  showToast('Lazy log estimated and added');
}
function estimateFoodText(text) {
  const lower = text.toLowerCase();
  const items = [
    ['egg', 78, 6, 1, 5], ['toast', 95, 3, 15, 2], ['milk', 310, 16, 24, 17], ['rice', 260, 5, 57, 1],
    ['chicken', 250, 40, 0, 8], ['banana', 105, 1, 27, 0], ['oats', 300, 10, 52, 6], ['peanut', 180, 7, 6, 15],
    ['pasta', 360, 12, 70, 3], ['yogurt', 180, 15, 18, 4], ['skyr', 150, 25, 10, 1], ['wrap', 430, 25, 45, 14]
  ];
  let cal = 250, protein = 10, carbs = 25, fat = 8;
  items.forEach(([word, c, p, ca, f]) => { if (lower.includes(word)) { cal += c; protein += p; carbs += ca; fat += f; } });
  return { calories: cal, protein, carbs, fat };
}
function addMealToToday(meal) {
  const log = getLog();
  log.meals.push(meal);
  log.calories += Number(meal.calories) || 0;
  log.protein += Number(meal.protein) || 0;
  log.carbs += Number(meal.carbs) || 0;
  log.fat += Number(meal.fat) || 0;
  saveState(); renderAll();
}
function mealCard(m) {
  return `<article class="meal-card"><div class="meal-row"><div><h4>${m.name}</h4><small>${m.calories || 0} kcal · ${m.protein || 0}g protein</small></div><span>${m.type === 'shake' ? '🥤' : '🍽'}</span></div><div class="tags"><span class="tag">${m.carbs || 0}g carbs</span><span class="tag">${m.fat || 0}g fat</span>${m.price ? `<span class="tag">${m.price}</span>` : ''}</div>${m.why ? `<p>${m.why}</p>` : ''}</article>`;
}
function savedCard(m) { return mealCard(m); }

function renderTraining() {
  const p = state.profile;
  $('#trainingView').innerHTML = `
    <section class="card glass glow"><div class="card-head"><div><p class="eyebrow">Training</p><h3>${cap(p.trainingDays)} days/week plan</h3></div><button class="primary" id="logWorkoutBtn">Log done</button></div><p>The workout plan stays simple: get stronger on basic movements, recover, and eat enough to grow.</p></section>
    <section class="card glass"><div class="card-head"><h3>Your plan</h3><button class="ghost" id="regenWorkout">Regenerate</button></div><div class="list">${state.workouts.map(workoutCard).join('')}</div></section>
    <section class="card glass"><div class="card-head"><h3>Progressive overload rule</h3></div><p>When you hit the top of the rep range on all sets with good form, increase the weight next time. If you miss workouts, do not punish yourself — restart with the next planned day.</p></section>`;
  $('#logWorkoutBtn')?.addEventListener('click', () => { getLog().workoutsDone = (getLog().workoutsDone || 0) + 1; saveState(); renderAll(); showToast('Workout logged'); });
  $('#regenWorkout')?.addEventListener('click', () => { state.workouts = generateWorkoutPlan(state.profile); saveState(); renderAll(); showToast('Workout plan regenerated'); });
}
function generateWorkoutPlan(p) {
  const days = Number(p.trainingDays) || 3;
  const beginner = p.experience === 'beginner';
  const plans = [];
  const full = [
    ['Squat or leg press','3','6-10'], ['Bench press','3','6-10'], ['Row','3','8-12'], ['Romanian deadlift','2','8-10'], ['Lateral raise','3','12-20'], ['Curl + triceps','2','10-15']
  ];
  const upper = [['Bench press','3','6-10'], ['Lat pulldown','3','8-12'], ['Incline DB press','3','8-12'], ['Cable row','3','8-12'], ['Lateral raise','3','12-20'], ['Arms','3','10-15']];
  const lower = [['Squat/leg press','3','6-10'], ['RDL','3','6-10'], ['Leg curl','3','10-15'], ['Calf raise','3','10-15'], ['Abs','3','10-15']];
  const push = [['Bench press','3','6-10'], ['Shoulder press','3','6-10'], ['Incline press','3','8-12'], ['Lateral raise','4','12-20'], ['Triceps pressdown','3','10-15']];
  const pull = [['Pullup/pulldown','3','6-10'], ['Barbell/cable row','3','8-12'], ['Rear delt fly','3','12-20'], ['Curl','3','10-15'], ['Hammer curl','2','10-15']];
  const legs = [['Squat/leg press','4','6-10'], ['RDL','3','6-10'], ['Leg extension','3','10-15'], ['Leg curl','3','10-15'], ['Calves','4','10-20']];
  if (days <= 3 || beginner) {
    for (let i=1;i<=days;i++) plans.push({ id: uid(), day: `Day ${i}`, title: `Full body ${i}`, exercises: full });
  } else if (days === 4) {
    [['Upper A',upper],['Lower A',lower],['Upper B',upper],['Lower B',lower]].forEach(([title, exercises],i)=>plans.push({id:uid(), day:`Day ${i+1}`, title, exercises}));
  } else {
    [['Push',push],['Pull',pull],['Legs',legs],['Upper',upper],['Lower',lower]].slice(0,days).forEach(([title, exercises],i)=>plans.push({id:uid(), day:`Day ${i+1}`, title, exercises}));
  }
  return plans;
}
function workoutCard(w) {
  return `<article class="workout-card"><div class="meal-row"><div><h4>${w.title}</h4><small>${w.day}</small></div><span>🏋️</span></div><div class="list" style="margin-top:10px">${w.exercises.map(ex => `<div class="switch-row"><span>${ex[0]}</span><small class="subtle">${ex[1]} × ${ex[2]}</small></div>`).join('')}</div></article>`;
}

function renderProgress() {
  const logs = getRecentLogs(60);
  const p = state.profile;
  $('#progressView').innerHTML = `
    <section class="card glass glow"><div class="card-head"><div><p class="eyebrow">Progress intelligence</p><h3>${progressSentence()}</h3></div><span class="pill">Goal ${p.targetWeight} kg</span></div><button class="primary" id="weeklyCheckBtn">Weekly check-in</button></section>
    <section class="card glass chart-card"><div class="card-head"><h3>Weight trend</h3><span class="pill">kg</span></div><canvas id="weightChart" width="430" height="230"></canvas></section>
    <section class="card glass chart-card"><div class="card-head"><h3>Calories vs target</h3><span class="pill">kcal</span></div><canvas id="calChart" width="430" height="230"></canvas></section>
    <section class="card glass chart-card"><div class="card-head"><h3>Bulk score</h3><span class="pill">0-100</span></div><canvas id="scoreChart" width="430" height="230"></canvas></section>
    <section class="card glass"><div class="card-head"><h3>Micro goals</h3></div><div class="list">${microGoals().map(g => `<div class="switch-row"><span>${g.label}</span><small class="subtle">${g.done ? 'Done' : g.next ? 'Next' : 'Upcoming'}</small></div>`).join('')}</div></section>`;
  $('#weeklyCheckBtn')?.addEventListener('click', weeklyCheckFlow);
  setTimeout(drawCharts, 80);
}
function progressSentence() {
  const weights = Object.values(state.logs).filter(l => l.weight).sort((a,b)=>a.date.localeCompare(b.date));
  if (weights.length < 2) return 'Start logging weight to unlock trends.';
  const first = weights[0].weight, last = weights.at(-1).weight;
  const diff = round(last - first, 1);
  return diff >= 0 ? `You are up ${diff} kg since start.` : `You are down ${Math.abs(diff)} kg since start.`;
}
function microGoals() {
  const p = state.profile;
  const start = p.currentWeight, target = p.targetWeight;
  const step = target > start ? 2.5 : -2.5;
  const arr = [];
  for (let w = start; target > start ? w <= target : w >= target; w += step) arr.push(round(w,1));
  if (!arr.includes(target)) arr.push(target);
  const latest = getLatestWeight();
  let nextMarked = false;
  return arr.map(w => {
    const done = target > start ? latest >= w : latest <= w;
    const next = !done && !nextMarked; if (next) nextMarked = true;
    return { label: `${w} kg`, done, next };
  });
}
function getLatestWeight() {
  const logs = Object.values(state.logs).filter(l => l.weight).sort((a,b)=>a.date.localeCompare(b.date));
  return logs.at(-1)?.weight || state.profile.currentWeight;
}
function drawCharts() {
  if (!$('#progressView').classList.contains('active')) return;
  const logs = getRecentLogs(40);
  drawLineChart($('#weightChart'), logs.map(l => l.weight || null), { target: state.profile.targetWeight, label: 'kg' });
  drawLineChart($('#calChart'), logs.map(l => l.calories || 0), { target: state.profile.targets.calories, label: 'kcal' });
  drawLineChart($('#scoreChart'), logs.map(l => dayScore(l, state.profile.targets)), { target: 80, label: 'score', min: 0, max: 100 });
}
function drawLineChart(canvas, data, opts = {}) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height, pad = 32;
  ctx.clearRect(0,0,w,h);
  const real = data.map((v,i)=>({v,i})).filter(x => Number.isFinite(x.v));
  if (!real.length) {
    ctx.fillStyle = getCss('--muted'); ctx.font = '14px system-ui'; ctx.fillText('No data yet', pad, h/2); return;
  }
  const vals = real.map(x=>x.v).concat(Number.isFinite(opts.target) ? [opts.target] : []);
  const min = opts.min ?? Math.min(...vals) * .96;
  const max = opts.max ?? Math.max(...vals) * 1.04;
  const x = i => pad + (i / Math.max(1, data.length - 1)) * (w - pad*2);
  const y = v => h - pad - ((v - min) / Math.max(1, max-min)) * (h - pad*2);
  ctx.strokeStyle = 'rgba(255,255,255,.10)'; ctx.lineWidth = 1;
  for (let i=0;i<4;i++) { const yy = pad + i*(h-pad*2)/3; ctx.beginPath(); ctx.moveTo(pad, yy); ctx.lineTo(w-pad, yy); ctx.stroke(); }
  if (Number.isFinite(opts.target)) {
    ctx.strokeStyle = 'rgba(255,154,60,.42)'; ctx.setLineDash([8,8]); ctx.beginPath(); ctx.moveTo(pad, y(opts.target)); ctx.lineTo(w-pad, y(opts.target)); ctx.stroke(); ctx.setLineDash([]);
  }
  const grad = ctx.createLinearGradient(0,0,w,0); grad.addColorStop(0, getCss('--accent')); grad.addColorStop(1, getCss('--accent-2'));
  ctx.strokeStyle = grad; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
  real.forEach((p, idx) => { const xx = x(p.i), yy = y(p.v); if (idx===0) ctx.moveTo(xx,yy); else ctx.lineTo(xx,yy); }); ctx.stroke();
  real.forEach(p => { ctx.fillStyle = getCss('--bg'); ctx.strokeStyle = getCss('--accent'); ctx.lineWidth=3; ctx.beginPath(); ctx.arc(x(p.i), y(p.v), 5,0,Math.PI*2); ctx.fill(); ctx.stroke(); });
  ctx.fillStyle = getCss('--muted'); ctx.font = '12px system-ui';
  ctx.fillText(`${round(Math.min(...vals),1)} ${opts.label||''}`, 6, h-pad);
  ctx.fillText(`${round(Math.max(...vals),1)} ${opts.label||''}`, 6, pad+4);
}
function getCss(name) { return getComputedStyle(document.body).getPropertyValue(name).trim(); }

function renderCoach() {
  $('#coachView').innerHTML = `
    <section class="card glass glow"><div class="card-head"><div><p class="eyebrow">AI coach</p><h3>Personal, not generic</h3></div><span class="pill">${state.settings.geminiKey ? 'Gemini on' : 'Rule mode'}</span></div><p>${state.settings.geminiKey ? 'Real AI is enabled. It uses your saved profile and logs to generate custom food, shakes and advice.' : 'No API key yet. The app still works with smart local rules. Add a Gemini key in Profile for real AI.'}</p></section>
    <section class="coach-controls">
      ${['coach','quick','rescue','meal','reflection','strict','chill'].map(m => `<button class="ghost mode-btn ${currentCoachMode===m?'selected':''}" data-mode="${m}">${cap(m)}</button>`).join('')}
    </section>
    <section class="card glass">
      <div class="chat-window" id="chatWindow">${state.chat.length ? state.chat.slice(-18).map(chatBubble).join('') : '<div class="coach-bubble ai"><pre>Tell me what you need. Example: “I need a 700 kcal halal shake with milk, oats and banana.”</pre></div>'}</div>
      <div class="chat-input">
        <textarea id="coachInput" placeholder="Ask for a meal, shake, rescue plan, weekly advice..."></textarea>
        <button class="primary" id="sendCoach">Send</button>
      </div>
    </section>
    <section class="quick-actions">
      ${action('🥤','AI shake','Custom from data','coachShake')}
      ${action('🥘','AI meals','Plan my day','coachMeals')}
      ${action('🚑','Rescue','Fix today','coachRescue')}
      ${action('🧠','Check-in','Learn me','coachReflect')}
    </section>`;
  $$('.mode-btn').forEach(btn => btn.addEventListener('click', () => { currentCoachMode = btn.dataset.mode; renderCoach(); }));
  $('#sendCoach')?.addEventListener('click', sendCoach);
  $('#coachShake')?.addEventListener('click', () => coachAsk(`Make me a custom shake for my current calorie gap. Use my saved preferences and make it realistic.`));
  $('#coachMeals')?.addEventListener('click', () => coachAsk(`Create a meal plan for the rest of today using my calorie/protein gap, budget and preferences.`));
  $('#coachRescue')?.addEventListener('click', () => coachAsk(`I am behind today. Create a rescue plan before sleep.`));
  $('#coachReflect')?.addEventListener('click', () => coachAsk(`Ask me a short weekly check-in and tell me what to adjust.`));
  setTimeout(() => { const cw = $('#chatWindow'); if (cw) cw.scrollTop = cw.scrollHeight; }, 50);
}
function chatBubble(m) { return `<div class="coach-bubble ${m.role === 'user' ? 'user' : 'ai'}"><pre>${escapeHtml(m.text)}</pre></div>`; }
function escapeHtml(str) { return String(str).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])); }
async function sendCoach() {
  const input = $('#coachInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  await coachAsk(text);
}
async function coachAsk(text) {
  state.chat.push({ role: 'user', text, at: new Date().toISOString() }); saveState(); renderCoach();
  const reply = await getCoachReply(text, currentCoachMode);
  state.chat.push({ role: 'ai', text: reply, at: new Date().toISOString() }); saveState(); learnFromChat(text, reply); renderCoach();
}
async function getCoachReply(userText, mode = 'coach') {
  if (state.settings.geminiKey) {
    try { return await askGemini(userText, mode); }
    catch (err) { console.error(err); return `AI call failed, so I used local coach mode.\n\n${localCoachReply(userText, mode)}\n\nTip: check your Gemini API key/model in Profile.`; }
  }
  return localCoachReply(userText, mode);
}
function buildCoachContext() {
  const p = state.profile, log = getLog(), t = p.targets;
  return {
    profile: p,
    today: log,
    calorieGap: Math.max(0, t.calories - log.calories),
    proteinGap: Math.max(0, t.protein - log.protein),
    recentLogs: getRecentLogs(14),
    memory: state.aiMemory,
    safety: 'No extreme advice. No eating-disorder behavior. For medical issues, advise doctor/dietitian.'
  };
}
async function askGemini(userText, mode) {
  const key = state.settings.geminiKey.trim();
  const model = state.settings.geminiModel || 'gemini-2.5-flash-lite';
  const context = buildCoachContext();
  const prompt = `You are BulkMind, a practical personal fitness and nutrition coach. Be specific, simple, realistic, supportive and direct. Mode: ${mode}. Use the user context. If making meals or shakes, include calories, protein, carbs, fat, ingredients in grams/ml, instructions, price level, timing and why. Keep it safe. Do not diagnose. User request: ${userText}\n\nUSER_CONTEXT_JSON:\n${JSON.stringify(context, null, 2)}`;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.65, maxOutputTokens: 1100 } })
  });
  if (!res.ok) throw new Error(`Gemini error ${res.status}`);
  const json = await res.json();
  return json?.candidates?.[0]?.content?.parts?.map(p => p.text).join('\n').trim() || 'I could not generate a reply.';
}
function localCoachReply(userText, mode) {
  const p = state.profile, log = getLog(), t = p.targets;
  const gap = Math.max(0, t.calories - log.calories), proteinGap = Math.max(0, t.protein - log.protein);
  const lower = userText.toLowerCase();
  if (lower.includes('shake') || mode === 'meal') return formatShake(makeRuleShake(gap || 700, proteinGap));
  if (lower.includes('meal') || lower.includes('eat') || lower.includes('broke') || lower.includes('fridge')) return formatMealPlan(makeRuleMealPlan(gap, proteinGap));
  if (lower.includes('rescue') || lower.includes('miss') || mode === 'rescue') return `Rescue plan for today:\n1) Drink a ${Math.min(900, Math.max(500, gap))} kcal shake within 30 minutes.\n2) Eat one real meal with rice/pasta + chicken/eggs.\n3) Do not force junk at midnight. Hit protein first.\n4) Tomorrow: prepare breakfast the night before.\n\nYour gap now: ${gap} kcal and ${proteinGap}g protein.`;
  if (mode === 'reflection') return `Weekly check-in:\n- Average weight: ${round(avgWeight(7),1)} kg\n- Calories today: ${log.calories}/${t.calories}\n- Protein today: ${log.protein}/${t.protein}g\n- Focus next week: one fixed shake every day after school/work.\n\nQuestion: What made eating hard this week — appetite, money, time, or forgetting?`;
  return `Your current target is ${t.calories} kcal and ${t.protein}g protein. Today you still need about ${gap} kcal and ${proteinGap}g protein. Best move: ${gap > 650 ? 'make a dense shake now' : 'eat one normal meal and finish with milk/yogurt'}. Keep it simple enough that you repeat it tomorrow.`;
}
function avgWeight(days) {
  const xs = getRecentLogs(days).map(l=>l.weight).filter(Boolean);
  return xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : getLatestWeight();
}
function learnFromChat(user, reply) {
  const lower = user.toLowerCase();
  ['appetite','breakfast','money','broke','school','work','milk','oats','banana','peanut butter','halal'].forEach(k => {
    if (lower.includes(k) && !state.aiMemory.struggles.includes(k)) state.aiMemory.struggles.push(k);
  });
  saveState();
}

function renderProfile() {
  const p = state.profile;
  $('#profileView').innerHTML = `
    <section class="card glass glow"><div class="card-head"><div><p class="eyebrow">Profile</p><h3>${p.name}'s BulkMind</h3></div><span class="pill">${p.currentWeight} → ${p.targetWeight} kg</span></div><p>Everything saves on this device for free. Add a Gemini API key only if you want real AI inside the app.</p></section>
    <section class="card glass"><div class="card-head"><h3>Your targets</h3><button class="ghost" id="recalcTargets">Recalculate</button></div><div class="three"><div class="mini-stat"><strong>${p.targets.calories}</strong><span>kcal/day</span></div><div class="mini-stat"><strong>${p.targets.protein}g</strong><span>protein</span></div><div class="mini-stat"><strong>${p.targets.weeksToGoal}</strong><span>weeks est.</span></div></div></section>
    <section class="card glass"><div class="card-head"><h3>Edit basics</h3></div><div class="form-grid">
      <label>Name<input id="editName" value="${escapeHtml(p.name)}"></label>
      <label>Current kg<input id="editCurrent" type="number" value="${p.currentWeight}"></label>
      <label>Target kg<input id="editTarget" type="number" value="${p.targetWeight}"></label>
      <label>Training days<input id="editTrainingDays" type="number" value="${p.trainingDays}"></label>
      <label class="full">Liked foods<textarea id="editLiked">${escapeHtml(p.likedFoods)}</textarea></label>
      <label class="full">Restrictions<textarea id="editRestrictions">${escapeHtml(p.restrictions)}</textarea></label>
    </div><button class="primary" id="saveProfile">Save profile</button></section>
    <section class="card glass"><div class="card-head"><h3>AI setup</h3><span class="pill">Optional</span></div>
      <label>Gemini API key<input id="geminiKey" value="${escapeHtml(state.settings.geminiKey)}" placeholder="Paste key here for personal use"></label>
      <label>Model<input id="geminiModel" value="${escapeHtml(state.settings.geminiModel)}"></label>
      <p class="subtle">For a private deployed app, use a serverless API route instead of exposing your key. For personal local use, this is the simplest 0 kr version.</p>
      <button class="primary" id="saveAiSettings">Save AI settings</button>
    </section>
    <section class="card glass"><div class="card-head"><h3>Data</h3></div><div class="two"><button class="ghost" id="exportData">Export JSON</button><button class="danger-btn" id="resetApp">Reset app</button></div></section>`;
  $('#saveProfile')?.addEventListener('click', saveProfileEdits);
  $('#recalcTargets')?.addEventListener('click', () => { state.profile = hydrateProfile(state.profile); saveState(); renderAll(); showToast('Targets recalculated'); });
  $('#saveAiSettings')?.addEventListener('click', saveAiSettings);
  $('#exportData')?.addEventListener('click', exportData);
  $('#resetApp')?.addEventListener('click', resetApp);
}
function saveProfileEdits() {
  Object.assign(state.profile, {
    name: $('#editName').value.trim() || state.profile.name,
    currentWeight: Number($('#editCurrent').value) || state.profile.currentWeight,
    targetWeight: Number($('#editTarget').value) || state.profile.targetWeight,
    trainingDays: clamp(Number($('#editTrainingDays').value) || state.profile.trainingDays, 1, 7),
    likedFoods: $('#editLiked').value,
    restrictions: $('#editRestrictions').value
  });
  state.profile = hydrateProfile(state.profile);
  saveState(); renderAll(); showToast('Profile saved');
}
function saveAiSettings() {
  state.settings.geminiKey = $('#geminiKey').value.trim();
  state.settings.geminiModel = $('#geminiModel').value.trim() || 'gemini-2.5-flash-lite';
  saveState(); renderAll(); showToast('AI settings saved');
}
function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `bulkmind-data-${todayISO()}.json`; a.click(); URL.revokeObjectURL(a.href);
}
function resetApp() {
  if (!confirm('Reset all BulkMind data on this device?')) return;
  localStorage.removeItem(STORE_KEY); location.reload();
}

async function generateShakeFlow() {
  const gap = Math.max(500, Math.min(1100, state.profile.targets.calories - getLog().calories || 700));
  if (state.settings.geminiKey) {
    const text = await getCoachReply(`Create one custom ${gap} kcal bulk shake using my preferences. Return practical details.`, 'meal');
    showGeneratedText('AI shake', text, true);
  } else {
    const shake = makeRuleShake(gap, Math.max(20, state.profile.targets.protein - getLog().protein));
    addGeneratedShake(shake);
    showGeneratedText('Calorie gap shake', formatShake(shake), false);
  }
}
function makeRuleShake(targetCalories = 700, proteinGap = 35) {
  const p = state.profile;
  const milk = p.milkOk === 'no' ? 0 : targetCalories > 850 ? 600 : 500;
  let shake = { id: uid(), type: 'shake', name: `${targetCalories} kcal BulkMind shake`, ingredients: [], calories: 0, protein: 0, carbs: 0, fat: 0, price: p.budget === 'broke' ? 'cheap' : 'normal', why: 'Dense liquid calories are easier when appetite is low.' };
  const add = (name, cal, pro, carb, fat) => { shake.ingredients.push(name); shake.calories += cal; shake.protein += pro; shake.carbs += carb; shake.fat += fat; };
  if (milk) add(`${milk} ml whole milk`, Math.round(milk*0.64), Math.round(milk*0.033), Math.round(milk*0.048), Math.round(milk*0.035));
  add('80 g oats', 311, 10, 53, 6);
  add('1 banana', 105, 1, 27, 0);
  add(targetCalories > 750 ? '35 g peanut butter' : '20 g peanut butter', targetCalories > 750 ? 210 : 120, targetCalories > 750 ? 8 : 5, targetCalories > 750 ? 7 : 4, targetCalories > 750 ? 18 : 10);
  if (targetCalories > 900) add('20 g honey', 61, 0, 17, 0);
  if (proteinGap > 45) add('200 g skyr/yogurt', 130, 22, 10, 1);
  shake.calories = Math.round(shake.calories); shake.protein = Math.round(shake.protein); shake.carbs = Math.round(shake.carbs); shake.fat = Math.round(shake.fat);
  shake.instructions = 'Blend 45–60 seconds. Add water/ice if too thick.';
  shake.timing = 'Best after school/work, after gym, or before sleep.';
  return shake;
}
function addGeneratedShake(shake) { state.shakes.push(shake); saveState(); }
function formatShake(s) {
  return `${s.name}\nCalories: ${s.calories} kcal\nProtein: ${s.protein}g · Carbs: ${s.carbs}g · Fat: ${s.fat}g\n\nIngredients:\n- ${s.ingredients.join('\n- ')}\n\nInstructions: ${s.instructions}\nTiming: ${s.timing}\nWhy: ${s.why}`;
}
function showGeneratedText(title, text, ai) {
  openModal(`<h2>${title}</h2><p class="subtle">${ai ? 'Generated by AI' : 'Generated locally for free'}</p><pre style="white-space:pre-wrap;line-height:1.5">${escapeHtml(text)}</pre><button class="primary" id="addTextMeal">Add rough 700 kcal to today</button>`);
  $('#addTextMeal')?.addEventListener('click', () => { addMealToToday({ id: uid(), type: 'shake', name: title, calories: 700, protein: 30, carbs: 85, fat: 25, why: 'Added from generated suggestion. Edit later if needed.' }); closeModal(); });
}
async function rescueDayFlow() {
  const reply = await getCoachReply('Create a rescue plan for the rest of today based on my calorie/protein gap.', 'rescue');
  showGeneratedText('Rescue plan', reply, !!state.settings.geminiKey);
}
async function mealFlow(prompt) {
  const reply = await getCoachReply(prompt, 'meal');
  showGeneratedText('Meal plan', reply, !!state.settings.geminiKey);
}
function fridgeFlow() {
  openModal(`<h2>Fridge-to-bulk</h2><p class="subtle">Write ingredients you have. AI uses them if enabled, otherwise local rules help.</p><textarea id="fridgeItems" placeholder="milk, oats, eggs, rice, chicken, banana..."></textarea><button class="primary" id="makeFridgeMeal">Make meal</button>`);
  $('#makeFridgeMeal').addEventListener('click', async () => {
    const items = $('#fridgeItems').value.trim();
    const reply = await getCoachReply(`I only have these ingredients: ${items}. Create meals/shakes for my goal.`, 'meal');
    showGeneratedText('Fridge-to-bulk result', reply, !!state.settings.geminiKey);
  });
}
function makeRuleMealPlan(gap = 900, proteinGap = 50) {
  const p = state.profile;
  return [
    { name: 'Rice chicken bowl', calories: 720, protein: 48, carbs: 92, fat: 16, ingredients: ['250 g cooked rice','150 g chicken','olive oil','sauce/spices'], why: 'Cheap, simple, high carb and high protein.' },
    { name: 'Before-bed shake', calories: Math.min(850, Math.max(550, gap - 300)), protein: 30, carbs: 80, fat: 22, ingredients: ['milk','oats','banana','peanut butter'], why: 'Easy calories when appetite is low.' },
    { name: 'Egg toast snack', calories: 430, protein: 24, carbs: 36, fat: 20, ingredients: ['3 eggs','2 toast','ketchup/spices'], why: 'Fast protein and calories.' }
  ];
}
function formatMealPlan(plan) {
  return plan.map((m,i)=>`${i+1}) ${m.name}\n${m.calories} kcal · ${m.protein}g protein\nIngredients: ${m.ingredients.join(', ')}\nWhy: ${m.why}`).join('\n\n');
}
function logWeightFlow() {
  openModal(`<h2>Log weight</h2><p class="subtle">Best time: morning after bathroom, before food.</p><label>Weight kg<input id="newWeight" type="number" step="0.1" value="${getLatestWeight()}"></label><button class="primary" id="saveWeight">Save weight</button>`);
  $('#saveWeight').addEventListener('click', () => { const w = Number($('#newWeight').value); if (!w) return; getLog().weight = w; saveState(); closeModal(); renderAll(); showToast('Weight logged'); });
}
function weeklyCheckFlow() {
  openModal(`<h2>Weekly check-in</h2><div class="stack"><label>Current weight<input id="ciWeight" type="number" step="0.1" value="${getLatestWeight()}"></label><label>What was hard?<textarea id="ciHard" placeholder="appetite, money, time, missed breakfast..."></textarea></label><label>What worked?<textarea id="ciWorked" placeholder="shake after school, meal prep..."></textarea></label><button class="primary" id="saveCheckin">Generate report</button></div>`);
  $('#saveCheckin').addEventListener('click', async () => {
    const ci = { id: uid(), date: todayISO(), weight: Number($('#ciWeight').value), hard: $('#ciHard').value, worked: $('#ciWorked').value };
    state.checkins.push(ci); getLog().weight = ci.weight || getLatestWeight(); saveState();
    const reply = await getCoachReply(`Weekly check-in. Hard: ${ci.hard}. Worked: ${ci.worked}. Give report and adjustment.`, 'reflection');
    showGeneratedText('Weekly report', reply, !!state.settings.geminiKey);
    renderAll();
  });
}

init();

/* ===== BulkMind v2 upgrade: real generator studio + structured Gemini + adaptive local engine ===== */
const FOOD_BANK = [
  { key:'whole milk', aliases:['milk','södmælk','sødmælk'], unit:'ml', cal:.64, protein:.033, carbs:.048, fat:.035, tags:['shake','cheap','liquid'] },
  { key:'lactose-free milk', aliases:['lactose free milk','lactose-free'], unit:'ml', cal:.48, protein:.034, carbs:.048, fat:.015, tags:['shake','liquid'] },
  { key:'oats', aliases:['oat','havregryn'], unit:'g', cal:3.89, protein:.13, carbs:.66, fat:.07, tags:['shake','cheap','carb'] },
  { key:'banana', aliases:['banan','banana'], unit:'g', cal:.89, protein:.011, carbs:.23, fat:.003, tags:['shake','cheap','carb'] },
  { key:'peanut butter', aliases:['peanut','pb','peanutbutter'], unit:'g', cal:5.88, protein:.25, carbs:.20, fat:.50, tags:['shake','cheap','fat'] },
  { key:'honey', aliases:['honning','honey'], unit:'g', cal:3.04, protein:0, carbs:.82, fat:0, tags:['shake','carb'] },
  { key:'olive oil', aliases:['oliveolie','oil','olie'], unit:'ml', cal:8.1, protein:0, carbs:0, fat:.91, tags:['shake','fat','dense'] },
  { key:'skyr', aliases:['skyr','greek yogurt','yogurt','yoghurt'], unit:'g', cal:.65, protein:.11, carbs:.04, fat:.002, tags:['shake','protein'] },
  { key:'protein powder', aliases:['whey','protein powder','proteinpulver'], unit:'g', cal:4, protein:.8, carbs:.08, fat:.05, tags:['shake','protein'] },
  { key:'dates', aliases:['date','dates','dadler'], unit:'g', cal:2.8, protein:.025, carbs:.75, fat:.004, tags:['shake','carb'] },
  { key:'rice', aliases:['rice','ris'], unit:'g cooked', cal:1.3, protein:.027, carbs:.28, fat:.003, tags:['meal','cheap','carb'] },
  { key:'pasta', aliases:['pasta'], unit:'g cooked', cal:1.55, protein:.058, carbs:.31, fat:.009, tags:['meal','cheap','carb'] },
  { key:'chicken', aliases:['chicken','kylling'], unit:'g', cal:1.65, protein:.31, carbs:0, fat:.036, tags:['meal','halal','protein'] },
  { key:'egg', aliases:['egg','eggs','æg'], unit:'egg', cal:78, protein:6.3, carbs:.5, fat:5.3, tags:['meal','cheap','protein'] },
  { key:'wrap', aliases:['wrap','tortilla'], unit:'wrap', cal:190, protein:6, carbs:31, fat:5, tags:['meal','portable'] },
  { key:'bread', aliases:['bread','toast','brød'], unit:'slice', cal:95, protein:3, carbs:17, fat:1.5, tags:['meal','cheap'] },
  { key:'tuna', aliases:['tuna','tun'], unit:'g', cal:1.16, protein:.26, carbs:0, fat:.01, tags:['meal','protein','cheap'] },
  { key:'yogurt', aliases:['yogurt','yoghurt'], unit:'g', cal:.75, protein:.06, carbs:.08, fat:.025, tags:['meal','shake'] }
];

const MEAL_TEMPLATES_V2 = [
  {
    name:'Halal chicken rice power bowl', base:['rice','chicken'], price:'cheap-normal', timing:'Lunch or dinner',
    instructions:['Cook or heat rice.','Add chicken, spices, sauce and a small amount of oil.','Eat with water or milk if calories are still low.'],
    why:'High calories, high protein and easy to repeat.', tags:['halal','bulk','school night']
  },
  {
    name:'Pasta bulk plate', base:['pasta','chicken'], price:'cheap', timing:'Dinner',
    instructions:['Cook pasta.','Add chicken and sauce.','Add olive oil if the calorie gap is big.'],
    why:'Cheap carbs with protein, good after training.', tags:['bulk','cheap']
  },
  {
    name:'Egg toast rescue snack', base:['egg','bread'], price:'cheap', timing:'Late snack or breakfast',
    instructions:['Fry or boil eggs.','Eat with toast and ketchup/spices.','Add milk if you need more calories.'],
    why:'Fast, cheap and better than skipping calories.', tags:['fast','cheap']
  },
  {
    name:'Portable chicken wrap', base:['wrap','chicken'], price:'normal', timing:'School/work meal',
    instructions:['Fill wrap with chicken and sauce.','Add rice inside if you need extra calories.','Pack it before leaving home.'],
    why:'Good if you struggle to eat during school or work.', tags:['portable','halal']
  },
  {
    name:'Skyr oat bowl', base:['skyr','oats','banana','honey'], price:'cheap-normal', timing:'Breakfast or before sleep',
    instructions:['Mix skyr/yogurt with oats.','Add banana and honey.','Let it sit 5 minutes if you want it softer.'],
    why:'Easy protein and carbs without cooking.', tags:['no-cook','breakfast']
  }
];

function textList(str) { return String(str || '').toLowerCase().split(/[,\n]+/).map(s => s.trim()).filter(Boolean); }
function itemAllowed(item, inputText='') {
  const p = state.profile || defaults();
  const dislikes = textList(p.dislikedFoods).join(' ');
  const restrictions = String(p.restrictions || '').toLowerCase();
  if (dislikes && (dislikes.includes(item.key) || item.aliases.some(a => dislikes.includes(a)))) return false;
  if ((p.milkOk === 'no' || restrictions.includes('lactose')) && ['whole milk','skyr','yogurt'].includes(item.key)) return false;
  if (inputText) {
    const lower = inputText.toLowerCase();
    return lower.includes(item.key) || item.aliases.some(a => lower.includes(a));
  }
  return true;
}
function getFood(key) { return FOOD_BANK.find(f => f.key === key) || FOOD_BANK.find(f => f.aliases.includes(key)); }
function macroFrom(item, qty) {
  return { name: item.key, qty, unit: item.unit, calories: item.cal*qty, protein: item.protein*qty, carbs: item.carbs*qty, fat: item.fat*qty };
}
function roundFood(food) {
  const totals = food.ingredients.reduce((a,i)=>({ calories:a.calories+i.calories, protein:a.protein+i.protein, carbs:a.carbs+i.carbs, fat:a.fat+i.fat }), {calories:0,protein:0,carbs:0,fat:0});
  return { ...food, calories: Math.round(totals.calories), protein: Math.round(totals.protein), carbs: Math.round(totals.carbs), fat: Math.round(totals.fat), ingredients: food.ingredients.map(i => ({...i, qty: Math.round(i.qty), calories: Math.round(i.calories), protein: Math.round(i.protein), carbs: Math.round(i.carbs), fat: Math.round(i.fat)})) };
}
function addIngredient(food, key, qty) {
  const item = getFood(key); if (!item || qty <= 0) return;
  food.ingredients.push(macroFrom(item, qty));
}
function addOrIncrease(food, key, qty) {
  const item = getFood(key); if (!item || qty <= 0) return;
  const found = food.ingredients.find(i => i.name === item.key);
  if (found) {
    const extra = macroFrom(item, qty);
    found.qty += qty; found.calories += extra.calories; found.protein += extra.protein; found.carbs += extra.carbs; found.fat += extra.fat;
  } else addIngredient(food, key, qty);
}
function currentGaps() {
  const p = state.profile, log = getLog(), t = p.targets;
  return { calGap: Math.max(0, t.calories - log.calories), proteinGap: Math.max(0, t.protein - log.protein), log, targets:t };
}
function makeAdaptiveShake(opts = {}) {
  const p = state.profile || defaults();
  const { calGap, proteinGap } = currentGaps();
  const target = clamp(Number(opts.targetCalories) || calGap || 750, 350, 1300);
  const targetProtein = clamp(Number(opts.targetProtein) || Math.max(25, proteinGap || 35), 10, 80);
  const available = String(opts.ingredients || '').trim();
  const taste = opts.taste || 'banana peanut butter';
  const texture = opts.texture || 'medium';
  const cheap = opts.mode === 'broke' || p.budget === 'broke';
  let food = { id: uid(), type:'shake', name:'', ingredients:[], price: cheap ? 'cheap' : 'normal', timing: opts.timing || 'After school/work, after gym, or before sleep', why:'Built from your profile, calorie gap and available ingredients — not a preset answer.', instructions:'Blend 45–60 seconds. Add water/ice if it is too thick. Drink slowly if appetite is low.', tags:['custom','calorie gap','bulk'] };
  const can = (key) => { const item = getFood(key); return item && itemAllowed(item, available); };

  if (can('whole milk')) addIngredient(food, 'whole milk', texture === 'light' ? 350 : target > 850 ? 600 : 500);
  else if (can('lactose-free milk')) addIngredient(food, 'lactose-free milk', 500);
  if (can('oats')) addIngredient(food, 'oats', target > 900 ? 95 : target < 550 ? 45 : 70);
  if (can('banana') && taste !== 'chocolate') addIngredient(food, 'banana', target > 850 ? 140 : 115);
  if (can('peanut butter') && opts.noPeanut !== 'yes') addIngredient(food, 'peanut butter', cheap ? 25 : target > 850 ? 40 : 25);
  if (targetProtein > 42 && can('skyr')) addIngredient(food, 'skyr', 180);
  if (targetProtein > 55 && can('protein powder') && opts.noPowder !== 'yes') addIngredient(food, 'protein powder', 25);
  if (target > 850 && can('honey')) addIngredient(food, 'honey', 15);

  food = roundFood(food);
  const boosters = ['oats','peanut butter','honey','whole milk','olive oil','dates'].filter(can);
  let safety = 0;
  while (food.calories < target - 60 && safety++ < 30) {
    const gap = target - food.calories;
    const pick = gap > 250 && boosters.includes('peanut butter') ? 'peanut butter' : gap > 180 && boosters.includes('oats') ? 'oats' : boosters.includes('whole milk') ? 'whole milk' : boosters[0];
    const qty = pick === 'whole milk' ? 100 : pick === 'olive oil' ? 5 : pick === 'honey' ? 10 : pick === 'peanut butter' ? 10 : pick === 'dates' ? 20 : 15;
    addOrIncrease(food, pick, qty); food = roundFood(food);
  }
  if (food.protein < targetProtein - 8) {
    if (can('protein powder') && opts.noPowder !== 'yes') addOrIncrease(food, 'protein powder', 20);
    else if (can('skyr')) addOrIncrease(food, 'skyr', 150);
    food = roundFood(food);
  }
  food.name = `${food.calories} kcal ${cheap ? 'cheap ' : ''}${texture === 'light' ? 'light ' : ''}bulk shake`;
  food.why = `You needed about ${calGap || target} kcal and ${proteinGap || targetProtein}g protein. This shake is liquid calories, uses your preferences (${p.likedFoods || 'saved foods'}), and stays realistic for appetite.`;
  return food;
}
function mealPortion(template, desiredCalories, desiredProtein, opts={}) {
  const food = { id: uid(), type:'meal', name:template.name, ingredients:[], price:template.price, timing:template.timing, instructions:template.instructions.join(' '), why:template.why, tags:[...template.tags, opts.mode || 'custom'] };
  const base = template.base;
  if (base.includes('rice')) addIngredient(food, 'rice', desiredCalories > 750 ? 330 : 250);
  if (base.includes('pasta')) addIngredient(food, 'pasta', desiredCalories > 750 ? 300 : 230);
  if (base.includes('chicken')) addIngredient(food, 'chicken', desiredProtein > 45 ? 170 : 130);
  if (base.includes('egg')) addIngredient(food, 'egg', desiredProtein > 32 ? 4 : 3);
  if (base.includes('bread')) addIngredient(food, 'bread', desiredCalories > 550 ? 3 : 2);
  if (base.includes('wrap')) addIngredient(food, 'wrap', desiredCalories > 650 ? 2 : 1);
  if (base.includes('skyr')) addIngredient(food, 'skyr', 250);
  if (base.includes('oats')) addIngredient(food, 'oats', desiredCalories > 600 ? 70 : 45);
  if (base.includes('banana')) addIngredient(food, 'banana', 110);
  if (base.includes('honey')) addIngredient(food, 'honey', 15);
  let rounded = roundFood(food);
  if (rounded.calories < desiredCalories - 120) {
    if (base.includes('rice')) addOrIncrease(rounded, 'rice', 100);
    else if (base.includes('pasta')) addOrIncrease(rounded, 'pasta', 80);
    else if (base.includes('bread')) addOrIncrease(rounded, 'bread', 1);
    else addOrIncrease(rounded, 'oats', 25);
    rounded = roundFood(rounded);
  }
  return rounded;
}
function makeAdaptiveMealPlan(opts={}) {
  const p = state.profile || defaults();
  const { calGap, proteinGap } = currentGaps();
  const target = clamp(Number(opts.targetCalories) || calGap || 1200, 450, 2600);
  const proteinTarget = clamp(Number(opts.targetProtein) || proteinGap || 65, 20, 160);
  const mode = opts.mode || 'normal';
  const available = String(opts.ingredients || '').toLowerCase();
  let templates = MEAL_TEMPLATES_V2.filter(t => {
    if (mode === 'broke' && !String(t.price).includes('cheap')) return false;
    if (available) return t.base.some(k => available.includes(k) || (getFood(k)?.aliases || []).some(a => available.includes(a)));
    return true;
  });
  if (!templates.length) templates = MEAL_TEMPLATES_V2;
  const count = target > 1800 ? 4 : target > 950 ? 3 : 2;
  const meals = [];
  for (let i=0; i<count; i++) {
    const template = templates[i % templates.length];
    const mealTarget = Math.round(target / count * (i === count-1 ? 1.15 : 1));
    const protTarget = Math.round(proteinTarget / count * (i === 0 ? 1.1 : 1));
    meals.push(mealPortion(template, mealTarget, protTarget, {mode}));
  }
  if ((p.appetite === 'low' || mode === 'low-appetite') && target > 700) meals.push(makeAdaptiveShake({ targetCalories: Math.min(850, Math.max(500, Math.round(target*.35))), targetProtein: Math.min(45, Math.max(25, Math.round(proteinTarget*.35))), mode, ingredients: opts.ingredients || '' }));
  return meals;
}
function normalizeFoodItems(obj, fallbackType='meal') {
  const items = Array.isArray(obj) ? obj : Array.isArray(obj?.items) ? obj.items : obj?.meal ? [obj.meal] : obj?.shake ? [obj.shake] : [];
  return items.map(it => ({
    id: uid(), type: it.type || fallbackType, name: it.name || it.title || 'Custom food',
    calories: Math.round(Number(it.calories || it.kcal || 0)), protein: Math.round(Number(it.protein || 0)), carbs: Math.round(Number(it.carbs || 0)), fat: Math.round(Number(it.fat || 0)),
    price: it.price || it.priceLevel || 'normal', timing: it.timing || it.when || '', why: it.why || it.reason || '',
    instructions: Array.isArray(it.instructions) ? it.instructions.join(' ') : (it.instructions || ''),
    tags: Array.isArray(it.tags) ? it.tags : ['AI'],
    ingredients: Array.isArray(it.ingredients) ? it.ingredients.map(x => typeof x === 'string' ? { name:x, qty:'', unit:'', calories:0, protein:0, carbs:0, fat:0 } : x) : []
  })).filter(it => it.name && it.calories);
}
function foodSchemaV2() {
  return { type:'object', properties:{ coachMessage:{type:'string'}, items:{ type:'array', items:{ type:'object', properties:{ type:{type:'string'}, name:{type:'string'}, calories:{type:'integer'}, protein:{type:'integer'}, carbs:{type:'integer'}, fat:{type:'integer'}, price:{type:'string'}, timing:{type:'string'}, why:{type:'string'}, instructions:{type:'string'}, tags:{type:'array', items:{type:'string'}}, ingredients:{type:'array', items:{type:'object', properties:{ name:{type:'string'}, qty:{type:'number'}, unit:{type:'string'}, calories:{type:'integer'}, protein:{type:'integer'}, carbs:{type:'integer'}, fat:{type:'integer'} }, required:['name'] }} }, required:['type','name','calories','protein','carbs','fat','ingredients','instructions','why'] }} }, required:['items'] };
}
function stripJson(text) {
  const cleaned = String(text || '').replace(/```json|```/g,'').trim();
  const first = cleaned.indexOf('{'), last = cleaned.lastIndexOf('}');
  if (first >= 0 && last > first) return cleaned.slice(first, last+1);
  return cleaned;
}
async function geminiRaw(prompt, wantJson=false) {
  const key = state.settings.geminiKey?.trim();
  if (!key) throw new Error('No Gemini API key saved');
  const model = state.settings.geminiModel || 'gemini-2.5-flash-lite';
  const body = { contents:[{ parts:[{ text: prompt }] }], generationConfig:{ temperature:.72, maxOutputTokens: wantJson ? 1800 : 1300 } };
  if (wantJson) body.generationConfig.responseFormat = { text:{ mimeType:'application/json', schema: foodSchemaV2() } };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method:'POST', headers:{ 'Content-Type':'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text().catch(()=> '')}`);
  const json = await res.json();
  return json?.candidates?.[0]?.content?.parts?.map(p=>p.text).join('\n').trim() || '';
}
async function askGeminiFood(kind, request, opts={}) {
  const context = buildCoachContext();
  const prompt = `You are BulkMind, a practical AI nutrition coach inside a personal bulking app. Generate truly custom ${kind} suggestions, not generic templates. Use the user's real profile, calorie gap, protein gap, budget, restrictions, appetite, disliked foods and ingredients available. Keep halal/restrictions safe. Do not encourage extreme eating. Return ONLY valid JSON matching this shape: {"coachMessage":"short helpful note","items":[{"type":"shake or meal","name":"...","calories":800,"protein":35,"carbs":100,"fat":25,"price":"cheap/normal/premium","timing":"when to use","why":"why this fits the user","instructions":"short instructions","tags":["custom"],"ingredients":[{"name":"whole milk","qty":500,"unit":"ml","calories":320,"protein":17,"carbs":24,"fat":18}]}]}.

USER_REQUEST: ${request}
OPTIONS_JSON: ${JSON.stringify(opts)}
USER_CONTEXT_JSON: ${JSON.stringify(context)}`;
  try {
    const text = await geminiRaw(prompt, true);
    const parsed = JSON.parse(stripJson(text));
    const items = normalizeFoodItems(parsed, kind === 'shake' ? 'shake' : 'meal');
    if (items.length) return { coachMessage: parsed.coachMessage || 'Generated from your saved data.', items, source:'Gemini structured' };
  } catch (e) {
    console.warn('Structured Gemini failed, falling back to JSON prompt', e);
    const text = await geminiRaw(prompt + '\nReturn JSON only. No markdown.', false);
    const parsed = JSON.parse(stripJson(text));
    const items = normalizeFoodItems(parsed, kind === 'shake' ? 'shake' : 'meal');
    if (items.length) return { coachMessage: parsed.coachMessage || 'Generated from your saved data.', items, source:'Gemini JSON' };
  }
  throw new Error('Gemini did not return usable food JSON');
}
async function askGemini(userText, mode) {
  const context = buildCoachContext();
  const prompt = `You are BulkMind, a practical personal fitness/nutrition coach. Be specific, not generic. Use the user's saved profile, logs, calorie gap, preferences, restrictions, budget and AI memory. If the user asks for meals or shakes, include exact calories/protein/carbs/fat and ingredient amounts. Mode: ${mode}. Keep it safe and realistic. User request: ${userText}\n\nUSER_CONTEXT_JSON:\n${JSON.stringify(context, null, 2)}`;
  return await geminiRaw(prompt, false);
}
function foodCardRich(item, idx) {
  const ing = (item.ingredients || []).map(i => `<li>${escapeHtml(i.qty ? `${i.qty}${i.unit ? ' '+i.unit : ''} ` : '')}${escapeHtml(i.name || '')}${i.calories ? ` <small>${Math.round(i.calories)} kcal</small>` : ''}</li>`).join('');
  return `<article class="generated-food glass"><div class="meal-row"><div><h4>${escapeHtml(item.name)}</h4><small>${item.calories} kcal · ${item.protein}g protein · ${item.carbs}g carbs · ${item.fat}g fat</small></div><span>${item.type === 'shake' ? '🥤' : '🍽️'}</span></div><div class="tags">${(item.tags || []).slice(0,4).map(t=>`<span class="tag">${escapeHtml(t)}</span>`).join('')}${item.price ? `<span class="tag">${escapeHtml(item.price)}</span>`:''}</div>${item.timing ? `<p><strong>Timing:</strong> ${escapeHtml(item.timing)}</p>`:''}${item.why ? `<p><strong>Why:</strong> ${escapeHtml(item.why)}</p>`:''}<details><summary>Ingredients + instructions</summary><ul>${ing || '<li>No ingredients listed</li>'}</ul><p>${escapeHtml(item.instructions || '')}</p></details><div class="two"><button class="primary add-generated" data-idx="${idx}">Add to today</button><button class="ghost save-generated" data-idx="${idx}">Save</button></div></article>`;
}
let lastGeneratedFoods = [];
function showGeneratedFood(title, result, ai=false) {
  const items = Array.isArray(result) ? result : result.items || [];
  lastGeneratedFoods = items;
  openModal(`<h2>${escapeHtml(title)}</h2><p class="subtle">${ai ? 'Generated with Gemini from your saved profile/logs.' : 'Generated locally from your profile, gaps, foods and preferences. Add Gemini for even more creativity.'}</p>${result.coachMessage ? `<p>${escapeHtml(result.coachMessage)}</p>`:''}<div class="generated-list">${items.map(foodCardRich).join('')}</div>`);
  $$('.add-generated').forEach(btn => btn.addEventListener('click', () => { const item = lastGeneratedFoods[Number(btn.dataset.idx)]; addMealToToday(item); showToast('Added to today'); closeModal(); }));
  $$('.save-generated').forEach(btn => btn.addEventListener('click', () => { const item = lastGeneratedFoods[Number(btn.dataset.idx)]; (item.type === 'shake' ? state.shakes : state.meals).push(item); saveState(); showToast('Saved'); renderAll(); }));
}
function spinnerModal(title='Generating...') { openModal(`<h2>${escapeHtml(title)}</h2><p class="subtle">Building this around your actual profile, calorie gap and preferences.</p><div class="ai-loader"><span></span><span></span><span></span></div>`); }
async function generateShakeFlow() {
  const { calGap, proteinGap } = currentGaps();
  openModal(`<h2>Custom shake engine</h2><p class="subtle">This is not a preset. It uses target calories, your gaps, ingredients, budget and appetite.</p><div class="form-grid"><label>Target kcal<input id="shakeTarget" type="number" value="${Math.max(500, Math.min(1100, calGap || 750))}"></label><label>Protein target g<input id="shakeProtein" type="number" value="${Math.max(25, Math.min(65, proteinGap || 35))}"></label><label>Taste<select id="shakeTaste"><option>banana peanut butter</option><option>chocolate</option><option>vanilla oat</option><option>dates caramel</option></select></label><label>Texture<select id="shakeTexture"><option>medium</option><option>light</option><option>thick</option></select></label><label class="full">Ingredients available<textarea id="shakeIngredients" placeholder="milk, oats, banana, peanut butter, skyr, honey..."></textarea></label><label>No protein powder?<select id="shakeNoPowder"><option value="no">No, powder is okay</option><option value="yes">Yes, no powder</option></select></label><label>No peanut butter?<select id="shakeNoPeanut"><option value="no">Peanut is okay</option><option value="yes">No peanut</option></select></label></div><button class="primary big" id="makeShakeNow">Generate real custom shake</button>`);
  $('#makeShakeNow').addEventListener('click', async () => {
    const opts = { targetCalories: $('#shakeTarget').value, targetProtein: $('#shakeProtein').value, taste: $('#shakeTaste').value, texture: $('#shakeTexture').value, ingredients: $('#shakeIngredients').value, noPowder: $('#shakeNoPowder').value, noPeanut: $('#shakeNoPeanut').value };
    spinnerModal(state.settings.geminiKey ? 'Gemini is creating your shake...' : 'Local engine is creating your shake...');
    try {
      if (state.settings.geminiKey) {
        const result = await askGeminiFood('shake', 'Create one custom bulk shake. It must match the target calories/protein and use available ingredients if provided.', opts);
        showGeneratedFood('AI custom shake', result, true);
      } else showGeneratedFood('Custom shake', { items:[makeAdaptiveShake(opts)], coachMessage:'No Gemini key is active, so this uses the smart local engine instead of fixed answers.' }, false);
    } catch (err) {
      console.error(err); showGeneratedFood('Custom shake fallback', { items:[makeAdaptiveShake(opts)], coachMessage:'Gemini failed, so I used the local generator. Check your key/model in Profile.' }, false);
    }
  });
}
async function mealFlow(prompt='Create a meal plan for today.') {
  const { calGap, proteinGap } = currentGaps();
  openModal(`<h2>Custom meal engine</h2><p class="subtle">Ask for exact meals. Example: “cheap halal school meals with rice/chicken and a shake”.</p><div class="form-grid"><label>Calories to cover<input id="mealTarget" type="number" value="${Math.max(600, calGap || 1200)}"></label><label>Protein to cover g<input id="mealProtein" type="number" value="${Math.max(30, proteinGap || 65)}"></label><label>Mode<select id="mealMode"><option value="normal">normal</option><option value="broke">broke / cheapest</option><option value="low-appetite">low appetite</option><option value="school">school/work portable</option><option value="halal">halal focused</option></select></label><label>Meals wanted<select id="mealCount"><option>2</option><option selected>3</option><option>4</option></select></label><label class="full">Your request<textarea id="mealRequest">${escapeHtml(prompt)}</textarea></label><label class="full">Ingredients available / foods you want to use<textarea id="mealIngredients" placeholder="rice, chicken, eggs, pasta, milk, oats..."></textarea></label></div><button class="primary big" id="makeMealsNow">Generate custom meals</button>`);
  $('#makeMealsNow').addEventListener('click', async () => {
    const opts = { targetCalories: $('#mealTarget').value, targetProtein: $('#mealProtein').value, mode: $('#mealMode').value, count: $('#mealCount').value, ingredients: $('#mealIngredients').value };
    const req = $('#mealRequest').value.trim() || prompt;
    spinnerModal(state.settings.geminiKey ? 'Gemini is planning your meals...' : 'Local engine is planning your meals...');
    try {
      if (state.settings.geminiKey) {
        const result = await askGeminiFood('meal', req, opts);
        showGeneratedFood('AI custom meals', result, true);
      } else showGeneratedFood('Custom meals', { items: makeAdaptiveMealPlan(opts), coachMessage:'No Gemini key is active, so this uses a dynamic local meal engine.' }, false);
    } catch (err) {
      console.error(err); showGeneratedFood('Custom meals fallback', { items: makeAdaptiveMealPlan(opts), coachMessage:'Gemini failed, so I used the local generator. Check your key/model in Profile.' }, false);
    }
  });
}
function fridgeFlow() { mealFlow('Use only/mostly the ingredients I list and create meals or a shake for my bulk.'); }
function rescueDayFlow() {
  const { calGap, proteinGap } = currentGaps();
  const items = [makeAdaptiveShake({ targetCalories: Math.min(950, Math.max(550, Math.round(calGap*.55)||650)), targetProtein: Math.min(55, Math.max(25, Math.round(proteinGap*.5)||30)), mode:'low-appetite' }), ...makeAdaptiveMealPlan({ targetCalories: Math.max(600, Math.round(calGap*.45)||650), targetProtein: Math.max(25, Math.round(proteinGap*.5)||35), mode:'broke' }).slice(0,2)];
  if (state.settings.geminiKey) {
    spinnerModal('Gemini is building your rescue plan...');
    askGeminiFood('meal', `I am behind today by about ${calGap} kcal and ${proteinGap}g protein. Create a realistic rescue plan before sleep with a shake and food.`, {targetCalories:calGap,targetProtein:proteinGap,mode:'rescue'})
      .then(r => showGeneratedFood('AI rescue plan', r, true))
      .catch(() => showGeneratedFood('Rescue plan', {items, coachMessage:'Gemini failed, so here is the local rescue plan.'}, false));
  } else showGeneratedFood('Rescue plan', {items, coachMessage:`You are about ${calGap} kcal and ${proteinGap}g protein behind. Use liquid calories first, then one easy real meal.`}, false);
}
function formatFoodText(items) {
  return items.map((m,i)=>`${i+1}) ${m.name}\n${m.calories} kcal · ${m.protein}g protein · ${m.carbs}g carbs · ${m.fat}g fat\nIngredients: ${(m.ingredients||[]).map(x=>`${x.qty||''}${x.unit?' '+x.unit:''} ${x.name}`).join(', ')}\nWhy: ${m.why}`).join('\n\n');
}
function formatShake(s) { return formatFoodText([s]); }
function formatMealPlan(plan) { return formatFoodText(plan); }
function localCoachReply(userText, mode) {
  const { calGap, proteinGap, targets, log } = currentGaps();
  const lower = String(userText).toLowerCase();
  if (lower.includes('shake')) return formatFoodText([makeAdaptiveShake({ targetCalories: calGap || 750, targetProtein: proteinGap || 35, ingredients: userText })]);
  if (lower.includes('meal') || lower.includes('eat') || lower.includes('broke') || lower.includes('fridge') || mode === 'meal') return formatFoodText(makeAdaptiveMealPlan({ targetCalories: calGap || 1200, targetProtein: proteinGap || 65, mode: lower.includes('broke') ? 'broke' : lower.includes('school') ? 'school' : 'normal', ingredients: userText }));
  if (lower.includes('rescue') || lower.includes('miss') || mode === 'rescue') return `Rescue plan:\n${formatFoodText([makeAdaptiveShake({ targetCalories: Math.min(900, Math.max(550, calGap || 700)), targetProtein: Math.min(55, Math.max(25, proteinGap || 35)) }), ...makeAdaptiveMealPlan({targetCalories:Math.max(600, Math.round((calGap||1000)*.45)), targetProtein:Math.max(30, Math.round((proteinGap||60)*.45)), mode:'broke'}).slice(0,1)])}`;
  if (mode === 'reflection') return `Weekly check-in:\n- Calories today: ${log.calories}/${targets.calories}\n- Protein today: ${log.protein}/${targets.protein}g\n- Current gap: ${calGap} kcal and ${proteinGap}g protein\n\nQuestion: what made eating hard this week — appetite, money, time, forgetting, or food getting boring?`;
  return `Today you still need about ${calGap} kcal and ${proteinGap}g protein. Press “AI shake” or “AI meals” for generated food cards you can add directly to the log. ${state.settings.geminiKey ? 'Gemini is ON.' : 'Gemini is OFF, so I am using the local generator.'}`;
}
function mealCard(m) {
  const ingredientLine = (m.ingredients || []).slice(0,4).map(i => typeof i === 'string' ? i : `${i.qty ? Math.round(i.qty)+' '+(i.unit||'')+' ' : ''}${i.name}`).join(', ');
  return `<article class="meal-card"><div class="meal-row"><div><h4>${escapeHtml(m.name)}</h4><small>${m.calories || 0} kcal · ${m.protein || 0}g protein</small></div><span>${m.type === 'shake' ? '🥤' : '🍽'}</span></div><div class="tags"><span class="tag">${m.carbs || 0}g carbs</span><span class="tag">${m.fat || 0}g fat</span>${m.price ? `<span class="tag">${escapeHtml(m.price)}</span>` : ''}</div>${ingredientLine ? `<p><strong>Ingredients:</strong> ${escapeHtml(ingredientLine)}</p>` : ''}${m.why ? `<p>${escapeHtml(m.why)}</p>` : ''}</article>`;
}
function renderFood() {
  const p = state.profile, t = p.targets, log = getLog();
  const gap = Math.max(0, t.calories - log.calories), pgap = Math.max(0, t.protein - log.protein);
  $('#foodView').innerHTML = `
    <section class="card glass glow elevated">
      <div class="card-head"><div><p class="eyebrow">Food engine v2</p><h3>Custom meals, not preset answers</h3></div><span class="pill">${state.settings.geminiKey ? 'Gemini ON' : 'Local AI-like engine'}</span></div>
      <div class="three"><div class="mini-stat"><strong>${gap}</strong><span>kcal gap</span></div><div class="mini-stat"><strong>${pgap}g</strong><span>protein gap</span></div><div class="mini-stat"><strong>${p.budget}</strong><span>budget mode</span></div></div>
      ${macroRows(log, t)}
    </section>
    <section class="quick-actions">
      ${action('🥤','Custom shake','Exact kcal + ingredients','foodShake')}
      ${action('🥘','Custom meals','Plan rest of day','mealPlan')}
      ${action('🧊','Fridge-to-bulk','Use only what you have','fridgeBulk')}
      ${action('🚑','Rescue mode','Catch up today','foodRescue')}
    </section>
    <section class="card glass"><div class="card-head"><h3>Quick log</h3><span class="pill">Rough is okay</span></div><div class="input-row"><label>Calories<input id="addCalories" type="number" placeholder="600"></label><label>Protein g<input id="addProtein" type="number" placeholder="35"></label><button class="primary" id="quickAddFood">Add</button></div><label class="full">Lazy log text<textarea id="lazyText" placeholder="I ate 2 eggs, toast, 500ml milk and rice with chicken"></textarea></label><button class="ghost" id="lazyLogBtn">Estimate lazy log</button></section>
    <section class="card glass"><div class="card-head"><h3>Today’s meals</h3><button class="ghost" id="clearMeals">Clear</button></div><div class="list">${log.meals.length ? log.meals.map(mealCard).join('') : '<div class="empty">No meals logged yet. Generate a custom shake or meal.</div>'}</div></section>
    <section class="card glass"><div class="card-head"><h3>Saved generated food</h3><span class="pill">${state.shakes.length + state.meals.length}</span></div><div class="list">${[...state.shakes, ...state.meals].slice(-8).reverse().map(savedCard).join('') || '<div class="empty">Saved custom foods will appear here.</div>'}</div></section>`;
  $('#quickAddFood')?.addEventListener('click', quickAddFood);
  $('#lazyLogBtn')?.addEventListener('click', lazyLog);
  $('#foodShake')?.addEventListener('click', () => generateShakeFlow());
  $('#mealPlan')?.addEventListener('click', () => mealFlow('Create a meal plan for the rest of today using my current calorie/protein gap.'));
  $('#fridgeBulk')?.addEventListener('click', fridgeFlow);
  $('#foodRescue')?.addEventListener('click', rescueDayFlow);
  $('#clearMeals')?.addEventListener('click', () => { getLog().meals = []; Object.assign(getLog(), { calories:0, protein:0, carbs:0, fat:0 }); saveState(); renderAll(); });
}
function renderCoach() {
  const status = state.settings.geminiKey ? 'Gemini ON' : 'Local engine';
  $('#coachView').innerHTML = `
    <section class="card glass glow"><div class="card-head"><div><p class="eyebrow">Coach v2</p><h3>Real custom generation</h3></div><span class="pill">${status}</span></div><p>${state.settings.geminiKey ? 'Gemini uses your saved profile, logs, gaps and preferences to generate custom food/advice.' : 'No Gemini key yet. Buttons still generate dynamic food cards locally — not fixed answers.'}</p></section>
    <section class="coach-controls">${['coach','quick','rescue','meal','reflection','strict','chill'].map(m => `<button class="ghost mode-btn ${currentCoachMode===m?'selected':''}" data-mode="${m}">${cap(m)}</button>`).join('')}</section>
    <section class="card glass"><div class="chat-window" id="chatWindow">${state.chat.length ? state.chat.slice(-18).map(chatBubble).join('') : '<div class="coach-bubble ai"><pre>Ask me for something specific like: “Make a 900 kcal cheap halal shake with milk, oats and banana.”</pre></div>'}</div><div class="chat-input"><textarea id="coachInput" placeholder="Ask for a meal, shake, rescue plan, weekly advice..."></textarea><button class="primary" id="sendCoach">Send</button></div></section>
    <section class="quick-actions">${action('🥤','AI shake','Food card generator','coachShake')}${action('🥘','AI meals','Plan my day','coachMeals')}${action('🚑','Rescue','Fix today','coachRescue')}${action('🧪','Test AI','Check Gemini key','testAI')}</section>`;
  $$('.mode-btn').forEach(btn => btn.addEventListener('click', () => { currentCoachMode = btn.dataset.mode; renderCoach(); }));
  $('#sendCoach')?.addEventListener('click', sendCoach);
  $('#coachShake')?.addEventListener('click', () => generateShakeFlow());
  $('#coachMeals')?.addEventListener('click', () => mealFlow('Create meals for the rest of today using my exact gap, budget and preferences.'));
  $('#coachRescue')?.addEventListener('click', rescueDayFlow);
  $('#testAI')?.addEventListener('click', testGeminiKey);
  setTimeout(() => { const cw = $('#chatWindow'); if (cw) cw.scrollTop = cw.scrollHeight; }, 50);
}
async function testGeminiKey() {
  if (!state.settings.geminiKey) return showToast('Paste a Gemini API key in Profile first');
  spinnerModal('Testing Gemini...');
  try { const text = await askGemini('Reply with one short sentence saying BulkMind AI is connected.', 'quick'); openModal(`<h2>AI connected ✅</h2><p>${escapeHtml(text)}</p>`); }
  catch (e) { console.error(e); openModal(`<h2>AI test failed</h2><p class="subtle">Check the key/model in Profile. Error: ${escapeHtml(e.message)}</p>`); }
}
function renderProfile() {
  const p = state.profile;
  $('#profileView').innerHTML = `
    <section class="card glass glow"><div class="card-head"><div><p class="eyebrow">Profile</p><h3>${escapeHtml(p.name)}'s BulkMind</h3></div><span class="pill">${p.currentWeight} → ${p.targetWeight} kg</span></div><p>Everything saves on this device for 0 kr. Gemini is optional for real AI creativity; without it the local generator still creates custom meals/shakes.</p></section>
    <section class="card glass"><div class="card-head"><h3>Your targets</h3><button class="ghost" id="recalcTargets">Recalculate</button></div><div class="three"><div class="mini-stat"><strong>${p.targets.calories}</strong><span>kcal/day</span></div><div class="mini-stat"><strong>${p.targets.protein}g</strong><span>protein</span></div><div class="mini-stat"><strong>${p.targets.weeksToGoal}</strong><span>weeks est.</span></div></div></section>
    <section class="card glass"><div class="card-head"><h3>Edit basics</h3></div><div class="form-grid"><label>Name<input id="editName" value="${escapeHtml(p.name)}"></label><label>Current kg<input id="editCurrent" type="number" value="${p.currentWeight}"></label><label>Target kg<input id="editTarget" type="number" value="${p.targetWeight}"></label><label>Training days<input id="editTrainingDays" type="number" value="${p.trainingDays}"></label><label class="full">Liked foods<textarea id="editLiked">${escapeHtml(p.likedFoods)}</textarea></label><label class="full">Restrictions<textarea id="editRestrictions">${escapeHtml(p.restrictions)}</textarea></label></div><button class="primary" id="saveProfile">Save profile</button></section>
    <section class="card glass elevated"><div class="card-head"><div><p class="eyebrow">Real AI setup</p><h3>${state.settings.geminiKey ? 'Gemini connected-ish' : 'Gemini not added'}</h3></div><span class="pill">Optional</span></div><label>Gemini API key<input id="geminiKey" value="${escapeHtml(state.settings.geminiKey)}" placeholder="Paste Gemini API key here"></label><label>Model<input id="geminiModel" value="${escapeHtml(state.settings.geminiModel || 'gemini-2.5-flash-lite')}"></label><p class="subtle">For personal local use, the key is saved only in your browser. Do not publish the app publicly with your own key inside the frontend.</p><div class="two"><button class="primary" id="saveAiSettings">Save AI settings</button><button class="ghost" id="profileTestAI">Test AI</button></div></section>
    <section class="card glass"><div class="card-head"><h3>Data</h3></div><div class="two"><button class="ghost" id="exportData">Export JSON</button><button class="danger-btn" id="resetApp">Reset app</button></div></section>`;
  $('#saveProfile')?.addEventListener('click', saveProfileEdits);
  $('#recalcTargets')?.addEventListener('click', () => { state.profile = hydrateProfile(state.profile); saveState(); renderAll(); showToast('Targets recalculated'); });
  $('#saveAiSettings')?.addEventListener('click', saveAiSettings);
  $('#profileTestAI')?.addEventListener('click', testGeminiKey);
  $('#exportData')?.addEventListener('click', exportData);
  $('#resetApp')?.addEventListener('click', resetApp);
}

/* ===== BulkMind v3: ask AI about generated food + iPhone helper polish ===== */
function findFoodById(id) {
  const today = getLog()?.meals || [];
  return [...today, ...(state.shakes || []), ...(state.meals || []), ...(lastGeneratedFoods || [])].find(x => String(x.id) === String(id));
}
function foodSummaryForPrompt(item) {
  const ingredients = (item.ingredients || []).map(i => typeof i === 'string' ? i : `${i.qty || ''} ${i.unit || ''} ${i.name || ''}`.trim()).filter(Boolean).join(', ');
  return `${item.name}\n${item.calories || 0} kcal · ${item.protein || 0}g protein · ${item.carbs || 0}g carbs · ${item.fat || 0}g fat\nIngredients: ${ingredients || 'not listed'}\nTiming: ${item.timing || 'not listed'}\nInstructions: ${item.instructions || 'not listed'}\nWhy: ${item.why || 'not listed'}`;
}
function askAboutFoodById(id) {
  const item = findFoodById(id);
  if (!item) return showToast('Could not find that meal/shake');
  askAboutFoodFlow(item);
}
function askAboutGeneratedFood(idx) {
  const item = (lastGeneratedFoods || [])[Number(idx)];
  if (!item) return showToast('Generate a shake/meal first');
  askAboutFoodFlow(item);
}
function askAboutFoodFlow(item) {
  const starter = item.type === 'shake' ? 'Can you explain this shake and make it taste better?' : 'Can you explain this meal and make it easier to prep?';
  openModal(`
    <h2>Ask AI about this ${item.type === 'shake' ? 'shake' : 'meal'}</h2>
    <div class="food-question-card">
      <div class="meal-card">
        <div class="meal-row"><div><h4>${escapeHtml(item.name)}</h4><small>${item.calories || 0} kcal · ${item.protein || 0}g protein</small></div><span>${item.type === 'shake' ? '🥤' : '🍽️'}</span></div>
        <p class="subtle">Ask about taste, substitutions, timing, digestion, price, prep, or whether it fits your bulk.</p>
      </div>
      <div class="prompt-chip-row">
        <button class="prompt-chip" data-q="Make it cheaper but keep similar calories and protein.">Cheaper</button>
        <button class="prompt-chip" data-q="Make it less filling / easier to eat with low appetite.">Low appetite</button>
        <button class="prompt-chip" data-q="Is this good before or after gym? Explain timing.">Gym timing</button>
        <button class="prompt-chip" data-q="What can I replace if I do not have one ingredient?">Substitutions</button>
        <button class="prompt-chip" data-q="Will this taste good? How do I improve the taste and texture?">Taste check</button>
      </div>
      <label>Your question<textarea id="foodQuestion">${escapeHtml(starter)}</textarea></label>
      <button class="primary big" id="askFoodAiBtn">Ask about this</button>
      <div id="foodAiAnswer"></div>
    </div>`);
  $$('.prompt-chip').forEach(btn => btn.addEventListener('click', () => { $('#foodQuestion').value = btn.dataset.q; }));
  $('#askFoodAiBtn')?.addEventListener('click', async () => {
    const q = $('#foodQuestion').value.trim();
    if (!q) return showToast('Write a question first');
    const answerBox = $('#foodAiAnswer');
    answerBox.innerHTML = '<div class="ai-loader"><span></span><span></span><span></span></div>';
    try {
      const answer = await askFoodQuestion(item, q);
      answerBox.innerHTML = `<div class="answer-box">${escapeHtml(answer)}</div><div class="two" style="margin-top:10px"><button class="ghost" id="copyFoodAnswer">Copy answer</button><button class="primary" id="sendFoodToCoach">Save to coach</button></div>`;
      $('#copyFoodAnswer')?.addEventListener('click', async () => { await navigator.clipboard?.writeText(answer).catch(()=>{}); showToast('Copied'); });
      $('#sendFoodToCoach')?.addEventListener('click', () => {
        state.chat.push({ role:'user', text:`Question about ${item.name}: ${q}`, at:new Date().toISOString() });
        state.chat.push({ role:'ai', text:answer, at:new Date().toISOString() });
        saveState(); renderCoach(); showToast('Saved in Coach chat');
      });
    } catch (e) {
      console.error(e);
      answerBox.innerHTML = `<div class="answer-box">AI failed, so here is the local answer:\n\n${escapeHtml(localFoodAnswer(item, q))}</div>`;
    }
  });
}
async function askFoodQuestion(item, question) {
  const prompt = `The user is asking about ONE generated food item inside BulkMind. Answer specifically about this exact food, not generic fitness advice. Be practical and simple. Mention exact ingredient swaps or changes when useful. Keep it safe and realistic.\n\nFOOD_ITEM:\n${foodSummaryForPrompt(item)}\n\nUSER_QUESTION: ${question}`;
  if (state.settings.geminiKey) return await askGemini(prompt, 'meal');
  return localFoodAnswer(item, question);
}
function localFoodAnswer(item, question) {
  const lower = String(question).toLowerCase();
  const isShake = item.type === 'shake';
  const protein = Number(item.protein || 0), cal = Number(item.calories || 0);
  if (lower.includes('cheap')) return `Cheaper version: keep the main calorie base, but use more oats/rice/bread and less expensive add-ons. For this ${isShake ? 'shake' : 'meal'}, the goal is still around ${cal} kcal and ${protein}g protein. If it uses skyr/protein powder, replace some of it with milk, eggs, tuna or chicken depending on what you have.`;
  if (lower.includes('appetite') || lower.includes('filling')) return `Low appetite fix: split it into 2 smaller servings. ${isShake ? 'Use more milk/water and blend longer so it is thinner. Drink half now and half later.' : 'Eat the protein first, then carbs. Add calories with sauce/oil instead of making the portion huge.'} This keeps the bulk goal without making you feel destroyed.`;
  if (lower.includes('gym') || lower.includes('timing')) return `Timing: this is useful ${cal > 700 ? 'after training or later in the day because it is calorie-dense' : 'before or after training because it is not insanely heavy'}. Before gym, keep it lighter and give yourself 60–120 minutes. After gym, it is good because it helps fill calories and protein.`;
  if (lower.includes('substitut') || lower.includes('replace')) return `Substitutions: keep the same role. Carbs can swap with oats, rice, pasta, bread or banana. Protein can swap with chicken, eggs, skyr, tuna, milk or protein powder. Fats/calories can swap with peanut butter, olive oil, nuts or cheese. Try to keep the total close to ${cal} kcal and ${protein}g protein.`;
  if (lower.includes('taste') || lower.includes('texture')) return isShake ? `Taste/texture: blend longer, add ice, cinnamon, cocoa powder or a little honey. If it is too thick, add milk/water. If it tastes too oat-heavy, reduce oats slightly and add banana/honey.` : `Taste: add spices, sauce, salt/pepper, garlic, chili, ketchup or yogurt dressing. The best meal is the one you can actually repeat, so taste matters.`;
  return `This fits your bulk because it gives around ${cal} kcal and ${protein}g protein. The main thing is repeatability: make it easy, affordable and not too disgusting to eat often. Ask me about price, substitutions, timing or taste for a more specific tweak.`;
}
function foodCardRich(item, idx) {
  const ing = (item.ingredients || []).map(i => `<li>${escapeHtml(i.qty ? `${i.qty}${i.unit ? ' '+i.unit : ''} ` : '')}${escapeHtml(i.name || '')}${i.calories ? ` <small>${Math.round(i.calories)} kcal</small>` : ''}</li>`).join('');
  return `<article class="generated-food glass"><div class="meal-row"><div><h4>${escapeHtml(item.name)}</h4><small>${item.calories} kcal · ${item.protein}g protein · ${item.carbs}g carbs · ${item.fat}g fat</small></div><span>${item.type === 'shake' ? '🥤' : '🍽️'}</span></div><div class="tags">${(item.tags || []).slice(0,4).map(t=>`<span class="tag">${escapeHtml(t)}</span>`).join('')}${item.price ? `<span class="tag">${escapeHtml(item.price)}</span>`:''}</div>${item.timing ? `<p><strong>Timing:</strong> ${escapeHtml(item.timing)}</p>`:''}${item.why ? `<p><strong>Why:</strong> ${escapeHtml(item.why)}</p>`:''}<details><summary>Ingredients + instructions</summary><ul>${ing || '<li>No ingredients listed</li>'}</ul><p>${escapeHtml(item.instructions || '')}</p></details><div class="generated-actions"><button class="primary add-generated" data-idx="${idx}">Add to today</button><button class="ghost save-generated" data-idx="${idx}">Save</button><button class="ghost ask-generated" data-idx="${idx}">💬 Ask AI about this</button></div></article>`;
}
function showGeneratedFood(title, result, ai=false) {
  const items = Array.isArray(result) ? result : result.items || [];
  lastGeneratedFoods = items.map(it => ({ id: it.id || uid(), ...it }));
  openModal(`<h2>${escapeHtml(title)}</h2><p class="subtle">${ai ? 'Generated with Gemini from your saved profile/logs.' : 'Generated locally from your profile, gaps, foods and preferences. Add Gemini for even more creativity.'}</p>${result.coachMessage ? `<p>${escapeHtml(result.coachMessage)}</p>`:''}<div class="generated-list">${lastGeneratedFoods.map(foodCardRich).join('')}</div>`);
  $$('.add-generated').forEach(btn => btn.addEventListener('click', () => { const item = lastGeneratedFoods[Number(btn.dataset.idx)]; addMealToToday(item); showToast('Added to today'); closeModal(); }));
  $$('.save-generated').forEach(btn => btn.addEventListener('click', () => { const item = lastGeneratedFoods[Number(btn.dataset.idx)]; (item.type === 'shake' ? state.shakes : state.meals).push(item); saveState(); showToast('Saved'); renderAll(); }));
  $$('.ask-generated').forEach(btn => btn.addEventListener('click', () => askAboutGeneratedFood(btn.dataset.idx)));
}
function mealCard(m) {
  const ingredientLine = (m.ingredients || []).slice(0,4).map(i => typeof i === 'string' ? i : `${i.qty ? Math.round(i.qty)+' '+(i.unit||'')+' ' : ''}${i.name}`).join(', ');
  return `<article class="meal-card"><div class="meal-row"><div><h4>${escapeHtml(m.name)}</h4><small>${m.calories || 0} kcal · ${m.protein || 0}g protein</small></div><span>${m.type === 'shake' ? '🥤' : '🍽'}</span></div><div class="tags"><span class="tag">${m.carbs || 0}g carbs</span><span class="tag">${m.fat || 0}g fat</span>${m.price ? `<span class="tag">${escapeHtml(m.price)}</span>` : ''}</div>${ingredientLine ? `<p><strong>Ingredients:</strong> ${escapeHtml(ingredientLine)}</p>` : ''}${m.why ? `<p>${escapeHtml(m.why)}</p>` : ''}<button class="ghost ask-stored" data-id="${escapeHtml(m.id || '')}">💬 Ask AI about this</button></article>`;
}
document.addEventListener('click', (event) => {
  const btn = event.target.closest?.('.ask-stored');
  if (!btn) return;
  event.preventDefault();
  askAboutFoodById(btn.dataset.id);
});
