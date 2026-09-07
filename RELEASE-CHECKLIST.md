# Checklist de publication — Écrivain 0.6.0 bêta

## Code

- [ ] `npm.cmd run check` réussit.
- [ ] Un seul lancement d’Écrivain peut être actif à la fois.
- [ ] Aucun chemin de développement `D:\\...` n’est nécessaire au fonctionnement.
- [ ] Les projets restent en dehors du dossier de l’application.

## Écriture

- [ ] Création/renommage/suppression de chapitre.
- [ ] Sous-chapitres et retour au niveau supérieur.
- [ ] Glisser-déposer vers le haut et vers le bas.
- [ ] Autosauvegarde et `Ctrl+S`.
- [ ] Plein écran `F11` et sortie `Échap`.
- [ ] Zoom clavier et curseur.
- [ ] Caractères invisibles `F6`.

## Sécurité

- [ ] Historique et comparaison fonctionnent.
- [ ] Les cinq sauvegardes sont créées/rotées correctement.
- [ ] La vérification silencieuse n’affiche rien sur un projet sain.
- [ ] Le rapport de diagnostic ne contient ni manuscrit ni clé API.

## Exports

Tester un projet réel en :

- [ ] DOCX ;
- [ ] ODT ;
- [ ] EPUB sur liseuse ;
- [ ] PDF ;
- [ ] Markdown.

Vérifier titres centrés, sauts de page, police, corps, interligne, alinéas et
justification.

## Fonctions projet

- [ ] Synopsis global.
- [ ] Synoptique.
- [ ] Notes et pièces jointes.
- [ ] Chronologie.
- [ ] Carte mentale.
- [ ] Statistiques.
- [ ] Recherche/remplacement global avec sauvegarde préalable.

## Distribution Windows

- [ ] `CONSTRUIRE-WINDOWS.cmd` termine sans erreur.
- [ ] `Ecrivain.exe` démarre sans Node.js installé sur la machine de test.
- [ ] L’installateur s’installe pour l’utilisateur courant.
- [ ] Raccourci Menu Démarrer correct.
- [ ] Désinstallation propre.
- [ ] Les projets de l’utilisateur ne sont jamais supprimés à la désinstallation.
