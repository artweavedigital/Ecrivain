# Finalisation de la bêta 0.6.0

Cette archive est la base destinée à la publication de la première bêta publique.

## Ajouts de distribution

- icônes `ico`, `png` et `icns` ;
- verrou d’instance unique ;
- `CONSTRUIRE-WINDOWS.cmd` ;
- `CONSTRUIRE-LINUX.sh` ;
- `CONSTRUIRE-MACOS.sh` ;
- script Inno Setup dans `release/windows/` ;
- structure GitHub et modèles d’issues ;
- checklist de publication ;
- documentation rapide et informations sur les composants tiers.

## Avant publication

La dernière étape à effectuer sur un vrai PC Windows consiste à lancer
`CONSTRUIRE-WINDOWS.cmd`, puis à tester le programme packagé sur une machine où
Node.js n’est pas installé. Le code de l’application n’en dépend pas une fois packagé.

Ne pas ajouter de nouvelle fonction entre ce test et la publication de la bêta, sauf
correction d’un bug bloquant.
