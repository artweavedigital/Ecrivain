# Diagnostic

Écrivain écrit un journal technique dans le dossier de données locales de
l’application, sous `logs/ecrivain.log`.

Le journal est limité et tourne automatiquement lorsqu’il dépasse environ 1 Mo.
Le précédent journal est conservé sous `ecrivain-previous.log`.

## Rapport exportable

**Aide → Informations techniques → Créer un rapport de diagnostic…** crée un ZIP
contenant :

- version d’Écrivain et versions techniques ;
- système et architecture ;
- chemin et métadonnées minimales du projet courant ;
- nombre de chapitres ;
- journaux techniques ;
- dernier rapport de validation du projet lorsqu’il existe.

Ne sont pas inclus :

- contenu des chapitres ;
- synopsis, notes et pièces jointes ;
- clés API ;
- réponses IA.
