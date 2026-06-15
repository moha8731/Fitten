# BulkMind PWA

Personal fitness/bulk app built as a free PWA. It saves data locally on your device using IndexedDB.

## Run locally
Open `index.html`, or run:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.

## Deploy
Upload all files in this folder to GitHub and deploy on Vercel as a static site.

## Gemini AI
Go to Settings → Gemini AI and paste your Gemini API key. The key is stored locally on the device/browser.

## v9 Product Memory
Product scanning is now connected to the rest of the app:

- Scan/enter a barcode through Open Food Facts.
- If nutrition is missing, take a label photo and Gemini will extract the per-100g/ml macros.
- Save products to Product Memory.
- Mark normal products as "Prefer in shakes".
- Add price/package size to compare saved products.
- Shake/meal generation reuses saved products automatically when possible.
- Generated cards show which saved products were used.
- If product data is missing, BulkMind asks for the nutrition label instead of guessing.

## Privacy
Data stays in your browser/iPhone storage unless you export it. Gemini requests are sent to Google only when you use AI features.


## v12
- Weekly planner now supports feeding multiple people.
- Budget, shopping list and total cost scale for everyone.
- Meal calories/macros remain per person so logging one serving stays correct.
- Shopping list clearly shows total amounts and cost per person.

## v11
- Added Denmark weekly meal planner: store, equipment, diet rules, meals, budget and combined shopping list.
- Uses Product Memory and saved exact prices first; missing price/nutrition is flagged for scanning.
- Added meal swaps and one-tap logging from weekly plan.
