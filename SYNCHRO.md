# Synchro guilde

La synchro permet aux membres de la guilde de regarder la même vidéo YouTube au même moment, avec une liste d'attente commune. Il n'y a pas de compte à créer : on se connecte avec Discord, et seuls les membres du serveur Discord de la guilde peuvent se brancher.

L'option est **désactivée par défaut**. Tant qu'elle reste désactivée, PiP Browser n'établit aucune connexion au serveur de synchro.

## Utilisation

1. Dans une fenêtre PiP, clique sur **Synchro** (ou ouvre **Synchro guilde…** dans le menu près de l'horloge). Le panneau s'ouvre et cette fenêtre devient la **fenêtre synchronisée**.
2. Coche **Activer**, puis **Se connecter avec Discord**. Le navigateur par défaut s'ouvre sur Discord : accepte, puis reviens à PiP Browser. L'application vérifie que ton compte fait partie du serveur de la guilde.
3. **Crée** un salon ou **rejoins**-en un avec son code à 6 caractères. Le bouton **Code** copie le code pour le partager sur Discord.
4. **Ajoute** des vidéos YouTube à la liste d'attente. Si rien n'est en cours, la première vidéo démarre pour tout le monde.

Dans un salon :

- Lecture, pause et déplacement dans la vidéo sont partagés avec tout le salon. Chacun peut piloter la lecture.
- À la fin d'une vidéo, la suivante de la liste démarre automatiquement, une seule fois même si plusieurs membres terminent en même temps. **Suivante ⏭** passe directement à la vidéo suivante.
- **▶** dans la liste lance une vidéo tout de suite pour tout le monde. **✕** la retire de la liste : c'est possible pour la personne qui l'a ajoutée et pour la personne qui a créé le salon.
- **Partager ma vidéo** fait regarder à tout le salon la vidéo ouverte dans la fenêtre synchronisée, à sa position actuelle.
- Si tu navigues ailleurs dans la fenêtre synchronisée, le salon ne te suit pas et tu n'es plus synchronisé. **Revenir au salon** te ramène à la vidéo et à la position du salon. Quand le salon passe à une nouvelle vidéo, la fenêtre l'ouvre automatiquement.
- Le panneau affiche qui est présent dans le salon.
- Un écart de plus de 2 secondes avec le salon est corrigé automatiquement.

Une seule fenêtre est synchronisée à la fois. Clique sur **Synchro** dans une autre fenêtre pour la synchroniser à la place. Seules des vidéos YouTube peuvent circuler dans un salon : un membre ne peut pas faire ouvrir une autre adresse chez les autres.

## Mise en place du serveur (une seule fois)

La synchro utilise un projet [Supabase](https://supabase.com) (base Postgres, Realtime, Auth et Edge Functions) et une application Discord.

### 1. Application Discord

1. Sur le [portail développeur Discord](https://discord.com/developers/applications), crée une application, puis ouvre **OAuth2**.
2. Note le **Client ID** et génère un **Client Secret**.
3. Ajoute l'adresse de redirection fournie par Supabase : `https://<projet>.supabase.co/auth/v1/callback`.
4. Récupère l'**identifiant du serveur** Discord de la guilde : active le mode développeur dans Discord, puis fais un clic droit sur le serveur et choisis **Copier l'identifiant du serveur**.

### 2. Projet Supabase

1. Crée un projet Supabase.
2. Dans **Authentication → Sign In / Providers → Discord**, active Discord et colle le Client ID et le Client Secret.
3. Dans **Authentication → URL Configuration**, ajoute `http://127.0.0.1:47821/callback` aux **Redirect URLs**. C'est l'adresse locale sur laquelle PiP Browser reçoit la fin de la connexion.
4. Applique le schéma `supabase/migrations/20261115000000_synchro_guilde.sql`. Tu peux le coller dans le **SQL Editor**, ou utiliser la CLI : `supabase link` puis `supabase db push`.
5. Déploie la fonction de vérification et définis l'identifiant du serveur Discord :

   ```powershell
   supabase functions deploy verify-guild
   supabase secrets set DISCORD_GUILD_ID=123456789012345678
   # Facultatif : n'autoriser que certains rôles du serveur (un seul suffit)
   supabase secrets set DISCORD_REQUIRED_ROLE_ID=123456789012345678,234567890123456789
   ```

   `DISCORD_REQUIRED_ROLE_ID` accepte un ou plusieurs identifiants de rôles, séparés par des virgules. Avoir **l'un** de ces rôles suffit pour se brancher. Sans ce secret, tous les membres du serveur sont acceptés. Si un identifiant de la liste est mal saisi, la vérification refuse tout le monde au lieu d'ouvrir l'accès à tout le serveur. Pour copier l'identifiant d'un rôle : **Paramètres du serveur → Rôles**, clic droit sur le rôle, **Copier l'identifiant** (mode développeur activé).

6. Dans **Realtime → Settings**, laisse l'accès aux canaux publics autorisé. Les changements de la base passent par un canal public qui reste protégé par les règles RLS. La présence passe par des canaux privés réservés aux membres.

### 3. Relier l'application

Renseigne l'adresse du projet et la clé publique (**publishable** ou **anon**, jamais la clé `service_role`) dans `package.json` :

```json
"pipSync": {
  "supabaseUrl": "https://<projet>.supabase.co",
  "supabaseKey": "sb_publishable_..."
}
```

Ces deux valeurs sont publiques par nature. Pour un essai sans modifier le fichier, utilise les variables d'environnement `PIP_SYNC_SUPABASE_URL` et `PIP_SYNC_SUPABASE_KEY`.

## Sécurité

- **Pas de compte à créer** : Supabase enregistre une identité Discord technique, sans mot de passe. La connexion demande les autorisations Discord `identify` et `guilds.members.read`, c'est-à-dire lire son propre profil et son appartenance au serveur. Supabase y ajoute l'adresse e-mail du compte Discord, qu'il utilise pour identifier la personne.
- **Vérification de la guilde** : la fonction `verify-guild` interroge Discord avec le jeton de l'utilisateur et vérifie que ce jeton appartient au même compte que la session. Elle enregistre ensuite une attestation valable 24 heures. L'application la renouvelle toutes les 12 heures et à chaque connexion. Quelqu'un qui quitte le serveur Discord perd l'accès au plus tard 24 heures après.
- **Accès à la base** : aucune écriture directe dans les tables n'est possible. Toutes les actions passent par des fonctions SQL qui vérifient l'attestation, et la lecture est réservée aux membres vérifiés grâce aux règles RLS.
- **Contenu partagé** : seuls des identifiants de vidéo YouTube (11 caractères) circulent. Ils sont contrôlés dans l'application et par la base. Les noms et les titres sont affichés comme du texte, jamais comme du HTML.
- **Stockage local** : les jetons restent dans le processus principal. Ils sont stockés dans `sync-session.bin`, chiffré avec Windows (DPAPI), dans le dossier de données de l'application. Ni l'interface ni les sites web n'y ont accès.
- **Limites anti-abus** : 10 salons par heure et par membre, et 100 vidéos au plus dans une liste d'attente.

## Limites connues

- Les publicités YouTube ne sont pas synchronisées : pendant une publicité, la fenêtre ne pilote rien et ne suit pas le salon. Elle se recale ensuite.
- La vitesse de lecture n'est pas partagée. Une vitesse différente provoque des corrections régulières de la position.
- La lecture automatique de YouTube peut ouvrir une autre vidéo quand la liste est vide. La fenêtre sort alors du salon ; utilise **Revenir au salon**.
- Le jeton Discord expire au bout de 7 jours environ. Il faut alors se reconnecter avec Discord.
- Le port local 47821 doit être libre pendant la connexion Discord.

## Vérifications

- `npm test` couvre la validation des adresses, le calcul de position, l'ordre des événements et le gestionnaire de synchro, avec un faux serveur Supabase.
- `npm run test:sync-smoke` ouvre de vraies fenêtres Electron. Il vérifie le pilotage du lecteur sur une page locale imitant YouTube (position, lecture, pause, absence d'écho, correction d'écart) ainsi que l'affichage et les commandes du panneau. Il ne contacte ni Supabase ni Discord.
- À vérifier manuellement avec un vrai projet : la connexion Discord, le refus d'un compte hors guilde, et deux PC dans le même salon (lecture, pause, déplacement, fin de vidéo et liste d'attente, présence, retour au salon).
