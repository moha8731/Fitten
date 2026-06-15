# BulkMind v17

- Fixed startup crashes when localStorage is blocked or unavailable.
- Added memory-only fallback so the app can still open.
- Added safer app boot error handling.
- Updated service worker cache to v17 so iPhone can fetch the new build.

Note: memory-only mode does not persist after closing the app. Use the hosted HTTPS Safari/Vercel version for persistent data.
