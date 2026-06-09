# BulkMind — personal AI bulk app (free PWA)

BulkMind is a mobile-first Progressive Web App for personal fitness goals such as bulking from 60 kg to 80 kg. It saves data locally in your browser using `localStorage`, so it does not require a paid database or backend.

## What is included

- Beautiful animated mobile app UI
- Onboarding flow
- Personalized calorie/protein/carb/fat targets
- Dashboard with bulk score and macro progress
- Food logger with quick add and lazy text estimate
- Calorie gap shake builder
- Meal planner modes
- Fridge-to-bulk mode
- Broke mode
- Workout plan generator
- Workout logging
- Progress charts using Canvas, no paid library
- Weekly check-in
- Coach chat
- Optional Gemini API integration for real AI meals/shakes/advice
- PWA manifest and service worker

## How to run for free

### Option 1: Open directly
Open `index.html` in a browser. Most features work. Some browsers restrict service workers from local files.

### Option 2: Run local server
From this folder:

```bash
python -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

## How to get AI working

1. Get a Gemini API key from Google AI Studio.
2. Open the app.
3. Go to Profile → AI setup.
4. Paste your API key.
5. Keep the default model `gemini-2.5-flash-lite`, or change it if needed.
6. Ask the Coach for custom meals, shakes or rescue plans.

Important: this personal version stores the API key locally in your browser. Do not publish this publicly with your key inside it. For a real public app, move the Gemini call to a serverless API route and keep the key in environment variables.

## How to deploy free

You can deploy this as a static site on Vercel, Netlify, GitHub Pages, or Cloudflare Pages. For personal use, keep it private or do not save an API key in a public version.

## Next upgrades

- Move AI calls to a serverless endpoint
- Add IndexedDB instead of localStorage for larger data
- Add photo progress storage
- Add import/export UI
- Add barcode/food database integration
- Add Supabase sync if you want login across devices


## v2 upgrade
This build has a much stronger Food/Coach engine:
- Custom shake form with target kcal/protein, ingredients, texture, taste, no-powder/no-peanut options.
- Custom meal form with target kcal/protein, mode, ingredient list, and generated cards.
- Generated meals/shakes can be added to today's log with their real macros instead of "rough 700 kcal".
- If Gemini key is active, BulkMind asks Gemini for structured food JSON and turns it into cards.
- If Gemini is not active, BulkMind uses a dynamic local generator based on your profile, calorie gap, protein gap, appetite, budget and restrictions.
- Profile now includes a Test AI button.

For a personal local app, saving the Gemini key in the browser is okay. Do not publish a public copy with your key in frontend code.

## BulkMind v3 update

New in v3:

- Every generated shake/meal now has a **“Ask AI about this”** button.
- You can ask about taste, timing, substitutions, cheap versions, low-appetite versions, and whether it fits your bulk.
- Works with Gemini if your API key is saved.
- If Gemini is off, it still gives a local practical answer.
- Added iPhone/PWA polish: safe-area support, 16px inputs to prevent iOS zoom, better bottom navigation spacing, Apple home-screen meta tags, improved manifest, and updated service worker cache.

## Put it on your iPhone home screen

1. Upload/deploy this folder to a HTTPS host like Vercel or Netlify.
2. Open the deployed link in Safari on your iPhone.
3. Tap Share.
4. Tap Add to Home Screen.
5. Name it BulkMind and tap Add.

After that it opens from your home screen like an app. Your data is saved locally on the iPhone/browser for that deployed URL.
