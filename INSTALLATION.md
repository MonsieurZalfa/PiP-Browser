# Installer PiP Browser et publier les mises à jour

## Installation

Lancer **release/PiP-Browser-Setup-0.2.0-x64.exe**. L'assistant installe l'application Windows pour l'utilisateur courant, propose le dossier d'installation, crée les raccourcis et une entrée de désinstallation. Quitter la version portable avant de lancer l'assistant, puis utiliser le raccourci du menu Démarrer.

Les données utilisateur (pages mémorisées, réglages et cookies) restent dans le même profil que la version portable. La désinstallation conserve ces données.

## Mises à jour dans l'application

Une recherche a lieu dix secondes après le démarrage, puis toutes les six heures. Une nouvelle version est téléchargée en arrière-plan. Le bouton **↑** dans la barre supérieure et le menu près de l'horloge permettent de vérifier manuellement les versions ou de redémarrer pour installer un téléchargement terminé.

Le redémarrage exige une confirmation. Quitter normalement n'installe pas la mise à jour. Les erreurs réseau des recherches automatiques ne créent pas de fenêtre bloquante. En développement et dans les versions portables, ces commandes sont désactivées.

## Activation de la publication

Le flux public pointe sur **MonsieurZalfa/PiP-Browser** sur GitHub Releases. La première version v0.2.0 est publiée : https://github.com/MonsieurZalfa/PiP-Browser/releases/tag/v0.2.0. L’application accède aux mises à jour sans identifiant embarqué.

Le workflow **.github/workflows/release.yml** est prêt :
1. Changer la version de package.json puis exécuter npm install --package-lock-only.
2. Committer et pousser les sources, puis un tag correspondant à la version, par exemple v0.2.0.
3. GitHub Actions teste le projet, compile Windows, joint les trois fichiers à un brouillon, puis publie la version complète.

Les trois fichiers à publier ensemble sont :
- PiP-Browser-Setup-0.2.0-x64.exe
- PiP-Browser-Setup-0.2.0-x64.exe.blockmap
- latest.yml

Pour publier manuellement, joindre ces trois fichiers de la même compilation à une version GitHub publique et stable. Ne pas mélanger les fichiers de compilations différentes.

Le workflow utilise le jeton temporaire GitHub Actions. Aucun jeton personnel n'est incorporé à l'application. Si les sources doivent rester privées, créer un dépôt public de distributions, changer build.publish.owner/repo et adapter le workflow pour y publier, puis reconstruire l'application avant distribution.

## Commandes

- npm run pack : installateur NSIS et métadonnées, sans publication.
- npm run pack:portable : exécutable portable.
- npm test et npm run check : tests et syntaxe.
- node node_modules/electron/cli.js test/updater-download.cjs : test réel de téléchargement sur un serveur local, après compilation. Ajouter --github pour tester le flux public réel. Le test simule la version cliente 0.1.7 et ne lance jamais l'installateur.

L'installateur n'est pas signé avec un certificat de signature Windows. Les téléchargements de mise à jour sont contrôlés par SHA-512 à partir du manifeste servi par GitHub en HTTPS.
