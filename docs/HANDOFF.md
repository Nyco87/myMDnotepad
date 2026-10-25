# myMDnotepad — Note de reprise (état au 2026-10-25)

Note destinée à une future conversation : ce qui existe, pourquoi, et ce qui reste à faire. Les détails sont dans `docs/superpowers/specs/` (conceptions validées) et `docs/superpowers/plans/` (plans d'implémentation).

## 1. Le produit

- **Quoi** : éditeur de notes Markdown **WYSIWYG** (style Typora : la syntaxe n'est jamais visible) pour **Windows 11**, **exe unique portable** (`mymdnotepad.exe`, ~5,7 Mo, pas d'installeur, non signé → avertissement SmartScreen accepté).
- **Pourquoi** : l'utilisateur écrivait du Markdown dans VS Code avec un aperçu dans un 2ᵉ onglet ; il veut écrire directement dans le rendu, avec de vrais fichiers `.md` propres.
- **Nom** : MDnote → renommé **myMDnotepad** (beaucoup de noms pris). Le dossier local du dépôt s'appelle encore `C:\Users\nicol\CODE\MDnote`.
- **Dépôt** : https://github.com/Nyco87/myMDnotepad — **public**, licence **MIT © 2026 Nicolas Morellet**, branche unique `main`.
- **Icône** : post-it jaune vif carré à grand coin corné, « M » (police normale) + « D> » (police code), crayon bleu fin à 45° touchant le D. Source : `src-tauri/icons/app-icon.svg`, rendu 1024 px fait **avec Edge headless** (resvg rendait mal les polices) puis `npx tauri icon`.

## 2. Fonctionnalités livrées

- Édition visuelle : titres, gras, italique, barré, `==surligné==` (couleur dérivée de l'accent), code, citations, listes (retrait Tab/Maj+Tab, boutons), cases à cocher (sombres), liens (Ctrl+clic : web → navigateur, `.md` relatif → onglet), images, séparateurs (`---`/`***`/`___` + espace ou Entrée).
- Raccourcis Markdown à la frappe ; blocs « collants » (Entrée reste dans citation/code/alerte, flèche bas pour sortir).
- **Menu `/`** (FR/EN, insensible aux accents ; pas dans le code ; restreint dans les cellules).
- **Tableaux** : taille via grille, `+` au survol des bordures (insertion n'importe où), clic droit (insérer/supprimer/aligner/supprimer le tableau), Tab entre cellules.
- **Alertes GitHub** `> [!NOTE|TIP|IMPORTANT|WARNING|CAUTION]` (titres FR/EN, changement de type, casse d'origine conservée).
- **Mermaid** (v12) : rendu à la demande (jamais sur le chemin de démarrage) + **atelier à briques** pour camembert (avertissement si total > 100), flux, états, Gantt ; aller-retour **strict** code ↔ briques (sinon mode code).
- Images collées → `images/<slug-note>-<date>-<n>.png` à côté de la note ; elles suivent la note (renommage/déplacement, copie si partagée).
- Arborescence (dossiers en couleur d'accent + pictogramme, panneau redimensionnable et repliable Ctrl+\\), **onglets** (largeur min, flèches de défilement), session restaurée.
- **Réglages** (onglet ⚙) : dossier des notes, emplacement du fichier de réglages (exe → pointeur → `%APPDATA%\myMDnotepad`), transparence acrylique, langue FR/EN (toute l'UI via `src/i18n`), À propos.
- Look : sombre Fluent, **acrylique seul** (Mica supprimé), **couleur d'accent Windows en direct** (AccentLight2), barres de défilement discrètes, CSP stricte.

## 3. Garanties (à préserver absolument)

- **Aucune perte de données** : ouvrir une note ne l'écrit jamais ; autosave 400 ms avec file d'attente, réessai, `markSaved` après rechargement ; **compare-and-swap** sur mtime (`write_note(expected_mtime)` → `CONFLICT`) ; modification externe pendant une saisie → copie `<nom> (conflit AAAA-MM-JJ HHmm).md` ; note illisible (non UTF-8, verrouillée) → enregistrement suspendu + bandeau « Réessayer » ; suppression = Corbeille ; verrous `lockUnder` autour des renommages/déplacements.
- **Markdown « pretty » idempotent** (titres `#`, puces `-`, tableaux alignés, ≥ 1 ligne vide entre blocs, lignes vides en plus conservées) ; **Markdown non pris en charge conservé octet pour octet** (`raw_block`/`raw_inline` : front matter, HTML, notes de bas de page, maths, définitions de liens…).
- **Démarrage < 1 s** (médiane ~630 ms, `scripts/measure-startup.ps1`).

## 4. Architecture et choix techniques

- **Tauri 2** : Rust (`src-tauri/src/`) pour fichiers, réglages, surveillance du dossier, fenêtre, accent ; **TypeScript + Vite sans framework** (`src/`) pour l'UI ; **ProseMirror** direct (pas TipTap) + **markdown-it** (parseur) + sérialiseur maison (`src/markdown/`).
- Rust : `paths.rs` (chemins relatifs à la racine, refus des sorties), `notes_fs.rs` (lecture/écriture atomique, CAS), `file_ops.rs` (créer/renommer/déplacer/corbeille + images qui suivent), `images.rs`, `settings.rs` (résolution d'emplacement, migration depuis `mdnote.settings.json`, `update_settings(patch)`), `watcher.rs` (notify-debouncer-mini), `window_fx.rs` (window-vibrancy 0.8), `accent.rs` (WinRT `UISettings`).
- TS : `src/editor/` (plugins, keymap, tables, images, slash, alerts, mermaid-view, autosave), `src/ui/` (tabs, titlebar, sidebar, toolbar, settings-tab, toast…), `src/diagram/` (modèles + atelier), `src/i18n/` (fr/en, test de parité des clés).
- Tests : **Vitest** (fichiers `*.test.ts` à côté du code, ~573) + **cargo test** (modules `#[cfg(test)]`, ~73). Convention conservée volontairement.

## 5. CI / qualité (GitHub Actions, tout est vert)

- `ci.yml` : 6 jobs distincts — Frontend tests & coverage, Frontend lint & types (ESLint + tsc), Frontend build, Rust format & clippy (`-D warnings`), Rust tests & coverage (cargo-llvm-cov), Security dependency audit. Couverture dans les résumés + **Codecov** (secret `CODECOV_TOKEN` en place ; ~81 %). Pas de seuil (informatif).
- `codeql.yml` (JS/TS + Rust), `dependency-review.yml` (PR), `dependabot.yml` (npm, cargo, actions ; hebdo, groupé ; **ignore markdown-it 15** — prosemirror-markdown dépend de la 14 — et **TypeScript 7** — typescript-eslint pas prêt).
- `release.yml` : à la **publication d'une release GitHub**, construit l'exe et l'attache (aussi lançable à la main). Aucune release publiée pour l'instant.
- Protection de `main` (rulesets) : pas de suppression ni force-push ; « CI must pass » (6 contrôles) pour les PR, contournable par l'admin (push direct autorisé).
- Alertes connues classées : 2 faux positifs CodeQL (échappement déjà fait en amont) ; glib (Dependabot) « non utilisé » car Linux uniquement.

## 6. Façon de travailler avec l'utilisateur

- Français ; il ne code pas lui-même ; valide sur maquettes (compagnon visuel) et captures d'écran.
- **Sensible au coût en crédits** : préférer **un seul implémenteur (Sonnet) par lot + une seule relecture à la fin** ; petits lots UI sans relecture ; pas de relecture par tâche.
- Branche par lot (`feat/...`, `fix/...`), fusion dans `main` + push sur demande explicite (« Fusionne … et pousse »).
- Pièges rencontrés : l'exe dans `src-tauri/target/release` verrouillé s'il est lancé (demander de fermer l'app) ; les heredocs bash peuvent avaler les antislashs dans du code TS (utiliser `String.raw` / l'outil Write) ; `core.autocrlf` → `.gitattributes` force LF.

## 7. Pistes en attente (non faites, discutées)

- **Tests E2E** : proposé **Playwright via le port de débogage WebView2** sur le vrai exe (≈7 scénarios : démarrage, création + vérif disque, renommage/déplacement, tableau/alerte/menu /, modification externe + conflit, restauration de session, langue), job « E2E · Windows » avec captures en cas d'échec. Reporté par l'utilisateur.
- **Version macOS** (Apple Silicon seulement) : faisable (vibrancy, boutons à gauche, ⌘, chemins, polices, `.app/.dmg`, Gatekeeper sans notarisation) mais **personne pour tester** → reporté ; build possible sur runner macOS (gratuit car dépôt public).
- **Windows 10** : WebView2 généralement présent ; proposer message clair si absent + fond opaque au lieu de l'acrylique. Non fait.
- **IA** (améliorer les notes) : abonnements grand public (Claude Pro, ChatGPT Plus, Copilot) **non utilisables** par une app tierce ; options = clé API personnelle, GitHub Models (compte GitHub, quotas), Ollama local ; toujours aperçu + accepter/refuser. Non fait.
- **Releases** : publier une release GitHub déclencherait `release.yml` ; badge version lit `package.json` (0.1.0).
- Mineurs connus : infobulle d'onglet = chemin relatif (pas seulement le nom) ; quelques lignes vides dans les conteneurs (listes/alertes) non conservées ; cas Gantt « weekend… » refusé par mermaid.
