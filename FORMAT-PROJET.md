# Format de projet Écrivain — version 1

Écrivain utilise son propre format de projet local et autonome.

## Identification

Le fichier `project.json` contient au minimum :

```json
{
  "format": "ecrivain-project",
  "formatVersion": 1
}
```

Un projet dont `formatVersion` est supérieur à la version comprise par l’application
n’est pas modifié : Écrivain refuse de l’ouvrir afin d’éviter toute corruption.

## Structure principale

```text
Mon Roman/
├── project.json
├── synopsis.json
├── mindmap.json
├── chapters/
│   └── autosave/
├── notes/
├── board/
│   ├── cards/
│   └── timeline/
│       └── events/
├── stats/
├── assets/
│   ├── notes/
│   └── covers/
├── exports/
├── styles/
├── backups/
├── history/
├── trash/
├── recovery/
└── extensions/
```

## Principe de sécurité

Les chapitres restent des fichiers JSON indépendants. Une erreur sur un chapitre ne
doit donc pas rendre tout le roman illisible. Les fichiers corrompus sont copiés dans
`recovery/` avant toute tentative de restauration.

Les sources de récupération, dans l’ordre, sont :
1. historique du chapitre ;
2. autosauvegardes techniques ;
3. sauvegardes complètes du projet.

Le rapport de la dernière vérification est stocké dans
`recovery/last-validation.json`.

## Chapitres et sous-chapitres

Chaque fichier de chapitre possède un champ `parent`. `null` désigne un chapitre principal ; l’identifiant d’un autre chapitre désigne un sous-chapitre. La hiérarchie peut être modifiée depuis le menu **Chapitres** sans modifier le contenu du texte.


## Données des extensions

Le dossier `extensions/` appartient au projet et contient uniquement les données propres
aux extensions. Le code des extensions n’est jamais copié dans le roman.

```text
extensions/
└── identifiant-extension/
    └── data.json
```

La présence de ce dossier est additive et reste compatible avec `formatVersion: 1`.

## Champs ajoutés par la bêta.11 (schéma interne 1.5.0)

Tous sont facultatifs et additifs : un projet qui ne les contient pas reste valide, et
une version antérieure d’Écrivain qui les rencontre les ignore.

`project.json` :

| Champ | Rôle |
| --- | --- |
| `uuid` | Identifiant stable du projet (UUID), ajouté à l’ouverture d’un ancien projet. Il sert d’identifiant à l’EPUB exporté (`urn:uuid:…`). |
| `pageNumbers` | `true` (par défaut si absent) ou `false` : numéroter les pages des exports Word, OpenDocument et PDF. |
| `runningHeader` | En-tête courant des exports : `none` (défaut), `title`, `author` ou `author-title` (auteur sur les pages paires, titre sur les pages impaires). |
| `exportExcludeStatuses` | Liste des statuts de chapitre non exportés. Par défaut `["cut"]` ; `"draft"` est aussi accepté. |

Chapitres (`chapters/<id>.json`) :

| Champ | Rôle |
| --- | --- |
| `wcv` | Version du compteur de mots qui a produit `wordCount` (actuellement `2`). Un chapitre dont `wcv` diffère est recompté une seule fois à l’ouverture. |
| `excludeFromExport` | `true` : le chapitre, et ses sous-chapitres, ne sont pas exportés. |
| `status` | `draft`, `writing`, `review`, `final` ou `cut`. |

Sauvegardes (`backups/backup-*/backup.json`) : `kind` vaut `manual` ou `auto` (chaque type
a son propre quota de cinq sauvegardes). Une sauvegarde ne contient ni `backups/`, ni
`history/`, ni `exports/`, ni `trash/`.

## Corbeille

Supprimer un chapitre ou une note ne l’efface pas : l’élément est déplacé dans `trash/`.

```text
trash/
└── 20260131-101502-123-ch-xxxx/
    ├── manifest.json
    ├── chapters/      (le chapitre et ses sous-chapitres)
    ├── notes/         (les notes liées)
    └── files/         (leurs pièces jointes)
```

Le fichier `manifest.json` est écrit en premier : une opération interrompue laisse donc un
élément récupérable, signalé comme incomplet. La restauration ne remplace jamais un
chapitre ou une note qui existe déjà ; l’élément concerné reste dans la corbeille.
La corbeille n’est jamais vidée automatiquement. Elle est conservée telle quelle lors de
la restauration d’une sauvegarde.

## Historique des chapitres

Dans `history/<identifiant-du-chapitre>/`, les jalons automatiques (`…-autosave.json`) sont
allégés : tous conservés pendant sept jours, puis un par jour jusqu’à trente jours, puis un
par semaine. Les jalons manuels, `avant-restauration` et de remplacement global ne sont
jamais supprimés.
