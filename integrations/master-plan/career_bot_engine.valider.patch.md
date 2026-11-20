# Patch proposé : `/valider` écrit `VALIDATED`, le harness génère et postule

Fichier : `02_Assistant_Personnel/02_Automatisation/core/career_bot_engine.js`,
méthode `validateAndTailorJob(input)`. **Non appliqué** (bot de production) : à coller à la main.

## Avant

```js
validateAndTailorJob(input) {
  const slug = this.resolveSlug(input);
  try {
    const scriptPath = path.join(this.baseDir, '04_Productivite_Admin', 'career_ops', 'cv_tailor_engine.py');
    const cmd = `uv run --no-project python "${scriptPath}" "${slug}"`;
    const out = execSync(cmd, { encoding: 'utf8', timeout: 25000 });
    // … parse du JSON, message « CV & PITCH GÉNÉRÉS »
  } catch (err) {
    return `❌ *Erreur lors de la génération du CV :* ${err.message}`;
  }
}
```

## Après

```js
validateAndTailorJob(input) {
  const slug = this.resolveSlug(input);
  const boardPath = path.join(this.careerDir, 'pending_gold_jobs.json');
  try {
    const jobs = JSON.parse(fs.readFileSync(boardPath, 'utf8'));
    const job = jobs.find(j => j.slug === slug || String(j.index) === String(slug));
    if (!job) return `❌ *Offre introuvable :* \`${input}\`. Tapez \`/jobs\` pour la liste.`;
    if (!['PENDING_VALIDATION', 'VALIDATED', 'APPLY_FAILED'].includes(job.status)) {
      return `ℹ️ *${job.company || slug}* est déjà en \`${job.status}\`. \`/cv ${slug}\` pour le dossier.`;
    }
    job.status = 'VALIDATED';
    job.validated_at = new Date().toISOString();
    const tmp = `${boardPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(jobs, null, 2));
    fs.renameSync(tmp, boardPath);                       // écriture atomique, comme le listener
    return `✅ *OFFRE VALIDÉE — ${job.company || slug}*\n\n` +
           `Le harness prend le relais : CV sur mesure, pitch, puis candidature sur la plateforme ` +
           `de l'employeur (avec votre « go » tant que la plateforme n'est pas éprouvée).\n\n` +
           `📄 \`/cv ${slug}\` dans une quinzaine de minutes pour relire le dossier.\n` +
           `✍️ \`/remarque ${slug} …\` est pris en compte au prochain passage.`;
  } catch (err) {
    return `❌ *Erreur lors de la validation :* ${err.message}`;
  }
}
```

## Ce qui ne change pas

- `/jobs` : ajouter `VALIDATED`, `APPLYING`, `APPLIED`, `APPLY_UNPROVEN`, `APPLY_FAILED` à la
  table des libellés de statut (ligne ~50) pour que la liste les affiche ; sinon ils tombent
  dans « ⏳ À VALIDER ».
- `/cv`, `/remarque`, `/postuler` lisent `applications/<slug>/` : `career-apply` y écrit
  `CV_Antoine_Lecerf_<slug>.md`, `Message_Accroche_<slug>.md`, `interlocuteur_cible.json`,
  `submission_receipt.json`, les mêmes noms que `cv_tailor_engine.py` et
  `ats_application_submitter.py`.
- `cv_tailor_engine.py` reste disponible en secours (`uv run --no-project python
  cv_tailor_engine.py <slug>` à la main).
