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
