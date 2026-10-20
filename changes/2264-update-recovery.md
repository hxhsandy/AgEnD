---
section: Fixed
---
- Upgrades hand off to the exact npm target's installer; manual npm repair cannot be blocked by an update lock. Known stale artifacts are preserved aside, modern installs are not retired, failed npm rollback is checked, and root non-login service commands recover their runtime-directory default. Existing fleet data survives repair (#2264).
