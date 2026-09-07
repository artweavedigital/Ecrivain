# Assistant IA — Écrivain 0.6.0 bêta

L’Assistant IA est accessible depuis **Outils > Assistant IA**.

## À comprendre avant de commencer

Écrivain ne contient pas lui-même un modèle d’intelligence artificielle. Il sert d’interface entre votre manuscrit et un moteur IA que vous choisissez.

Il existe deux méthodes :

1. **IA locale gratuite** : Ollama ou LM Studio sont installés sur votre ordinateur. Aucun abonnement ni clé API n’est nécessaire.
2. **Service distant** : OpenAI, Anthropic ou Mistral. Vous utilisez votre propre clé API et les conditions/quota/facturation de ce fournisseur.

La page IA vous guide maintenant en trois étapes : **Tester → Charger les modèles → Lancer l’analyse**.

## Ollama — local / gratuit

1. Installez Ollama sur Windows.
2. Lancez Ollama.
3. Installez au moins un modèle. Exemple dans un terminal :

   `ollama pull gemma3:4b`

4. Dans Écrivain, choisissez **Ollama**.
5. Cliquez sur **1. Tester**.
6. Cliquez sur **2. Charger les modèles**.
7. Choisissez le modèle et lancez votre analyse.

Adresse normale : `http://127.0.0.1:11434`.

Si Écrivain indique qu’Ollama ne répond pas, cela signifie généralement qu’Ollama n’est pas installé ou pas lancé.

## LM Studio — local / gratuit

1. Installez LM Studio.
2. Téléchargez un modèle dans LM Studio.
3. Ouvrez l’onglet **Developer** de LM Studio et démarrez le serveur local.
4. Dans Écrivain, choisissez **LM Studio**.
5. Cliquez sur **1. Tester** puis sur **2. Charger les modèles**.

Adresse normale : `http://127.0.0.1:1234/v1`.

Si le serveur répond mais qu’aucun modèle n’apparaît, vérifiez qu’un modèle a bien été téléchargé ou chargé dans LM Studio.

## OpenAI, Anthropic et Mistral — clé API personnelle

1. Créez une clé API dans le compte du fournisseur.
2. Collez la clé dans Écrivain.
3. Cliquez sur **1. Tester**.
4. Cliquez sur **2. Charger les modèles**.
5. Choisissez un modèle de génération de texte.

Les clés sont enregistrées hors des projets. Lorsque Windows permet le stockage sécurisé, Écrivain les chiffre avec le mécanisme sécurisé fourni par Electron/Windows.

**Important :** un abonnement à une application grand public d’un fournisseur ne signifie pas nécessairement que l’API est comprise. L’API peut avoir son propre quota ou sa propre facturation.

## Messages compréhensibles

Écrivain distingue désormais les problèmes les plus courants :

- application locale non lancée ;
- serveur LM Studio non démarré ;
- mauvaise adresse ;
- clé API refusée ;
- accès interdit ;
- quota ou limite atteinte ;
- absence de modèle installé/chargé ;
- problème de connexion Internet.

Le message reste affiché dans la page IA : il ne disparaît plus après quelques secondes.

## Contextes disponibles

- sélection du chapitre ;
- chapitre courant ;
- synopsis global ;
- manuscrit entier.

Pour une requête unique sur un manuscrit très volumineux, Écrivain limite actuellement le contexte à environ 180 000 caractères et signale si une troncature a été nécessaire.

## Outils proposés

- Analyse éditoriale ;
- Répétitions et lourdeurs ;
- Cohérence ;
- Résumé ;
- Reformulation ;
- Question libre.

## Sécurité éditoriale

La réponse de l’IA est affichée séparément. Écrivain ne remplace, ne complète et ne sauvegarde jamais automatiquement le manuscrit à partir d’une réponse IA.
