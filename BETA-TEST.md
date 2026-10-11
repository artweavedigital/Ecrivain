# Tester Écrivain 0.6.0 bêta

L’objectif de la bêta est d’utiliser Écrivain normalement, sur un vrai projet, et de
ne corriger que ce qui se révèle gênant à l’usage.

## Que noter ?

### BUG

- ce que vous faisiez ;
- ce qui s’est produit ;
- ce qui aurait dû se produire ;
- si le problème est reproductible.

### ERGONOMIE

- une commande difficile à trouver ;
- une fenêtre trop grande ;
- trop de clics pour une action fréquente ;
- un élément peu lisible ou ambigu.

### IDÉE

- une fonction réellement manquante pendant le travail ;
- une amélioration qui ferait gagner du temps régulièrement.

## En cas de plantage ou de comportement étrange

1. Ne modifiez pas manuellement les fichiers du projet.
2. Relancez Écrivain.
3. Utilisez **Projet → Vérifier et réparer le projet…** si nécessaire.
4. Utilisez **Aide → Informations techniques → Créer un rapport de diagnostic…**.
5. Conservez le ZIP produit avec votre description du problème.

Le rapport de diagnostic ne contient pas le contenu des chapitres et ne contient pas
les clés API enregistrées.

## Rechercher / remplacer — format avancé

Avant diffusion de la bêta.11, vérifier au minimum :

- recherche simple dans le chapitre courant, occurrence précédente et suivante ;
- laisser la barre de recherche ouverte, reprendre la frappe dans le manuscrit et vérifier que le curseur ne quitte jamais la position de saisie ;
- sélectionner un mot ou une expression dans le manuscrit, ouvrir Rechercher puis Rechercher/Remplacer et vérifier que le champ est prérempli ;
- saisir ou modifier un terme dans le champ de recherche : aucune occurrence ne doit être sélectionnée tant que l’auteur n’appuie pas sur ↑, ↓ ou Entrée ;
- **Tout rechercher** : toutes les occurrences compatibles sont surlignées ;
- recherche avec **Respecter la casse** et **Mots entiers uniquement** ;
- recherche par format seul ou combinée au texte : police, corps, style, soulignement, barré, exposant/indice, couleur et surlignage ;
- remplacement du texte sans format imposé ;
- remplacement avec un format différent, par exemple Arial 10 normal → Times New Roman 18 gras italique ;
- remplacement avec **soulignement**, **couleur de texte** et **surlignage** ;
- enregistrer le chapitre, changer de chapitre puis revenir : ces trois formats doivent rester visibles ;
- fermer puis rouvrir le projet : la couleur, le soulignement et le surlignage doivent toujours être présents ;
- dans « Format », choisir directement une couleur doit activer automatiquement le critère correspondant ;
- **Aucun format** remet bien les critères de format à zéro ;
- les mêmes cas fonctionnent dans **Tout le projet** ;
- un remplacement global crée bien la sauvegarde et l’historique prévus ;
- après remplacement formaté, contrôler un export DOCX, ODT, EPUB et PDF.

## Points à surveiller pendant un long manuscrit

- navigation avec plusieurs dizaines de chapitres et sous-chapitres ;
- glisser-déposer ;
- autosauvegarde ;
- historique sur plusieurs semaines ;
- notes et pièces jointes nombreuses ;
- chronologie chargée ;
- exports DOCX/ODT/PDF/EPUB sur un manuscrit long ;
- vitesse de recherche/remplacement global ;
- stabilité après plusieurs heures d’utilisation.

### Remplacement de format sans changer le mot

- saisir plusieurs fois le même mot avec une ancienne police ;
- ouvrir « Remplacer dans tout le projet » ;
- laisser « Remplacer par » vide et choisir uniquement une nouvelle police/tailles/style dans « Format » ;
- confirmer : le mot doit rester présent et seul son format doit changer ;
- vérifier qu’un champ « Remplacer par » vide **sans** format continue à supprimer les occurrences ;
- vérifier que les modifications non encore enregistrées du chapitre courant ne sont pas perdues lors du remplacement global.

## Bêta.11 — vérifications à faire sur un vrai manuscrit

Faire d’abord une copie du projet.

### Enregistrement et fermeture

- taper quelques mots puis fermer la fenêtre aussitôt (sans attendre l’autosauvegarde) : à la réouverture, tout est là ;
- fermer pendant que le synopsis global ou une note est en cours d’édition : rien n’est perdu ;
- comparer le nombre de mots d’un chapitre avant et après l’ouverture dans cette version : un écart de quelques mots est normal (nouvelle méthode de comptage, tirets de dialogue non comptés).

### Corbeille

- supprimer un chapitre qui a des sous-chapitres et des notes liées : l’écran de confirmation l’annonce ;
- **Projet → Corbeille** : l’élément est listé avec son nombre de mots ; **Restaurer** le remet à sa place avec ses sous-chapitres et ses notes ;
- supprimer une note, la restaurer ;
- **Supprimer définitivement** et **Vider la corbeille** demandent confirmation.

### Sauvegardes

- créer plusieurs sauvegardes manuelles et laisser des automatiques se produire : cinq de chaque sorte au plus ;
- choisir un dossier de sauvegarde externe dans les **Préférences**, créer une sauvegarde : une copie apparaît dans `Ecrivain-sauvegardes/` ; débrancher le disque et recommencer : un message l’indique, la sauvegarde locale est faite ;
- restaurer une sauvegarde : la corbeille et l’historique sont intacts, une sauvegarde « Avant restauration » a été créée.

### Exports

- **Projet → Configuration du document** : numérotation des pages et en-tête courant ;
- marquer un chapitre « Coupé », un autre « Exclure de l’export » (clic droit sur le chapitre) : aucun des deux n’apparaît dans Word, OpenDocument, EPUB, PDF et Markdown, et l’export indique combien de chapitres ont été laissés de côté ;
- Word, OpenDocument et PDF : la page de titre n’a ni numéro ni en-tête, la page 2 porte le numéro 2 ; avec « auteur et titre », les pages paires et impaires portent bien chacune le bon en-tête ;
- ouvrir l’EPUB sur une liseuse : le sommaire montre les sous-chapitres sous leur chapitre ;
- exporter deux fois le même EPUB : l’identifiant du livre ne change pas (visible dans les métadonnées de la liseuse).

## Bêta.11.1 — espaces insécables dans les fichiers de mise en page

- exporter le même chapitre en Word, OpenDocument et Markdown, puis l’ouvrir dans XPress ou Scribus : avant « ; », « ? », « ! » et « : », l’espace ne se coupe pas en fin de ligne et n’affiche ni carré ni espace anormale ;
- vérifier que chaque chapitre et sous-chapitre commence sur une nouvelle page dans les fichiers Word, OpenDocument et PDF.
