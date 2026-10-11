# Journal des versions

## 0.6.0 bêta.11.1 — espace insécable ordinaire dans les fichiers Word, OpenDocument et Markdown

Version corrective de la bêta.11, sans aucun autre changement : le format de projet, la mise en page, les styles, les sauts de page, les numéros de page et les en-têtes sont ceux de la bêta.11.

- Dans les fichiers **Word (.docx)**, **OpenDocument (.odt)** et **Markdown (.md)**, l’espace avant « ; », « ? » et « ! » est une **espace insécable ordinaire (U+00A0)** au lieu de l’espace fine insécable (U+202F), que beaucoup de polices et plusieurs logiciels de mise en page (XPress, Scribus) ne reconnaissent pas. Les espaces avant « : », à l’intérieur des guillemets et avant « % » et « € » étaient déjà des espaces insécables ordinaires.
- Cela concerne le texte, le titre du livre, le sous-titre, le nom de l’auteur, les titres de chapitres et les en-têtes courants de ces trois fichiers. Le manuscrit enregistré n’est pas modifié : les espaces fines déjà saisies sont converties à l’export.
- **Inchangés** : l’EPUB, le PDF et le bouton **Typo FR** de l’éditeur gardent l’espace fine insécable (U+202F). Dans le Markdown, les titres restent tels qu’ils ont été saisis, comme en bêta.11.
- Les changements des versions d’essai bêta.12 et bêta.13 (chapitres sur page impaire, nouveau style de sous-chapitre, réglages ajoutés à la configuration du document) ne sont pas repris.
- Vérification : les fichiers Word, OpenDocument et Markdown produits sont identiques à ceux de la bêta.11, caractère pour caractère, à l’exception de l’espace (U+202F devenue U+00A0) ; l’EPUB et le document d’impression du PDF sont identiques. Dans LibreOffice, chaque chapitre et sous-chapitre commence sur une nouvelle page. 54 tests automatisés (4 de plus).

## 0.6.0 bêta.11 — fiabilité des données, sécurité et exports

Cette version ne change pas le format de projet (`ecrivain-project` v1) : les ajouts sont des champs et un dossier facultatifs. Un projet de la bêta.10 s’ouvre sans migration visible ; les nouveaux champs sont ajoutés à l’ouverture ou à la première modification des réglages.

### Texte, comptage et enregistrement

- **Un seul compteur de mots**, partagé par l’éditeur, les statistiques, l’enregistrement, l’assistant IA et les exports (`shared/text-utils.js`). Un mot est une suite de caractères séparés par des espaces, insécables compris, qui contient au moins une lettre ou un chiffre : les tirets cadratins de dialogue, les « & » isolés et les ponctuations seules ne comptent plus, « 2<sup>e</sup> » compte pour un seul mot. La version du compteur est inscrite dans chaque chapitre (`wcv`) : les chapitres existants sont recalculés **une seule fois** à l’ouverture, sans créer de « mots ajoutés » dans les statistiques. Les totaux de vos chapitres peuvent donc changer légèrement.
- **Typographie française unifiée** : mêmes règles dans l’éditeur et dans les exports, application idempotente (la relancer ne change plus rien), adresses web et courriels intacts, heures (« 12:30 ») préservées, une seule espace fine insécable pour « ?! », tiret de dialogue converti uniquement en début de paragraphe.
- **Enregistrements en série** : une frappe faite pendant qu’un enregistrement est en cours n’est plus marquée comme enregistrée à tort ; deux enregistrements simultanés ne peuvent plus s’écraser.
- **Écriture atomique** des fichiers de données du projet (chapitres, notes, synopsis, chronologie, statistiques, `project.json`…) et des préférences (fichier temporaire, écriture physique forcée, renommage) : un arrêt brutal laisse l’ancienne ou la nouvelle version, jamais un fichier tronqué. Les fichiers temporaires orphelins sont nettoyés.
- **Fermeture sûre** : à la fermeture de la fenêtre, le processus principal demande à l’interface d’enregistrer le chapitre en cours et le synopsis global, attend l’accusé, puis attend la fin des écritures avant de quitter (délai de sécurité de six secondes).

### Corbeille, sauvegardes et historique

- **Corbeille du projet** (menu **Projet → Corbeille**, ou onglet dans l’écran des sauvegardes) : supprimer un chapitre, avec ses sous-chapitres, ses notes liées et leurs pièces jointes, ou supprimer une note, les place dans `trash/` au lieu de les effacer. L’écran de confirmation annonce ce qui sera déplacé. Restauration en un clic (un élément déjà présent n’est jamais écrasé : il reste dans la corbeille et l’interface le signale), suppression définitive et vidage avec confirmation. La corbeille n’est jamais vidée automatiquement.
- **Sauvegardes** : cinq sauvegardes manuelles et cinq automatiques, avec des quotas indépendants (un grand nombre de sauvegardes automatiques ne chasse plus les manuelles). Le type est enregistré dans `backup.json` (`kind`).
- **Copie externe facultative** de chaque sauvegarde dans un dossier choisi dans les Préférences (disque externe, dossier synchronisé) : dix copies conservées par projet ; si le dossier est introuvable, la sauvegarde locale réussit quand même et l’échec est signalé.
- Une sauvegarde n’emporte plus `history/`, `exports/`, `trash/` ni les anciennes sauvegardes : elle est plus petite et ne s’emboîte plus dans elle-même.
- **Restauration d’une sauvegarde** : l’état courant est sauvegardé d’abord ; la corbeille, l’historique, les exports et les autres sauvegardes sont conservés intacts.
- **Historique des chapitres** : tous les jalons automatiques sont gardés pendant sept jours, puis un par jour jusqu’à trente jours, puis un par semaine. Les jalons manuels, « avant restauration » et « remplacement global » ne sont jamais supprimés.

### Sécurité

- **Contenu importé nettoyé** : le HTML des chapitres et des notes est filtré par liste blanche avant d’entrer dans l’interface (`shared/html-sanitize.js`). Un projet reçu d’un tiers ne peut plus y introduire de script, de cadre, de formulaire, de lien `javascript:`, d’image distante ni de style capable de masquer l’interface. Ce que produit l’éditeur (gras, italique, souligné, barré, exposant, indice, titres, citations, listes, polices, corps, couleur, surlignage) est conservé tel quel.
- **Identifiants validés** : tout identifiant venu de l’interface (chapitre, note, version d’historique, sauvegarde, élément de corbeille) est contrôlé avant de servir de nom de fichier ; « ../../x » et ses variantes sont refusés.
- **Pièces jointes des notes** : un chemin désigné par un fichier de note ne peut plus sortir du dossier du projet, et seuls les fichiers réellement choisis par l’auteur dans la boîte de dialogue peuvent être copiés dans le projet.
- **Fenêtres durcies** : aucune ouverture de nouvelle fenêtre, navigation limitée à l’interface (les liens `https://` s’ouvrent dans le navigateur du système), aucune permission web accordée (caméra, position, notifications…), blocage de `webview`.
- Le document utilisé pour produire le PDF est isolé par sa propre politique de sécurité (aucun script, aucune ressource distante) ; les titres et noms d’auteur y sont échappés.

### Exports

- **Numéros de page** en Word (.docx), OpenDocument (.odt) et PDF : en bas de page, la page de titre est comptée mais reste vierge (la numérotation visible commence à la page 2). Option **Numéroter les pages** dans **Projet → Configuration du document** ; elle est activée par défaut. Désactivez-la si vous préférez numéroter à la mise en page finale.
- **En-tête courant** facultatif : titre du livre, nom de l’auteur, ou « auteur (pages paires) et titre (pages impaires) ».
- **Chapitres à ne pas exporter** : le statut « Coupé » n’est plus exporté (réglage modifiable ; « Brouillon » peut aussi être exclu), et chaque chapitre peut être marqué **Exclure de l’export** par son menu contextuel (clic droit). Les sous-chapitres suivent leur parent. Chaque export indique combien de chapitres ont été laissés de côté. *Précision : le champ `excludeFromExport` existait déjà dans le format mais n’était lu que par les statistiques ; il est maintenant respecté par tous les exports, et la page Statistiques calcule les « mots exportés » avec la même sélection que les exports.*
- **EPUB** : identifiant stable (`urn:uuid:` tiré de l’identifiant du projet), le même livre garde le même identifiant d’une exportation à l’autre ; sommaire imbriqué qui reflète les sous-chapitres ; description et langue du projet ; validé sans aucune erreur ni avertissement par EPUBCheck 5.2.1.
- **Archives ZIP compressées** (DOCX, ODT, EPUB) : fichiers sensiblement plus petits ; `mimetype` reste stocké en premier et sans compression comme l’exigent EPUB et ODT.
- **PDF** : césure automatique du texte justifié, selon la langue du document et les dictionnaires du moteur d’impression de la plateforme (l’effet varie donc d’un système à l’autre).
- **DOCX** : XML écrit dans l’ordre canonique du schéma WordprocessingML (lecteurs stricts) ; titres de chapitre à la taille de leur style au lieu de la taille du corps ; interligne des titres automatique (le titre du livre sur deux lignes n’est plus tassé) ; même correction dans l’ODT.
- Correction d’un défaut ancien : une mise à jour **partielle** des réglages de page ramenait la page à 5 × 5 cm et les marges à zéro ; une valeur absente ou vide conserve désormais la valeur précédente.

### Tests, intégration continue et documentation

- **Premiers tests automatisés** : `npm test` (50 tests) exécute les vrais gestionnaires du processus principal avec un faux module `electron` et un projet réel en dossier temporaire : comptage et typographie, ZIP, écriture atomique et files exclusives, création et ouverture de projet, enregistrements simultanés, identifiants hostiles, corbeille, notes et pièces jointes, sauvegardes et quotas, copie externe, restauration, historique, exports DOCX, ODT, EPUB, PDF et Markdown. Le test du filtre HTML s’exécute avec `jsdom` (installé par `npm install`) ou, à défaut, avec Chromium ; sans l’un ni l’autre il est signalé comme ignoré.
- `npm run test:ui` : test de fumée de l’interface complète dans Chromium (Playwright, facultatif) : aucune erreur JavaScript, aucune violation de la politique de sécurité, contenu hostile neutralisé, fermeture avec enregistrement, corbeille, sauvegardes, configuration du document.
- `npm run check` et `VERIFIER-ECRIVAIN.cmd` couvrent aussi les nouveaux modules ; les scripts de paquetage excluent le dossier `test/`.
- Intégration continue GitHub (`.github/workflows/ci.yml`) sous Linux et Windows, Node.js 24.
- Documentation mise à jour : `FORMAT-PROJET.md` (dossier `trash/`, champs `uuid`, `pageNumbers`, `runningHeader`, `exportExcludeStatuses`, `excludeFromExport`, `kind` et `wcv`), `SECURITY.md`, `KNOWN-ISSUES.md` (limites résiduelles), `VERSION.txt` (schéma interne 1.5.0, API d’extensions v3), `BETA-TEST.md` et `RELEASE-CHECKLIST.md`.

### Schéma interne 1.5.0

Champs ajoutés, tous facultatifs et lisibles par la bêta.10 (qui les ignore) : `uuid`, `pageNumbers`, `runningHeader` et `exportExcludeStatuses` dans `project.json` ; `wcv` et `excludeFromExport` dans les chapitres ; `kind` dans `backup.json` ; dossier `trash/`.

### Non traité dans cette version

Collage propre depuis Word, objectifs de mots, mode concentration, thème sombre, palette de commandes, import de documents, étiquettes et fiches par chapitre, suivi des modifications, remplacement de l’analyseur HTML d’export par un analyseur complet, découpage de `main.js` en modules, éditeur ProseMirror/TipTap, resserrement de la politique de sécurité de l’interface (elle exige encore `data:` et `blob:` pour les extensions) : voir `KNOWN-ISSUES.md`.

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
