# BulkMind v18 Truthful Planner Fix

This build directly addresses the confusing planner flow.

## Fixed
- Store selector no longer pretends to be live Netto/Lidl/REMA pricing.
- Planner now explains what happens before generation.
- Generated meal cards now show ingredients and cooking steps, not just macros.
- Shopping list now shows price source, confidence, and scan/missing price status.
- Gemini prompt is stricter: it must include ingredients, instructions, grocery list, missing data and price-source labels.
- Fixed safeId recursion bug that could break logging/products.

## Important
Real 1:1 prices require saved scanned products, receipts/prices, or a connected official retailer API route. If no real price source exists, BulkMind marks the price as an estimate instead of lying.
