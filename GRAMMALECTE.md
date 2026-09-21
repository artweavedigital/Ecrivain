# Grammalecte dans Écrivain

Écrivain 0.6.0-beta.6 utilise l’API d’extensions v3 pour permettre au correcteur Grammalecte d’appliquer une correction **uniquement après validation explicite de l’auteur**.

## Installation

Installez `grammalecte-fr-0.3.0.ecrivain-plugin` depuis **Outils → Extensions → Installer une extension…**. Si une ancienne version est déjà présente, choisissez **Remplacer**.

## Fonctionnement

Le moteur Grammalecte 2.3.0, son dictionnaire, son lexicographe et son conjugueur sont embarqués dans l’extension et fonctionnent localement.

Dans l’onglet **Correcteur**, choisissez un chapitre puis cliquez sur **Analyser le chapitre**. Chaque problème propose, lorsque Grammalecte en fournit, un ou plusieurs boutons de correction. Cliquer sur une proposition modifie seulement le passage concerné, puis le chapitre est réanalysé.

Écrivain enregistre le chapitre avant l’opération, crée l’historique normal du chapitre et resynchronise l’éditeur afin qu’une autosauvegarde ne puisse pas rétablir l’ancien texte.

## Sécurité

L’extension reçoit les permissions :

- lecture du projet ;
- lecture des chapitres ;
- `chapters.write`, limitée par Écrivain à l’application d’une correction textuelle précise validée par l’utilisateur ;
- lecture/écriture de ses propres données d’extension.

L’extension ne reçoit pas un accès général aux fichiers du projet ni au système Windows.

## Licence

Le moteur Grammalecte reste sous GNU GPL v3 ou ultérieure. Il est distribué comme composant distinct de l’extension et n’est pas incorporé au cœur d’Écrivain.
