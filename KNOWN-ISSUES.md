# Points connus — Écrivain 0.6.0 bêta.11.1

Cette version est destinée aux essais grandeur nature.

## Grammalecte

La correction automatique est volontairement limitée aux suggestions explicitement choisies par l’auteur. Lorsqu’un passage signalé traverse plusieurs éléments de mise en forme HTML ou qu’Écrivain ne peut pas identifier sans ambiguïté l’occurrence à corriger, l’application refuse la modification plutôt que de risquer d’altérer le manuscrit. Dans ce cas, la correction reste à effectuer directement dans l’éditeur.

Le formateur typographique Grammalecte affiche pour l’instant un aperçu ; l’application globale de cet aperçu n’est pas proposée afin de ne pas écraser les mises en forme du chapitre.

## Bêta

Les exports longs, extensions tierces et migrations futures du format de projet doivent continuer à être testés sur des copies de travail et des sauvegardes régulières.

## Limites de la bêta.11

### Ce qui n’a pas pu être vérifié avant publication

- Cette version a été préparée dans un environnement sans Electron : le programme complet
  n’y a donc pas été lancé. Les gestionnaires du processus principal ont été exécutés avec un
  module Electron simulé, et l’interface complète dans Chromium (`npm run test:ui`), mais
  la fenêtre, les menus natifs, les boîtes de dialogue et l’impression PDF d’Electron n’ont
  pas été essayés. Faire la passe manuelle de `RELEASE-CHECKLIST.md` avant de diffuser.
- Aucun fichier `package-lock.json` n’est fourni. Lancer `npm install` une première fois
  puis versionner le fichier créé ; la CI utilisera alors `npm ci`.
- Les tests ont été exécutés sous Linux ; la CI Windows n’a pas encore tourné. Le test du filtre HTML a été validé avec Chromium ; son exécution avec `jsdom` (installé par `npm install`) n’a pas pu être essayée ici.

### Exports

- La césure automatique du PDF dépend de la langue du document et des dictionnaires de la
  plateforme : l’effet peut varier d’un système à l’autre.
- La page de titre est comptée dans la pagination mais reste vierge : la première page
  numérotée porte le numéro 2. C’est la convention de l’édition ; désactiver
  **Numéroter les pages** dans **Projet → Configuration du document** pour renoncer à la
  numérotation.
- L’en-tête courant « auteur / titre » repose sur la distinction pages paires et impaires :
  il suppose une impression recto verso.
- Les fichiers Word, OpenDocument et Markdown utilisent l’espace insécable ordinaire (U+00A0) avant « ; ? ! » ;
  l’EPUB, le PDF et le bouton **Typo FR** utilisent l’espace fine insécable (U+202F), qui peut s’afficher comme un
  carré dans les polices qui ne la contiennent pas.
- L’EPUB n’a pas encore de couverture (le champ `cover` du projet n’est pas exposé dans
  l’interface).

### Données

- La corbeille n’est jamais vidée automatiquement : penser à la vider de temps en temps.
- Les totaux de mots peuvent changer légèrement à la première ouverture d’un projet ancien
  (méthode de comptage unifiée, voir `CHANGELOG.md`).

### Sécurité et licences

- Voir `SECURITY.md` pour les limites de la politique de sécurité de l’interface.
- Écrivain (Apache 2.0 avec Commons Clause) et le moteur Grammalecte (GNU GPL v3 ou
  ultérieure) sont distribués ensemble dans `extensions-exemples/`. Les deux licences
  ne sont pas évidentes à concilier : faire examiner la distribution publique par une
  personne compétente en droit des licences avant de la publier. Ce point n’a pas été
  tranché ici.

### Pas encore traité

Collage propre depuis Word, objectifs de mots, mode concentration, thème sombre, palette
de commandes, import de documents, étiquettes et fiches par chapitre, suivi des
modifications, découpage de `main.js` en modules et éditeur plus robuste que
`contentEditable`.
