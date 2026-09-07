# Publication sur GitHub

## Dépôt conseillé

Créer un dépôt public nommé simplement :

```text
Ecrivain
```

Le compte GitHub existant peut être utilisé ; aucune organisation séparée n’est
nécessaire.

## Premier envoi

Depuis le dossier du projet :

```powershell
git init
git add .
git commit -m "Écrivain 0.6.0 bêta"
git branch -M main
git remote add origin https://github.com/VOTRE-COMPTE/Ecrivain.git
git push -u origin main
```

Remplacer `VOTRE-COMPTE` par le nom du compte GitHub.

## Première release

Créer ensuite une release GitHub intitulée :

```text
Écrivain 0.6.0 bêta
```

Joindre au minimum :

- `Ecrivain-Setup-0.6.0-beta.exe` ;
- `Ecrivain-0.6.0-beta-portable.zip` ;
- l’archive du code source créée automatiquement par GitHub.

La release doit être indiquée comme **préversion / bêta**.
