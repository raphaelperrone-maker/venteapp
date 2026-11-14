# AllinOne sur Firebase — modèle de données (preuve de concept : Planning + dispos)

Objectif : remplacer les onglets Google Sheets par Firestore, avec des **règles de sécurité
vérifiées par Google côté serveur** (`firestore.rules`) au lieu de contrôles dans le navigateur.

## Principes
1. **Une donnée sait ce qu'elle est.** Un planning est rangé sous sa semaine (`semaines/2026-S47`),
   pas dans une plage de cellules qu'il faut « faire tourner » chaque lundi. Plus de rotation,
   plus de purge : une nouvelle semaine est un nouveau document, vide par construction.
2. **Les règles refusent ce qui est invalide** (champ inconnu, plus de 2 personnes par magasin et
   par jour, dispo sur une semaine passée…), quel que soit le code qui écrit.
3. **Les données sensibles sont séparées** (`collaborateursPrive`), lisibles par l'admin seul.
   Le PIN n'est jamais stocké dans Firestore : l'authentification est gérée par Firebase Auth.

## Identité et rôles
Chaque utilisateur est connecté avec Firebase Auth, `uid` = son **matricule** (ex. `PF001`).
Le jeton porte deux informations (« custom claims ») posées par le serveur à la connexion :
- `role` : `employe` | `manager` | `admin`
- `magasins` : liste des magasins gérés, ou `["*"]` pour tous

Connexion envisagée : l'API Vercel actuelle vérifie matricule + PIN, puis renvoie un *custom token*
Firebase portant ces claims (pas besoin de Cloud Functions, donc compatible avec l'offre gratuite).

## Collections

| Chemin | Contenu | Lecture | Écriture |
|---|---|---|---|
| `magasins/{magasinId}` | `nom`, `actif` | tout utilisateur connecté | admin |
| `collaborateurs/{matricule}` | `nom`, `prenom`, `role`, `magasins`, `actif` | soi-même, managers | admin |
| `collaborateursPrive/{matricule}` | `tauxHoraire`, données RH | admin | admin |
| `semaines/{AAAA-Snn}` | `lundi` (date), `statut` (`brouillon` / `publie`), `majPar`, `majLe` | tout utilisateur connecté | création en brouillon : tout connecté (semaine future) ; publication : manager |
| `semaines/{S}/affectations/{magasinId}` | `jours` : `{"0": ["PF001"], …, "6": [...]}` (0 = lundi), `majPar`, `majLe` | managers ; tout le monde une fois la semaine **publiée** | manager **du magasin** ; 2 personnes max par jour |
| `semaines/{S}/dispos/{matricule}` | `magasins` (1 à 10), `jours` (1 à 7), `declareLe` | soi-même, managers | soi-même, **seulement** si la semaine n'a pas commencé et n'est pas encore publiée |

## Correspondance avec l'existant
| Aujourd'hui (Sheet TdB, onglet Planning) | Firebase |
|---|---|
| `A2:D500` (dispos) + marqueur de purge `F1` | `semaines/{S+1}/dispos/*` — plus de purge : chaque semaine a ses propres dispos |
| `G1:N50` / `P1:W50` / `Y1:AF50` (en cours, S-1, S+1) + rotation du lundi | `semaines/{S}/affectations/*` — l'historique complet est conservé, sans rotation |
| En-tête « Lun 26/10 » pour deviner la semaine | la clé du document **est** la semaine |
| Magasin vide masqué à l'affichage (V2.1.0) | pas de document d'affectation, ou `jours` vides → non affiché |

## Hors périmètre de cette preuve de concept
Ventes, CA, stocks, produits, sociétés, logs, connexion réelle (custom token), hors-ligne,
migration des données existantes. Ils suivront le même schéma, module par module.
