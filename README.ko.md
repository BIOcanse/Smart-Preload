<p align="center">
  <img src="extansion/images/icon-128.png" width="96" alt="Smart Preload logo">
</p>

# Smart Preload / Zero Latency Web

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | 한국어 | [Deutsch](README.de.md) | [Français](README.fr.md) | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | [Русский](README.ru.md)

Smart Preload는 Chrome과 Edge를 지원하는 브라우저 확장 프로그램입니다. 링크 점수, 탭 활동 기록, 마우스 호버 프리로드, Windows 도우미 앱의 백그라운드 창 제어를 조합해 다음에 열 가능성이 높은 페이지를 더 적극적으로 미리 불러옵니다.

## 다운로드

최신 버전은 [GitHub Releases](https://github.com/kingstonwang114514-cloud/zero-latency-web/releases/latest)에서 다운로드하세요.

Windows 앱은 선택 사항이지만 설치를 권장합니다. Windows 전용이며 Native Messaging, 워치독 복구, 성능 스냅샷, 백그라운드 창 제어에 사용됩니다.

## 설치

1. 먼저 Chrome 또는 Edge에서 확장 프로그램을 설치하거나 활성화합니다.
2. Windows 앱 패키지를 압축 해제합니다.
3. 압축을 푼 app 폴더에서 `install-register.cmd`를 실행하거나 앱을 한 번 시작합니다.
4. 첫 연결이 성공하면 이후 확장 프로그램이 로컬 앱을 자동으로 실행할 수 있습니다.

약 1분 동안 앱을 감지하지 못하면 확장 프로그램이 앱 다운로드 또는 전체 네이티브 프리로드 모드 사용을 안내할 수 있습니다.

## 기능

- 현재 탭만이 아니라 표시 중인 여러 탭 전체에 프리로드 예산을 배분합니다.
- 일반 프리로드와 실제 백그라운드 탭 프리로드가 서로 독립된 예산을 사용합니다.
- 링크에 마우스를 올리거나 링크를 우클릭할 때 독립 프리로드를 시작할 수 있습니다.
- 로컬 페이지, 사설 네트워크 페이지, Google 페이지, 시크릿 창, 설정된 프록시 관련 탐색을 제외할 수 있습니다.
- 브라우저 언어 자동 감지와 수동 UI 언어 선택을 모두 지원합니다.
- 기록 데이터는 이동 가능한 폴더에 저장되어 새 컴퓨터나 새 버전으로 복사할 수 있습니다.

## 참고

- 지원 브라우저: Chromium 기반 Google Chrome 및 Microsoft Edge.
- 네이티브 앱: Windows 전용.
- 첫 연결 순서가 중요합니다. 확장 프로그램을 먼저 설치하거나 활성화한 뒤 app 등록을 실행하세요.
- 예측 로직은 확장 프로그램에 남아 있습니다. 로컬 앱은 로컬 AI 모델을 실행하지 않으며 AI 제공자 키를 저장하지 않습니다.
