# Smart Preload Datenschutzrichtlinie

Zuletzt aktualisiert: 31. Juli 2026

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
- Wenn AI-Vorhersage aktiviert ist, ein kurzer Textauszug der von dir besuchten Seiten (bis zu 2.200 Zeichen). Er wird für Keyword- und Relevanzbewertung verwendet und bis zu 180 Tage gespeichert. Diese Auszüge sind auch in Verlaufs-Backups enthalten, die du auf der Einstellungsseite exportierst.
- Erweiterungseinstellungen, Preload-Limits, Sicherheitseinstellungen, lokale Verlaufsstatistiken, AI-Anbietereinstellungen und Diagnoseprotokolle, wenn Diagnosen aktiviert sind.

Diese lokalen Daten werden nur verwendet, um Smart-Preload-Funktionen bereitzustellen: Vorhersage, Ranking, Preload-Planung, Sicherheitsfilterung, lokale Verlaufslöschung, Diagnosen und optionales AI-gestütztes Scoring.

## Daten, die dein Gerät verlassen

Smart Preload sendet keinen Browserverlauf und keinen Preload-Verlauf an den Entwickler.

Daten können dein Gerät nur in diesen Fällen verlassen:

- Wenn du einen externen AI-Anbieter aktivierst und einen API key oder Endpunkt eingibst, sendet die Erweiterung Seitenkontext zur Keyword- und Relevanzbewertung an diesen Anbieter. Dieser Kontext umfasst:
  - die vollständige URL, den Titel und bis zu die ersten 2.200 Zeichen des sichtbaren Textes der Seite, die du gerade ansiehst;
  - für die Relevanzbewertung zusätzlich URL, Titel und Textauszug weiterer im selben Fenster geöffneter Tabs (bis zu 8) sowie kürzlich angesehener und gespeicherter Verlaufsseiten (jeweils bis zu 5).

  AI-Vorhersage ist standardmäßig deaktiviert und läuft erst, nachdem du einen Anbieter ausgewählt und einen API key eingegeben hast. Für diese Anfragen gilt die Datenschutzrichtlinie des jeweiligen Anbieters. **Wenn du nicht möchtest, dass Seiteninhalte an ein externes Unternehmen gesendet werden, verwende einen lokalen AI-Endpunkt (siehe unten) oder lasse AI-Vorhersage deaktiviert.**
- Wenn du einen lokalen AI-Endpunkt wie LM Studio verwendest, wird derselbe Kontext nur an den von dir auf deinem eigenen Rechner konfigurierten Endpunkt gesendet und erreicht kein drittes Unternehmen.
- Wenn die Windows-Begleit-App läuft, ruft die Erweiterung bei jedem Öffnen der Einstellungsseite die GitHub-Releases-API ab, um anzuzeigen, ob ein Update der Begleit-App verfügbar ist. Beim Herunterladen eines Updates werden ebenfalls GitHub-Release-Seiten oder von GitHub gehostete Dateien abgerufen.
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
