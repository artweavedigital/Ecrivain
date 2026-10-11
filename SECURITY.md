# Sécurité

Écrivain stocke les projets localement. Les clés API de l’assistant IA ne doivent
jamais être écrites dans le dossier du roman.

## Signaler un problème de sécurité

Pour une vulnérabilité pouvant exposer des fichiers personnels, des clés API ou
permettre l’exécution de code non autorisé, évitez de publier immédiatement des
détails exploitables dans une issue publique. Contactez le mainteneur du dépôt par
un canal privé disponible sur son profil GitHub, puis une correction pourra être
publiée avant les détails techniques.

## Extensions

Les extensions sont volontairement limitées par une API de permissions. Une
extension ne doit pas obtenir un accès direct général au système de fichiers ni aux
clés IA par défaut.

## Mesures en place (bêta.11)

- **Contenu importé** : le HTML des chapitres et des notes est filtré par liste blanche
  (`shared/html-sanitize.js`) avant d’entrer dans l’interface. Scripts, cadres, formulaires,
  liens `javascript:`, images distantes et styles dangereux sont retirés.
- **Identifiants** : tout identifiant reçu de l’interface est validé avant de devenir un nom
  de fichier ou de dossier (`lib/fs-safe.js`) ; un chemin ne peut pas sortir du dossier du
  projet.
- **Pièces jointes des notes** : seuls les fichiers choisis par l’auteur dans la boîte de
  dialogue peuvent être copiés dans le projet, et un chemin enregistré dans une note ne peut
  pas désigner un fichier extérieur au projet.
- **Fenêtres** : aucune ouverture de nouvelle fenêtre, navigation limitée à l’interface
  (les liens `https://` s’ouvrent dans le navigateur du système), `webview` interdit,
  aucune permission web accordée.
- **Écritures** : écriture atomique des fichiers du projet, pour qu’un arrêt brutal ne
  laisse jamais un fichier tronqué.
- **PDF** : la page imprimée est isolée par sa propre politique de sécurité (aucun script,
  aucune ressource distante).

## Limites connues

- La politique de sécurité de l’interface autorise encore `data:` et `blob:` : les
  extensions s’exécutent dans un cadre isolé construit à partir de ces ressources. La
  resserrer demande un protocole de chargement dédié aux extensions.
- L’éditeur s’appuie encore sur `contentEditable` et `document.execCommand`, dont le
  navigateur peut modifier le comportement.
- L’export lit le HTML avec un analyseur à base d’expressions régulières, pas avec un
  analyseur complet : il ne produit que du texte et des balises connues, mais il reste à
  remplacer.
- Une extension installée par l’utilisateur peut demander des permissions étendues : lire
  les permissions affichées avant d’installer.
