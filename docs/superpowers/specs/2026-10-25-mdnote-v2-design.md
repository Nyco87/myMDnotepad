# MDnote v2 — document de conception

Date : 2026-10-25
Statut : brouillon, à valider
Base : MDnote v1 (branche `feat/mdnote-v1`, spec `2026-10-24-mdnote-design.md`, plan `2026-10-24-mdnote.md`). Tout ce que la v1 garantit reste valable (aucune perte de données, Markdown « pretty » idempotent, conservation à l'identique du Markdown non pris en charge, démarrage < 1 s, `.exe` unique portable, textes en français, sombre Fluent).

## 1. Intention et pourquoi

L'utilisateur a testé la v1. L'acrylique lui convient. Il veut corriger quelques défauts visuels, aligner l'app sur Windows (couleur d'accent), et ajouter trois capacités qu'il utilise ailleurs : les **blocs d'alerte GitHub**, les **schémas mermaid** (créés sans écrire de code, via un « atelier » à briques) et un **menu « / »** pour insérer et mettre en forme pendant la frappe. Il ne touche pas au code.

Légende : **[U]** = décidé par l'utilisateur ; **[C]** = proposé par Claude et validé dans la conversation.

## 2. Objectifs

### 2.1 Retouches
- **Zone de saisie uniforme** [U] : l'éditeur a un fond sombre uniforme sur toute la hauteur de la zone d'écriture, y compris sous une note courte (aujourd'hui deux teintes visibles : le fond de l'éditeur et l'acrylique en dessous). Cliquer dans la zone vide sous le texte place le curseur à la fin de la note [C].
- **Supprimer Mica** [U] : l'acrylique est le seul effet ; l'option « Effet de fenêtre » disparaît du menu « ⋯ » ; le réglage `window_effect` est ignoré/supprimé (un ancien fichier de réglages qui le contient doit toujours se charger).
- **Icône du bouton emoji** [U] : une icône évoquant des symboles (`Ω`) [C], infobulle « Symboles ». Le contenu de la palette ne change pas.
- **Couleur d'accent Windows** [U] : toutes les couleurs d'accent de l'app (bouton « ＋ Nouvelle note », barre de sélection de l'arborescence, curseur/sélection, liens, cases cochées, boutons actifs du bandeau, focus) utilisent la couleur d'accent configurée dans Windows (Paramètres → Personnalisation → Couleurs). Mise à jour à chaud si l'utilisateur la change pendant que l'app est ouverte [C]. Le texte posé sur l'accent (ex. libellé du bouton) reste lisible quelle que soit la couleur (noir ou blanc selon la luminance) [C]. Repli : `#60cdff` si la couleur ne peut pas être lue.
- **Surlignage** [U] : `==texte==` → texte surligné (fond ambré, cf. capture fournie par l'utilisateur). Raccourci à la frappe `==x==`, raccourci clavier Ctrl+Shift+H [C], bouton dans le bandeau à côté du barré [C]. Sérialisé `==texte==`. Note : non standard (GitHub affichera les `==`), accepté.
- **Barré** : existe déjà (`~~`, Ctrl+Shift+X, bouton ~~S~~). L'utilisateur ne l'a pas trouvé : rendre le bouton plus explicite (infobulle « Barré (Ctrl+Shift+X) » déjà présente — vérifier qu'elle s'affiche et que le bouton est visuellement reconnaissable) [C].

### 2.2 Blocs d'alerte GitHub [U]
- Les 5 types GitHub uniquement : `NOTE`, `TIP`, `IMPORTANT`, `WARNING`, `CAUTION`.
- Rendu « joli bloc » dans l'esprit de la capture fournie : barre colorée à gauche, fond teinté, coins arrondis, titre en gras coloré avec icône. Titres français [C] : Note (bleu `#4493f8`, ℹ️), Astuce (vert `#3fb950`, 💡), Important (violet `#ab7df8`, ❗), Attention (orange `#d29922`, ⚠️), Danger (rouge `#f85149`, 🔴). Référence visuelle : `.superpowers/brainstorm/5954-1792878933/content/alerts-slash.html`.
- Pas de repli/pliage [C].
- Fichier : syntaxe GitHub exacte `> [!NOTE]` en première ligne, contenu préfixé `> `. Lecture insensible à la casse du mot-clé ; écriture en majuscules [C]. Un `> [!AUTRE]` inconnu reste une citation normale (non perdu).
- Contenu : blocs comme une citation (paragraphes, listes, code…). Comportement « collant » identique aux citations v1 (Entrée reste dans le bloc, flèche bas depuis la dernière ligne sort).
- Changer le type d'une alerte existante : clic sur son titre → petit menu des 5 types [C] ; aussi via le menu « / » quand le curseur est dedans.

### 2.3 Schémas mermaid + atelier [U]
- Les blocs ```` ```mermaid ```` sont **affichés comme dessins** dans l'éditeur (thème sombre cohérent avec l'app, accent Windows), jamais comme code.
- **Atelier de création** [U] : on choisit le type puis on assemble des briques ; aperçu en direct. Types pris en charge par l'atelier [U] : **camembert** (pie), **Gantt**, **flux/organigramme** (flowchart), **diagramme d'états** (stateDiagram-v2, cf. capture : états, transitions nommées, point de départ ● et de fin ◉).
- Déroulé [C, validé sur maquette `mermaid-builder.html`] : ① choisir le type → ② briques à gauche, aperçu à droite mis à jour en direct → ③ « Insérer ». Bouton « Voir le code mermaid » (édition du code brut possible, avec aperçu). « Annuler » ne modifie rien.
- Briques par type [C] :
  - **Camembert** : titre ; parts (libellé, valeur numérique ≥ 0) ; ajouter / supprimer / réordonner.
  - **Flux** : sens (Haut→Bas, Gauche→Droite) ; cases (texte, forme : rectangle, arrondi, décision ◇, cercle) ; flèches (de → vers, texte facultatif) ; supprimer une case supprime ses flèches.
  - **États** : états (nom) ; transitions (de → vers, nom facultatif) ; cases à cocher « point de départ vers… » (choix de l'état initial) et « point de fin depuis… » (un ou plusieurs états).
  - **Gantt** : titre ; format de date AAAA-MM-JJ ; sections ; tâches (nom, début = date ou « après <tâche> », durée en jours) ; ajouter / supprimer / réordonner.
- **Dans la note** : clic sur un dessin → rouvre l'atelier pré-rempli. Si le code mermaid ne peut pas être relu en briques (autre type, ou syntaxe hors du sous-ensemble produit par l'atelier), l'atelier s'ouvre directement en mode code (rien n'est réinterprété ni perdu) [C].
- Un schéma au code invalide affiche un cadre d'erreur discret avec le message mermaid et le code, jamais une page cassée [C].
- **Aucune perte** : le texte du bloc ```` ```mermaid ```` est conservé à l'identique tant qu'on ne l'a pas modifié via l'atelier ; après modification via les briques, l'atelier régénère un code propre et déterministe.
- **Performance** [C] : la bibliothèque mermaid est embarquée (pas de réseau) mais **chargée à la demande**, au premier schéma affiché ou à l'ouverture de l'atelier ; le démarrage reste < 1 s (mesuré avec `scripts/measure-startup.ps1`, note sans schéma). Le `.exe` grossira (accepté, à indiquer).

### 2.4 Menu « / » [U]
- Taper `/` **en début de ligne ou après un espace** ouvre un menu flottant sous le curseur [C] ; un `/` au milieu d'un mot (URL, date `24/10`) n'ouvre rien.
- Les lettres tapées après `/` filtrent la liste (français, insensible à la casse et aux accents ; correspondance sur le libellé et des mots-clés : `/tab` → Tableau, `/att` → Attention, `/todo` → Tâches) [C].
- ↑/↓ pour choisir, Entrée ou clic pour valider, Échap ferme (le texte `/xxx` reste tel quel), espace sans correspondance ferme [C].
- À la validation, le texte `/xxx` tapé est retiré puis la commande s'applique.
- Commandes [C, validé sur maquette] : Titre 1, Titre 2, Titre 3, Paragraphe, Liste à puces, Liste numérotée, Tâches, Citation, Bloc de code, Tableau (ouvre le choix de taille), Lien, Image, Séparateur, Symboles (ouvre la palette), Schéma (ouvre l'atelier), et les 5 alertes (Note, Astuce, Important, Attention, Danger). Les commandes de bloc **transforment la ligne courante** quand c'est possible (ex. `/titre` sur un paragraphe le change en titre) ; sinon elles insèrent un nouveau bloc.
- Le gras/italique d'une sélection reste au bandeau et aux raccourcis (pas via `/`).

### 2.5 Correctifs hérités de la v1 (relecture finale)
- **N1 [important, perte de données]** : un onglet marqué « introuvable » après n'importe quelle erreur de lecture (fichier réencodé hors UTF-8, verrou OneDrive/antivirus) enregistre ensuite sans contrôle de version et peut écraser la version externe sans copie conflit. Correctif : toujours envoyer la dernière date de modification connue ; ne marquer « introuvable » que si le fichier n'existe vraiment plus ; une erreur de lecture d'un fichier existant suspend l'enregistrement automatique de l'onglet et l'affiche à l'utilisateur.
- **N2** : après l'échec de toutes les tentatives, le message affiché contient « CONFLICT » brut → message français clair.
- **N3** : un avis de conflit persistant bloque la file des messages → les messages persistants ne bloquent pas les suivants (empilés).
- Renommer (pas seulement déplacer) un dossier recalcule aussi les liens d'images relatifs sortants (même logique que le déplacement).

## 3. Non-objectifs (v2)
- Autres types mermaid dans l'atelier (séquence, classes, mindmap…) : affichés, éditables en mode code uniquement.
- Alertes Obsidian (types étendus, pliage).
- Gras/italique via « / ».
- Thème clair, recherche plein texte.

## 4. Anti-objectifs
- Démarrage ralenti par mermaid.
- Un schéma, une alerte ou un surlignage qui fait disparaître ou altère du texte du fichier (toute la garantie v1 de conservation s'applique).
- Un menu « / » qui s'ouvre à tort pendant la frappe normale (URL, dates, chemins).
- Couleur d'accent illisible (texte sur accent) ou incohérente entre composants.

## 5. Précisions issues de la relecture [C — choix de Claude, à vérifier par l'utilisateur]

1. **Atelier mermaid strict** : le code n'est relu en briques que s'il fait l'aller-retour à l'identique (code → briques → code régénéré == code d'origine, à la normalisation des espaces près). Sinon (commentaires `%%`, directives `%%{init}%%`, `style`/`classDef`, syntaxe équivalente mais différente), l'atelier s'ouvre en mode code. Rien n'est donc perdu en passant par les briques.
2. **N1 précis** : la commande Rust de lecture renvoie un code distinct `NOT_FOUND` quand le fichier n'existe pas ; seul ce cas marque l'onglet « introuvable ». Toute autre erreur de lecture d'un fichier existant met l'onglet en état « lecture impossible » : enregistrement automatique suspendu, bandeau sur la note avec le message et un bouton « Réessayer » (et nouvelle tentative automatique à chaque événement du dossier) ; les modifications restent en mémoire et sont enregistrées dès qu'une lecture réussit, en passant par le contrôle de version (copie conflit si le fichier a changé). Si la toute première lecture échoue, l'onglet ne s'ouvre pas (comportement v1).
3. **Alertes, cas limites** : `> [!NOTE] texte` sur la même ligne → le texte devient le premier paragraphe de l'alerte ; alerte vide autorisée ; alertes reconnues aussi dans les listes et citations imbriquées ; la casse d'origine du mot-clé (`[!note]`) est conservée tant que l'alerte n'est pas modifiée (aucune réécriture d'un contenu non touché ; écriture en majuscules seulement pour une alerte créée ou modifiée).
4. **Surlignage `==`** : mêmes règles que le barré `~~` (délimiteurs « flanquants », pas d'espace juste à l'intérieur) ; jamais interprété dans le code (en ligne ou bloc) ; `a==b` reste littéral. Couleur : fond ambré `#9a6700`, texte `#fff3c4`.
5. **Mica / réglages** : Windows 11 uniquement ; commande `set_window_effect` et repli Mica supprimés ; un ancien réglage `window_effect` est simplement ignoré au chargement ; pas de compatibilité descendante v2 → v1 requise.
6. **Base** : la v2 se construit sur la branche `feat/mdnote-v1` (non fusionnée), dans une branche `feat/mdnote-v2` qui en part.
7. **Mermaid** : rendu dans l'éditeur uniquement (pas d'export en v2), y compris dans les listes et citations.
8. **Menu « / »** : désactivé dans le code (bloc et en ligne) ; actif dans les cellules de tableau, où seules les commandes compatibles avec une cellule sont proposées (symboles, lien, image… pas de titre, liste, tableau, alerte ni schéma) ; dans un élément de liste ou une alerte, « transformer la ligne » s'applique au paragraphe courant quand le schéma le permet, sinon insertion après le bloc.
9. **Accent** : variantes dérivées (survol, appui, teintes transparentes pour sélection et arborescence) calculées depuis l'accent ; les couleurs des alertes restent fixes (GitHub) ; mode contraste élevé hors périmètre.

## 5bis. Retours du test du lot A [U] (à faire en tête du lot B)

- **Lignes vides conservées** : la règle « pretty » devient « au moins une ligne vide entre blocs ». Chaque paragraphe vide entre deux blocs s'écrit comme une ligne vide supplémentaire et revient tel quel à la réouverture (aller-retour idempotent). Les paragraphes vides en fin de note ne sont pas conservés (un seul `\n` final).
- **Insérer une ligne oubliée** : un clic dans l'espace entre deux blocs non textuels (tableau, alerte, code, schéma, séparateur…), ou flèche haut/bas, place un curseur d'espacement visible ; taper ou Entrée y crée un paragraphe.
- **Bouton « Alerte ▾ »** dans le bandeau, après Citation : menu des 5 types (insère, ou change le type si le curseur est déjà dans une alerte).
- **Surlignage dérivé de l'accent** : fond = teinte de l'accent Windows (remplace l'ambre fixe `#9a6700`), texte lisible garanti.

## 6. Laissé au constructeur
- Moyen de lire l'accent Windows (API WinRT `UISettings`, registre DWM, ou couleur système CSS si WebView2 la fournit) tant que la mise à jour à chaud fonctionne.
- Bibliothèque/plugin markdown-it pour `==` et pour les alertes, ou implémentation maison, tant que l'aller-retour reste idempotent et que les cas non reconnus restent intacts.
- Version de mermaid, mode d'intégration (import dynamique), et thème exact.
- Structure du code de l'atelier (un module par type recommandé), détails visuels dans l'esprit des maquettes.
