# 2.3 realistic sweep: screenshots (PR #2067)

Fixture data only: 60 synthetic instances, no real accounts. Chromium (Chrome for Testing 151), headless.

- `sheets/`: one contact sheet per smoke. Rows are shots; columns are matrix cases (desk 1366 / phone 390 × light / dark × en / zh-TW).
  - `sheet-mod-effects.png` comes from main before #2046, so its dark cases show the white effect frame.
- `before-after/`:
  - `2044-*`: an effect in the dark theme: before (opaque white frame over the chat), after (see-through);
  - `2047-*`: the org chart with long CJK names: before (past their cards), after (inside);
  - `2055-*`: the Effects dialog: before ("Stopped"), after (the three-pauses OFF sentence; "Was running; paused while this dialog is open").
