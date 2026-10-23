---
section: Added
---
- Office view skin packs: an admin uploads an artist's pack (its `manifest.json` and PNG files) in **Edit offices**; the host checks it with the page's own rules plus the pictures (PNG only, each frame strip exactly frames·w × h, a 16:9 background, per-file and per-pack size caps, no path traversal), keeps it unchanged in `web-office-skins/` in the AgEnD home and serves its pictures to signed-in viewers and the public link. Packs appear in the Style pickers; one that cannot be loaded is drawn as Desks with a note.
- Office view **Edit layout** (admin only): a 1280×720 coordinate overlay for a stored office in Studio or a pack — drag (or move with the arrow keys) seats, furniture, the door and waypoints, add or remove waypoints and corridors; saved as that office's overrides (the pack stays as uploaded), with **Reset** back to the pack's layout.
- Office view crowds: an area with more people than seats packs the rest into a tighter grid before showing "+N" in its corner, keeps only a few bubbles (calls, then work) and shows name tags on hover or focus; **Hide paused and stopped** (per browser) leaves the sleepers out.
