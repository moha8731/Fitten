# BulkMind v5

A functionality-first personal PWA for nutrition, custom meals/shakes, workouts and progress.

## Deploy
Upload every file in this folder to the root of your GitHub repository. Vercel will redeploy automatically.

## iPhone
Open the deployed HTTPS URL in Safari → Share → Add to Home Screen → keep Open as Web App enabled.

## AI
Open Settings in BulkMind and paste a Gemini API key. The key is stored locally in IndexedDB on that device. Without a key, the app uses a local adaptive meal/shake generator.

## Data
Data is stored in IndexedDB. Existing v1-v4 localStorage data is migrated when possible. Use Settings → Export backup before clearing Safari data or changing domains.
