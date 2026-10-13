---
section: Changed
---
- **Skill：credential-profiles 新增手動複製 Claude 對話的操作說明（#1753）。** 新增段落說明在切換 Claude Code credential profile 時如何保留對話：停止 → 已停止時執行 update_instance_config → 定位目錄（slug 是把所有非英數字元換成 `-`；應直接列出現有的 projects/ 資料夾確認，而非自行計算）→ 複製 `.jsonl` 與 checkpoint 資料夾，**絕不覆蓋目的地較新的 transcript** → touch → 啟動 → 驗證。原始檔案永遠保留，切換回去可依相同步驟操作。
