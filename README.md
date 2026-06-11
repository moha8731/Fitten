# BulkMind v6

A functionality-first personal PWA for nutrition, custom meals/shakes, workouts and progress.

## Deploy
Upload every file in this folder to the root of your GitHub repository. Vercel will redeploy automatically.

## iPhone
Open the deployed HTTPS URL in Safari → Share → Add to Home Screen → keep Open as Web App enabled.

## AI
Open Settings in BulkMind and paste a Gemini API key. The key is stored locally in IndexedDB on that device. Without a key, the app uses a local adaptive meal/shake generator.

## Data
Data is stored in IndexedDB. Existing v1-v4 localStorage data is migrated when possible. Use Settings → Export backup before clearing Safari data or changing domains.


### v6 note
Use Settings → Nutrition targets to switch between automatic app-calculated targets and custom calories/macros.


## v7 AI goal planner
Open Settings → Nutrition targets → Plan my bulk from goal. Enter your current weight, target weight and deadline. If Gemini is connected, BulkMind asks Gemini for the plan and then safety-validates the targets before applying them. Without Gemini, the local planner still works.


## v8 Product scanning
Use Food → Products or Quick add → Scan product. Barcode lookup uses Open Food Facts. Label photo scanning needs your Gemini API key. Camera barcode scanning depends on browser support; manual barcode entry always works.
