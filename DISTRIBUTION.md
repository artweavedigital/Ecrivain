# Distribution d’Écrivain

## Windows

La plateforme prioritaire de la bêta est Windows x64.

Lancer :

```text
CONSTRUIRE-WINDOWS.cmd
```

Résultats attendus :

```text
dist/
├── Ecrivain-win32-x64/
│   └── Ecrivain.exe
├── Ecrivain-0.6.0-beta-portable.zip
└── installer/
    └── Ecrivain-Setup-0.6.0-beta.exe
```

La création de l’installateur `.exe` nécessite Inno Setup 6. Sans Inno Setup, la
version portable est quand même générée.

## Linux

Sur une machine Linux x64 :

```bash
./CONSTRUIRE-LINUX.sh
```

Cette étape fabrique le bundle Electron. Les paquets AppImage/deb pourront être
ajoutés après validation de la bêta Windows.

## macOS

Sur un Mac :

```bash
./CONSTRUIRE-MACOS.sh
```

Deux bundles sont préparés : Apple Silicon (`arm64`) et Intel (`x64`). Pour une
publication publique, la signature et la notarisation Apple restent nécessaires.

## Principe de maintenance

Écrivain conserve **un seul code principal** et **un seul format de projet** pour les
trois systèmes. Les différences doivent rester limitées à l’empaquetage et aux
intégrations propres au système d’exploitation.
