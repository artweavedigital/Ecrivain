# Extensions Écrivain — API v3

Le système d’extensions permet d’ajouter des outils à Écrivain sans modifier son noyau. Les extensions s’exécutent dans une interface isolée et ne reçoivent que les permissions déclarées dans leur manifeste.

Les API v1 et v2 restent prises en charge. L’API v3 ajoute une écriture **très limitée et contrôlée** pour les correcteurs de texte.

## Permissions

| Permission | Accès |
|---|---|
| `project.read` | lire les informations générales du projet |
| `chapters.read` | lister et lire les chapitres |
| `chapters.write` | appliquer une correction textuelle précise, explicitement validée par l’utilisateur |
| `storage.read` | lire les données propres à l’extension dans le projet |
| `storage.write` | enregistrer les données propres à l’extension dans le projet |

`chapters.write` n’accorde **pas** un accès libre aux fichiers du manuscrit. L’extension transmet à Écrivain le passage signalé et le remplacement choisi ; le noyau localise ce passage, refuse les cas ambigus et sauvegarde lui-même le chapitre avec son historique normal.

## Ressources privées — API v2+

Une extension peut embarquer un dossier `resources/` contenant moteurs JavaScript, dictionnaires, données ou licences. Ces ressources ne sont accessibles qu’à l’extension concernée.

API disponible :

```js
ecrivain.resources.list()
ecrivain.resources.text(path)
ecrivain.resources.json(path)
```

## Chapitres

```js
ecrivain.chapters.list()
ecrivain.chapters.get(id)
ecrivain.chapters.readAll()
```

Depuis l’API v3 :

```js
ecrivain.chapters.applyCorrection(id, {
  start,
  end,
  target,
  replacement,
  before,
  after
})
```

Cette fonction nécessite `chapters.write`. Écrivain vérifie la correction, sauvegarde le chapitre, conserve l’historique et resynchronise l’éditeur.

## Structure d’une extension

```text
mon-extension/
├── manifest.json
├── plugin.js
├── style.css          facultatif
└── resources/         facultatif
```

Exemple de manifeste :

```json
{
  "id": "mon-extension",
  "name": "Mon extension",
  "version": "1.0.0",
  "ecrivainApi": 3,
  "permissions": ["project.read", "chapters.read"],
  "commands": [
    { "id": "ouvrir", "label": "Ouvrir" }
  ]
}
```

## Paquet installable

Les extensions distribuées utilisent l’extension `.ecrivain-plugin`.

```bash
node packager-extension.js chemin/vers/mon-extension sortie.ecrivain-plugin
```

## Exemples fournis

- `extensions-exemples/analyse-dialogues/` : exemple simple compatible API v1 ;
- `extensions-exemples/grammalecte-ecrivain/` : intégration Grammalecte complète utilisant l’API v3.

## Principe de sécurité

Une extension ne reçoit ni Node.js, ni accès direct au disque, ni accès général au système Windows. Les échanges avec le projet passent par l’API contrôlée d’Écrivain.
