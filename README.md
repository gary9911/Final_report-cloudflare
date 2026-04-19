技術摘要

1. 專案概述
FINDTAIL 是一款專為行動裝置優化的單頁 Web 應用程式，以純 HTML + CSS + 原生 JavaScript 開發，無後端框架。主要提供資產總覽、即時報價、配置圖表、歷史績效、部位調整與交易記帳等功能。透過 Cloudflare Workers 實現雲端資料同步與持久化，打造即時互動的投資組合管理工具。

2. 技術架構
前端技術：
HTML、CSS、原生 JavaScript、Bootstrap
圖表套件：
Chart.js
UI 資源：
Google Fonts（Inter、Noto Sans TC、Noto Serif TC）與 Font Awesome 6
資料儲存：
Cloudflare KV + 自訂 Workers 端點
報價來源：
TWSE 開放資料 + Yahoo Finance API（經 Workers Proxy 處理 CORS）
部署方式：
單一 index.html 靜態檔案
製作流程：
GOOGLE GEMINI 3.1 pro 協作
3. 核心功能
英雄總覽區：動態顯示總資產、成本、報酬率與今日損益（含數字動畫）。
資產卡片：台股、美股、現金區塊，支援展開詳細列表與迷你配置長條圖。
即時報價與圖表：圓餅圖呈現資產配置，線圖顯示趨勢與現金水位。
部位調整與交易記帳：支援買賣、配息，自動計算加權平均成本，具歷史交易管理功能。
歷史績效：整合 Yahoo Finance 6個月 K 線資料，計算多週期漲跌幅。
4. 資料管理與設計特色
全域 appData 物件管理狀態，透過加密金鑰與 Cloudflare KV 實現 Serverless 雲端同步。

專案亮點： 輕量化、高效能（Promise.all 並行請求）、響應式設計（最大寬度 480px）、行動裝置優先。安全性採用自訂 Header 驗證與 Workers Proxy 保護資料存取。
