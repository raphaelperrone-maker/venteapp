# AllinOne — front (venteapp)

PWA de gestion de magasins (ventes, CA, heures, planning, stocks). Hébergée sur GitHub Pages
(`main` → https://raphaelperrone-maker.github.io/venteapp/). Dépôt **public** : ne jamais y
mettre de secret, et rester vague dans le Changelog sur le fonctionnement d'une faille.

## Architecture
- `index.html` : structure + script inline de vérification de version (doit rester inline, s'exécute en premier).
- `style.css` : tout le CSS. `app.js` : toute la logique (script classique, pas de module : les `onclick=` du HTML appellent des fonctions globales).
- `version.js` : **seule source** de `APP_VERSION`, lue par `index.html` et `sw.js` (`importScripts`).
- `sw.js` : Service Worker, cache `allinone-v<version>`, network-first, `offline.html` en repli.
- Librairies via CDN (Chart.js, jsPDF, html2canvas, xlsx) avec versions fixées.
- API : `https://allinone-server.vercel.app` (dépôt privé `allinone-server`). Données dans des Google Sheets, via `/api/sheets` (`sheetsGet/Put/Append/Clear` dans `app.js`). Authentification par JWT (matricule + PIN).
- Clavier intégré (`kbdAttacher`) : les champs sont `readonly` + `inputmode=none` ; en test, saisir via `kbdOuvrir()` + `kbdTaper()`, pas `page.fill`.

## Conventions
- Branche dédiée (`fix/…`, `feat/…`, `chore/…`) repartie de `main` à jour ; PR vers `main` ; **ne jamais fusionner soi-même** (la fusion = mise en production).
- Chaque changement visible : incrémenter `version.js` (SemVer : bug → correctif, ajout → mineur, rupture → majeur) et ajouter une entrée en tête de `Changelog`. Un changement serveur seul ne touche pas `version.js`.
- Pas de repli silencieux : un `catch` qui bascule sur des données par défaut doit prévenir les managers (`if (isManager()) showToast(...)`).
- Données injectées dans `innerHTML` : toujours `esc()` ; préférer `createElement` + `textContent` pour un élément isolé.
- Variables globales d'`app.js` déclarées avec `let` (`utilisateurConnecte`, `magasinsList`…) : en test, les affecter par leur nom, pas via `window.x`.

## Tester
Servir le dépôt sous `/venteapp/` (ex. `python3 -m http.server` depuis le dossier parent) et piloter Chromium (Playwright). Les CDN et l'API ne sont pas joignables depuis l'environnement cloud : stubber `sheetsGet/Put/Clear`, `apiCall`, `fetch`. Vérifier : console sans erreur, en-tête `V<version>`, cache SW, mode hors-ligne.

## Google Sheet (onglet Planning du TdB)
32 colonnes max (A→AF). Dispos `A2:D500`, marqueur de purge `F1`, planning en cours `G1:N50`, S-1 `P1:W50`, S+1 `Y1:AF50`.
