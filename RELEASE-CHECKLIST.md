# Checklist de publication — Écrivain 0.6.0 bêta

## Code

- [ ] `npm.cmd run check` réussit.
- [ ] `npm.cmd test` réussit (au moins 50 tests ; le test du filtre HTML n’est pas « ignoré »).
- [ ] `npm.cmd run test:ui` réussit (Playwright et Chromium installés).
- [ ] Un `package-lock.json` est versionné et la CI est verte sous Linux et Windows.
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
- [ ] Cinq sauvegardes manuelles et cinq automatiques au plus, rotation correcte et indépendante.
- [ ] La copie vers le dossier de sauvegarde externe fonctionne, et un dossier absent ne bloque pas la sauvegarde.
- [ ] Supprimer un chapitre le place dans la corbeille ; la restauration, la suppression définitive et le vidage fonctionnent.
- [ ] Fermer la fenêtre juste après une frappe ne perd rien.
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

Vérifier aussi, dans Word, OpenDocument et PDF : page de titre sans numéro, numérotation à
partir de la page 2, en-têtes courants ; dans l’EPUB : sommaire imbriqué et identifiant
stable. Contrôler l’EPUB avec EPUBCheck et ouvrir le DOCX dans Word lui-même (le fichier a
été validé avec LibreOffice et python-docx, pas avec Word).

Vérifier qu’un chapitre « Coupé » ou marqué « Exclure de l’export » n’apparaît dans aucun export.

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
