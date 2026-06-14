<p align="center">
  <img src="extansion/images/icon-128.png" width="96" alt="Smart Preload logo">
</p>

# Smart Preload / Zero Latency Web

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | 日本語 | [한국어](README.ko.md) | [Deutsch](README.de.md) | [Français](README.fr.md) | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | [Русский](README.ru.md)

Smart Preload は Chrome と Edge に対応したブラウザ拡張機能です。次に開く可能性が高いページを、リンクスコア、タブの利用履歴、ホバー時プリロード、Windows ヘルパーアプリによるバックグラウンドウィンドウ制御を組み合わせて、より積極的にプリロードします。

## ダウンロード

最新版は [GitHub Releases](https://github.com/kingstonwang114514-cloud/zero-latency-web/releases/latest) からダウンロードしてください。

Windows アプリは任意ですが、推奨です。対応は Windows のみで、Native Messaging、ウォッチドッグ復旧、パフォーマンススナップショット、バックグラウンドウィンドウ制御に使われます。

## インストール

1. 先に Chrome または Edge で拡張機能をインストールまたは有効化します。
2. Windows アプリのパッケージを展開します。
3. 展開した app フォルダーで `install-register.cmd` を実行するか、アプリを一度起動します。
4. 初回の連携に成功すると、以後は拡張機能がローカルアプリを自動起動できます。

約 1 分間アプリを検出できない場合、拡張機能はアプリのダウンロードまたはフルネイティブプリロードモードの有効化を案内できます。

## 機能

- 現在のタブだけでなく、表示中の複数タブ全体でプリロードを調整します。
- 通常プリロードと実バックグラウンドタブプリロードに別々の予算を使います。
- リンクのホバーや右クリック時に独立したプリロードを開始できます。
- ローカルページ、プライベートネットワークページ、Google ページ、シークレットウィンドウ、設定されたプロキシ利用中の閲覧を除外できます。
- ブラウザ言語の自動検出に加えて、UI 言語を手動で選択できます。
- 履歴データは移行しやすいフォルダーに保存され、新しい PC や新しいバージョンへコピーできます。

## 注意

- 対応ブラウザ: Google Chrome と Microsoft Edge の Chromium ベース版。
- ネイティブアプリ: Windows のみ。
- 初回連携の順序が重要です。拡張機能を先にインストールまたは有効化し、その後 app 登録を実行してください。
- 予測ロジックは拡張機能側に残ります。ローカルアプリはローカル AI モデルを実行せず、AI プロバイダーのキーも保存しません。
