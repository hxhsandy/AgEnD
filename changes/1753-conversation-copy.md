---
section: Changed
---
- **Skill: credential-profiles adds manual Claude conversation copy procedure (#1753).** A new section documents how to carry a Claude Code conversation across a credential-profile switch: stop → update_instance_config while stopped → locate directories (slug is every non-alphanumeric character replaced by `-`; list the existing projects/ folder rather than computing the slug) → copy `.jsonl` and checkpoint folder, **never overwriting a newer destination transcript** → touch → start → verify. Switching back works the same way because the original files are never removed.
