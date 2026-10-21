---
section: Security
---
- **透過暫時公開連結時，Fleet 設定在伺服器端也是唯讀（#2347）。** 公開閘道會在任何處理程序執行前，以 403 `fleet_settings_read_only_over_public_link` 拒絕每一個會變更 `fleet.yaml`（或套用、重新載入、重新啟動它）的寫入，包括設定、**New agent**、Fleet 的設定與刪除 agent。讀取、表情符號預覽、暫停或喚醒 agent、撤回自己待確認的請求，以及聊天仍可使用。在此之前，那裡只拒絕網頁、訪客與網頁授權的寫入。
