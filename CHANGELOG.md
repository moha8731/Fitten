# BulkMind v5 — functionality-first rebuild

- Replaced six crowded tabs with four clear sections: Today, Food, Train, Progress.
- Added a universal quick-add button.
- Reduced onboarding from six stages to three and autosaves progress.
- Added keyboard-aware iPhone layout using the Visual Viewport API.
- Added exact custom meal/shake generation with Gemini or an adaptive local fallback.
- Added “Ask AI / change it” directly on generated items.
- Added lazy logging, manual macro logging, editable daily log, saved foods, and one-tap reuse.
- Added usable workout logging with set completion.
- Added weight chart, consistency map, and weekly check-in.
- Moved core data to IndexedDB and attempts migration from old BulkMind localStorage data.
- Rebuilt the service worker with versioned caches and update notification.
- Removed duplicate JavaScript definitions and reduced the app script substantially.
