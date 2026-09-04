# venteapp
v1.72 — Purge automatique des disponibilités

🐛 Correction — les demandes de disponibilité ne disparaissaient jamais

Les dispos déclarées par les employés restaient affichées d'une semaine sur l'autre. Le code de purge existait mais nécessitait quatre conditions simultanées pour se déclencher :

Condition requise	Conséquence si non remplie
Être un lundi (getDay() === 1)	Personne n'ouvre l'app ce jour-là → raté jusqu'au lundi suivant
Être connecté en manager	Aucun manager ne se connecte → rien ne se passe
Avoir un planning S+1 rempli	return anticipé avant la ligne de purge
Marqueur localStorage du bon appareil	Non partagé entre les devices

Nouveau mécanisme indépendant de la rotation :

Comparaison du numéro de semaine ISO (2026-S23) avec un marqueur stocké dans le Sheet (Planning!AJ1)
Se déclenche n'importe quel jour, pas seulement le lundi
Déclenché par n'importe quel utilisateur, pas seulement un manager
Marqueur centralisé dans le Sheet → purge exécutée une seule fois même avec 15 employés qui ouvrent l'app
Nouvelle fonction cleSemaineCourante() conforme à la norme ISO 8601 (bascule le lundi)
La rotation manuelle du planning met aussi le marqueur à jour → pas de double purge

v1.71 — Correction du bug d'affichage des montants en modification

🐛 Correction — champs CB/Espèces/Autres parfois vides dans Gestion → Suivi

Symptôme : au clic sur "Modifier", les montants s'affichaient ou non selon la personne ayant saisi le CA.

Cause : les champs sont des <input type="number">, un élément HTML qui n'accepte que le point décimal. Une valeur stockée 1234,56 (virgule française) était silencieusement rejetée par le navigateur → champ vide. Selon la personne, son appareil ou le chemin de saisie, Google Sheets enregistrait tantôt un point, tantôt une virgule.

Trois correctifs :

À l'ouverture — normalisation via parseFR() (gère virgule, point, espaces, symbole €) avant injection dans les inputs
Fallback intelligent — si une ligne a un CA total mais aucun détail CB/Esp/Autre, le CA est pré-rempli en CB. Il y a toujours quelque chose à modifier
À la sauvegarde — écriture en nombres purs (jamais de chaîne avec virgule) → le problème ne peut plus se reproduire

Amélioration : le total se recalcule désormais en direct même quand un champ est vidé (avant, la fonction sortait prématurément si les trois champs étaient vides).
