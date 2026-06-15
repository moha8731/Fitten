# BulkMind v15

- Updated Gemini setup to support both standard API keys and newer Google AI Studio authorization keys.
- Removed misleading `AIza`-only messaging.
- Vercel hidden key mode still uses `GEMINI_API_KEY`.
- If AI Studio gives a key beginning with `AQ...`, paste it exactly as `GEMINI_API_KEY`.
- Frontend still avoids hardcoding secrets; use Vercel Environment Variables for a fixed personal key.
