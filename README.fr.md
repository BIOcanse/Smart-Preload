<p align="center">
  <img src="extansion/images/icon-128.png" width="96" alt="Logo Smart Preload">
</p>

# Smart Preload / Zero Latency Web

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Deutsch](README.de.md) | Français | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | [Русский](README.ru.md)

Smart Preload est une extension pour Chrome et Edge qui precharge plus activement les pages que vous etes susceptible d'ouvrir ensuite. Elle combine le score des liens, l'historique d'activite des onglets, le prechargement au survol et une application Windows pour mieux controler les fenetres en arriere-plan.

## Telechargement

Telechargez la derniere version depuis [GitHub Releases](https://github.com/kingstonwang114514-cloud/zero-latency-web/releases/latest).

L'application Windows est facultative mais recommandee. Elle est disponible uniquement pour Windows et sert au Native Messaging, a la recuperation par watchdog, aux instantanes de performance et au controle des fenetres en arriere-plan.

## Installation

1. Installez ou activez d'abord l'extension dans Chrome ou Edge.
2. Extrayez le package de l'application Windows.
3. Executez `install-register.cmd` dans le dossier app extrait, ou lancez l'application une fois.
4. Apres la premiere liaison reussie, l'extension peut lancer automatiquement l'application locale.

Si l'application n'est pas detectee pendant environ une minute, l'extension peut proposer de telecharger l'application ou d'activer le mode de prechargement entierement natif.

## Fonctionnalites

- Planification globale du prechargement sur les onglets visibles, pas seulement l'onglet courant.
- Budgets separes pour les prechargements normaux et les vrais prechargements d'onglets en arriere-plan.
- Prechargement independant au survol d'un lien ou lors d'un clic droit sur un lien.
- Exclusions pour les pages locales, les pages de reseau prive, les pages Google, les fenetres de navigation privee et la navigation via proxy configuree.
- Choix manuel de la langue de l'interface en plus de la detection automatique de la langue du navigateur.
- Les donnees d'historique locales sont stockees dans un dossier portable et peuvent etre copiees vers un nouvel ordinateur ou une nouvelle version.

## Notes

- Navigateurs pris en charge : versions Chromium de Google Chrome et Microsoft Edge.
- Application native : Windows uniquement.
- L'ordre de la premiere liaison est important : installez ou activez d'abord l'extension, puis lancez l'enregistrement de l'application.
- La logique de prediction reste dans l'extension. L'application locale n'execute pas de modeles AI locaux et ne stocke pas de cles de fournisseurs AI.
