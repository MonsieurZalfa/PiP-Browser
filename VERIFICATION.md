# Vérification du prototype 0.1.7

- `npm test` : quatre tests passent (validation des adresses, ratio et ancrage des huit poignées, restauration de données invalides, réduction des anciennes fenêtres lors de la mise à jour).
- `npm run check` : syntaxe JavaScript valide.
- Test Electron sous Windows : ouverture de plusieurs fenêtres, premier plan, isolation des pages, opacité indépendante, ratio de la vue, mode compact, mode jeu et récupération par la fonction du menu vérifiés avec des pages locales.
- Régression du redimensionnement : les huit poignées sont testées dans Electron en agrandissant puis en réduisant au cours du même geste ; les boutons de taille, la remise à 640 pixels et le déplacement sont vérifiés.
- Régression du déplacement : le test reproduit l’ancien défaut (640 × 468 devenant 641 × 469). La correction est vérifiée sur 40 mouvements consécutifs et 20 gestes distincts : pas de croissance cumulée, avec une tolérance d’un pixel pour l’arrondi de l’échelle Windows. La taille demandée est mémorisée indépendamment des dimensions arrondies renvoyées par Windows.
- Régression du mode vidéo : un fichier MP4 réel est décodé et joué dans le test Electron. Le passage en mode vidéo conserve le même élément vidéo en lecture, laisse la fenêtre à sa taille et produit une capture de l’image visible. La désactivation restaure les attributs du lecteur. Le fichier de test CC0 n’est pas inclus dans l’exécutable.
- Redimensionnement en mode vidéo : six changements de taille franchissent plusieurs fois un seuil de mise en page qui retire puis réinsère le lecteur. Le mode se rétablit après chaque changement, après fermeture du popover et après remplacement du conteneur. La désactivation arrête les observateurs et restaure le lecteur normal.
- Double clic droit : les vrais événements souris Electron vérifient qu’un clic isolé ne change pas le mode, que deux clics activent vidéo + compact et que la paire suivante restaure le mode normal. Une autre fenêtre reste inchangée. Le contenu internet n’obtient aucun accès aux commandes de l’application.
- Glissement au bouton droit depuis le contenu : testé par événements souris Electron en mode normal, compact, vidéo et vidéo + compact. Le bouton gauche, même pendant un glissement, ne déplace pas la fenêtre. Le glissement droit conserve sa taille et son relâchement ne déclenche pas de clic dans la page ni de changement de mode, même après un premier clic droit court. Le preload isolé ne publie aucune API au site et ne transmet les gestes que depuis le cadre principal enregistré.
- Page ordinaire sans lecteur : le double clic droit bascule compact / normal ; les clics de bouton, de lien et la saisie de texte sont testés.
- Le mode Jeu transmettant les clics au jeu, il faut d’abord en sortir pour manipuler la fenêtre. Le nouveau glissement droit a été vérifié par événements souris Electron ; l’ancien essai souris réel de la 0.1.4 concernait le bouton gauche.
- Démarrage : un profil contenant deux fenêtres enregistrées n’en ouvre qu’une. L’ouverture volontaire de fenêtres supplémentaires est ensuite vérifiée par le bouton Nouvelle fenêtre.
- YouTube réel : sept changements de taille entre 400 et 1280 pixels en mode vidéo + compact. Le lecteur reste ouvert et remplit la zone vidéo à chaque étape. La capture après le dernier redimensionnement a été inspectée et l’image reste visible.
- Essai réel à la souris avec Computer Use : réduction par le bouton **−**, réduction par la poignée inférieure droite et déplacement par la large barre supérieure vérifiés visuellement sous Windows.
- Le nouveau raccourci de récupération **Ctrl+Alt+Maj+R** (ou son remplacement **Ctrl+Maj+F12**) s’enregistre dans l’environnement de test. Les conflits sont traités sans boîte de dialogue bloquante. Le menu près de l’horloge et son double-clic restent les solutions de secours. La réception des raccourcis physiques et la transmission effective des clics à un jeu nécessitent un essai manuel.
- Sur une vraie page YouTube, le mode vidéo affiche maintenant l’image (capture inspectée à 60 secondes dans Big Buck Bunny), conserve le même élément vidéo et sa position de lecture, puis restaure le lecteur à la désactivation. Le profil de test affiche aussi un consentement YouTube et la vidéo y était déjà en pause avant l’activation du mode : la lecture continue sur YouTube reste à valider manuellement. La connexion au compte n’a pas été testée.
- Aucun jeu n’a été lancé pour les essais. Le plein écran exclusif, les performances sous charge et les configurations multi-écrans restent à vérifier.
- L’exécutable portable est généré sans certificat de signature.
- `npm audit` signale six alertes modérées dans les dépendances de développement d’electron-builder, liées à minimatch. Ces outils ne sont pas inclus dans l’exécutable ; pas de mise à niveau forcée vers une version majeure incompatible.

Les essais réseau utilisent un profil distinct dans `.runtime`. Ils ne modifient pas un profil Chrome ou Edge existant.

## Cadre invisible et icône de l’interface

- Fenêtre transparente et sans ombre ; les marges gardent un alpha de 1/255, visuellement imperceptible, pour rester accessibles à la souris sous Windows. Leurs dimensions ne changent pas.
- Test Electron : le cadre compact a un alpha inférieur ou égal à 2/255, le coin garde une zone de 12 × 12 pixels et son repère devient transparent. Le mode normal retrouve son fond opaque. L’image de l’icône dans le GUI charge correctement.
- Test souris réel : réduction depuis le coin invisible, de 640 à 540 pixels de largeur, vérifiée visuellement en mode compact. L’icône de la barre supérieure a également été inspectée.
- Le test d’intégration complet, notamment la vidéo en lecture, l’opacité, les gestes et les changements de mode, passe avec la nouvelle fenêtre transparente.

## Installateur et mises à jour (0.2.0)

- Installateur NSIS Windows x64 généré, avec raccourcis et désinstallation ; données utilisateur conservées.
- Huit tests unitaires passent, dont quatre sur les mises à jour : mode développement/portable, recherches concurrentes, échec réseau et reprise, confirmation avant installation et sauvegarde préalable.
- Le test Electron complet des fenêtres, gestes et vidéo passe avec le nouveau module.
- Test réel electron-updater sur serveur local : détection d'une version supérieure, téléchargement de l'installateur généré, contrôle SHA-512 et passage à l'état prêt au redémarrage. L'installateur n'est pas exécuté par ce test.
- Les fichiers app-update.yml, latest.yml et .blockmap sont générés. Le flux vise GitHub Releases (MonsieurZalfa/PiP-Browser).
- Le workflow GitHub a compilé et publié la version v0.2.0 avec succès. Le téléchargement réel depuis le flux GitHub public a été testé par electron-updater : nouvelle version détectée, exécutable téléchargé, empreinte SHA-512 vérifiée et état prêt au redémarrage obtenu. L’installation Windows réelle et le remplacement d’une application déjà installée n’ont pas été exécutés par les tests.

## Compatibilité Twitch (0.2.3)

- Pull effectué avant toute modification : main mis à jour de bfb1907 à a9566de avec les correctifs de synchronisation.
- Tests dédiés Twitch : lecteur direct et iframe, double clic droit, déplacement natif sans changement de taille, redimensionnement, retour normal et conservation d’une mise en page Studio préexistante.
- Vérification sur un direct Twitch public : lecture en cours avant et après activation (21,68 s puis 23,26 s), lecteur couvrant toute la vue 988 × 556 ; déplacement de 60 × 40 pixels sans variation de taille ; restauration des commandes.
- Image du direct en mode vidéo inspectée. Le lecteur n’est ni extrait ni recréé.
- Les tests Electron YouTube et de synchronisation passent après la modification. Aucun changement des fonctions de synchronisation n’a été effectué.
