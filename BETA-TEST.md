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

Avant diffusion de la bêta.10, vérifier au minimum :

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
