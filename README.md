# PR #2313 before / after screenshots

All eight images were captured locally with Chromium 156 (Playwright Chromium 1248), the same inert smoke-fixture driver and seeded task cards. This is a UI comparison, not a production-fleet acceptance run.

- Before: c2eab1bbfe42b9400db84ad65c6f2f981d4aef4b (already includes the missing CSS-brace hotfix).
- After: c813b264e877e1ee9cd566ce26c7740a8bc51319.
- Desktop: 1366 × 900, light, English.
- Phone: 390 × 844, dark, zh-TW.
- Seed: Release readiness project; five main tasks distributed over all five statuses; the in-progress task has two subtasks, a goal, scope and three acceptance items.
- Synthetic smoke fixture data only; scratch AGEND_HOME; owned loopback listeners 48720/48721 and 48730/48731. Fleet start, CLI/provider/tmux startup and real tunnel calls were not invoked. Task-board wake admission was stubbed before attaching the board. The eight synthetic screenshots are published on the review artifact branch for the requested comparison.
- Driver: ../review-2313-ui.mts. Run receipts: before-run.log, after-run.log. Geometry and CSP/page-error results: before-measurements.json, after-measurements.json.

| View | Before | After |
| --- | --- | --- |
| Desktop board | before-desk-light-en-board.png | after-desk-light-en-board.png |
| Desktop open card | before-desk-light-en-card.png | after-desk-light-en-card.png |
| Phone board | before-phone-dark-zh-TW-board.png | after-phone-dark-zh-TW-board.png |
| Phone open card | before-phone-dark-zh-TW-card.png | after-phone-dark-zh-TW-card.png |

Observed: desktop columns become equally tall, tiles more compact/bold, task card changes from a centered 640 px dialog to a full-height 620 px right drawer; on phone it retains the existing full-width bottom sheet. Assignee chips gain initials. Both before and after have zero page-wide horizontal overflow at the captured widths, zero off-screen dialog buttons in the geometry probe, zero collected page errors and zero CSP violations. The task-card body scrolls internally; the screenshot shows its top, not the entire card.
