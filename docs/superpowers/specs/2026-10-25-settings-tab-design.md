# myMDnotepad — Onglet Réglages (conception + plan)

Date : 2026-10-25 — validé par l'utilisateur dans la conversation (maquette `.superpowers/brainstorm/10566-1792916979/content/settings-tab.html`).
Garanties existantes inchangées : aucune perte de données, ouvrir une note ne l'écrit jamais, Markdown « pretty » idempotent, démarrage < 1 s, exe unique portable, Windows 11.

## Pourquoi
L'utilisateur veut un vrai écran de réglages, et ne veut pas de fichier `.json` à côté de l'exe (ex. sur le Bureau).

## Comportement (validé)
1. **Ouverture** : l'icône ⚙ remplace « ⋯ » dans la barre de titre et ouvre un onglet « Réglages » ; un seul à la fois (re-clic = activation). L'onglet n'est pas une note : jamais sauvegardé comme fichier, non restauré au démarrage (ou restauré — au choix du constructeur, sans écrire de fichier). Les anciennes entrées du menu « ⋯ » (changer de dossier) migrent ici.
2. **Dossier des notes** : chemin affiché ; « Ouvrir » (Explorateur) ; « Changer… » = même flux sûr que l'actuel `changeRoot` (flushAll d'abord, abandon avec message si échec).
3. **Fichier de réglages** :
   - Emplacement **par défaut : `%APPDATA%\myMDnotepad\mymdnotepad.settings.json`** (plus rien à côté de l'exe).
   - **Mode portable** : si `mymdnotepad.settings.json` existe à côté de l'exe, il est utilisé (priorité) ; l'écran propose « Déplacer vers AppData ».
   - **Emplacement personnalisé** : « Déplacer… » (choix d'un dossier, ex. OneDrive) écrit le fichier de réglages à la nouvelle place puis enregistre un **pointeur** `%APPDATA%\myMDnotepad\location.json` `{ "settings_path": "<chemin absolu>" }`. Au démarrage : réglages à côté de l'exe ? sinon pointeur valide ? sinon AppData par défaut. Pointeur vers un fichier introuvable → message + repli sur AppData (sans écraser quoi que ce soit).
   - « Ouvrir le dossier » ; « Charger… » = choisir un `.json` existant, le valider (serde, valeurs par défaut pour le manquant), puis l'adopter (copié à l'emplacement courant après confirmation « Remplacer les réglages actuels ? »).
   - Migration v2.1 → : l'ancien comportement « fichier à côté de l'exe si inscriptible » disparaît pour les nouvelles installations ; un fichier existant à côté de l'exe reste utilisé (mode portable). La migration depuis `mdnote.settings.json` reste.
   - Jamais de suppression de l'ancien fichier lors d'un déplacement (on écrit le nouveau, on bascule, l'ancien reste — le message le dit).
4. **Transparence** : curseur 0–100 « Opaque ↔ Transparent », ne règle **que** l'opacité du voile (pas le flou). Aperçu en direct, valeur mémorisée (`transparency`, défaut = rendu actuel). Implémentation laissée au constructeur (alpha de la teinte acrylique via `window-vibrancy` et/ou opacité des fonds CSS) ; aucun impact sur la lisibilité du texte de l'éditeur.
5. **Langue** : Français / English ; défaut = langue de Windows (fr* → français, sinon anglais) ; changement immédiat sans redémarrage ; **toute** l'interface traduite (titre de fenêtre, bandeau, infobulles, menus, arborescence, onglets, toasts/erreurs, dialogues, premier lancement, atelier de schémas, menu « / » et ses mots-clés de recherche dans les deux langues, palette de symboles, étiquettes d'alertes). Le contenu des notes ne change jamais (`[!NOTE]` reste tel quel). Les messages d'erreur venant de Rust : codes ou messages traduits côté TS.
6. **À propos** : icône, « myMDnotepad », version (depuis la config Tauri), lien GitHub `https://github.com/Nyco87/myMDnotepad` (s'ouvre via opener), licence, liste des bibliothèques principales (Tauri, ProseMirror, markdown-it, mermaid).

## Découpage (un seul lot, un commit par étape)
- **S1 Rust réglages** : résolution emplacement (exe → pointeur → AppData), commandes `get_settings_location() -> {path, mode: "portable"|"appdata"|"custom"}`, `move_settings(dest_dir)`, `load_settings_file(path)`, `open_in_explorer(path)` (ou opener) ; champs `transparency: u8`, `language: Option<String>` (`#[serde(default)]`). Tests Rust : priorité exe > pointeur > défaut ; pointeur cassé → défaut sans écrasement ; move n'efface pas l'ancien ; load valide/invalide ; migration mdnote toujours OK.
- **S2 i18n** : module `src/i18n/` (`t(key, params?)`, dictionnaires `fr.ts`/`en.ts`, `setLanguage`, `onLanguageChanged`), remplacement de toutes les chaînes UI ; test qui vérifie que les deux dictionnaires ont exactement les mêmes clés et qu'aucune chaîne UI française codée en dur ne reste dans `src/ui`, `src/editor`, `src/diagram` (hors tests et dictionnaires — heuristique sur accents/mots français, liste blanche si besoin).
- **S3 Onglet Réglages** : `src/ui/settings-tab.ts` intégré au contrôleur d'onglets comme onglet spécial ; sections selon la maquette ; ⚙ dans la barre de titre ; curseur de transparence en direct ; sélecteur de langue ; À propos. Tests jsdom (ouverture unique, actions appellent les bonnes commandes, langue bascule les textes).
- **S4** : build complet, `.exe`, mesure de démarrage (< 1 s), liste de vérifications manuelles.

## Laissé au constructeur
Structure exacte du code, technique de transparence, détails visuels dans l'esprit de la maquette et du thème Fluent sombre/accent.
