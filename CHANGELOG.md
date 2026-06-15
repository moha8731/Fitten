# BulkMind v16

- Fixed Gemini 400 error: tool/search use is no longer combined with `response_mime_type: application/json`.
- JSON prompts now force raw JSON and parse it safely when Google Search/tool mode is enabled.
- Setup no longer gets stuck if Gemini fails; it falls back to a safe local bulking calculator.
- Weekly planner no longer dead-ends on AI failure; it creates a local backup plan and explains what failed.
- Updated service worker cache so iPhone gets the new build.
