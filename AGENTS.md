<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Knot 專案導覽

台灣國考申論題練習系統，單人使用。核心流程：建題 → 作答（文字/手寫圖）→ Gemini AI 批改（考題重點 + 字卡）→ 複習（字卡/筆記/統計）。

## 技術棧

- Next.js 16（App Router、Turbopack）+ React 19 + TypeScript + Tailwind v4
- Firebase：Firestore（Admin SDK 走 server route）、Storage（client 直傳圖片）
- Gemini API（`@google/generative-ai`，模型 fallback 清單在 `api/analyze`）
- 介面文案一律繁體中文；設計風格為米色紙感（stone/amber 色系、`#fffdf8` 卡片）

## 頁面（`src/app/(app)/`，皆為 client component）

| 路徑 | 功能 |
|---|---|
| `/` | 練習大廳：題目列表、篩選（科目/關鍵字/年份）、狀態徽章（已完成/已批改/已生成字卡）、勾選匯出 Markdown、新增/編輯/刪除題目 |
| `/practice/[id]` | 作答頁：計時器、關鍵字標籤、草稿自動儲存（本機 0.8s / Firestore 4s debounce）、AI 批改、轉字卡、儲存解答批改與重點筆記 |
| `/flashcards` | 字卡總覽：純文字編輯、依科目篩選、匯出 Markdown |
| `/review` | 字卡複習：先設定範圍（科目、勾選關鍵字、全部/加強不記得），開始後隨機洗牌翻卡並回答「記得/不記得」（記入 rememberCount/forgetCount），結束有結算畫面。鍵盤：空白翻面、1 記得、2 不記得、←→ 切換 |
| `/skeleton-cards` | 骨架卡列表：依科目分組、顯示卡樁/完整徽章與待補完進度；新增表單科目為固定選單（資通網路/資通安全/資料庫應用/作業系統），關鍵字輸入會從 `/api/keywords` 帶出既有關鍵字建議；同科關鍵字有交集的題目會自動勾選連結（不限考古標記；考古題也可手動勾選） |
| `/skeleton-cards/[id]` | 骨架卡編輯：定義（無字數限制）→ 可複數組的分類架構＋逐點展開（`points.length` 不可超過 `count`）→ 結論；同科且關鍵字有交集的題目會自動連結並把題幹帶入問法（不限「考古」標記；清單另含標記為考古的題目可供手動勾選），也可手動調整；可連結其他骨架卡（`relatedCardIds`，雙向同步）；儲存時可手動選擇要存成「卡樁」或「骨架卡」，不再單純依內容完整度自動判斷 |
| `/skeleton-review` | 骨架卡回想模式複習：依科目/關鍵字/複習輪次（R1 全部／R2 信心<2／R3 信心=0）篩選，牌組依熱度＋信心排序（非洗牌），正面只給問法與分類鉤子，翻面才顯示完整內容，三段自評（秒答/想得出來/空白）寫回 `confidence`。鍵盤：空白翻面、1/2/3 自評、←→ 切換 |
| `/keypoints` | 速讀重點：彙整所有已批改題目的 examKeyPoints，依科目篩選、往下滑速讀 |
| `/notes`、`/keyword-notes` | 解答批改筆記、重點筆記列表 |
| `/stats` | 統計儀表板：總覽數字、各科進度條、近八週活動、常用關鍵字 |
| `/login` | 登入頁（`(app)` 群組之外） |

## API routes（`src/app/api/`，皆 `runtime = "nodejs"`）

- `questions`：GET 列表（用題目文件上的鏡射欄位，勿改回逐題查 attempts 的 N+1）；支援 `?archaeology=1` 篩選考古題；預設排除 `archived: true` 的封存題目（`?includeArchived=1` 可含封存）；POST 建題（內建重複題目偵測：同科目 bigram 相似度 ≥ 0.6 回 409 + `duplicates`，帶 `allowDuplicate: true` 可強制建立；封存題目不參與重複比對）
- `attempts/[questionId]`：一題一份作答紀錄（文件 ID = questionId）。PUT 會同步鏡射 `latestAttemptStatus`/`latestAttemptKeywords` 回 questions，且只對「新加入」的關鍵字遞增 usageCount（勿改壞，自動儲存會頻繁 PUT）；帶 `clearAnalysis: true` 可刪除已存的批改結果。**狀態防護**：只要 attempt 仍存有 analysis，PUT 送 `draft`/`completed` 會被伺服器升回 `analyzed`/`flashcards_ready`（避免自動儲存/暫存把「已批改」徽章洗掉），實際生效狀態以回應的 `status` 為準；`scripts/repair-attempt-status.mjs` 可修復歷史錯誤鏡射
- `analyze`：Gemini 批改（`GEMINI_MODEL`），輸出 `{ examKeyPoints: string[](2~6), flashcards: {front,back}[](2~6) }`，依題目配分決定數量、超限截斷。規則要求僅從考生答案萃取、不額外補充知識。可帶 `answerImageUrl`（本機 `/...` 路徑）或 `answerImageBase64`（手寫圖），並傳 `score` 供配分參考
- `ocr`：題目圖片辨識文字（`GEMINI_OCR_MODEL`，最便宜的 Flash-Lite），圖片只進記憶體不儲存，新增題目視窗的「掃描圖片辨識文字」按鈕會呼叫
- `flashcards`：GET 列表（會批次附帶各題 attempts 的 `keywordDisplay` 供複習頁篩選）/ POST 寫入（同題同內容去重；若題目 `isArchaeology` 為 true 則字卡寫入 `important: true`）/ `DELETE ?questionId=` 清除該題全部字卡
- `flashcards/[id]`：PUT 帶 `review: "remember" | "forget"` 會遞增 `rememberCount`/`forgetCount` 並更新 `lastReviewedAt`（優先於其他欄位更新）；一般 PUT 更新 front/back；DELETE 刪單張
- `keypoints`：GET 彙整已批改 attempts 的 `analysis.examKeyPoints`，批次補題目文字（getAll，勿改成 N+1）
- `skeleton-cards`：GET 列表（`?subject=` 篩選）/ POST 建卡（`keywords` 為主索引，至少 1 個，同科目關鍵字有交集回 409 + `duplicates`，帶 `allowDuplicate: true` 可強制建立；會依關鍵字自動連結同科題目並併入 `archaeologyQuestionIds`——不要求 `isArchaeology`，帶明確 ID 且未帶 `prompts` 時自動用題幹前 40 字產生問法草稿）；`isStub` 預設由 `src/lib/skeleton-cards.ts` 的 `isCardComplete()` 依內容完整度自動判斷（建立時無法覆寫，只有編輯 PUT 可以）
- `skeleton-cards/[id]`：GET 單卡 / DELETE 刪除 / PUT 三種模式：`{confidence:0|1|2}` 快速寫回複習信心值、`{heatDelta:number}`（或舊版 `{heatIncrement:true}`）調整熱度 ±1（夾在 0-3）、其餘欄位為內容編輯（`definition` 無字數限制；帶 `isStub:boolean` 可手動覆寫要存成卡樁還是骨架卡，不帶則沿用 `isCardComplete()` 自動判斷；帶 `keywords` 或 `archaeologyQuestionIds` 時會把同科關鍵字相符的題目併入連結；帶 `relatedCardIds` 會雙向同步——用 batch 把自己的 id 加進/移出對方文件的 `relatedCardIds`）
- `study-notes`、`personal-notes`、`keywords`、`export/questions`、`stats`、`auth/login`、`auth/logout`
- `archive`：GET 回傳 `{ activeCount, archivedCount }`；POST `{ action: "archiveAll" | "restoreAll" }` 批次封存/還原全部題目（資料保留，僅從各列表隱藏）；POST `{ action: "deleteAllArchived" }` 永久刪除所有封存題目及其 attempts/flashcards/studyNotes/personalNotes（資料真的會消失，練習大廳有二次確認對話框）。CLI：`node scripts/archive-all-questions.mjs [--dry-run] [--restore]`

## Firestore collections

- `questions`：題目 + 鏡射欄位（`latestAttemptStatus`、`latestAttemptKeywords`、`latestAttemptKeywordDisplay`）+ `isArchaeology`（考古標籤）+ `archived`/`archivedAt`（封存：隱藏但不刪除）
- `attempts`：作答紀錄（ID = questionId），status 流轉：`draft → completed → analyzed → flashcards_ready`（另有 `analyze_failed`）
- `flashcards`：字卡（含 `rememberCount`/`forgetCount`/`lastReviewedAt` 複習統計、`important` 考古題字卡標記，舊卡可能沒有這些欄位）
- `studyNotes`（解答批改）、`personalNotes`（重點筆記）、`keywords`（ID = 正規化關鍵字，含 usageCount）
- `skeletonCards`：骨架卡（定義→分類架構→逐點展開→結論四層，見 `src/lib/skeleton-cards.ts`），`topic`/`topicEn` 為主題名稱的中/英文欄位（英文選填）、`keywords`/`keywordDisplay` 為主索引、`archaeologyQuestionIds` 連結考古題作佐證、`relatedCardIds` 連結其他骨架卡（雙向，由 API 維護對稱性）、`heat`（0-3 手動加減）、`confidence`（0/1/2 複習信心，複習輪次 R1/R2/R3 依此篩選）、`isStub` 預設自動判斷但編輯時可手動覆寫。科目固定為 `src/lib/subjects.ts` 的 `PRESET_SUBJECTS`（資通網路/資通安全/資料庫應用/作業系統；舊別名「資通庫應用」會正規化）

## 認證

- 單人帳號。憑證存 `.env`：`AUTH_USERNAME`、`AUTH_PASSWORD_HASH`（scrypt，格式 `s2:salt:hash`，分隔符不可用 `$`——Next 載入 .env 會把 `$xxx` 展開成變數）、`AUTH_SECRET`（HMAC 金鑰）
- 換密碼：`node scripts/hash-password.mjs <新密碼>`，輸出貼回 `.env`
- Session：HMAC 簽章 token（`到期秒數.簽章`），`src/proxy.ts`（Next 16 的 middleware）驗證所有非公開路徑；驗證邏輯在 `src/lib/auth.ts`（Web Crypto，proxy 可用），密碼驗證在 `src/lib/auth-credentials.ts`（node:crypto，僅 API route 用）
- 登入 API 有連續失敗 5 次鎖 10 分鐘的機制

## 慣例與地雷

- 關鍵字一律經過 `src/lib/keywords.ts` 正規化（去 `#`、trim、比對用小寫；顯示用 `keywordDisplay`），新程式碼務必沿用
- 題目相似度比對在 `src/lib/similarity.ts`（去空白標點後做字元 bigram Jaccard）
- 錯誤處理模式：API 回 `{ error: string }`，client 統一 `payload?.error || 中文 fallback`
- 作答附圖（ERD 等）不走 Firebase Storage：圖片放 `public/answer-images/`，作答頁填本機路徑（`src/lib/local-image.ts` 的 `normalizeLocalImagePath` 正規化後存進 attempts 的 `imageUrl`）；批改時 client 帶 `answerImageUrl` 給 `api/analyze` 讀檔送 Gemini。手寫答案圖片上傳（Storage）保留但使用者暫不使用；批改仍支援 base64 圖片送 Gemini
- 舊資料相容：部分 questions 還有 legacy `latestDraft` 欄位，`scripts/migrate-attempts.mjs` 可遷移
- `.env` 含真實金鑰，勿印出或提交
