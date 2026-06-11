# BulkMind v8 — exact product scanning

- Added Product Library for real milk, protein powder, skyr and other packaged foods.
- Added Open Food Facts barcode/API lookup.
- Added manual barcode entry fallback for iPhone browsers.
- Added optional camera barcode scanning when the browser supports BarcodeDetector.
- Added Gemini vision nutrition-label extraction from a photo.
- Added manual product entry for per-100g/ml labels.
- Generated meals and shakes now send saved scanned product macros to Gemini, so “milk” can mean your actual milk.
- Added portion logging from saved products.

# BulkMind v7 — AI goal planner

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


## v6
- Added direct Nutrition Targets editor for calories/protein/carbs/fat.
- Added automatic vs custom target mode.
- Fixed shake generator so it suggests a realistic portion instead of a full-day shake when nothing is logged.
- Updated cache version to v6.


## v7
- Added AI Goal Planner inside Nutrition targets.
- User can enter current weight, target weight and deadline, e.g. 60 kg to 84 kg in 8 months.
- Uses Gemini when a Gemini API key is connected, then validates the numbers before applying them.
- Applies calories/protein/carbs/fat automatically as custom targets.
- Adds honest warning when a deadline requires aggressive weekly gain.
- Saves targetMonths and lastGoalPlan in the user profile.
