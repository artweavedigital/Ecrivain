# Écrivain — Manuel d'utilisation

Oct 11, 2026 · @stefanos Matsos

## 1. Présentation et installation

Écrivain est un atelier d’écriture local pour auteurs francophones : les chapitres sont à gauche, le texte au centre, les notes et les outils narratifs à portée de souris. Ce manuel décrit la version **0.6.0 bêta.11.1**.

### Ce qu’il faut savoir

- **Application locale.** Vos projets restent sur votre ordinateur. L’écriture, les notes, l’organisation et les exports fonctionnent hors ligne. Internet ne sert qu’aux services que vous connectez vous-même, comme une IA distante.
- **Vos œuvres vous appartiennent.** Écrivain ne revendique aucun droit sur vos manuscrits, notes ou images.
- **Format documenté.** Un projet est un dossier au format `ecrivain-project` (version 1, schéma interne 1.5.0). Il n’est pas enfermé dans l’application.
- **Bêta.** La version est faite pour de vrais projets, mais la priorité est la stabilité. Gardez vos propres copies de sécurité (voir la section 11).

### Installer et lancer

Sous Windows 64 bits, il y a trois façons de l’utiliser :

1. **Installateur** `Ecrivain-Setup-0.6.0-beta.11.1.exe` : il est créé seulement si Inno Setup 6 est installé sur la machine qui construit l’application.
2. **Archive portable** `Ecrivain-0.6.0-beta.11.1-portable.zip` : décompressez-la dans un dossier court (par exemple `C:\Ecrivain`) et lancez l’exécutable.
3. **Depuis les sources** : installez Node.js 24 LTS, puis lancez `INSTALLER-DEPENDANCES.cmd` une fois, et `LANCER-ECRIVAIN.cmd` ensuite.

Pour fabriquer vous-même l’application, double-cliquez sur `CONSTRUIRE-WINDOWS.cmd` : il installe les dépendances, vérifie le code, construit l’application et l’archive portable, puis l’installateur si Inno Setup est présent. Tout est placé dans le dossier `dist`. Pour Linux et macOS, utilisez `CONSTRUIRE-LINUX.sh` et `CONSTRUIRE-MACOS.sh`.

### Où trouver de l’aide

- Le menu **Aide** de l’application.
- Le fichier `PRISE-EN-MAIN.md` pour un démarrage en une page.
- En cas de problème : **Aide → Informations techniques → Créer un rapport de diagnostic…** Le rapport ne contient ni votre texte ni vos clés d’API.

## 2. Prise en main : créer et ouvrir un projet

### Créer un projet

1. Choisissez **Fichier → Nouveau projet…** (**Ctrl+N**) ou le bouton **Nouveau projet** de l’écran d’accueil.
2. Indiquez le **titre** (« Nouveau roman » par défaut) et l’**auteur**.
3. Choisissez le dossier qui accueillera vos projets. Écrivain y crée un sous-dossier au nom du titre (suivi de 2, 3… si ce nom existe déjà) avec toute la structure de fichiers.

Les valeurs de départ (police, page, marges, auteur par défaut) viennent de vos **Préférences** (section 15).

### Ouvrir un projet

- **Fichier → Ouvrir un projet…** (**Ctrl+O**) : choisissez le dossier du projet.
- **Fichier → Projets récents** : les 3 ou 5 derniers projets, selon vos préférences.
- Au démarrage, Écrivain affiche l’accueil ou rouvre le dernier projet, selon le réglage « Au démarrage ».

Un projet créé par une version plus récente du format n’est pas ouvert, pour éviter de l’abîmer.

### Informations du projet

**Projet → Informations du projet…** permet de modifier le titre, le sous-titre, l’auteur, la **langue** (français, anglais, néerlandais ou allemand) et une description. La fenêtre affiche aussi les dates de création et de dernière modification, le nombre de chapitres et le format. Le bouton **Ouvrir le dossier** montre le projet dans l’explorateur de fichiers.

### Ce que contient un dossier de projet

| Élément | Rôle |
| --- | --- |
| `project.json` | Titre, auteur, réglages de mise en page. |
| `chapters/` | Un fichier par chapitre : une erreur sur l’un n’empêche pas d’ouvrir les autres. |
| `notes/`, `assets/` | Notes et fichiers joints. |
| `board/` | Fiches du synoptique et événements de la chronologie. |
| `synopsis.json`, `mindmap.json` | Synopsis global et carte mentale. |
| `backups/`, `history/`, `trash/`, `recovery/` | Sauvegardes, versions des chapitres, corbeille et récupération. |
| `exports/` | Fichiers exportés. |

Vous pouvez copier ou archiver ce dossier tel quel. Le détail technique est dans `FORMAT-PROJET.md`.

## 3. L’espace de travail

L’écran se compose d’un bandeau en haut, de la colonne des chapitres à gauche et de la zone centrale, qui change selon ce que vous ouvrez.

| Zone | Contenu |
| --- | --- |
| Bandeau du projet | Titre et sous-titre du projet, langue (FR), nombre de chapitres et nombre total de mots. |
| Colonne « Manuscrit » | Liste des chapitres et sous-chapitres. Le bouton ＋ crée un chapitre. On change l’ordre en glissant‑déposant ; les sous-chapitres restent attachés à leur chapitre. |
| Zone centrale | Soit l’éditeur du chapitre, soit l’un des outils (synopsis, notes, chronologie, carte mentale, recherche, statistiques, sauvegardes, historique, assistant IA, extensions, préférences). |
| Barre d’état | Chemin du projet, nombre de mots du chapitre et règlage du zoom de l’interface. |

### Navigation

- Chaque outil s’ouvre dans la zone centrale, à la place du texte. Le bouton **Retour au manuscrit** (ou **← Manuscrit** pour les extensions) ramène à l’éditeur.
- Les outils s’ouvrent par les menus **Projet** et **Outils**, qui sont décrits section par section dans ce manuel.
- Le menu **Affichage → Afficher/masquer les chapitres** masque ou affiche la colonne des chapitres (raccourci Ctrl+B, voir la section 16).
- **Zoom de l’interface** : **Ctrl +**, **Ctrl −**, **Ctrl 0** (taille réelle) ou le curseur de la barre d’état, de 80 % à 150 %.
- **F11** passe en plein écran ; **Échap** en sort. Un bouton « Quitter le plein écran » s’affiche aussi.

### Les menus

| Menu | Fonctions principales |
| --- | --- |
| Fichier | Nouveau projet, ouvrir un projet, projets récents, enregistrer, exporter, quitter. |
| Édition | Annuler, rétablir, couper, copier, coller, tout sélectionner, rechercher et remplacer dans le chapitre ou dans tout le projet. |
| Affichage | Colonne des chapitres, caractères invisibles, zoom, plein écran. |
| Projet | Informations, configuration du document, vérification et réparation, synopsis global, synoptique, notes, chronologie, carte mentale, statistiques, sauvegardes, corbeille, historique. |
| Chapitres | Nouveau chapitre ou sous-chapitre, dupliquer, renommer, changer le niveau, supprimer. |
| Outils | Typographie française, assistant IA, extensions, préférences. |
| Aide | Guide de prise en main, raccourcis clavier, informations techniques, rapport de diagnostic, journaux, à propos. |

## 4. Écrire : l’éditeur

Cliquez sur un chapitre dans la colonne de gauche : son texte s’ouvre dans la zone centrale, présentée comme une page. En haut, le **titre du chapitre** et son **statut** se modifient directement.

### La barre d’outils

| Groupe | Boutons |
| --- | --- |
| Historique | ↶ Annuler (Ctrl+Z), ↷ Rétablir (Ctrl+Y). |
| Mise en forme | **G** gras (Ctrl+B), *I* italique (Ctrl+I), S souligné (Ctrl+U), exposant (pour « XXIᵉ siècle »). |
| Styles de paragraphe | **Texte** (paragraphe normal), **Titre** (intertitre dans le chapitre), **Citation**. |
| Dialogue et typographie | **— Dialogue** insère un tiret cadratin suivi d’une espace ; **Typo FR** normalise tout le chapitre (voir section 6). |
| Caractères | À, É, È, Ç, Œ, guillemets français « et », tiret cadratin —, points de suspension … |
| À droite | Indicateur « Enregistré » et bouton **Enregistrer**. |

Un chapitre peut aussi contenir une police, une taille, une couleur ou un surlignage particuliers : ils sont conservés, par exemple après un remplacement avec format (section 10). Tout contenu venu d’un fichier est filtré : scripts, formulaires et styles dangereux sont retirés, ce qui protège contre un projet reçu d’un tiers.

### Enregistrement

- **Automatique.** Écrivain enregistre après un temps d’inactivité (1,8 seconde par défaut, réglable de 1 à 10 secondes dans les préférences).
- **Manuel.** **Ctrl+S** ou le bouton **Enregistrer**. Un enregistrement manuel crée un jalon dans l’historique du chapitre.
- **À la fermeture.** La fenêtre ne se ferme qu’après l’enregistrement du chapitre en cours et du synopsis global.

### Confort de frappe

- L’apostrophe droite (« ' ») devient automatiquement une apostrophe typographique (« ’ ») pendant la frappe.
- **F6** affiche les **caractères invisibles** (espaces, espaces insécables, fins de paragraphe), dessinés par-dessus le texte sans le modifier.
- Les mots inconnus sont soulignés par le correcteur orthographique (section 6).
- Un repère « Fin du chapitre · saut de page à l’export » s’affiche en bas du texte lorsque l’option de saut de page est active.
- Le **zoom** de l’interface (Ctrl + / Ctrl −) agrandit tout l’écran, pas seulement le texte.

## 5. Chapitres et sous-chapitres

### Créer

- **Chapitres → Nouveau chapitre…** (**Ctrl+Maj+N**) ou le bouton ＋ de la colonne.
- **Chapitres → Nouveau sous-chapitre…** crée un sous-chapitre rattaché au chapitre actif.

Les chapitres principaux sont numérotés dans la colonne ; les sous-chapitres ne le sont pas. **Cette numérotation n’apparaît pas dans les exports :** le titre est exporté exactement comme vous l’avez saisi.

### Organiser

- **Glisser-déposer** par la poignée ⋮⋮. On déplace un chapitre parmi ceux du même niveau ; ses sous-chapitres le suivent.
- **Chapitres → Transformer en sous-chapitre du précédent** (**Alt+→**) et **Remonter d’un niveau** (**Alt+←**) changent la hiérarchie sans toucher au texte.
- **Dupliquer** et **Renommer** sont dans le menu **Chapitres** et dans le menu contextuel.

### Statuts

Chaque chapitre a un statut, affiché par une pastille de couleur et modifiable dans l’éditeur ou par clic droit :

| Statut | Usage |
| --- | --- |
| Brouillon | Premier jet, valeur par défaut. |
| En cours | Chapitre en cours d’écriture. |
| À relire | Écrit, en attente de relecture. |
| Finalisé | Terminé. |
| Coupé | Retiré du livre, mais conservé. |

Les statuts alimentent les statistiques et peuvent exclure des chapitres de l’export (section 12).

### Menu contextuel (clic droit)

Ouvrir, nouveau sous-chapitre, transformer en sous-chapitre, remonter d’un niveau, statut, **Exclure de l’export** (case à cocher, le chapitre est alors marqué « hors export » dans la colonne), renommer, dupliquer, supprimer.

### Supprimer

**Chapitres → Supprimer le chapitre…** ne détruit rien : le chapitre, ses sous-chapitres et ses notes liées vont dans la **corbeille** (**Projet → Corbeille**), d’où on peut les restaurer. Une confirmation indique le nombre de chapitres, de notes et de mots concernés.

## 6. Typographie française et correction

### Le bouton « Typo FR »

Le bouton **Typo FR** de la barre d’outils, ou **Outils → Typographie française**, normalise tout le chapitre ouvert. Il peut être relancé autant de fois que nécessaire : le résultat ne change pas la deuxième fois, et les espaces déjà présentes sont converties au passage.

| Règle | Résultat |
| --- | --- |
| Apostrophe | « l'homme » devient « l’homme ». |
| Points de suspension | Trois points consécutifs deviennent « … ». |
| Virgule et point | Aucune espace avant. |
| Deux-points | Espace insécable avant, sauf dans les heures (12:30) et les adresses (https://). |
| Point-virgule, point d’interrogation, point d’exclamation | Espace insécable avant, une seule pour « ?! » ou « !! ». Pas d’espace juste après une parenthèse ouvrante : « (?) ». |
| Guillemets français | Espace insécable à l’intérieur, après le guillemet ouvrant et avant le guillemet fermant. |
| Pourcentage et euro | Espace insécable entre le nombre et « % », « ‰ » ou « € ». |
| Dialogue | Un paragraphe qui commence par « - » ou « – » suivi d’une espace devient un tiret cadratin « — ». Seul le début du paragraphe est touché. |
| Adresses web et courriel | Jamais modifiées. |

### Quelle espace avant « ; ? ! » ?

Dans l’éditeur, le bouton **Typo FR** met une **espace fine insécable** (U+202F) avant « ; ? ! », comme le veut la tradition typographique. Les autres espaces insécables sont des espaces insécables ordinaires (U+00A0).

Pour les **exports Word, OpenDocument et Markdown**, Écrivain remplace cette espace fine par une espace insécable ordinaire (U+00A0) avant « ; ? ! ». Elle est reconnue par tous les logiciels de mise en page (XPress, Scribus, InDesign…), alors que l’espace fine manque à certaines polices et est mal gérée par certains logiciels. L’**EPUB** et le **PDF** gardent l’espace fine.

### Correcteur orthographique

Le correcteur intégré est actif par défaut. Les mots inconnus sont soulignés pendant la frappe ; un **clic droit** sur un mot signalé propose jusqu’à six corrections, **Ajouter « mot » au dictionnaire**, puis les commandes habituelles (couper, copier, coller).

- Il se désactive dans **Outils → Préférences → Écriture**.
- Sous Windows et Linux, il utilise les dictionnaires Hunspell ; le dictionnaire français peut être téléchargé à la première utilisation (seul le fichier de dictionnaire est téléchargé, jamais votre texte).
- Il vérifie l’orthographe des mots, pas la grammaire.

Pour la grammaire (accords, conjugaisons), installez l’extension **Correcteur français — Grammalecte** (section 14).

## 7. Notes, fiches et synopsis

Ces outils servent à préparer le roman. Ils sont **séparés du manuscrit** : ils ne sont jamais ajoutés aux exports. Aucun n’est obligatoire pour écrire. Ils s’ouvrent par le menu **Projet**.

### Synopsis global

Une vue d’ensemble du roman en quatre zones :

- **Titre de travail** ;
- **Synopsis** : le déroulé de l’histoire, du début à la fin ;
- **Pitch** : quelques lignes pour résumer l’essentiel ;
- **Notes de structure** : arcs, points de bascule, problèmes à résoudre, idées de réorganisation.

Un indicateur affiche l’état d’enregistrement ; **Ctrl+S** enregistre le synopsis lorsqu’il est ouvert.

### Synoptique

Le synoptique est un tableau de **fiches libres**, pour les scènes, les personnages, les lieux, les idées et la documentation. Le bouton **Nouvelle fiche** en crée une ; un double-clic ou **Ouvrir** la modifie.

| Champ | Contenu |
| --- | --- |
| Type | Scène, Personnage, Lieu, Idée ou Documentation. Des boutons de filtre en haut du tableau permettent de n’en afficher qu’un. |
| Statut | À écrire, En cours, Intégré ou Coupé. |
| Couleur | Ivoire, Sable, Rose poudré, Bleu grisé, Vert sauge ou Ardoise. |
| Chapitre lié | Relie la fiche à un chapitre (facultatif). |
| Titre, Résumé, Idées, Notes | Champs communs à tous les types. |
| Rôle, Traits, Objectif | Utiles pour un personnage. |
| Ambiance, Personnages impliqués | Utiles pour un lieu ou une scène. |
| Tension | Utile pour une scène. |
| Liens / sources | Utile pour la documentation. |

Pour réorganiser les fiches, glissez-les par la poignée ⋮⋮ **lorsque le filtre « Toutes » est actif**. Supprimer une fiche ne modifie pas le manuscrit.

### Notes

Le menu **Projet → Notes** regroupe les notes du livre et des chapitres.

- **Nouvelle note** : titre, catégorie (Idée, Documentation, Rappel, Scène coupée, Image, PDF, Libre), **lien** (livre entier ou un chapitre précis) et couleur. Le texte accepte gras, italique, souligné et listes à puces ou numérotées.
- **Joindre un fichier** : image, PDF, document Word ou OpenDocument, texte ou archive. Le fichier est copié dans le dossier du projet ; l’original n’est pas déplacé.
- **Ouvrir le fichier** lance l’application associée sur votre ordinateur. **Fichiers du projet** ouvre le dossier où les pièces jointes sont regroupées.
- Le champ de recherche filtre par titre ou contenu ; deux listes déroulantes filtrent par catégorie et par lien (livre entier ou chapitre actif).
- Dans l’éditeur de note, **CNRTL Définition** et **Synonymes** ouvrent dans votre navigateur la page du Centre national de ressources textuelles et lexicales pour le mot sélectionné. Ce sont les seuls boutons qui contactent Internet ; ils n’envoient que ce mot.

## 8. Chronologie et carte mentale

### Chronologie

**Projet → Chronologie** affiche une frise des scènes de l’histoire, rangées par **fil narratif** (par exemple « Récit principal », « Intrigue secondaire »). On peut changer l’échelle (jour, semaine, mois), **centrer la frise** et déplacer une scène à la souris pour changer sa date ou son fil.

Pour ajouter une scène, cliquez sur **Nouvel événement** et remplissez le formulaire :

| Groupe | Champs |
| --- | --- |
| Scène | Action ou titre, fil narratif. |
| Temps | Date et heure de début, date et heure de fin. |
| Présence dans la scène | Personnage principal, lieu, autres personnages (séparés par des virgules). |
| Mémoire de scène | Chapitre lié (facultatif), résumé ou intrigue. |

- La **couleur du cadre** correspond au personnage principal de la scène. Le bloc **Couleurs des personnages** permet de choisir une couleur par nom, puis **Enregistrer les couleurs**.
- Sous la frise, la liste des événements est triée par date.
- Lorsque des scènes sont liées à des chapitres, le bloc **Rythme des chapitres liés** compare le nombre de mots de chaque chapitre et le nombre de scènes qui s’y rattachent.

### Carte mentale

**Projet → Carte mentale** relie visuellement les **personnages, lieux, intrigues, chapitres, idées et objets** du roman. Chaque type a sa couleur.

- **Nouvel élément**, ou double-clic sur une zone vide de la carte : crée un élément à cet endroit.
- On **déplace** les éléments à la souris ; leur position est enregistrée automatiquement. La molette zoome ; **Centrer** cadre toute la carte ; **Réorganiser** replace les éléments automatiquement.
- Un clic sur un élément l’ouvre dans le panneau de droite : nom, type, chapitre lié, note de résumé. Pour un élément lié à un chapitre, un double-clic ouvre ce chapitre.
- Pour relier deux éléments, choisissez la cible dans **Vers**, écrivez la **relation** (par exemple « confrère GRC » ou « se trouve à »), puis **Ajouter le lien**. Les liens s’affichent sous forme de flèches.
- Le champ de recherche trouve un élément par nom, note ou type.
- **Exporter PNG** enregistre la carte sous forme d’image.

## 9. Statistiques

**Projet → Statistiques** donne une vue d’ensemble du manuscrit et de votre progression. Le bouton **Actualiser** recalcule les chiffres.

| Indicateur | Signification |
| --- | --- |
| Total du manuscrit | Nombre de mots de tous les chapitres. |
| Exportable | Nombre de mots des chapitres qui seront exportés, et nombre de chapitres exclus. |
| Aujourd’hui | Mots ajoutés aujourd’hui. |
| 7 derniers jours | Mots ajoutés sur la semaine. |
| Chapitres | Nombre de chapitres du projet. |
| Moyenne | Mots par chapitre. |

Trois blocs détaillent ensuite : la **progression sur 7 jours** (un histogramme, qui ne compte que les mots ajoutés lors des enregistrements), l’**état des chapitres** selon leur statut, et la **répartition des mots par chapitre**.

### Comment les mots sont comptés

Un mot est une suite de caractères séparés par des espaces (y compris insécables) qui contient au moins une lettre ou un chiffre. Les tirets cadratins de dialogue et les signes de ponctuation seuls ne comptent donc pas ; « dit-il », « l’homme » ou « c’est-à-dire » comptent chacun pour un mot, comme dans un traitement de texte classique. Le même compteur sert dans l’éditeur, les statistiques et la sauvegarde.

Écrivain ne propose pas d’objectif défini (nombre de mots par jour) dans cette version.

## 10. Recherche et remplacement

### Dans le chapitre

**Ctrl+F** ouvre la barre de recherche au-dessus du texte ; **Ctrl+H** y ajoute la ligne de remplacement.

- **Entrée** passe à l’occurrence suivante, **Maj+Entrée** à la précédente ; les flèches ↑ ↓ font de même. Un compteur indique la position (par exemple « 3 / 12 »). **Échap** ferme la barre.
- **Respecter la casse** et **Mot entier** affinent la recherche. **Tout rechercher** surligne toutes les occurrences.
- **Remplacer** change l’occurrence courante ; **Remplacer tout** change toutes les occurrences, **dans le chapitre en cours uniquement**.
- **Format…** limite la recherche à un texte ayant une mise en forme donnée, ou applique une mise en forme au texte remplacé (voir plus bas).

### Dans tout le projet

**Ctrl+Maj+F** ouvre la page **Rechercher dans le projet** : elle cherche dans tous les chapitres et liste les résultats ; un clic sur un résultat ouvre le chapitre concerné. Les options « Respecter la casse », « Mot entier » et le format de recherche existent aussi ici.

**Ctrl+Maj+H** ajoute le champ de remplacement et le bouton **Remplacer dans tout le projet**. Par sécurité, le remplacement global se fait en deux temps :

1. Un message résume ce qui va être modifié ; vous devez cliquer sur **Confirmer le remplacement global**.
2. Avant de toucher au premier chapitre, Écrivain crée une **sauvegarde complète** du projet (« Avant remplacement global ») et un jalon dans l’historique de chaque chapitre modifié. Une erreur se rattrape donc avec **Projet → Sauvegardes** ou **Projet → Historique** (section 11).

### Recherche par format

Le bouton **Format…** ouvre une fenêtre à quatre onglets. Un réglage laissé sur « Indifférent » n’est pas utilisé comme critère.

| Onglet | Critères |
| --- | --- |
| Police | Police, style (normal, gras, italique, gras italique), taille en points. |
| Effets de caractère | Souligné, barré, couleur du texte. |
| Position | Normale, exposant ou indice. |
| Mise en évidence | Surlignage. |

Exemple : retrouver tous les mots en italique, ou transformer en exposant un « e » de numérotation.

## 11. Sauvegardes, versions et sécurité des données

Écrivain empile plusieurs protections. Elles s’ajoutent à vos propres copies : gardez toujours une copie du dossier du projet sur un autre support.

| Protection | Ce qu’elle conserve | Où la trouver |
| --- | --- | --- |
| Enregistrement automatique | Le chapitre en cours, après un temps d’inactivité. | Automatique (réglage dans les préférences). |
| Historique des chapitres | Les versions successives d’un chapitre : un jalon à chaque enregistrement manuel, au plus un toutes les dix minutes pour les enregistrements automatiques. | Projet → Historique |
| Sauvegardes du projet | Une copie complète du projet. Cinq sauvegardes manuelles et cinq automatiques au maximum ; une automatique ne remplace jamais une manuelle. | Projet → Sauvegardes |
| Corbeille | Chapitres et notes supprimés, jusqu’à ce que vous la vidiez. | Projet → Corbeille |
| Copie externe | Une copie de chaque sauvegarde dans le dossier de votre choix (clé USB, disque externe, dossier synchronisé). Les dix plus récentes y sont gardées. | Préférences → Démarrage |
| Vérification et récupération | Contrôle de tous les fichiers du projet, avec réparation. | Projet → Vérifier et réparer le projet… |

### Sauvegardes du projet

**Projet → Sauvegardes** montre les sauvegardes sous forme de cartes (type, date, nombre de chapitres et de mots, taille). **Sauvegarder maintenant** en crée une manuelle ; **Restaurer** remet le projet dans l’état choisi. Avant toute restauration, Écrivain sauvegarde automatiquement l’état actuel, pour qu’on puisse revenir en arrière. Le bouton **Dossier des sauvegardes** les affiche dans l’explorateur. Une sauvegarde automatique est aussi faite avant chaque remplacement global.

Les sauvegardes ne contiennent ni l’historique, ni la corbeille, ni les exports.

### Historique d’un chapitre

**Projet → Historique** liste les versions du chapitre choisi, avec leur date et leur nombre de mots.

- **Comparer** met deux versions face à face : les suppressions apparaissent à gauche, les ajouts à droite.
- **Restaurer** remet une ancienne version ; la version actuelle est conservée dans l’historique avant la restauration.

Pour que l’historique ne grossisse pas sans fin, les jalons **automatiques** sont allégés avec le temps : tout est conservé pendant 7 jours, puis un jalon par jour jusqu’à 30 jours, puis un par semaine. Les jalons **manuels**, ceux d’« avant restauration » et de « remplacement global » ne sont jamais supprimés.

### Corbeille

L’onglet **Corbeille** liste les éléments supprimés avec leur nombre de mots, de notes liées et leur taille. **Restaurer** les remet à leur place ; **Supprimer définitivement** et **Vider la corbeille** sont, eux, irréversibles.

### Vérifier et réparer

**Projet → Vérifier et réparer le projet…** contrôle la structure du projet et répare ce qui peut l’être. Un message indique le résultat : aucune anomalie, nombre de corrections, ou avertissements. Les fichiers endommagés sont copiés dans `recovery/` avant toute réparation, qui puise dans l’ordre : l’historique du chapitre, les autosauvegardes techniques, puis les sauvegardes complètes. Cette vérification se fait aussi en silence à l’ouverture d’un projet.

### Autres garde-fous

- Un fichier de projet inconnu ou plus récent que la version de l’application n’est pas modifié.
- Le contenu venu d’un fichier (chapitres, notes) est filtré avant affichage.
- Les clés d’API de l’assistant IA sont stockées hors du projet et, lorsque le système le permet, chiffrées.

## 12. Exports

### Lancer un export

**Fichier → Exporter** propose cinq formats. Écrivain enregistre d’abord le chapitre en cours, puis ouvre une fenêtre « Enregistrer sous ». Le dossier proposé est `exports/` dans le projet et le nom de fichier reprend le titre du livre. Un message confirme l’export et indique combien de chapitres n’ont pas été exportés.

| Format | Usage |
| --- | --- |
| Word (.docx) | Mise en page complète, à importer dans un logiciel de PAO ou à relire dans Word. |
| OpenDocument (.odt) | Même rôle pour LibreOffice. |
| Markdown (.md) | Texte brut balisé, à archiver ou à retravailler ailleurs. |
| EPUB (.epub) | Livre numérique. |
| PDF (.pdf) | Fichier de lecture ou d’impression, au format de page du livre. |

### Ce qui est exporté

- Tous les chapitres, dans l’ordre de la colonne **Manuscrit**, sauf ceux que vous excluez : chapitres coupés ou brouillons selon la configuration du document, ou chapitres marqués **Exclure de l’export** par clic droit. **Exclure un chapitre exclut aussi ses sous-chapitres.**
- Le titre de chaque chapitre, exactement comme vous l’avez saisi (aucun numéro n’est ajouté).
- La mise en forme du texte : gras, italique, souligné, barré, exposant, indice, police, taille, couleur et surlignage dans Word et OpenDocument ; titres, citations et listes.
- Ne sont **jamais** exportés : les notes, les fiches du synoptique, le synopsis global, la chronologie et la carte mentale.

### Word et OpenDocument

- Une **page de titre** (titre, sous-titre, auteur) en première page.
- Chaque chapitre et sous-chapitre commence sur une **nouvelle page** si l’option « Commencer chaque chapitre sur une nouvelle page » est cochée (section 13).
- Les titres de chapitres utilisent le style « Titre 1 » ; les intertitres du texte (bouton **Titre**) sont en « Titre 2 », et ainsi de suite ; les citations ont leur propre style. Ces noms de styles servent à faire correspondre le texte aux styles de votre logiciel de mise en page.
- Les numéros de page et l’en-tête courant suivent la configuration du document.
- Avant « ; ? ! », l’espace est une **espace insécable ordinaire** (U+00A0).

### Markdown

Un seul fichier : le titre du livre en niveau 1, le sous-titre en italique, l’auteur en gras, puis les chapitres en niveau 2 et les sous-chapitres en niveau 3. Les titres sont repris tels que saisis ; les espaces du texte avant « ; ? ! » sont des espaces insécables ordinaires.

### EPUB

Un livre numérique avec un fichier par chapitre. L’espace avant « ; ? ! » y est une espace fine insécable. **Il n’y a pas encore de couverture.**

### PDF

Le PDF est produit par l’impression intégrée d’Écrivain, au format de page, avec les marges, l’en-tête courant et les numéros de page de la configuration. Les césures automatiques dépendent de la langue du projet et du système : elles peuvent varier d’un ordinateur à l’autre.

### Importer le fichier dans XPress, Scribus ou InDesign

- Utilisez de préférence le **DOCX** (ou l’ODT) et conservez les styles Word à l’import, pour retrouver « Titre 1 », « Titre 2 » et « Citation ».
- **Saut de page :** certains logiciels de PAO, dont XPress, ignorent le saut de page « avant le paragraphe » d’un fichier Word : les chapitres se suivent alors sans changer de page. Il faut alors définir ce saut dans le logiciel de mise en page, sur le style de titre de chapitre.
- La version bêta ne propose pas de chapitre commençant obligatoirement sur une page impaire.

## 13. Configuration du document

**Projet → Configuration du document…** règle la mise en page du livre, pour l’édition **et** pour les exports. Ces réglages sont propres à chaque projet ; les valeurs de départ d’un nouveau projet viennent des Préférences (section 15).

| Groupe | Réglage | Défaut |
| --- | --- | --- |
| Typographie | Police du manuscrit | Garamond |
|  | Corps | 11 pt (de 7 à 30) |
|  | Interligne | 13 pt (de 8 à 60) |
| Format de page | Largeur | 12 cm |
|  | Hauteur | 19 cm |
| Marges | Haut, bas, gauche, droite | 15 mm chacune |
| Paragraphes | Alinéa de première ligne | 5 mm |
|  | Espace avant, espace après | 0 mm |
| Chapitres | Commencer chaque chapitre sur une nouvelle page à l’export | Coché |
| Pagination | Numéroter les pages (Word, OpenDocument, PDF) | Coché |
|  | En-tête courant | Aucun |
| Chapitres exportés | Ne pas exporter les chapitres « Coupé » | Coché |
|  | Ne pas exporter les chapitres « Brouillon » | Décoché |

### Pagination et en-têtes

- La **page de titre est comptée mais reste vierge** : la première page numérotée porte le numéro 2. C’est la convention de l’édition ; décochez **Numéroter les pages** pour y renoncer.
- L’**en-tête courant** peut être : aucun ; le titre du livre ; le nom de l’auteur ; ou l’**auteur sur les pages paires et le titre sur les pages impaires**. Cette dernière option suppose une impression recto verso.

### Le réglage « nouvelle page »

Lorsque la case est cochée, chaque chapitre et sous-chapitre commence sur une nouvelle page dans le Word, l’OpenDocument et le PDF, et un repère « Fin du chapitre » s’affiche en bas du texte dans l’éditeur. Lorsqu’elle est décochée, les chapitres s’enchaînent sans saut de page.

> Les polices proposées doivent être installées sur votre ordinateur pour être utilisées dans les exports.

## 14. Assistant IA et extensions

### Assistant IA

**Outils → Assistant IA** vous fait dialoguer avec une intelligence artificielle à propos de votre manuscrit. Écrivain ne contient pas de modèle : il sert d’interface avec un moteur que vous choisissez. **Il ne modifie jamais le manuscrit automatiquement** : la réponse s’affiche séparément, vous pouvez la copier, et rien n’est inséré ou enregistré sans votre action.

| Fournisseur | Particularité | Adresse par défaut |
| --- | --- | --- |
| Ollama | Local, gratuit, sans clé. | `http://127.0.0.1:11434` |
| LM Studio | Local, gratuit, sans clé. Démarrer le serveur local dans l’onglet Developer. | `http://127.0.0.1:1234/v1` |
| OpenAI | Service distant, clé API personnelle. | `https://api.openai.com/v1` |
| Anthropic | Service distant, clé API personnelle. | `https://api.anthropic.com/v1` |
| Mistral | Service distant, clé API personnelle. | `https://api.mistral.ai/v1` |

**Confidentialité :** avec Ollama ou LM Studio, le texte reste sur votre ordinateur. Avec OpenAI, Anthropic ou Mistral, le passage choisi est **envoyé à ce fournisseur**, selon ses conditions, son quota et sa facturation. Un abonnement à une application grand public n’inclut pas forcément l’accès à l’API.

#### Mise en route en trois étapes

1. Choisissez le fournisseur. Pour un service distant, collez la **clé API** ; **Effacer la clé** la supprime. Les clés sont enregistrées hors des projets et chiffrées quand le système le permet.
2. Cliquez sur **1. Tester**, puis sur **2. Charger les modèles**, et choisissez un modèle (ou saisissez son nom). Les **Réglages avancés** permettent de changer l’adresse du service. **Enregistrer** conserve vos réglages.
3. Choisissez la **tâche** et le **contexte**, écrivez au besoin une consigne, puis **Lancer l’analyse**.

| Tâche | Utilité |
| --- | --- |
| Analyse éditoriale | Regard global sur le texte. |
| Répétitions et lourdeurs | Repère les redites et les phrases pesantes. |
| Cohérence | Repère les contradictions. |
| Résumé | Résume le passage. |
| Reformulation | Propose d’autres formulations. |
| Question libre | Pose votre propre question. |

Le **contexte** envoyé à l’IA est au choix : la sélection dans le chapitre, le chapitre courant, le synopsis global ou le manuscrit entier. Une seule requête est limitée à environ 180 000 caractères ; Écrivain signale lorsqu’il a dû tronquer. Une consigne comme « ne corrige pas le style, cherche uniquement les incohérences de chronologie » oriente la réponse. Les messages d’erreur sont explicites (application non lancée, clé refusée, quota atteint, modèle absent, connexion…) et restent affichés.

### Extensions

Les extensions ajoutent des outils sans modifier Écrivain. Elles s’installent hors ligne depuis un fichier `.ecrivain-plugin`, s’exécutent dans un espace isolé et ne reçoivent que les permissions qu’elles déclarent.

- **Outils → Extensions → Gérer les extensions…** ouvre la page des extensions. **Installer une extension…** choisit le fichier ; si une version existe déjà, écrivez par-dessus en choisissant **Remplacer**. **Dossier des extensions** montre où elles sont rangées.
- Chaque extension a un bloc **Détails et permissions** et un bouton **Désinstaller**. Cliquez sur une extension puis sur l’action voulue pour la lancer.
- Les extensions s’installent pour l’application, pas pour un seul projet ; leurs données, elles, sont enregistrées dans le projet ouvert.

| Extension fournie | Rôle |
| --- | --- |
| Analyse des dialogues (1.1.0) | Compte, chapitre par chapitre, les paragraphes de dialogue. Lecture seule. |
| Correcteur français — Grammalecte (0.3.0) | Correcteur grammatical local : accords, conjugaisons, lexicographe, conjugueur et aperçu du formateur typographique. |

Pour Grammalecte, ouvrez l’extension, onglet **Correcteur**, choisissez un chapitre et cliquez sur **Analyser le chapitre**. Chaque problème propose des boutons de correction : **rien n’est modifié sans votre clic**. Écrivain enregistre d’abord le chapitre, garde l’historique, change seulement le passage concerné, puis réanalyse. Si le passage est ambigu ou traverse plusieurs mises en forme, la correction est refusée plutôt que de risquer d’altérer le texte : corrigez alors à la main. Les fichiers fournis et leur code figurent dans `extensions-exemples/` ; `EXTENSIONS.md` décrit comment en créer une.

## 15. Préférences de l’application

**Outils → Préférences** règle le comportement général d’Écrivain. Les choix de mise en page propres à un roman se font dans **Projet → Configuration du document**. Le bouton **Enregistrer les préférences** valide ; **Valeurs par défaut** remet tout à zéro.

| Bloc | Réglage | Choix |
| --- | --- | --- |
| Démarrage | Au démarrage | Afficher l’accueil, ou rouvrir le dernier projet. |
|  | Projets récents affichés | 3 ou 5. |
|  | Dossier par défaut des projets | Un dossier de votre choix. |
|  | Copie externe des sauvegardes | Un dossier (clé USB, disque externe, dossier synchronisé). Les dix plus récentes y sont conservées ; si le dossier est indisponible, la sauvegarde normale se fait quand même. |
| Écriture | Sauvegarde automatique après | 1, 2, 3, 5 ou 10 secondes d’inactivité. |
|  | Correcteur orthographique français | Activé (Hunspell) ou désactivé. |
|  | Auteur par défaut | Nom proposé à la création d’un projet. |
|  | Police du manuscrit, corps, interligne | Valeurs de départ des nouveaux projets. |
| Nouveaux romans | Largeur, hauteur, marges, alinéa | Valeurs de départ ; chaque projet peut ensuite avoir les siennes. |
| Interface | Zoom | De 80 % à 150 %. |
| Données locales | Ouvrir les données d’Écrivain, ouvrir le dossier des extensions | Montre où sont les réglages et les extensions. |

Les réglages et les extensions sont conservés **en dehors** des projets : copier un projet ne copie pas vos préférences.

## 16. Raccourcis clavier

La liste est aussi disponible dans **Aide → Raccourcis clavier**. Sous macOS, **Ctrl** devient **Cmd**.

| Action | Raccourci |
| --- | --- |
| Enregistrer | Ctrl+S |
| Nouveau projet | Ctrl+N |
| Ouvrir un projet | Ctrl+O |
| Nouveau chapitre | Ctrl+Maj+N |
| Rechercher dans le chapitre | Ctrl+F |
| Remplacer dans le chapitre | Ctrl+H |
| Rechercher dans le projet | Ctrl+Maj+F |
| Remplacer dans tout le projet | Ctrl+Maj+H |
| Gras, italique, souligné | Ctrl+B, Ctrl+I, Ctrl+U |
| Annuler, rétablir | Ctrl+Z, Ctrl+Y |
| Afficher ou masquer la colonne des chapitres | Ctrl+B (hors éditeur : voir la remarque) |
| Afficher les caractères invisibles | F6 |
| Plein écran, en sortir | F11, Échap |
| Zoom avant, arrière, taille réelle | Ctrl + +, Ctrl + −, Ctrl+0 |
| Faire du chapitre un sous-chapitre du précédent | Alt+→ |
| Remonter d’un niveau | Alt+← |
| Quitter | Alt+F4 |

> Remarque : Ctrl+B est déclaré à la fois pour le gras et pour l’affichage de la colonne des chapitres. Si le gras ne répond pas au clavier, utilisez le bouton G de la barre d’outils et le menu Affichage pour la colonne. Ce comportement n’a pas été vérifié dans l’application lancée.

## 17. Dépannage et limites connues

### En cas de problème

1. Ne modifiez pas à la main les fichiers du projet. Relancez Écrivain.
2. Lancez **Projet → Vérifier et réparer le projet…**
3. Si le comportement reste anormal, ouvrez **Aide → Informations techniques** (versions, dossier des données, journal) et cliquez sur **Créer un rapport de diagnostic…**. Le rapport ne contient ni le texte du manuscrit ni les clés d’API ; joignez-le à votre description (ce que vous faisiez, ce qui s’est produit, ce que vous attendiez, si c’est reproductible).
4. **Aide → Ouvrir les journaux** affiche le dossier du journal technique.

### Problèmes fréquents

| Symptôme | Piste |
| --- | --- |
| Le correcteur ne souligne rien | Vérifiez qu’il est activé dans les préférences. Sous Windows et Linux, le dictionnaire français peut avoir besoin d’Internet la première fois. |
| Un carré apparaît avant « ; ? ! » | La police ne contient pas l’espace fine insécable (U+202F) utilisée par **Typo FR**. Choisissez une autre police du manuscrit. |
| L’assistant IA répond « ne répond pas » | Ollama ou LM Studio n’est pas lancé, ou l’adresse du service est fausse. Relancez-le puis cliquez sur **1. Tester**. |
| Aucun modèle dans la liste | Aucun modèle n’est installé ou chargé dans le moteur local. |
| Les chapitres se suivent sans changer de page dans la PAO | Le logiciel de mise en page ignore le saut de page de Word : voir la section 12. |
| Une extension ne démarre pas | Revenez à la liste des extensions et réessayez ; sinon créez un rapport de diagnostic. |
| Un chapitre supprimé par erreur | Il est dans **Projet → Corbeille**. |
| Un remplacement global a mal tourné | **Projet → Sauvegardes**, sauvegarde « Avant remplacement global », ou **Projet → Historique** chapitre par chapitre. |

### Limites de cette version bêta

- **Pas de couverture** dans l’EPUB.
- La **page de titre est comptée** dans la pagination des exports : la première page numérotée est la page 2.
- L’en-tête courant « auteur / titre » suppose une impression recto verso.
- Le PDF dépend du système pour la césure ; le rendu exact n’a pas été testé sur toutes les machines.
- La **corbeille n’est jamais vidée automatiquement** : pensez à la vider de temps en temps.
- Les totaux de mots peuvent changer un peu à la première ouverture d’un projet ancien (méthode de comptage unifiée).
- Le formateur typographique de Grammalecte n’affiche qu’un aperçu ; il n’applique pas les changements à tout le chapitre.
- Pas encore prévus : collage propre depuis Word, objectif de mots, mode concentration, thème sombre, palette de commandes, import de documents, suivi des modifications.
- Le rendu dans XPress et Scribus n’a pas été testé par les concepteurs de cette version : vérifiez un export sur un extrait avant de mettre en page un livre entier.

### Bonnes habitudes

- Copiez régulièrement le dossier du projet sur un autre support, ou activez la **copie externe des sauvegardes**.
- Testez un export sur quelques chapitres avant d’en lancer un long.
- Faites une sauvegarde manuelle avant toute grosse manipulation (remplacement global, restructuration).
