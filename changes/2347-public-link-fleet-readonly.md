---
section: Security
---
- **Over a temporary public link the fleet's settings are read-only on the server too (#2347).** The public gateway refuses every write that changes `fleet.yaml`, or applies, reloads or restarts it, with 403 `fleet_settings_read_only_over_public_link` before any handler runs. That includes Settings, **New agent**, Fleet's config and deleting an agent. Reads, the emoji preview, pausing or waking an agent, withdrawing your own pending request, and chatting still work. Before this, only Web, Guests and Web authority writes were refused there.
