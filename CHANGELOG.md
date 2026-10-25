# Changelog

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) ; versions selon [SemVer](https://semver.org/lang/fr/).

## [1.0.0] — 2026-10-25

Première version publique.

### Édition
- Édition Markdown **visuelle** (WYSIWYG) : la syntaxe n'est jamais affichée ; le fichier reste un `.md` propre.
- Titres, gras, italique, barré, `==surligné==`, code, citations, listes (retrait Tab / Maj+Tab), cases à cocher, liens, images, séparateurs.
- Raccourcis Markdown à la frappe (`## `, `> `, `- `, `---`…) et raccourcis clavier (Ctrl+B, Ctrl+I, Ctrl+1…6…).
- **Menu `/`** pour insérer ou transformer un bloc.
- **Tableaux** : création par grille, ajout de lignes/colonnes n'importe où, alignement, suppression.
- **Alertes GitHub** (`> [!NOTE]`, `TIP`, `IMPORTANT`, `WARNING`, `CAUTION`).
- **Schémas Mermaid** affichés en dessin, avec un **atelier** pour en créer sans code (camembert, Gantt, flux, diagramme d'états).
- Images collées (Ctrl+V) enregistrées à côté de la note ; elles suivent la note quand on la renomme ou la déplace.
- Liens ouvrables par Ctrl+clic (navigateur, ou autre note dans un onglet).

### Organisation
- Arborescence de dossiers et notes (panneau redimensionnable et repliable), onglets avec défilement, session restaurée au lancement.
- Enregistrement automatique sûr : aucune perte de données, détection des modifications externes (OneDrive, VS Code…) avec copie « conflit », suppression vers la Corbeille uniquement.
- Markdown réécrit de façon cohérente ; le Markdown non pris en charge est conservé à l'identique.

### Apparence et réglages
- Thème sombre Fluent, effet acrylique à transparence réglable, couleur d'accent de Windows suivie en direct.
- Onglet **Réglages** : dossier des notes, emplacement du fichier de réglages (AppData par défaut, mode portable, emplacement personnalisé), transparence, langue.
- Interface en **français** et en **anglais**.

### Distribution
- Un seul exécutable portable `mymdnotepad.exe` pour Windows 11, sans installation (non signé : avertissement SmartScreen au premier lancement).

[1.0.0]: https://github.com/Nyco87/myMDnotepad/releases/tag/v1.0.0
