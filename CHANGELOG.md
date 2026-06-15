# Changelog

## v12
- Added “People to feed” to the weekly planner.
- Budget is now treated as the total weekly budget for all people.
- Shopping lists and product amounts scale automatically for 1-12 people.
- Meal calories/protein/carbs/fat are shown per person/serving, so logging a planned meal still logs one person’s portion.
- Plan cards now show total cost and estimated cost per person.

## v11
- Mise-style Danish weekly planner with store selection, kitchen equipment, dietary rules, budget, meal selection and reusable shopping list.
- Product Memory now powers weekly plans and flags missing nutrition/prices.
- Added meal swap and add-to-today buttons.

# BulkMind v9 — Product Memory automation

This version turns product scanning into a real memory system instead of a dead-end scan screen.

## New
- Product Memory dashboard with saved/preferred/missing-nutrition counters.
- Saved products now store category, default portion, price, package size, usage count, last used time, and whether they should be preferred in shakes.
- Generated shakes/meals can now reuse saved products automatically.
- Local generator now uses your saved milk, protein powder, skyr/yogurt, oats, peanut butter and other product categories when available.
- Gemini prompt now receives product history and is instructed to use preferred/recent products.
- Generated cards show "Using your products" when product memory was used.
- Generated cards can show a shopping note when a cheaper saved alternative exists or when price data is needed.
- If a saved/scanned product is missing nutrition, BulkMind asks for a nutrition label photo instead of guessing exact macros.
- Product cards now include "Prefer in shakes", "Ask AI compare", "Add nutrition photo", and "Use / edit".
- Manual product entry now supports category, price, package size and preferred-in-shakes.

## Notes
- Price comparison works between products you have saved. BulkMind does not search live supermarket prices.
- Open Food Facts data can be incomplete, so always review scanned products before saving.


## v10
- Added Denmark price planner inspired by meal-planner price apps.
- Added receipt/shelf-label price scan with Gemini vision.
- Added exact package price memory, cost per protein/kcal, and cheapest saved product suggestions.
- Added optional Salling Group API settings/connector shell for Netto/Føtex/Bilka sources when user has API access.
- Shake/meal generation now receives real saved Danish prices and should ask for missing nutrition/price instead of guessing.
