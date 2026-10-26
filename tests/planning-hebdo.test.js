// Test de non-régression : remise à zéro hebdomadaire du planning et des dispos.
// Bug du 25/10/2026 : la semaine du 26/10 s'affichait déjà remplie avec l'ancienne grille,
// faute de rotation (déclenchée seulement le lundi, par un manager, une fois par appareil).
//
// Lancer depuis la racine du dépôt :   node tests/planning-hebdo.test.js
// (Playwright requis ; dans l'environnement cloud : NODE_PATH=$(npm root -g))
// Le test démarre son propre serveur statique, fixe l'horloge et le fuseau Europe/Paris,
// et remplace le Google Sheet par une feuille Planning factice de 32 colonnes (A→AF).

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const RACINE = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

function serveur() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      if (!url.startsWith('/venteapp/')) { res.writeHead(404); return res.end(); }
      let f = path.join(RACINE, url.slice('/venteapp/'.length) || 'index.html');
      if (!f.startsWith(RACINE)) { res.writeHead(403); return res.end(); }
      if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
      fs.readFile(f, (err, data) => {
        if (err) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

let ok = 0, ko = 0;
function check(nom, cond, info) {
  cond ? ok++ : ko++;
  console.log((cond ? '✅ ' : '❌ ') + nom + (cond ? '' : '  → ' + JSON.stringify(info)));
}

// Installe une feuille Planning factice (32 colonnes max, comme la vraie) et les stubs d'API
function installerSheet() {
  const colIdx = L => { let n = 0; for (const c of L) n = n * 26 + (c.charCodeAt(0) - 64); return n - 1; };
  const parse = range => {
    const a1 = range.split('!')[1];
    const m = a1.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+)?)?$/);
    const c1 = colIdx(m[1]), r1 = +m[2], c2 = m[3] ? colIdx(m[3]) : c1, r2 = m[4] ? +m[4] : (m[3] ? 1002 : r1);
    if (c2 > 31) throw new Error(`Range (${range}) exceeds grid limits. Max rows: 1002, max columns: 32`);
    return { c1, r1, c2, r2 };
  };
  window.__sheet = {}; window.__log = [];
  window.sheetsGet = async (id, range) => {
    const { c1, r1, c2, r2 } = parse(range); window.__log.push(['get', range]);
    const out = [];
    for (let r = r1; r <= r2; r++) {
      const row = []; for (let c = c1; c <= c2; c++) row.push(window.__sheet[r + ',' + c] ?? '');
      while (row.length && row[row.length - 1] === '') row.pop();
      if (row.length) out[r - r1] = row;
    }
    return Array.from(out, r => r || []).filter((r, i, a) => i < a.length);
  };
  window.sheetsPut = async (id, range, values) => {
    const { c1, r1 } = parse(range); window.__log.push(['put', range]);
    values.forEach((row, i) => row.forEach((v, j) => { window.__sheet[(r1 + i) + ',' + (c1 + j)] = v; }));
  };
  window.sheetsClear = async (id, range) => {
    const { c1, r1, c2, r2 } = parse(range); window.__log.push(['clear', range]);
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) delete window.__sheet[r + ',' + c];
  };
  window.getConfig = () => 'TDB';
  window.logAction = () => {};
  // Écrit une grille (en-tête daté comme publierPlanning + une ligne magasin) à partir de la colonne c0
  window.__grille = (c0, lundiJJMM, nom) => {
    const [j, m] = lundiJJMM.split('/').map(Number);
    const jours = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
    const header = ['Magasin/Jour', ...jours.map((x, i) => { const d = new Date(2026, m - 1, j + i); return `${x} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`; })];
    const ligne = ['Grasse', nom, nom, '', '', '', '', ''];
    [header, ligne].forEach((row, i) => row.forEach((v, k) => { window.__sheet[(1 + i) + ',' + (c0 + k)] = v; }));
  };
  window.__ligne2 = c0 => [1, 2, 3, 4, 5, 6, 7].map(k => window.__sheet['2,' + (c0 + k)] || '').join('|');
}
const G = 6, P = 15, Y = 24; // colonnes G, P, Y (index 0)

(async () => {
  const srv = await serveur();
  const base = `http://127.0.0.1:${srv.address().port}/venteapp/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ timezoneId: 'Europe/Paris' });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on('pageerror', e => erreurs.push(e.message));
  page.on('dialog', d => d.dismiss());

  const aLHeure = async iso => { await page.clock.setFixedTime(new Date(iso)); };
  const reinit = async (role = 'manager') => {
    await page.evaluate(installerSheet);
    await page.evaluate(r => {
      utilisateurConnecte = { nomComplet: 'Test', matricule: 'T1', isManager: r === 'manager' };
      planningCurrentData = null; planningNextData = null; planningEditData = {};
    }, role);
  };
  // Dispos saisies en S (19→25/10) pour S+1 + marqueur de purge S43, grilles :
  // G = semaine du 12/10 (pas tournée), Y = semaine du 19/10 (périmée le 25/10)
  const scenarioBug = async () => page.evaluate(() => {
    const put = (r, vals) => vals.forEach((v, j) => { window.__sheet[r + ',' + j] = v; });
    put(2, ['21/10/2026 10:00:00', 'Alice Martin', 'Grasse', 'Lundi, Mardi']);
    put(3, ['24/10/2026 18:00:00', 'Bob Durand', 'Nice', 'Jeudi']);
    window.__sheet['1,5'] = '2026-S43';             // F1 : purge déjà faite cette semaine
    window.__grille(6, '12/10', 'Ancienne G');      // G1:N  → semaine du 12/10
    window.__grille(24, '19/10', 'Ancienne S+1');   // Y1:AF → semaine du 19/10
  });

  await aLHeure('2026-10-25T12:00:00+01:00');
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const version = await page.evaluate(() => window.APP_VERSION);
  console.log(`Version testée : ${version}\n`);

  // ── 1. Reproduction du bug : dimanche 25/10, ouverture de S+1 (26/10 → 01/11) ──
  await reinit('employe'); await scenarioBug();
  await page.evaluate(() => chargerPlanningTab('next'));
  let r = await page.evaluate(() => ({ html: document.getElementById('planning-container-next').textContent, data: planningNextData }));
  check('Dimanche 25/10 12h — S+1 (26/10) affichée VIDE, pas l\'ancienne grille', !r.html.includes('Ancienne') && r.data === null, r);

  // ── 2. Même scénario autour du changement d'heure (25/10/2026, Europe/Paris) ──
  for (const iso of ['2026-10-25T02:30:00+02:00', '2026-10-25T02:30:00+01:00', '2026-10-25T23:59:00+01:00']) {
    await aLHeure(iso); await reinit('employe'); await scenarioBug();
    await page.evaluate(() => chargerPlanningTab('next'));
    r = await page.evaluate(() => document.getElementById('planning-container-next').textContent);
    check(`Changement d'heure — ${iso} : S+1 vide`, !r.includes('Ancienne'), r.slice(0, 80));
  }

  // ── 3. Éditeur « Modifier le planning S+1 » : grille vierge, pas pré-remplie avec l'ancienne ──
  await aLHeure('2026-10-25T12:00:00+01:00'); await reinit('manager'); await scenarioBug();
  await page.evaluate(() => _editerPlanningExistant('next'));
  await page.waitForTimeout(200);
  r = await page.evaluate(() => Object.values(planningEditData).flat().filter(Boolean));
  check('Éditeur S+1 le 25/10 : grille vierge (aucun nom repris)', r.length === 0, r);

  // ── 4. Les dispos de la semaine en cours ne sont pas touchées ──
  await reinit('manager'); await scenarioBug();
  await page.evaluate(() => chargerPlanning());
  await page.waitForTimeout(300);
  r = await page.evaluate(() => ({ a2: window.__sheet['2,1'], a3: window.__sheet['3,1'], clears: window.__log.filter(l => l[0] === 'clear').map(l => l[1]) }));
  check('Dimanche 25/10 (manager) : dispos de la semaine en cours conservées', r.a2 === 'Alice Martin' && r.a3 === 'Bob Durand' && !r.clears.includes('Planning!A2:D500'), r);
  // Le 25/10, la grille rangée en S+1 est celle de la semaine du 19/10 = la semaine EN COURS,
  // restée bloquée faute de rotation le lundi 19/10 → le manager déclenche le rattrapage.
  r = await page.evaluate(([g, p, y]) => ({ g: window.__ligne2(g), p: window.__ligne2(p), y: window.__ligne2(y) }), [G, P, Y]);
  check('Dimanche 25/10 (manager) : rattrapage — G = semaine du 19/10, P = semaine du 12/10, S+1 vidée',
    r.g.startsWith('Ancienne S+1') && r.p.startsWith('Ancienne G') && r.y === '||||||', r);

  // ── 5. Non-régression : un S+1 valide (publié pour le 26/10) reste affiché ──
  await reinit('employe'); await scenarioBug();
  await page.evaluate(() => window.__grille(24, '26/10', 'Valide S+1'));
  await page.evaluate(() => chargerPlanningTab('next'));
  r = await page.evaluate(() => document.getElementById('planning-container-next').textContent);
  check('S+1 publié pour le 26/10 : bien affiché', r.includes('Valide') || r.includes('Valide S.'), r.slice(0, 120));

  // ── 6. Rotation un MERCREDI (lundi manqué) : la semaine en cours bascule, dispos conservées ──
  await aLHeure('2026-10-28T09:00:00+01:00'); await reinit('manager');
  await page.evaluate(() => {
    window.__sheet['1,5'] = '2026-S44';                                   // purge S44 déjà faite
    const put = (r, vals) => vals.forEach((v, j) => { window.__sheet[r + ',' + j] = v; });
    put(2, ['27/10/2026 08:00:00', 'Chloé Petit', 'Grasse', 'Vendredi']); // dispo saisie mardi pour S+1
    window.__grille(6, '19/10', 'Semaine 19/10');                        // G = semaine passée (pas tournée)
    window.__grille(24, '26/10', 'Semaine 26/10');                       // Y = semaine en cours
  });
  await page.evaluate(() => chargerPlanning());
  await page.waitForTimeout(500);
  r = await page.evaluate(([g, p, y]) => ({ g: window.__ligne2(g), p: window.__ligne2(p), y: window.__ligne2(y), dispo: window.__sheet['2,1'] }), [G, P, Y]);
  check('Mercredi 28/10 : rotation faite (G = semaine du 26/10)', r.g.startsWith('Semaine 26/10'), r);
  check('Mercredi 28/10 : ancienne semaine archivée en S-1 (P), S+1 vidée', r.p.startsWith('Semaine 19/10') && r.y === '||||||', r);
  check('Mercredi 28/10 : dispo saisie mardi (pour S+1) conservée', r.dispo === 'Chloé Petit', r);

  // ── 7. Idempotence : un 2e chargement le même jour ne refait rien ──
  await page.evaluate(() => { window.__log = []; });
  await page.evaluate(() => chargerPlanning());
  await page.waitForTimeout(300);
  r = await page.evaluate(() => window.__log.filter(l => l[0] !== 'get'));
  check('2e chargement : aucune écriture (rotation non rejouée)', r.length === 0, r);

  // ── 8. Employé : jamais d'écriture de rotation ; il voit quand même la bonne semaine ──
  await aLHeure('2026-10-26T08:00:00+01:00'); await reinit('employe');
  await page.evaluate(() => { window.__sheet['1,5'] = '2026-S44'; window.__grille(6, '19/10', 'Semaine 19/10'); window.__grille(24, '26/10', 'Semaine 26/10'); });
  await page.evaluate(() => chargerPlanning());
  await page.waitForTimeout(300);
  r = await page.evaluate(() => ({ html: document.getElementById('planning-container-current').textContent, ecritures: window.__log.filter(l => l[0] !== 'get' && !l[1].startsWith('Planning!A2') && l[1] !== 'Planning!F1') }));
  check('Lundi 26/10, employé : aucune écriture de rotation', r.ecritures.length === 0, r);
  // L'app abrège les noms : « Semaine 26/10 » → « Semaine 2. », « Semaine 19/10 » → « Semaine 1. »
  check('Lundi 26/10, employé : « Cette semaine » montre la semaine du 26/10, pas celle du 19/10', r.html.includes('Semaine 2.') && !r.html.includes('Semaine 1.'), r.html.slice(0, 160));

  // ── 9. Grille sans en-tête daté (ancienne / saisie à la main) : affichée comme avant ──
  await aLHeure('2026-10-25T12:00:00+01:00'); await reinit('employe');
  await page.evaluate(() => {
    ['Magasin/Jour', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].forEach((v, k) => { window.__sheet['1,' + (24 + k)] = v; });
    ['Nice', 'Manuel', '', '', '', '', '', ''].forEach((v, k) => { window.__sheet['2,' + (24 + k)] = v; });
  });
  await page.evaluate(() => chargerPlanningTab('next'));
  r = await page.evaluate(() => document.getElementById('planning-container-next').textContent);
  check('En-tête sans date : grille affichée comme avant (pas de perte)', r.includes('Nice'), r.slice(0, 80));

  // ── 10. Parcours complet du dimanche : dispos → Générer → Publier S+1 → affichage ──
  await aLHeure('2026-10-25T18:00:00+01:00'); await reinit('manager'); await scenarioBug();
  await page.evaluate(async () => {
    magasinsList = ['Grasse', 'Nice'];
    utilisateurConnecte.autorisationMagasins = MOT_CLE_TOUS;   // manager global (voit tous les magasins)
    await chargerPlanning();                 // rattrapage de rotation + S+1 vidée
    await chargerDisponibilites();           // Alice (Grasse, lun/mar) + Bob (Nice, jeu)
    await genererProposition();
    await new Promise(res => { publierPlanning(); setTimeout(res, 300); });
    planningNextData = null;
    await chargerPlanningTab('next');
  });
  r = await page.evaluate(() => ({ html: document.getElementById('planning-container-next').textContent, z1: window.__sheet['1,25'] }));
  check('Dimanche 25/10 : planning S+1 généré depuis les dispos puis publié → en-tête « Lun 26/10 » et affiché',
    r.z1 === 'Lun 26/10' && r.html.includes('Alice M.') && r.html.includes('Bob D.') && !r.html.includes('Ancienne'), { z1: r.z1, html: r.html.replace(/\s+/g, ' ').slice(0, 200) });

  check('Aucune erreur JS', erreurs.length === 0, erreurs);

  await browser.close(); srv.close();
  console.log(`\n${ok} réussis, ${ko} échoués`);
  process.exit(ko ? 1 : 0);
})();
