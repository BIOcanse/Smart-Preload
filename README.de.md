<p align="center">
  <img src="extansion/images/icon-128.png" width="96" alt="Smart Preload logo">
</p>

# Smart Preload / Zero Latency Web

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | Deutsch | [Français](README.fr.md) | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | [Русский](README.ru.md)

Smart Preload ist eine Browsererweiterung fuer Chrome und Edge, die wahrscheinlich als Naechstes geoeffnete Seiten aktiver vorlaedt. Sie kombiniert Link-Bewertung, Tab-Aktivitaetsverlauf, Hover-Preloading und eine Windows-Hilfsapp fuer staerkere Kontrolle von Hintergrundfenstern.

## Download

Laden Sie die neueste Version ueber [GitHub Releases](https://github.com/kingstonwang114514-cloud/zero-latency-web/releases/latest) herunter.

Die Windows-App ist optional, wird aber empfohlen. Sie ist nur fuer Windows verfuegbar und wird fuer Native Messaging, Watchdog-Reparatur, Performance-Snapshots und Hintergrundfenstersteuerung verwendet.

## Installation

1. Installieren oder aktivieren Sie zuerst die Erweiterung in Chrome oder Edge.
2. Entpacken Sie das Windows-App-Paket.
3. Fuehren Sie `install-register.cmd` im entpackten app-Ordner aus oder starten Sie die App einmal.
4. Nach der ersten erfolgreichen Kopplung kann die Erweiterung die lokale App automatisch starten.

Wenn die App etwa eine Minute lang nicht erkannt wird, kann die Erweiterung zum Download der App oder zum Aktivieren des voll nativen Preload-Modus auffordern.

## Funktionen

- Globale Preload-Planung ueber sichtbare Tabs hinweg, nicht nur fuer den aktuellen Tab.
- Getrennte Budgets fuer normale Preloads und echte Hintergrund-Tab-Preloads.
- Eigenstaendiges Preloading beim Hover ueber Links oder beim Rechtsklick auf Links.
- Ausschluesse fuer lokale Seiten, private Netzwerkseiten, Google-Seiten, Inkognito-Fenster und konfigurierte Proxy-Nutzung.
- Manuelle UI-Sprachauswahl zusaetzlich zur automatischen Erkennung der Browsersprache.
- Lokale Verlaufsdaten liegen in einem portablen Ordner und koennen auf einen neuen Computer oder eine neue Version kopiert werden.

## Hinweise

- Unterstuetzte Browser: Chromium-basierte Versionen von Google Chrome und Microsoft Edge.
- Native App: nur Windows.
- Die Reihenfolge bei der ersten Kopplung ist wichtig: zuerst die Erweiterung installieren oder aktivieren, danach die App-Registrierung ausfuehren.
- Die Vorhersagelogik bleibt in der Erweiterung. Die lokale App fuehrt keine lokalen AI-Modelle aus und speichert keine AI-Anbieter-Schluessel.
