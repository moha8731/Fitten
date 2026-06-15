# BulkMind v16

## What changed
- Fixed Gemini JSON + search/tool error that caused 400 on plan generation.
- Added safe local fallback for setup and weekly planner.
- Hidden Vercel server key mode for Gemini AI remains supported.
- Added `/api/gemini` serverless proxy so your Gemini key can live in Vercel Environment Variables instead of the frontend.
- Added `/api/salling` token-check placeholder for retailer/Salling tokens.
- Added settings for server-key mode, optional local Gemini key, and optional retailer token.

## Important
Google AI Studio can create standard API keys and newer authorization keys. Use the exact key shown in AI Studio, even if the prefix is not `AIza`.

Use:
- `GEMINI_API_KEY` for AI meals/shakes/weekly planning.
- `SALLING_API_TOKEN` for Salling/retailer API work.

## Vercel setup
1. Upload these files to GitHub.
2. In Vercel, open your BulkMind project.
3. Go to Settings -> Environment Variables.
4. Add `GEMINI_API_KEY` with your Gemini key/auth key from AI Studio.
5. Optional: add `SALLING_API_TOKEN` with your retailer token.
6. Redeploy.

Then open the app -> Settings -> enable `Use hidden Vercel server key` -> Test AI.
