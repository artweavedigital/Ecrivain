# Extensions Écrivain — API v1

Écrivain peut recevoir des extensions sans modifier le noyau de l’application.

## Pour l’utilisateur

Ouvrez **Outils → Extensions → Gérer les extensions…** puis cliquez sur
**Installer une extension…** et choisissez un fichier `.ecrivain-plugin`.

Une extension peut être :

- activée ou désactivée sans être supprimée ;
- désinstallée sans effacer les données qu’elle a éventuellement enregistrées dans vos romans ;
- lancée depuis le gestionnaire ou directement depuis **Outils → Extensions**.

Avant toute installation, Écrivain affiche ensuite les permissions déclarées par
l’extension dans son gestionnaire. Les extensions s’exécutent dans une interface
sandboxée : elles n’ont pas d’accès Node.js direct, pas d’accès direct au système de
fichiers et pas d’accès réseau depuis leur interface.

## Permissions disponibles dans l’API v1

| Permission | Donne accès à |
| --- | --- |
| `project.read` | titre, auteur, langue et version du projet courant |
| `chapters.read` | liste des chapitres et lecture de leur contenu |
| `storage.read` | lecture des données propres à l’extension dans le projet |
| `storage.write` | écriture des données propres à l’extension dans le projet |

Une extension ne peut pas modifier les chapitres avec l’API v1. Ce choix est
volontaire : la première API publique privilégie la sécurité du manuscrit.

## Données des extensions

Les extensions elles-mêmes sont installées globalement dans le dossier de données
d’Écrivain, hors des romans.

Lorsqu’une extension enregistre des données propres à un projet, elles sont placées
dans :

```text
Mon Roman/
└── extensions/
    └── identifiant-extension/
        └── data.json
```

Désinstaller l’extension ne supprime pas ce dossier.

## Format `.ecrivain-plugin`

Le paquet est un fichier JSON autonome :

```json
{
  "format": "ecrivain-plugin",
  "packageVersion": 1,
  "manifest": {
    "id": "mon-extension",
    "name": "Mon extension",
    "version": "1.0.0",
    "author": "Auteur",
    "description": "Description courte.",
    "icon": "🧩",
    "ecrivainApi": 1,
    "permissions": ["project.read", "chapters.read"],
    "commands": [
      { "id": "analyser", "label": "Analyser le manuscrit" }
    ]
  },
  "code": "... JavaScript ...",
  "style": "... CSS facultatif ..."
}
```

## API JavaScript dans une extension

Le code reçoit l’objet `ecrivain` :

```javascript
ecrivain.onCommand('analyser', async () => {
    const projet = await ecrivain.project.getCurrent();
    const chapitres = await ecrivain.chapters.list();
    const chapitre = await ecrivain.chapters.get(chapitres[0].id);

    document.getElementById('plugin-root').textContent =
        `${projet.title} — ${chapitre.title}`;
});
```

Méthodes disponibles :

```text
ecrivain.app.version()
ecrivain.project.getCurrent()
ecrivain.chapters.list()
ecrivain.chapters.get(id)
ecrivain.storage.read()
ecrivain.storage.write(value)
ecrivain.notify(message)
ecrivain.onCommand(id, handler)
```

Les appels sont contrôlés par Écrivain selon les permissions du manifeste.

## Fabriquer un paquet

Un dossier de développement contient :

```text
mon-extension/
├── manifest.json
├── plugin.js
└── style.css      (facultatif)
```

Puis :

```powershell
node packager-extension.js mon-extension
```

Écrivain crée alors `mon-extension.ecrivain-plugin`.

Un exemple complet est fourni dans :

```text
extensions-exemples/analyse-dialogues/
extensions-exemples/analyse-dialogues.ecrivain-plugin
```


## Lire tous les chapitres

API v1 : `ecrivain.chapters.readAll()` renvoie tous les chapitres dans l’ordre visuel, sous-chapitres compris, avec leur contenu HTML et leur profondeur. Cette méthode est recommandée pour les extensions d’analyse globale.
