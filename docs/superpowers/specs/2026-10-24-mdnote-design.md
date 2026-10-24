# MDnote — document de conception

Date : 2026-10-24
Statut : brouillon, à valider

## 1. Intention et pourquoi

L'utilisateur prend ses notes en Markdown dans VS Code : un onglet pour taper la syntaxe (`#`, `>`, `|`…), un second onglet pour la prévisualisation. La syntaxe est peu lisible, sa représentation n'est pas évidente, et l'aller-retour entre les deux vues est pénible.

MDnote est une application de prise de notes où **on écrit directement dans le rendu** (édition « aperçu », façon Typora), tout en enregistrant de **vrais fichiers `.md` propres** sur le disque. L'utilisateur ne touchera pas au code : il utilise l'app.

## 2. Objectifs

- Un **seul `.exe` Windows**, portable, à double-cliquer, sans installation, sans hébergement web.
- **Démarrage ultra rapide** : c'est un critère de réussite explicite de l'utilisateur.
- Édition WYSIWYG du Markdown, **syntaxe jamais visible** (style A, façon Typora — y compris sur la ligne du curseur).
- Notes = fichiers `.md` dans un dossier choisi par l'utilisateur, affichés en **arborescence** latérale.
- Markdown enregistré **« pretty »** et déterministe.
- Look **Windows 11 / Fluent, mode sombre, fond acrylique**.

## 3. Non-objectifs (v1)

- Recherche plein texte dans toutes les notes (plus tard).
- Synchronisation cloud intégrée. Le cloud viendra « gratuitement » si l'utilisateur choisit un dossier OneDrive ; l'app n'a rien à faire de plus en v1. L'utilisateur souhaite du cloud à terme.
- Thème clair, autres OS que Windows 11.
- Édition en mode source / bascule vers la syntaxe brute.

## 4. Anti-objectifs (ce qui serait un échec même si « ça marche »)

- Un démarrage lent ou une fenêtre qui « charge ».
- Un bouton de création de note discret / difficile à trouver.
- Du texte illisible sur fond sombre (ex. texte noir dans les tableaux — repéré sur une maquette).
- Un `.md` produit sale, incohérent, ou qui change de forme à chaque sauvegarde.
- Toute perte de données (suppression définitive, écrasement silencieux).
- Un format propriétaire / base de données cachée : les fichiers doivent rester lisibles par VS Code, GitHub, etc.

## 5. Contraintes

- Windows 11 (WebView2 présent nativement).
- Exécutable unique, pas d'installateur, pas de droits admin.
- Aucune dépendance réseau au runtime.

## 6. Ce qui a été décidé

Légende : **[U]** = décidé par l'utilisateur ; **[C]** = choix de Claude (proposé, non contesté) ; l'utilisateur a validé l'ensemble des playbacks.

### 6.1 Technique — [C], délégué par l'utilisateur
- **Tauri 2** : coquille Rust (fenêtre, système de fichiers, effet acrylique/Mica, réglages), interface en **TypeScript** affichée par WebView2.
- Éditeur bâti sur **ProseMirror / TipTap** (ou Milkdown) — le constructeur choisit la librairie précise, avec comme critères : style A sans syntaxe visible, sérialisation Markdown contrôlable (pour le « pretty »), poids/temps de démarrage.
- Build en `.exe` unique (pas d'installateur MSI/NSIS livré à l'utilisateur).
- **Pas de signature de code** [U] : l'avertissement SmartScreen au premier lancement est accepté. Livraison : le `.exe` est produit localement et remis à l'utilisateur ; pas de canal de mise à jour automatique en v1 [C].

### 6.2 Fenêtre et look — [U] sauf mention
- Mode sombre uniquement, style Fluent Windows 11, **fond acrylique** laissant transparaître le bureau [U].
- **Repli Mica accepté** [U] : si l'acrylique provoque des saccades au déplacement/redimensionnement de la fenêtre (problème connu Tauri/Windows 11), on bascule sur Mica. À prototyper tôt, comme point de décision go/no-go.
- **Onglets intégrés à la barre de titre** (façon Terminal Windows) [C].
- Disposition : barre d'onglets en haut → bandeau de mise en forme → à gauche l'arborescence, à droite l'éditeur [U, validé sur maquette].
- Référence visuelle : maquette `dark-fluent-v2.html` (cf. `.superpowers/brainstorm/`).

### 6.3 Dossier de notes et réglages
- Au **premier lancement**, l'app demande de choisir un dossier local ; elle s'en souvient [U]. On peut en changer via un menu [C].
- Réglages stockés dans un fichier **à côté du `.exe`** ; si l'emplacement n'est pas inscriptible, repli dans le dossier utilisateur Windows (`%APPDATA%\MDnote`) [C].
- Pas de base de données : l'arborescence reflète exactement le disque [U].

### 6.4 Arborescence — [C] validé par l'utilisateur
- Dossiers et notes réels du disque ; seuls les `.md` sont affichés ; le dossier `images/` (cf. 6.8) est masqué. Dossiers sans `.md` : affichés (ce sont de vrais dossiers).
- Nom affiché = nom de fichier sans `.md`.
- Actions : créer note, créer dossier, renommer, supprimer (**vers la Corbeille Windows**, jamais définitif), déplacer par glisser-déposer.
- Si un fichier change en dehors de l'app (OneDrive, VS Code…), l'arborescence et la note ouverte se mettent à jour.
- **Bouton « ＋ Nouvelle note » très visible** en haut de l'arborescence, couleur d'accent, raccourci **Ctrl+N** [U].
  - La note est créée dans le dossier sélectionné (sinon à la racine), s'ouvre dans un nouvel onglet, son nom est éditable directement dans l'arborescence (pré-rempli « Nouvelle note »), Entrée valide et place le curseur dans la note [C].

### 6.5 Onglets — [U] pour la présence, [C] pour le comportement
- Un clic dans l'arborescence ouvre la note dans un onglet ; si déjà ouverte, on bascule dessus.
- Fermer : ✕ ou Ctrl+W. Changer : Ctrl+Tab / Ctrl+Shift+Tab.
- Les onglets ouverts sont restaurés au lancement suivant.

### 6.6 Éditeur
- **Style A** : tout est rendu, la syntaxe n'est jamais visible [U].
- **Enregistrement automatique**, pas de Ctrl+S obligatoire [U a validé la supposition].
- **Bandeau de mise en forme** [U] contenant [C, validé] : gras, italique, barré, code en ligne | niveau de titre (menu) | liste à puces, numérotée, cases à cocher | citation, bloc de code, tableau, lien, image, séparateur | emoji.
- **Raccourcis Markdown à la frappe**, en plus du bandeau [U] : `# `…`###### ` → titres, `> ` → citation, `- ` / `* ` → puces, `1. ` → liste numérotée, `- [ ] ` → case à cocher, ` ``` ` → bloc de code, `---` → séparateur, `**x**`, `*x*`, `~~x~~`, `` `x` `` → styles en ligne [C, validé].
- Raccourcis clavier classiques : Ctrl+B, Ctrl+I, etc. [C].
- **Blocs « collants »** [U] : dans une citation ou un bloc de code, Entrée crée une nouvelle ligne **dans le même bloc**. On sort du bloc avec **flèche bas** depuis sa dernière ligne ; si le bloc est le dernier élément de la note, flèche bas crée un paragraphe normal en dessous [C, validé].

### 6.7 Tableaux — [U] pour le besoin, [C] pour l'interaction
- Bouton ⊞ : choix de la taille (ex. grille 3×3 à survoler) puis insertion.
- Poignées `+` au bord du tableau pour ajouter une ligne / une colonne.
- Clic droit sur une cellule : insérer ligne au-dessus/en dessous, colonne à gauche/à droite, supprimer ligne/colonne, alignement de colonne.
- Tab = cellule suivante ; Tab dans la dernière cellule = nouvelle ligne.
- Le texte des cellules doit être lisible en sombre.

### 6.8 Images — [U] pour le besoin, [C] pour le stockage
- Ctrl+V d'une image (capture, etc.) : enregistrée en `.png` dans un dossier `images/` **à côté de la note**, nommée `<note>-<AAAA-MM-JJ>-<n>.png`, et insérée en lien relatif `![](images/…)`.
- Dans l'éditeur, on voit l'image, jamais le lien.
- Bouton 🖼 du bandeau : insérer une image depuis un fichier (copiée dans `images/` de la même façon).
- **Déplacement / renommage / suppression de note** [C] : les images collées depuis MDnote (dossier `images/`, préfixe = nom de la note) suivent la note — déplacées dans le `images/` du dossier de destination, renommées avec la note, liens réécrits. À la suppression d'une note, ses images vont à la Corbeille sauf si une autre note y fait référence. Les images référencées par d'autres chemins (écrites à la main) ne sont jamais touchées ; si un déplacement casse un tel lien relatif, le lien est réécrit pour rester valide.

### 6.9 Palette d'emojis — [U]
- Bouton 😀 dans le bandeau → palette ; clic = insertion au curseur.
- Contenu et ordre validés (maquette `emoji-v3.html`) :
  - **Récents** (les derniers utilisés)
  - **Validation** : ✅ ✔️ ❌ ✖️ ☑️ 👍 👎
  - **Alerte & info** : ⚠️ ⛔ 🚫 ❗ ❓ ℹ️ 💡 🔥
  - **Avancement** : ⏳ 🚧 ⏸️ 🔄 🚀 🐛 🔒
  - **Ronds** : 🔴 🟠 🟡 🟢 🔵 🟣 🟤 ⚫ ⚪
  - **Carrés** : 🟥 🟧 🟨 🟩 🟦 🟪 🟫 ⬛ ⬜
  - **Flèches** : ⬅️ ➡️ ⬆️ ⬇️ ↗️ ↘️ ↔️ ↕️ ↩️
  - **Repères** : ⭐ 📌 📅 ⏰ 📎 🔗 📝 ❤️

### 6.10 Markdown « pretty » — [U] pour l'exigence, [C] pour les règles (validées)
Le fichier écrit est toujours normalisé de la même façon :
- Titres ATX uniquement (`#`), jamais soulignés.
- Une ligne vide entre blocs.
- Un seul marqueur de puce (`-`), listes numérotées `1.`.
- **Tableaux avec colonnes alignées** (cellules complétées d'espaces), ligne de séparation `| --- |` aux largeurs alignées.
- Gras `**`, italique `*`, blocs de code clôturés par ` ``` `.
- Fin de fichier avec un unique saut de ligne, encodage UTF-8.
- Ré-ouvrir puis ré-enregistrer un fichier ne doit pas le modifier (idempotence).
- **Ouvrir un fichier ne l'écrit jamais** [C] : l'enregistrement automatique ne se déclenche qu'après une vraie modification par l'utilisateur. Un fichier existant (écrit par VS Code, etc.) n'est donc normalisé qu'au moment où on le modifie.
- **Markdown non pris en charge** [C] : tout ce que l'éditeur ne sait pas représenter (HTML brut, front matter YAML, notes de bas de page, maths, liens de référence…) est conservé **à l'identique** sous forme de bloc « brut » discret, affiché en texte gris non éditable visuellement mais jamais supprimé ni altéré à l'enregistrement. Couverture visée : CommonMark + GFM (tableaux, cases à cocher, barré).

### 6.11 Performances — [U] pour l'exigence, [C] pour la cible
- Cible : fenêtre affichée et utilisable **en moins d'1 seconde** sur un PC standard, dernière note ouverte visible immédiatement ; l'arborescence se charge sans bloquer l'affichage.
- À **mesurer** (pas seulement viser) et vérifier à chaque étape majeure.

## 7. Laissé au constructeur

- Choix précis de la librairie d'éditeur et du sérialiseur Markdown, tant que 6.6, 6.7 et 6.10 sont respectés.
- Structure du code, tests, outillage de build.
- Détails visuels fins (icônes, espacements, couleur d'accent exacte) dans l'esprit Fluent sombre de la maquette.
- Gestion des cas limites (nom de fichier en conflit, caractères interdits, dossier racine supprimé…) avec des choix sûrs et sans perte de données.
