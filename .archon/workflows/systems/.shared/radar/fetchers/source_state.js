/**
 * source_state.js — État persistant des sources (cadence, curseurs, run Apify en cours)
 * Pilier : 02_Assistant_Personnel / Career Ops
 * Fichier : Workspace/career/source_state.json — { [nom de source]: dernierAppelIso, ...curseurs }.
 * Jamais de secret ici : uniquement des horodatages, des index et des identifiants de run.
 */

const fs = require('node:fs');
const path = require('node:path');

const FILE_NAME = 'source_state.json';

function stateFile(careerDir) {
  return path.join(careerDir, FILE_NAME);
}

function readSourceState(careerDir) {
  try {
    const file = stateFile(careerDir);
    return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) || {}) : {};
  } catch {
    return {};
  }
}

function writeSourceState(careerDir, state) {
  try {
    fs.writeFileSync(stateFile(careerDir), JSON.stringify(state, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

// Minutes restantes avant le prochain appel autorisé (0 si l'appel est permis).
function minutesUntilAllowed(lastRunIso, minIntervalMin, now = Date.now()) {
  if (!minIntervalMin || !lastRunIso) return 0;
  const last = new Date(lastRunIso).getTime();
  if (Number.isNaN(last)) return 0;
  const remainingMs = last + minIntervalMin * 60 * 1000 - now;
  return remainingMs > 0 ? Math.ceil(remainingMs / 60000) : 0;
}

module.exports = { readSourceState, writeSourceState, minutesUntilAllowed, stateFile };
