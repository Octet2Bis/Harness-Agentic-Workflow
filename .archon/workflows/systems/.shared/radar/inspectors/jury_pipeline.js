/**
 * JURY D'INSPECTEURS SPÉCIALISÉS — CASCADE FAIL-FAST (Node.js 24)
 * Pilier : 02_Assistant_Personnel / Career Ops (< 110 lignes)
 * Trois inspecteurs : langue, télétravail, séniorité. Un seul refus disqualifie.
 */

const { evaluateLanguage } = require('./language_sentinel');
const { evaluateRemote } = require('./remote_auditor');
const { evaluateSeniority } = require('./seniority_calibrator');

const INSPECTORS = 3;

function runJuryEvaluation(job, taxonomy) {
  const auditReport = {
    pass: false,
    failed_inspector: null,
    verdict_summary: '',
    scores: {}
  };

  // 1. Sentinelle Linguistique (Fail-Fast)
  const langRes = evaluateLanguage(job, taxonomy);
  auditReport.scores.language = langRes;
  if (!langRes.pass) {
    auditReport.failed_inspector = 'language_sentinel';
    auditReport.verdict_summary = `Langue non conforme : ${langRes.reason}`;
    return auditReport;
  }

  // 2. Auditeur Remote (Fail-Fast) — sauf pour un candidat qui accepte le présentiel
  // (`remote_policy: "indifferent"` dans sa taxonomie ; défaut `full`, celui d'Antoine).
  const remoteRes = taxonomy?.remote_policy === 'indifferent'
    ? { pass: true, reason: 'mode de travail indifférent pour ce candidat' }
    : evaluateRemote(job);
  auditReport.scores.remote = remoteRes;
  if (!remoteRes.pass) {
    auditReport.failed_inspector = 'remote_auditor';
    auditReport.verdict_summary = `Remote non établi : ${remoteRes.reason}`;
    return auditReport;
  }

  // 3. Calibreur de Séniorité (Fail-Fast)
  const senRes = evaluateSeniority(job, taxonomy);
  auditReport.scores.seniority = senRes;
  if (!senRes.pass) {
    auditReport.failed_inspector = 'seniority_calibrator';
    auditReport.verdict_summary = `Séniorité/Scope hors cible : ${senRes.reason}`;
    return auditReport;
  }

  // Calcul du score Gold/Silver
  const full = `${job.title} ${job.description} ${job.skills_required} ${job.company}`.toLowerCase();
  let hits = 0;
  (taxonomy?.search_queries || []).forEach(kw => { if (full.includes(kw.toLowerCase())) hits++; });
  const isStartup = (taxonomy?.startup_scaleup_signals || []).some(s => full.includes(s));
  const finalScore = Math.min(95, 75 + (hits * 5) + (isStartup ? 10 : 0));

  auditReport.pass = true;
  auditReport.final_score = finalScore;
  auditReport.tier = finalScore >= 85 ? 'Gold' : 'Silver';
  auditReport.is_startup = isStartup;
  auditReport.verdict_summary = `Jury unanime : ${INSPECTORS}/${INSPECTORS} inspecteurs validés (${remoteRes.reason})`;

  return auditReport;
}

module.exports = { runJuryEvaluation, INSPECTORS };
