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
