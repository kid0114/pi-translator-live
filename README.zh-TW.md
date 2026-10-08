# pi-translator-live

[English](README.md)

[pi](https://github.com/earendil-works/pi) 的即時翻譯擴充套件：你的輸入會被翻譯成**輸出語言**（主模型思考與回覆所用的語言），而模型的回覆會以你的**輸入語言**（你的閱讀語言）顯示。工作階段歷史保留原文；翻譯僅用於顯示，完全不影響模型實際看到的內容。

- 自動偵測來源語言——用任何語言輸入都可以
- 雙向翻譯：輸入→輸出、回覆→顯示兩個方向可分別開關（`/translator input` 只翻譯輸入）
- 即時顯示切換：回覆文字在訊息定稿時翻譯完成，畫面上的 Markdown 立即換成你的閱讀語言；輸入翻譯進行中狀態列即時顯示（`→en · Esc`），可按 Esc 中途取消
- 程式碼區塊、行內程式碼、指令、路徑、URL 逐位元組保持不變
- 翻譯由獨立、可自行選擇的模型執行，主模型設定不受影響
- 輸入方向 fail-closed：翻譯失敗就不會送出，原稿會回到編輯器
- 顯示翻譯只存在記憶體中；已印出的終端歷史不會重繪

## 安裝

```bash
pi install git:github.com/kid0114/pi-translator-live
```

免安裝試用：

```bash
pi -e git:github.com/kid0114/pi-translator-live
```

## 需求

- pi ≥ 1.1.0
- pi 模型註冊表中至少一個已認證模型。你現有在用的模型都可以——託管的 OAuth 模型或本地 OpenAI 相容端點（在自己的 `models.json` 中設定）皆可。便宜快速的模型（例如 Gemini Flash 級別）最適合做翻譯。

## 首次執行

安裝後的第一個互動工作階段會出現一次性選擇器，請你選擇預設翻譯模型（推薦的輕量模型會標註）。選擇會存入 `~/.pi/agent/translator.json`。按 Esc 取消則本次使用內建啟發式選擇，下次啟動時會再詢問。

## 使用方式

翻譯預設為啟用。指令一覽：

| 指令 | 效果 |
|---|---|
| `/translator` 或 `/translator both` | 啟用輸入 + 回覆翻譯 |
| `/translator input` | 只翻譯輸入；回覆維持輸出語言 |
| `/translator off` | 關閉；進行中的翻譯會取消 |
| `/translator original` | 檢視最近一則完成回覆的原文（唯讀檢視器） |
| `/translator model [關鍵字]` | 本次執行切換翻譯模型（省略時開啟選擇器） |
| `/translator default [關鍵字]` | 同上，但儲存為預設值 |
| `/translator default clear` | 清除已儲存的預設模型 |
| `/translator default input [語言]` | 設定回覆的**顯示語言**（例如 `zh-TW`） |
| `/translator default output [語言]` | 設定**主模型語言**（例如 `en`） |

> 命名說明：`default input` 選的是回覆**顯示**的語言；`default output` 選的是你的輸入被翻譯**成**的語言，也就是主模型回覆所用的語言。

語言參數接受代碼（`en`、`zh-CN`、`zh-TW`、`ja`……）或英文名稱；省略參數可開啟選擇器。內建 32 種語言。

輸入翻譯進行中可按 Esc 取消。

## 選擇翻譯模型

### 本地模型（有條件時推薦）

本地模型讓文字不離開你的機器，且回應以毫秒計。任何 OpenAI 相容伺服器都可以——llama.cpp、LM Studio、vLLM、SGLang、Ollama，或 MLX 伺服器。小型的專用翻譯模型（例如 Hy-MT2 級別）或小型指令模型（7B 級別）已經綽綽有餘。

在你自己的 `~/.pi/agent/models.json` 中註冊端點：

```json
{
  "providers": {
    "local-translator": {
      "baseUrl": "http://localhost:PORT/v1",
      "api": "openai-completions",
      "apiKey": "local",
      "models": [{ "id": "<伺服器預期的模型 id>" }]
    }
  }
}
```

注意事項：

- 即使伺服器不驗證身份，pi 也要求填寫 `apiKey`——填 `"local"` 之類的虛設值即可。不填的話 pi 不會把該供應商列為可用。
- 伺服器必須接受 `system` 角色訊息（翻譯指令），每個文字區段搭配一則 `user` 訊息。

設定後執行一次 `/translator default local-translator/<模型 id>` 即可儲存。

### 沒有本地模型

直接使用你在 pi 中已認證的託管模型——無需額外設定，它就會出現在 `/translator model` 中。建議選便宜、快速、非推理型的模型（Gemini Flash 級別或類似者）：每次輸入和每則回覆都會觸發翻譯，重型推理模型只會增加延遲與 token 成本。內建的預設啟發式邏輯在首次執行時已優先選擇這類模型。

## 運作原理

- **輸入方向（fail-closed）**：你的文字在送出前翻譯成輸出語言。翻譯失敗時不會送出任何內容，原稿會回到編輯器。指令、`!shell`、路徑、程式碼一律不翻譯。
- **顯示方向（優雅降級）**：回覆的文字區段在訊息定稿時翻譯，再由 Markdown 顯示轉換換入快取譯文。歷史記錄與模型收到的內容不受影響。翻譯失敗時顯示原文。
- 系統提示掛鉤會要求主模型以輸出語言撰寫回覆，同時保留你的任務、程式碼、路徑與工具參數。

## 隱私

你的輸入與模型回覆會傳送給你所選的翻譯模型。在意這點的話請選用本地端點。除此之外不會傳送任何資料；本套件只在你自己的 pi 代理目錄中儲存偏好設定（`translator.json`）與可選的診斷日誌（`translator.log`）。
