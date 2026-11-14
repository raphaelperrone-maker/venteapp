// Tests des règles de sécurité Firestore (firestore.rules) — module Planning + dispos.
// Lancer depuis firebase/ :   npm test
// L'émulateur Firestore tourne en local avec un projet fictif « demo-allinone » :
// aucun compte ni donnée réelle n'est utilisé.

const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, Timestamp } = require('firebase/firestore');

// ── Semaines calculées depuis aujourd'hui (le test reste valable quelle que soit la date) ──
function lundiDe(offsetSemaines) {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offsetSemaines * 7);
  return d;
}
function cleSemaine(d) { // ISO 8601, ex. « 2026-S47 »
  const t = new Date(d); t.setDate(t.getDate() - ((t.getDay() + 6) % 7) + 3);
  const an = t.getFullYear(), j4 = new Date(an, 0, 4);
  j4.setDate(j4.getDate() - ((j4.getDay() + 6) % 7) + 3);
  return an + '-S' + String(1 + Math.round((t - j4) / 604800000)).padStart(2, '0');
}
const PASSEE = cleSemaine(lundiDe(-1)), EN_COURS = cleSemaine(lundiDe(0)), SUIVANTE = cleSemaine(lundiDe(1)), APRES = cleSemaine(lundiDe(2));

let ok = 0, ko = 0;
async function cas(nom, promesse) {
  try { await promesse; ok++; console.log('✅ ' + nom); }
  catch (e) { ko++; console.log('❌ ' + nom + '  → ' + (e.message || e).split('\n')[0]); }
}

(async () => {
  const env = await initializeTestEnvironment({
    projectId: 'demo-allinone',
    firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8085 },
  });

  // ── Données de départ (écrites sans règles) ──
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'magasins/grasse'), { nom: 'Grasse', actif: true });
    await setDoc(doc(db, 'magasins/nice'), { nom: 'Nice', actif: true });
    await setDoc(doc(db, 'collaborateurs/PF001'), { nom: 'Martin', prenom: 'Alice', role: 'employe', magasins: ['grasse'], actif: true });
    await setDoc(doc(db, 'collaborateurs/PF002'), { nom: 'Durand', prenom: 'Bob', role: 'employe', magasins: ['nice'], actif: true });
    await setDoc(doc(db, 'collaborateursPrive/PF001'), { tauxHoraire: 12.5 });
    await setDoc(doc(db, `semaines/${PASSEE}`), { lundi: Timestamp.fromDate(lundiDe(-1)), statut: 'publie' });
    await setDoc(doc(db, `semaines/${EN_COURS}`), { lundi: Timestamp.fromDate(lundiDe(0)), statut: 'publie' });
    await setDoc(doc(db, `semaines/${SUIVANTE}`), { lundi: Timestamp.fromDate(lundiDe(1)), statut: 'brouillon' });
    await setDoc(doc(db, `semaines/${SUIVANTE}/affectations/grasse`), { jours: { '0': ['PF001'] } });
    await setDoc(doc(db, `semaines/${EN_COURS}/affectations/grasse`), { jours: { '0': ['PF001'] } });
    await setDoc(doc(db, `semaines/${SUIVANTE}/dispos/PF002`), { magasins: ['nice'], jours: [3], declareLe: Timestamp.now() });
  });

  // ── Utilisateurs ──
  const anonyme = env.unauthenticatedContext().firestore();
  const alice   = env.authenticatedContext('PF001', { role: 'employe', magasins: ['grasse'] }).firestore();
  const mgrGrasse = env.authenticatedContext('MG01', { role: 'manager', magasins: ['grasse'] }).firestore();
  const mgrTous   = env.authenticatedContext('MG02', { role: 'manager', magasins: ['*'] }).firestore();
  const admin     = env.authenticatedContext('ADMIN', { role: 'admin', magasins: ['*'] }).firestore();
  const dispo = (jours, extra = {}) => ({ magasins: ['grasse'], jours, declareLe: Timestamp.now(), ...extra });

  console.log(`Semaines : passée ${PASSEE}, en cours ${EN_COURS}, suivante ${SUIVANTE}\n`);

  console.log('— Connexion et référentiels');
  await cas('Non connecté : lecture du planning refusée', assertFails(getDoc(doc(anonyme, `semaines/${EN_COURS}`))));
  await cas('Employé : lit la liste des magasins', assertSucceeds(getDoc(doc(alice, 'magasins/grasse'))));
  await cas('Employé : NE PEUT PAS lire le taux horaire (collaborateursPrive)', assertFails(getDoc(doc(alice, 'collaborateursPrive/PF001'))));
  await cas('Admin : lit le taux horaire', assertSucceeds(getDoc(doc(admin, 'collaborateursPrive/PF001'))));
  await cas('Employé : NE PEUT PAS se donner le rôle manager', assertFails(updateDoc(doc(alice, 'collaborateurs/PF001'), { role: 'manager' })));
  await cas('Employé : NE PEUT PAS lire la fiche d\'un collègue', assertFails(getDoc(doc(alice, 'collaborateurs/PF002'))));

  console.log('\n— Disponibilités');
  await cas('Employé : déclare ses dispos pour la semaine suivante', assertSucceeds(setDoc(doc(alice, `semaines/${SUIVANTE}/dispos/PF001`), dispo([0, 1]))));
  await cas('Employé : NE PEUT PAS écrire les dispos d\'un collègue', assertFails(setDoc(doc(alice, `semaines/${SUIVANTE}/dispos/PF002`), dispo([0]))));
  await cas('Employé : NE PEUT PAS déclarer de dispo sur une semaine passée', assertFails(setDoc(doc(alice, `semaines/${PASSEE}/dispos/PF001`), dispo([0]))));
  await cas('Employé : NE PEUT PAS déclarer de dispo sur la semaine en cours (publiée)', assertFails(setDoc(doc(alice, `semaines/${EN_COURS}/dispos/PF001`), dispo([0]))));
  await cas('Dispo invalide (aucun jour) refusée', assertFails(setDoc(doc(alice, `semaines/${SUIVANTE}/dispos/PF001`), dispo([]))));
  await cas('Dispo avec un champ inconnu refusée', assertFails(setDoc(doc(alice, `semaines/${SUIVANTE}/dispos/PF001`), dispo([0], { pin: '1234' }))));
  await cas('Employé : NE PEUT PAS lire les dispos d\'un collègue', assertFails(getDoc(doc(alice, `semaines/${SUIVANTE}/dispos/PF002`))));
  await cas('Manager : lit les dispos de tous', assertSucceeds(getDoc(doc(mgrGrasse, `semaines/${SUIVANTE}/dispos/PF002`))));
  await cas('Nouvelle semaine : aucune dispo héritée (semaine S+2 vide)', (async () => {
    const snap = await assertSucceeds(getDoc(doc(mgrTous, `semaines/${APRES}/dispos/PF001`)));
    if (snap.exists()) throw new Error('une dispo existe déjà sur S+2');
  })());

  console.log('\n— Planning (affectations)');
  await cas('Employé : NE PEUT PAS modifier le planning', assertFails(setDoc(doc(alice, `semaines/${SUIVANTE}/affectations/grasse`), { jours: { '1': ['PF001'] } })));
  await cas('Manager de Grasse : affecte à Grasse', assertSucceeds(setDoc(doc(mgrGrasse, `semaines/${SUIVANTE}/affectations/grasse`), { jours: { '0': ['PF001'], '2': ['PF001', 'PF002'] } })));
  await cas('Manager de Grasse : NE PEUT PAS affecter à Nice', assertFails(setDoc(doc(mgrGrasse, `semaines/${SUIVANTE}/affectations/nice`), { jours: { '0': ['PF002'] } })));
  await cas('Manager « tous magasins » : affecte à Nice', assertSucceeds(setDoc(doc(mgrTous, `semaines/${SUIVANTE}/affectations/nice`), { jours: { '3': ['PF002'] } })));
  await cas('3 personnes le même jour dans un magasin : refusé (max 2)', assertFails(setDoc(doc(mgrTous, `semaines/${SUIVANTE}/affectations/nice`), { jours: { '3': ['PF001', 'PF002', 'PF003'] } })));
  await cas('Jour inexistant (« 7 ») : refusé', assertFails(setDoc(doc(mgrTous, `semaines/${SUIVANTE}/affectations/nice`), { jours: { '7': ['PF002'] } })));

  console.log('\n— Publication');
  await cas('Employé : NE VOIT PAS le planning S+1 tant qu\'il est en brouillon', assertFails(getDoc(doc(alice, `semaines/${SUIVANTE}/affectations/grasse`))));
  await cas('Employé : voit le planning de la semaine en cours (publié)', assertSucceeds(getDoc(doc(alice, `semaines/${EN_COURS}/affectations/grasse`))));
  await cas('Employé : NE PEUT PAS publier une semaine', assertFails(updateDoc(doc(alice, `semaines/${SUIVANTE}`), { statut: 'publie' })));
  await cas('Employé : peut ouvrir une semaine future en brouillon (pour ses dispos)', assertSucceeds(setDoc(doc(alice, `semaines/${APRES}`), { lundi: Timestamp.fromDate(lundiDe(2)), statut: 'brouillon' })));
  await cas('Employé : NE PEUT PAS créer une semaine passée', assertFails(setDoc(doc(alice, 'semaines/2020-S01'), { lundi: Timestamp.fromDate(new Date(2019, 11, 30)), statut: 'brouillon' })));
  await cas('Manager : publie la semaine suivante', assertSucceeds(updateDoc(doc(mgrGrasse, `semaines/${SUIVANTE}`), { statut: 'publie' })));
  await cas('Après publication : l\'employé voit le planning S+1', assertSucceeds(getDoc(doc(alice, `semaines/${SUIVANTE}/affectations/grasse`))));
  await cas('Après publication : les dispos de S+1 sont fermées', assertFails(setDoc(doc(alice, `semaines/${SUIVANTE}/dispos/PF001`), dispo([4]))));
  await cas('Manager : NE PEUT PAS changer la date d\'une semaine', assertFails(updateDoc(doc(mgrTous, `semaines/${SUIVANTE}`), { lundi: Timestamp.fromDate(lundiDe(5)) })));

  await env.cleanup();
  console.log(`\n${ok} réussis, ${ko} échoués`);
  process.exit(ko ? 1 : 0);
})();
