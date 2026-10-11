# Contribuer à Écrivain

Les contributions sont bienvenues lorsqu’elles préservent la philosophie du projet :
**simplicité, sécurité des manuscrits et ergonomie pour un utilisateur non technicien**.

## Principes

- ne pas transformer l’interface en usine à gaz ;
- privilégier les fonctions utiles pendant l’écriture réelle ;
- ne jamais modifier silencieusement le format d’un projet existant ;
- conserver les données du roman lisibles et récupérables ;
- ne jamais exposer une clé API ou le manuscrit sans action explicite de l’utilisateur ;
- documenter toute migration de format.

En proposant du code au cœur d’Écrivain, le contributeur accepte que sa contribution
soit distribuée sous la licence du projet telle qu’indiquée dans `LICENSE`, sauf accord
écrit différent conclu avant son intégration.

Les extensions tierces restent indépendantes et peuvent utiliser une autre licence,
sous réserve du respect des marques et de l’identité visuelle d’Écrivain.

## Vérifier avant de proposer une modification

```text
npm install
npm run check
npm test
```

`npm test` exécute les vrais gestionnaires du processus principal avec un module Electron
simulé (`test/helpers/mock-electron.js`) : aucune fenêtre n’est nécessaire. Toute correction
de bug doit s’accompagner d’un test qui échouait avant elle. `npm run test:ui` lance en plus
un test de l’interface dans Chromium (`npm install --no-save playwright` puis
`npx playwright install chromium`).
