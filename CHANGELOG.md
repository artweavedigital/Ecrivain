# Journal des versions

## 0.6.0 bêta.10

- Correction de la persistance des formats locaux du manuscrit : les styles inline enregistrés dans les chapitres (police, taille, soulignement, couleur de texte, surlignage, etc.) sont désormais autorisés par la politique de sécurité de l'interface et restent donc visibles après sauvegarde, changement de chapitre ou réouverture du projet.
- Le remplacement formaté dans tout le projet affiche maintenant correctement les attributs enregistrés après rechargement du manuscrit.
- Dans la fenêtre Format, choisir une couleur de texte ou de surlignage active automatiquement cette option ; il n'est plus nécessaire de cocher séparément la case correspondante.
- Ajout de contrôles de bêta-test spécifiques pour vérifier la persistance du soulignement, de la couleur et du surlignage.

## 0.6.0 bêta.9

- Correction du remplacement formaté dans tout le projet : un champ « Remplacer par » vide avec un format choisi conserve désormais le texte trouvé et modifie uniquement sa mise en forme, au lieu de le supprimer.
- Le chapitre courant est enregistré avant un remplacement global afin que l’opération travaille toujours sur la dernière version du manuscrit.
- La confirmation indique explicitement s’il s’agit d’un remplacement, d’une suppression ou d’un changement de format uniquement.

## 0.6.0 bêta.8

### Recherche / remplacement — contrôle du curseur

- correction d’un défaut de la bêta.7 qui pouvait déplacer la sélection dans le manuscrit pendant la frappe lorsque la barre de recherche restait ouverte ;
- la saisie d’un terme, le changement de casse ou de mot entier ne déclenchent plus automatiquement la recherche ;
- l’auteur déclenche lui-même la navigation avec les flèches **↑ / ↓** (ou Entrée / Maj+Entrée) ;
- **Tout rechercher** reste une action volontaire et surligne toutes les occurrences sans déplacer le curseur ;
- lorsqu’un mot ou une expression est sélectionné dans le manuscrit avant d’ouvrir Rechercher ou Rechercher/Remplacer, la sélection est automatiquement placée dans le champ de recherche ;
- le même préremplissage est disponible pour la recherche dans tout le projet ;
- la première navigation part de la position ou de la sélection de l’auteur, puis les flèches parcourent les occurrences dans les deux sens.

## 0.6.0 bêta.7

### Rechercher / remplacer — format avancé

- ajout d’un bouton **Format…** pour le texte recherché et pour le texte de remplacement, dans le chapitre courant comme dans tout le projet ;
- recherche par police, corps, style (normal, gras, italique, gras italique), soulignement, barré, exposant/indice, couleur de texte et surlignage ;
- remplacement pouvant appliquer un format différent du texte trouvé — par exemple Arial 10 normal vers Times New Roman 18 gras italique ;
- bouton **Aucun format** pour supprimer rapidement les critères ou le format de remplacement ;
- bouton **Tout rechercher** dans le chapitre avec surlignage simultané des occurrences ;
- remplacement global toujours protégé par une sauvegarde complète et un jalon d’historique ;
- conservation des formats locaux dans les exports HTML/PDF, EPUB, DOCX et ODT lorsque le format le permet.

## 0.6.0 bêta.6

### Grammalecte et extensions

- API d’extensions v3 avec permission `chapters.write` limitée aux corrections explicitement validées ;
- application d’une suggestion Grammalecte directement dans le chapitre, avec historique normal du chapitre ;
- synchronisation du chapitre en mémoire afin d’éviter qu’une autosauvegarde n’écrase la correction ;
- interface Grammalecte recentrée dans l’espace disponible ;
- boutons de correction et d’ignorance directement sous chaque problème ;
- exemple Grammalecte livré avec Écrivain mis à niveau : suppression de l’ancienne préversion « moteur à brancher ».

## 0.6.0 bêta.5

### Extensions : correctif d’exécution et ergonomie

- correction du lancement des extensions : le document `srcdoc` conserve son bac à sable, mais son code et son style sont désormais chargés comme ressources `data:` externes autorisées par la politique de sécurité, au lieu d’utiliser du JavaScript inline bloqué par Chromium ;
- délai de démarrage porté à 12 secondes pour les extensions lourdes ;
- affichage d’un message d’échec plus clair lorsqu’une extension ne démarre pas ;
- gestionnaire d’extensions simplifié : une liste unique, un bouton **Ouvrir** évident et les permissions rangées dans **Détails et permissions** ;
- l’extension ouverte utilise désormais toute la largeur de l’espace de travail au lieu d’un petit panneau à droite ;
- bouton **← Extensions** pour revenir immédiatement au gestionnaire ;
- l’installation d’une extension ne l’ouvre plus automatiquement : elle apparaît dans la liste puis l’utilisateur choisit **Ouvrir**.

### Grammalecte

- compatibilité avec le paquet séparé `Correcteur français — Grammalecte 0.2.1`, qui embarque le moteur Grammalecte 2.3.0 local ;
- aucun texte n’est envoyé en ligne par le moteur Grammalecte.

## 0.6.0 bêta.4

### Préparation de Grammalecte

- passage de l’API d’extensions à la **v2**, avec compatibilité conservée pour les extensions API v1 ;
- ajout de ressources privées aux paquets `.ecrivain-plugin` pour pouvoir embarquer ultérieurement un moteur JavaScript et ses données sans les intégrer au cœur d’Écrivain ;
- limite des paquets portée à 16 Mo, avec limites séparées pour le code, le style et les ressources ;
- nouvelles méthodes `ecrivain.resources.list()`, `text()` et `json()` pour les extensions API v2 ;
- ajout d’une préversion installable **Correcteur français — Grammalecte** ;
- interface à onglets inspirée de la présentation de Grammalecte mais harmonisée avec Écrivain : Correcteur, Lexicographe, Conjugueur et Typographie ;
- lecture des chapitres du projet et pré-analyse typographique locale ;
- le véritable moteur Grammalecte n’est pas encore embarqué : la préversion ne prétend pas effectuer une correction grammaticale complète.

## 0.6.0 bêta.3

### Correcteur orthographique intégré

- activation explicite du correcteur Chromium/Hunspell d’Electron ;
- dictionnaire français sélectionné automatiquement sous Windows et Linux ;
- soulignement des mots inconnus pendant la frappe ;
- suggestions orthographiques au clic droit sur un mot signalé ;
- remplacement immédiat par la suggestion choisie ;
- ajout d’un mot au dictionnaire personnalisé depuis le clic droit ;
- option **Préférences → Écriture → Correcteur orthographique français** pour activer ou désactiver la correction ;
- journalisation discrète du chargement du dictionnaire pendant la bêta.

### Ergonomie de l’éditeur

- clic droit dans un texte éditable : suggestions orthographiques puis **Couper**, **Copier**, **Coller** et **Tout sélectionner** ;
- ajout d’une croix **×** en haut à droite des fenêtres modales pour les fermer directement ;
- la croix d’un formulaire équivaut à **Annuler** et ne valide donc pas les modifications en cours.

## 0.6.0 bêta

### Finalisation de la bêta

- verrou d’instance unique : un second lancement ramène la fenêtre existante au premier plan ;
- identité d’application et icônes Windows/macOS préparées ;
- scripts de construction Windows, Linux et macOS ;
- installateur Windows Inno Setup préparé ;
- structure GitHub, modèles de bugs/idées et checklist de release ;
- documentation de prise en main, distribution, sécurité et composants tiers.

### Consolidation

- version figée pour test grandeur nature ;
- format de projet v1 conservé ;
- journal technique local avec rotation ;
- détection d’une fermeture anormale précédente ;
- journalisation des erreurs du processus principal et de l’interface ;
- rapport de diagnostic ZIP exportable sans manuscrit ni clé API ;
- informations techniques enrichies ;
- identité et crédits clarifiés ;
- régime de licence séparant code, documentation et identité visuelle.

### Base fonctionnelle incluse

- chapitres/sous-chapitres, éditeur, exports ;
- synopsis, notes, chronologie, carte mentale, statistiques ;
- sauvegardes, historique, recherche/remplacement ;
- IA, extensions, préférences et aide.
