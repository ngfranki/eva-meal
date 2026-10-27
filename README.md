# 飲食記錄（eva-meal）

私人飲食＋健身記錄工具。單一 `index.html`，GitHub Pages 託管，資料存 Supabase。登入由伺服器核對暗號，本機只留工作階段 token（`appSession.meal`），唔再儲暗號。

- 網址：https://ngfranki.github.io/eva-meal/
- 手機「加至主畫面」即似 app（有 manifest＋icon）
- 開頁要輸入暗號（唔喺呢個 repo 度）
- 內建食物庫 38 樣，每樣有可查證來源（USDA FoodData Central／香港食物安全中心／日本文部科學省食品成分表），撳食物名可睇來源
- 唔做熱量消耗估算、唔做健康建議
