# PiP Browser

**PiP Browser est un navigateur Windows conçu pour regarder des vidéos en picture-in-picture pendant que l’on travaille ou joue aux jeux vidéo.**

Il affiche les vidéos dans des fenêtres flottantes qui restent au premier plan, au-dessus des autres applications. On peut ainsi suivre un tutoriel tout en utilisant un logiciel, ou regarder une vidéo pendant une partie, en gardant son activité principale à l’écran. La taille des fenêtres et leur opacité sont réglables pour adapter l’affichage à son espace de travail ou de jeu.

Une seule fenêtre s’ouvre au démarrage, sur la première page mémorisée ou sur YouTube au premier lancement. Le bouton **＋** permet ensuite d’en ouvrir d’autres.

## Lancer

Prérequis : Node.js LTS et npm.

```powershell
npm install
npm start
```

Créer un installateur Windows : `npm run pack`. Version portable : `npm run pack:portable` (résultat dans `release`).

## Utilisation

- Colle une adresse dans la barre puis appuie sur Entrée. Le bouton **＋** crée une fenêtre indépendante.
- Déplace la fenêtre depuis la large barre supérieure **⠿ Déplacer la fenêtre**, et redimensionne depuis ses bords ou la poignée turquoise en bas à droite. La zone de contenu conserve le ratio 16:9, avec une fine bordure de 6 pixels. Les commandes occupent 108 pixels en haut en mode édition.
- Les boutons **−** et **＋** de la barre supérieure diminuent ou augmentent la taille. **640 px** rétablit une largeur raisonnable sans changer la page ni son opacité.
- **Opacité** règle toute la fenêtre de 20 à 100 %.
- **Vidéo** isole le lecteur YouTube, sans extraire ni télécharger le flux. Ce mode expérimental dépend de la structure du site et fonctionne sur une page contenant un lecteur, pas sur la page d’accueil.
- Un **double clic droit dans la page** bascule entre **vidéo + compact** et le **mode normal** si un lecteur YouTube est présent. Dans une page ordinaire, ou une page YouTube sans lecteur, il active/désactive seulement **Compact**. Il agit seulement sur cette fenêtre. Le clic droit y est réservé à ce geste pour éviter que le menu du site intercepte le deuxième clic.
- Pour déplacer une fenêtre en mode normal, compact ou vidéo, maintiens le **clic droit dans le contenu** et glisse. Les petits mouvements de souris sont ignorés. Le relâchement après déplacement ne déclenche ni clic ni changement de mode. Le bouton gauche reste entièrement dédié à la page, y compris le maintien pour accélérer une vidéo YouTube. En mode jeu, utilise d’abord **Ctrl+Alt+G** pour reprendre le contrôle de la fenêtre : les clics y traversent la fenêtre vers le jeu.
- **Compact** masque la barre de commandes. **Ctrl+Alt+B** la réaffiche pour la dernière fenêtre active. Les boutons de taille sont distincts de ce mode.
- **Jeu** masque les commandes de toutes les fenêtres et laisse passer les clics vers le jeu. **Ctrl+Alt+G** quitte ce mode et restaure les barres précédemment visibles.
- **Ctrl+Alt+H** masque toutes les fenêtres d'un coup ; un second appui les réaffiche sans modifier leurs positions, tailles, opacités ou modes. Le menu PiP près de l'horloge propose aussi **Masquer / Afficher toutes les fenêtres**. Si le raccourci est occupé, **Ctrl+Alt+Maj+H** est essayé. Les fenêtres restent ouvertes et le son peut continuer. Une fenêtre créée pendant le masquage reste cachée jusqu'au réaffichage. Le masquage n'est pas conservé au redémarrage.
- **Ctrl+Alt+N** crée une fenêtre ; **Ctrl+Alt+Maj+R** récupère toutes les fenêtres, les replace sur l’écran principal et rétablit l’opacité à 100 %.
- L’icône **PiP près de l’horloge Windows** propose toutes ces commandes et permet de quitter l’application. Un double-clic sur l’icône récupère les fenêtres. Si un raccourci est occupé, un remplacement est essayé automatiquement : **Ctrl+Maj+F12** pour la récupération, et **Ctrl+Alt+Maj+lettre** pour les autres. Les raccourcis effectivement disponibles sont affichés dans le menu PiP et les infobulles. Aucun avertissement bloquant ne s’ouvre au démarrage.
- **Synchro** ouvre la synchro guilde : regarder la même vidéo YouTube que les autres membres de la guilde, avec une liste d'attente commune et une connexion Discord, sans compte à créer. L'option est désactivée par défaut. Voir [SYNCHRO.md](SYNCHRO.md).
- Fermer la dernière fenêtre quitte le logiciel. **Quitter** dans le menu près de l’horloge mémorise les réglages ; seule la première fenêtre enregistrée est rouverte au prochain lancement.

Positions, tailles, adresses et opacités sont stockées dans `windows.json` dans le dossier de données Electron de l’application. Les cookies sont conservés dans le profil `persist:browsing`, commun aux fenêtres. Les positions sont des positions de fenêtres, pas les positions de lecture des vidéos. Le mode jeu est désactivé à chaque lancement pour permettre de reprendre le contrôle.

## Limites à vérifier sur la machine

Utilise le jeu en **fenêtré sans bordure**. L’affichage par-dessus le plein écran exclusif n’est pas garanti. Il faut tester les performances avec les jeux concernés, les écrans à différentes échelles Windows, la lecture YouTube et la connexion au compte Google (qui peut refuser un navigateur intégré). Les contenus protégés par DRM ne sont pas garantis. Plusieurs vidéos consomment davantage de ressources.

Le navigateur refuse les téléchargements et les permissions caméra, microphone, localisation et notifications. Les pages distantes sont isolées des commandes de l’application ; seules les URL HTTP/HTTPS sont acceptées. Ce prototype ne remplace pas un navigateur généraliste.

## Vérification

```powershell
npm test
npm run check
npm run test:smoke
npm run test:sync-smoke
```

Essais manuels : deux lectures simultanées ; redimensionnement sur les huit bords/coins ; opacité indépendante ; clics transmis au jeu puis récupération au clavier et par l’icône ; fermeture et restauration de session ; déplacement entre écrans ; lecture après navigation ou rechargement.

Le test d’intégration `test:smoke` ouvre de vraies fenêtres Electron avec des pages de test locales et un profil isolé dans `.runtime`. Il ne vérifie pas la lecture YouTube réelle. Maximum : 12 fenêtres.

Voir [VERIFICATION.md](VERIFICATION.md) pour les résultats obtenus et les points restant à vérifier manuellement.

Pour participer au développement, voir le [guide de contribution](contribution.md).

## Mise à jour 0.1.1

Quitte l’ancienne version depuis le menu près de l’horloge avant de lancer `PiP Browser 0.1.1.exe`. Les fenêtres enregistrées par la version 0.1.0 sont rouvertes avec leurs adresses et une largeur limitée à 800 pixels. Leurs commandes sont réaffichées. Les nouvelles tailles choisies en 0.1.1 sont ensuite mémorisées normalement.

## Mise à jour 0.1.2

Quitte l’ancienne version depuis le menu près de l’horloge, puis lance `PiP Browser 0.1.2.exe`.

- Déplacer une fenêtre conserve désormais sa taille demandée, sans agrandissement cumulatif lié aux arrondis Windows.
- Le mode **Vidéo** affiche le lecteur au-dessus du reste de la page sans le déplacer dans le document ni recréer la vidéo. Cela évite le rognage de sa surface d’affichage par les conteneurs YouTube.
- Les tests incluent désormais des déplacements répétés et une vraie vidéo MP4 en lecture.

## Mise à jour 0.1.3

Quitte l’ancienne version depuis le menu près de l’horloge, puis lance `PiP Browser 0.1.3.exe`.

- Le mode vidéo se rétablit automatiquement si YouTube déplace, remplace ou masque son lecteur pendant un redimensionnement.
- Le double clic droit dans la page YouTube active **vidéo + compact** ; le même geste restaure le mode normal.

## Mise à jour 0.1.4

Quitte l’ancienne version depuis le menu près de l’horloge, puis lance `PiP Browser 0.1.4.exe`.

- Déplacement par clic gauche glissé depuis le contenu, même sans barre de commandes.
- Les clics courts conservent les liens, boutons et commandes de lecture habituels.
- Le double clic droit fonctionne sur les pages sans lecteur et y bascule seulement le mode compact.

## Mise à jour 0.1.5

Quitte l’ancienne version depuis le menu près de l’horloge, puis lance `PiP Browser 0.1.5.exe`.

- Le déplacement dans la page se fait avec le **bouton droit maintenu**, en laissant les interactions du bouton gauche au site.
- Le double clic droit change de mode uniquement après deux clics courts : un glissement ne le déclenche pas.
- Une seule fenêtre s’ouvre au démarrage, y compris après une session ayant plusieurs fenêtres.

## Mise à jour 0.1.6

L’application dispose de sa propre icône PiP, intégrée à l’exécutable Windows, aux fenêtres et à la zone près de l’horloge. Lance `PiP Browser 0.1.6.exe` après avoir quitté l’ancienne version.

Les sources de l’icône sont dans `assets/icon.svg`. Pour régénérer les fichiers PNG et ICO multirésolution sous Windows : `./scripts/build-icons.ps1`.

## Mise à jour 0.1.7

Quitte l’ancienne version puis lance `PiP Browser 0.1.7.exe`.

- Le cadre et son repère de coin deviennent invisibles en mode compact ou vidéo. Les mêmes zones sur les bords et les coins permettent toujours de redimensionner la fenêtre.
- L’icône PiP est également affichée dans la barre supérieure de l’interface.

## Application installable (0.2.0)

Lancer **release/PiP-Browser-Setup-0.2.0-x64.exe** pour installer PiP Browser dans Windows avec ses raccourcis et son entrée de désinstallation. Quitter d'abord la version portable.

Les mises à jour sont recherchées automatiquement puis téléchargées en arrière-plan. Le bouton **↑** et le menu près de l'horloge permettent une vérification manuelle et proposent le redémarrage lorsqu'une version est prête.

La première version est publiée sur [GitHub Releases](https://github.com/MonsieurZalfa/PiP-Browser/releases/latest). Les mises à jour sont distribuées depuis ce dépôt public. Voir [INSTALLATION.md](INSTALLATION.md) pour l'installation et le workflow de publication.

## Mise à jour 0.2.1

- **Ctrl+Alt+H** masque toutes les fenêtres ; un second appui les réaffiche en conservant leurs positions, tailles, opacités et modes.
- La commande est aussi disponible dans le menu PiP près de l'horloge. Si le raccourci est occupé, **Ctrl+Alt+Maj+H** est essayé.
- La récupération des fenêtres réaffiche également les fenêtres masquées. Le masquage n'est pas conservé au redémarrage.
- Un [guide de contribution](contribution.md) décrit le travail à plusieurs sur le projet.
