# Correcteur orthographique intégré

Depuis Écrivain 0.6.0 bêta.3, le logiciel active le correcteur intégré à Electron/Chromium.
Sous Windows et Linux, celui-ci utilise les dictionnaires Hunspell ; macOS utilise le correcteur natif du système.

## Utilisation

Le correcteur est activé par défaut. Dans le texte d’un chapitre, les mots inconnus sont soulignés.
Un clic droit sur un mot signalé affiche jusqu’à six suggestions, puis l’action **Ajouter au dictionnaire**, suivie des commandes d’édition habituelles.

Le correcteur peut être désactivé dans **Outils → Préférences → Écriture → Correcteur orthographique français**.

## Premier chargement

Sous Windows et Linux, Electron peut télécharger le dictionnaire Hunspell français lors de sa première utilisation. Le texte saisi n’est pas envoyé au service de dictionnaire ; seul le fichier de dictionnaire est téléchargé. Une fois disponible, il est conservé localement par Chromium.

## Limites

Hunspell vérifie essentiellement l’orthographe lexicale. Il ne remplace pas un correcteur grammatical : accords, conjugaisons complexes, syntaxe et style seront traités séparément par l’extension Grammalecte prévue pour Écrivain.
