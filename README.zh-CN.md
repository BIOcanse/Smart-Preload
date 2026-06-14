<p align="center">
  <img src="extansion/images/icon-128.png" width="96" alt="智能预加载图标">
</p>

# 智能预加载 / Zero Latency Web

[English](README.md) | 简体中文 | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Deutsch](README.de.md) | [Français](README.fr.md) | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | [Русский](README.ru.md)

智能预加载是一个支持 Chrome 和 Edge 的浏览器扩展，用于更智能、更积极地预加载你很可能下一步打开的网页。它会结合链接评分、标签页活动历史、鼠标悬停预加载，以及 Windows 本地 app 的后台窗口控制能力。

## 下载

请从 [GitHub Releases](https://github.com/kingstonwang114514-cloud/zero-latency-web/releases/latest) 下载最新版。

Windows app 是可选组件，但建议安装。它仅支持 Windows，用于 Native Messaging、看门狗修复、性能快照和后台窗口控制。

## 安装

1. 先在 Chrome 或 Edge 中安装或启用扩展。
2. 解压 Windows app 包。
3. 在解压后的 app 文件夹中运行 `install-register.cmd`，或者启动一次 app。
4. 首次绑定成功后，扩展后续可以自动拉起本地 app。

如果扩展约 1 分钟仍检测不到本地 app，会提示下载 app 或开启全原生预加载模式。

## 功能

- 全局预加载调度，不再只围绕当前标签页分配。
- 普通预加载和真实后台标签页预加载使用两套独立额度。
- 鼠标悬停链接、右键链接时可触发独立预加载。
- 可排除本地网页、内网页面、Google 页面、无痕窗口，以及按配置排除走代理的浏览。
- 支持自动语言检测，也支持手动选择界面语言。
- 历史数据存放在可迁移文件夹中，换电脑或升级版本时可以直接复制。

## 注意

- 支持浏览器：Google Chrome 和 Microsoft Edge 的 Chromium 版本。
- 本地 app：仅 Windows。
- 首次绑定顺序很重要：先安装或启用扩展，再运行 app 注册。
- 预测逻辑保留在扩展中；本地 app 不运行本地 AI 模型，也不保存 AI 服务商密钥。
