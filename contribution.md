# Contribuer à PiP Browser

Ce guide propose un cadre commun pour développer PiP Browser à plusieurs. Il couvre la préparation du projet, la coordination des tâches et la revue des changements.

## Préparer son environnement

- Windows pour lancer et vérifier l'application dans son environnement cible.
- Git et un compte GitHub pour proposer des pull requests.
- Node.js 24 et npm, pour utiliser la même version majeure que le workflow de publication.

Depuis un terminal PowerShell :

```powershell
git clone https://github.com/MonsieurZalfa/PiP-Browser.git
cd PiP-Browser
npm ci
npm start
```

`npm ci` installe les versions du fichier `package-lock.json`. Après une mise à jour de ce fichier, relancer cette commande. Si tu n'as pas les droits d'écriture sur le dépôt, crée un fork, clone ton fork et ouvre ensuite ta pull request vers `MonsieurZalfa/PiP-Browser`, sur `main`.

Lire aussi le [README](README.md), les [vérifications](VERIFICATION.md) et les [instructions d'installation et de publication](INSTALLATION.md).

## Se repérer dans le code

| Emplacement | Rôle |
| --- | --- |
| `src/main.js` | Processus principal Electron : fenêtres, session, raccourcis et commandes de l'application. |
| `src/core.js` | Fonctions partagées de logique applicative. |
| `src/index.html`, `src/style.css`, `src/renderer.js` | Interface locale et interactions avec la barre de commandes. |
| `src/preload.js` | Pont entre l'interface locale et le processus principal. |
| `src/surface-preload.js` | Gestion des gestes dans le contenu des pages. |
| `src/player-mode.js` | Comportement du mode vidéo. |
| `src/updates.js` | Gestion des mises à jour. |
| `src/sync.js`, `src/sync-core.js` | Synchro guilde : connexion Discord via Supabase, salons, lecture partagée et liste d'attente (voir [SYNCHRO.md](SYNCHRO.md)). |
| `src/sync.html`, `src/sync.css`, `src/sync-renderer.js`, `src/sync-preload.js` | Panneau de la synchro guilde. |
| `supabase/` | Schéma SQL et fonction Edge `verify-guild` du serveur de synchro. |
| `test/` | Tests automatisés, scénario Electron et ressources locales de test. |
| `assets/`, `scripts/build-icons.ps1` | Icônes et script de génération. |
| `.github/workflows/release.yml` | Compilation et publication Windows lors d'un push de tag `v*`. |

## Se coordonner avant de coder

1. Ouvrir ou choisir une issue décrivant le problème, le résultat attendu et les critères permettant de vérifier le résultat.
2. Indiquer dans l'issue qui prend la tâche et quels fichiers ou comportements seront concernés.
3. Pour une évolution importante, convenir de l'approche avant de modifier les interfaces partagées, les échanges IPC ou le format des données enregistrées.
4. Ouvrir une pull request en brouillon dès qu'une première version est utile à relire. Relier l'issue pour rendre le travail en cours visible.

Privilégier des tâches courtes et des pull requests centrées sur un seul objectif. Si plusieurs personnes doivent modifier le même fichier, se répartir les parties concernées et convenir de l'ordre de fusion. Éviter les reformattages globaux dans une modification fonctionnelle : ils compliquent les revues et les résolutions de conflits.

## Travailler sur une branche

Garder `main` comme base commune et proposer les changements par pull request. Avant de commencer, vérifier que les changements locaux sont enregistrés ou mis de côté.

```powershell
git switch main
git pull --ff-only origin main
git switch -c feat/description-courte
```

Utiliser un nom explicite, par exemple `feat/controle-volume`, `fix/restauration-fenetres` ou `docs/installation`. Pour les branches créées par Codex, utiliser le préfixe `codex/`.

Faire des commits cohérents avec un message décrivant le changement, par exemple `fix: conserver la taille pendant un déplacement`. Ne pas inclure de modifications sans rapport avec la tâche.

Avant de demander une revue, intégrer les derniers changements de `main` :

```powershell
git fetch origin
git merge origin/main
```

En cas de conflit, comprendre et conserver les comportements attendus des deux changements, puis relancer les vérifications. Échanger avec l'auteur de l'autre changement si l'intention est incertaine. Ne pas réécrire l'historique d'une branche partagée sans accord des personnes qui l'utilisent.

Publier ensuite la branche :

```powershell
git push -u origin HEAD
```

## Conventions de développement

- Suivre le style existant : JavaScript CommonJS, indentation de deux espaces et points-virgules.
- Garder la logique testable dans des fonctions indépendantes lorsque c'est pertinent, et réserver les interactions Electron aux modules qui les gèrent.
- Préserver l'isolation entre les pages distantes et les commandes de l'application. Toute évolution des preloads ou des messages IPC doit valider les entrées et leur provenance.
- Maintenir la compatibilité des réglages enregistrés, ou prévoir une migration explicite et vérifiée.
- Mettre à jour la documentation lorsque les commandes, raccourcis ou comportements visibles changent.
- Ajouter ou adapter les tests lorsqu'un correctif ou une évolution modifie un comportement testable.

Pour ajouter une dépendance, expliquer son utilité dans la pull request et versionner ensemble `package.json` et `package-lock.json`. Éviter de modifier le lockfile sans nécessité.

Ne pas committer `node_modules/`, `release/`, `.runtime/`, les journaux, les profils de navigation, les cookies ou les secrets. Les dossiers de dépendances, de compilation et de test local sont déjà ignorés par Git.

## Vérifier avant une revue

Pour un changement de code, exécuter :

```powershell
npm test
npm run check
npm run test:smoke
npm run test:sync-smoke
```

- `npm test` exécute les tests Node.js.
- `npm run check` vérifie la syntaxe des modules listés dans le script de `package.json` ; ce n'est pas un linter complet.
- `npm run test:smoke` ouvre de vraies fenêtres Electron avec des pages locales et un profil isolé dans `.runtime`. Il ne valide pas la lecture YouTube réelle.
- `npm run test:sync-smoke` vérifie la synchro guilde dans Electron, sans réseau : pilotage du lecteur sur une page locale et panneau Synchro.

Compléter avec les essais manuels pertinents dans [VERIFICATION.md](VERIFICATION.md). Pour les changements de fenêtres ou de gestes, vérifier notamment le déplacement, le redimensionnement, les modes compact/vidéo/jeu, la récupération au clavier et la restauration au redémarrage. Pour le lecteur, tester aussi une vraie page YouTube.

Si la compilation ou les mises à jour sont concernées, vérifier également `npm run pack`. L'installateur est produit dans `release/`, sans publication. `npm run pack:portable` permet de vérifier la version portable.

Une modification de documentation seule demande surtout de vérifier les liens, les chemins et l'exactitude des commandes. Dans tous les cas, préciser les vérifications effectuées et celles qui restent à faire.

Le workflow actuel s'exécute sur les tags de publication ; il ne lance pas automatiquement ces vérifications sur chaque pull request. Ne pas considérer l'absence d'échec GitHub Actions comme une validation de la pull request.

## Préparer et relire une pull request

Utiliser un titre décrivant le résultat et une description qui permet de comprendre et de vérifier le changement. Exemple de trame à copier :

```markdown
## Objectif
Problème résolu et comportement obtenu.
Issue liée : Closes #123

## Changements
- Principaux changements et éventuels effets sur les données existantes.

## Vérifications
- Commandes exécutées et résultats.
- Essais manuels, version de Windows et configuration pertinente.
- Limites ou points restant à vérifier.
```

Ajouter des captures ou une courte vidéo si l'interface ou les gestes changent. Demander la revue d'au moins une autre personne avant de fusionner ; traiter les remarques et relancer les vérifications affectées par les corrections. Le relecteur vérifie le comportement attendu, les risques de régression et la clarté du code.

Après fusion, les autres contributeurs mettent leur branche à jour depuis `main`. La branche fusionnée peut être supprimée lorsqu'elle n'est plus utilisée. Les règles de revue décrites ici sont une convention d'équipe ; leur application automatique nécessite une configuration de protection de branche sur GitHub.

## Publier une version

Réserver la publication à la personne qui coordonne la version. Un push de tag `v*` déclenche le workflow de publication et peut distribuer la version aux utilisateurs via les mises à jour automatiques.

Suivre [INSTALLATION.md](INSTALLATION.md) pour la procédure : cohérence entre la version du paquet et le tag, mise à jour du lockfile et publication des fichiers de la même compilation. Une pull request ordinaire ne nécessite ni changement de version ni création de tag.
