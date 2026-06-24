# Politique de confidentialité de Smart Preload

Dernière mise à jour : 23 juin 2026

[English](PRIVACY.md) | [简体中文](PRIVACY.zh-CN.md) | [繁體中文](PRIVACY.zh-TW.md) | [日本語](PRIVACY.ja.md) | [한국어](PRIVACY.ko.md) | [Deutsch](PRIVACY.de.md) | Français | [Español](PRIVACY.es.md) | [Português (Brasil)](PRIVACY.pt-BR.md) | [Русский](PRIVACY.ru.md)

Cette politique s'applique à l'extension de navigateur Smart Preload et à l'application Windows compagnon optionnelle.

Smart Preload utilise des algorithmes de préchargement intelligents pour réduire le temps d'attente perçu. Pour cela, l'extension traite des signaux liés à la navigation dans votre profil de navigateur et sur votre appareil. Le développeur n'exploite pas de serveur collectant votre historique de navigation, ne vend pas les données utilisateur et ne les partage pas avec des annonceurs, des courtiers d'analyse ou des courtiers de données.

## Données traitées localement

Smart Preload peut traiter et stocker localement les données suivantes :

- URL de pages, hôtes, titres et transitions de navigation.
- Liens candidats trouvés sur les pages, y compris URL, texte de lien et texte proche utilisé pour le classement.
- État des onglets, fenêtres, préchargements et prélectures nécessaires à la gestion des pages préparées.
- Signaux d'interaction tels que survol de lien, intention de préchargement via menu contextuel, activité de l'onglet au premier plan, temps d'activité récent et état média/activité utilisé par la planification.
- Titres et URL de favoris lorsque les fonctions de préchargement basées sur les favoris sont activées.
- Paramètres de l'extension, limites de préchargement, paramètres de sécurité, statistiques d'historique local, paramètres de fournisseur AI et journaux de diagnostic lorsque les diagnostics sont activés.

Ces données locales sont utilisées uniquement pour fournir les fonctions de Smart Preload : prédiction, classement, planification du préchargement, filtrage de sécurité, suppression d'historique local, diagnostics et notation assistée par AI optionnelle.

## Données envoyées hors de votre appareil

Smart Preload n'envoie pas l'historique de navigation ni l'historique de préchargement au développeur.

Les données peuvent quitter votre appareil uniquement dans les cas suivants :

- Si vous activez un fournisseur AI externe et saisissez une API key ou un endpoint, l'extension peut envoyer à ce fournisseur le contexte de page/lien sélectionné nécessaire à la notation par mots-clés ou pertinence. La politique de confidentialité de ce fournisseur s'applique à ces requêtes.
- Si vous utilisez un endpoint AI local tel que LM Studio, les requêtes sont envoyées à l'endpoint que vous avez configuré.
- Si vous vérifiez ou téléchargez des mises à jour de l'application native, l'extension ou l'application Windows compagnon peut contacter les pages de publication GitHub ou des fichiers hébergés par GitHub.
- Lorsque vous visitez réellement une page, ou lorsqu'une fonction de préchargement charge une page dans le navigateur, le réseau normal du navigateur est utilisé. Le site de destination peut recevoir des requêtes, cookies et informations de session ordinaires, comme lors d'un chargement normal.

## Application Windows compagnon optionnelle

L'application Windows compagnon optionnelle aide à garder les fenêtres de préchargement réel masquées et prend en charge l'intégration système locale. Elle communique avec l'extension sur le même appareil via Chrome/Edge native messaging. Elle peut traiter localement des métadonnées de fenêtres de navigateur et des informations de performance/activité du système pour gérer le comportement de préchargement. Elle n'envoie pas l'historique de navigation au développeur.

## Stockage et suppression

Smart Preload stocke ses données dans le stockage local de l'extension du navigateur et dans des fichiers locaux associés utilisés par l'extension ou l'application compagnon. Vous pouvez supprimer des plages sélectionnées d'historique local depuis la page des paramètres de l'extension. Vous pouvez aussi supprimer les données stockées en désinstallant l'extension ou en effaçant les données d'extension du profil de navigateur.

## Autorisations

Smart Preload demande uniquement les autorisations nécessaires à ses fonctions, notamment la gestion des onglets et événements de navigation, le stockage local, les fonctions de préchargement basées sur les favoris, le native messaging avec l'application compagnon optionnelle et les contrôles de maintenance planifiés.

## Aucune vente ni utilisation publicitaire

Le développeur ne vend, ne loue et ne partage pas les données utilisateur avec des annonceurs, des courtiers d'analyse ou d'autres tiers à des fins de suivi, de profilage ou de publicité.

## Limited Use du Chrome Web Store

L'utilisation par Smart Preload des informations reçues via les API d'extension Chrome est limitée à la fourniture et à l'amélioration de son objectif unique : réduire le temps d'attente perçu grâce à la prédiction locale et au préchargement. L'utilisation de ces informations par Smart Preload respecte la Chrome Web Store User Data Policy, y compris les exigences Limited Use.

## Confidentialité des enfants

Smart Preload ne s'adresse pas aux enfants et ne collecte pas sciemment d'informations personnelles d'enfants.

## Modifications

Cette politique peut être mise à jour lorsque Smart Preload modifie son traitement des données. La dernière version sera publiée dans ce dépôt.

## Contact

Pour toute question relative à la confidentialité : biocanse@gmail.com
