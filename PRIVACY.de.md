# Smart Preload Datenschutzrichtlinie

Zuletzt aktualisiert: 23. Juni 2026

[English](PRIVACY.md) | [简体中文](PRIVACY.zh-CN.md) | [繁體中文](PRIVACY.zh-TW.md) | [日本語](PRIVACY.ja.md) | [한국어](PRIVACY.ko.md) | Deutsch | [Français](PRIVACY.fr.md) | [Español](PRIVACY.es.md) | [Português (Brasil)](PRIVACY.pt-BR.md) | [Русский](PRIVACY.ru.md)

Diese Richtlinie gilt für die Browsererweiterung Smart Preload und die optionale Windows-Begleit-App.

Smart Preload verwendet intelligente Preloading-Algorithmen, um wahrgenommene Ladezeiten zu reduzieren. Dafür verarbeitet die Erweiterung browsingbezogene Signale in deinem Browserprofil und auf deinem Gerät. Der Entwickler betreibt keinen Server, der deinen Browserverlauf sammelt, verkauft keine Nutzerdaten und gibt keine Nutzerdaten an Werbetreibende, Analyse-Datenbroker oder Datenbroker weiter.

## Lokal verarbeitete Daten

Smart Preload kann die folgenden Daten lokal verarbeiten und speichern:

- Seiten-URLs, Hosts, Titel und Navigationsübergänge.
- Auf Seiten gefundene Linkkandidaten, einschließlich Link-URLs, Linktext und nahegelegener Texte für die Sortierung.
- Tab-, Fenster-, Preload- und Prefetch-Status, der zum Verwalten vorbereiteter Seiten benötigt wird.
- Interaktionssignale wie Link-Hover, Kontextmenü-Preload-Absicht, Aktivität des Vordergrund-Tabs, kürzliche Aktivzeit und Medien-/Aktivitätsstatus für die Planung.
- Lesezeichentitel und URLs, wenn lesezeichenbasierte Preload-Funktionen aktiviert sind.
- Erweiterungseinstellungen, Preload-Limits, Sicherheitseinstellungen, lokale Verlaufsstatistiken, AI-Anbietereinstellungen und Diagnoseprotokolle, wenn Diagnosen aktiviert sind.

Diese lokalen Daten werden nur verwendet, um Smart-Preload-Funktionen bereitzustellen: Vorhersage, Ranking, Preload-Planung, Sicherheitsfilterung, lokale Verlaufslöschung, Diagnosen und optionales AI-gestütztes Scoring.

## Daten, die dein Gerät verlassen

Smart Preload sendet keinen Browserverlauf und keinen Preload-Verlauf an den Entwickler.

Daten können dein Gerät nur in diesen Fällen verlassen:

- Wenn du einen externen AI-Anbieter aktivierst und einen API key oder Endpunkt eingibst, kann die Erweiterung den ausgewählten Seiten-/Link-Kontext, der für Keyword- oder Relevanzbewertung benötigt wird, an diesen Anbieter senden. Für diese Anfragen gilt die Datenschutzrichtlinie des jeweiligen Anbieters.
- Wenn du einen lokalen AI-Endpunkt wie LM Studio verwendest, werden Anfragen an den von dir konfigurierten Endpunkt gesendet.
- Wenn du Updates der nativen App prüfst oder herunterlädst, können die Erweiterung oder die Windows-Begleit-App GitHub-Release-Seiten oder von GitHub gehostete Dateien abrufen.
- Wenn du eine Seite tatsächlich besuchst oder eine Preload-Funktion eine Seite im Browser lädt, findet normale Browser-Netzwerkkommunikation statt. Die Zielwebsite kann gewöhnliche Anfragen, Cookies und Sitzungsinformationen erhalten, wie bei einem normalen Seitenaufruf.

## Optionale Windows-Begleit-App

Die optionale Windows-Begleit-App hilft dabei, echte Preload-Fenster verborgen zu halten und lokale Systemintegration zu unterstützen. Sie kommuniziert auf demselben Gerät über Chrome/Edge native messaging mit der Erweiterung. Sie kann lokale Browserfenster-Metadaten und lokale Systemleistungs-/Aktivitätsinformationen verarbeiten, um das Preload-Verhalten zu verwalten. Sie sendet keinen Browserverlauf an den Entwickler.

## Speicherung und Löschung

Smart Preload speichert Daten im lokalen Erweiterungsspeicher des Browsers und in zugehörigen lokalen Dateien, die von der Erweiterung oder der Begleit-App verwendet werden. Du kannst ausgewählte lokale Verlaufsbereiche auf der Einstellungsseite der Erweiterung löschen. Du kannst gespeicherte Erweiterungsdaten auch entfernen, indem du die Erweiterung deinstallierst oder die Erweiterungsdaten im Browserprofil löschst.

## Berechtigungen

Smart Preload fordert Browserberechtigungen nur zur Unterstützung seiner Funktionen an, einschließlich Tab- und Navigationsereignissen, lokalem Speicher, lesezeichenbasierten Preload-Funktionen, native messaging mit der optionalen Begleit-App und geplanten Wartungsprüfungen.

## Kein Verkauf und keine Werbenutzung

Der Entwickler verkauft, vermietet oder teilt Nutzerdaten nicht mit Werbetreibenden, Analyse-Datenbrokern oder anderen Dritten für Tracking, Profiling oder Werbung.

## Chrome Web Store Limited Use

Die Nutzung von Informationen, die Smart Preload über Chrome-Erweiterungs-APIs erhält, ist auf die Bereitstellung und Verbesserung seines einzigen Zwecks beschränkt: wahrgenommene Ladezeiten durch lokale Vorhersage und Preloading zu reduzieren. Die Nutzung dieser Informationen durch Smart Preload entspricht der Chrome Web Store User Data Policy, einschließlich der Limited Use-Anforderungen.

## Datenschutz von Kindern

Smart Preload richtet sich nicht an Kinder und sammelt wissentlich keine personenbezogenen Daten von Kindern.

## Änderungen

Diese Richtlinie kann aktualisiert werden, wenn Smart Preload seine Datenverarbeitung ändert. Die neueste Version wird in diesem Repository veröffentlicht.

## Kontakt

Bei Datenschutzfragen: biocanse@gmail.com
