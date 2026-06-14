<p align="center">
  <img src="extansion/images/icon-128.png" width="96" alt="智慧預載圖示">
</p>

# 智慧預載 / Zero Latency Web

[English](README.md) | [简体中文](README.zh-CN.md) | 繁體中文 | [日本語](README.ja.md) | [한국어](README.ko.md) | [Deutsch](README.de.md) | [Français](README.fr.md) | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | [Русский](README.ru.md)

智慧預載是一個支援 Chrome 和 Edge 的瀏覽器擴充功能，用於更智慧、更積極地預載你很可能下一步開啟的網頁。它會結合連結評分、分頁活動歷史、滑鼠懸停預載，以及 Windows 本機 app 的背景視窗控制能力。

## 下載

請從 [GitHub Releases](https://github.com/kingstonwang114514-cloud/zero-latency-web/releases/latest) 下載最新版。

Windows app 是選用元件，但建議安裝。它僅支援 Windows，用於 Native Messaging、看門狗修復、效能快照和背景視窗控制。

## 安裝

1. 先在 Chrome 或 Edge 中安裝或啟用擴充功能。
2. 解壓縮 Windows app 包。
3. 在解壓後的 app 資料夾中執行 `install-register.cmd`，或啟動一次 app。
4. 首次綁定成功後，擴充功能後續可以自動喚起本機 app。

如果擴充功能約 1 分鐘仍偵測不到本機 app，會提示下載 app 或開啟全原生預載模式。

## 功能

- 全域預載調度，不再只圍繞目前分頁分配。
- 普通預載和真實背景分頁預載使用兩套獨立額度。
- 滑鼠懸停連結、右鍵連結時可觸發獨立預載。
- 可排除本機網頁、內網頁面、Google 頁面、無痕視窗，以及依設定排除走代理的瀏覽。
- 支援自動語言偵測，也支援手動選擇介面語言。
- 歷史資料存放在可遷移資料夾中，換電腦或升級版本時可以直接複製。

## 注意

- 支援瀏覽器：Google Chrome 和 Microsoft Edge 的 Chromium 版本。
- 本機 app：僅 Windows。
- 首次綁定順序很重要：先安裝或啟用擴充功能，再執行 app 註冊。
- 預測邏輯保留在擴充功能中；本機 app 不執行本機 AI 模型，也不保存 AI 服務商金鑰。
