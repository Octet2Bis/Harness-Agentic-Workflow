/**
 * request.js — Requête HTTP(S) générique (GET / POST, en-têtes, corps JSON)
 * Pilier : 02_Assistant_Personnel / Career Ops
 * Même contrat que common.fetchUrl : ne rejette jamais, résout { status, data } avec
 * status = code HTTP, 'erreur réseau', 'timeout' ou 'url invalide'.
 * Les en-têtes de l'appelant complètent common.DEFAULT_HEADERS (clés API passées par l'appelant,
 * jamais lues ici).
 */

const https = require('node:https');
const http = require('node:http');
const common = require('./common');

function request(url, { method = 'GET', headers = {}, body, timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    let target;
    try { target = new URL(url); } catch { return resolve({ status: 'url invalide', data: '' }); }
    const client = target.protocol === 'https:' ? https : http;
    const payload = body === undefined || body === null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const finalHeaders = { ...common.DEFAULT_HEADERS, ...headers };
    if (payload !== null) {
      if (!Object.keys(finalHeaders).some(k => k.toLowerCase() === 'content-type')) finalHeaders['Content-Type'] = 'application/json';
      finalHeaders['Content-Length'] = Buffer.byteLength(payload);
    }
    let settled = false;
    const done = (result) => { if (!settled) { settled = true; resolve(result); } };
    const req = client.request(target, { method, headers: finalHeaders, timeout: timeoutMs }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => done({ status: res.statusCode, data }));
      res.on('error', () => done({ status: 'erreur réseau', data: '' }));
    });
    req.on('error', () => done({ status: 'erreur réseau', data: '' }));
    req.on('timeout', () => { req.destroy(); done({ status: 'timeout', data: '' }); });
    if (payload !== null) req.write(payload);
    req.end();
  });
}

// Corps JSON analysé ou null ; un 200 illisible devient 'réponse illisible'.
function parseJsonBody(res) {
  if (res.status !== 200 && res.status !== 201) return { status: res.status, data: null };
  if (!res.data) return { status: res.status, data: null };
  try { return { status: res.status, data: JSON.parse(res.data) }; } catch { return { status: 'réponse illisible', data: null }; }
}

// `send` permet d'injecter une fausse requête en test ; par défaut request().
async function fetchJsonWith(url, opts = {}, send = request) {
  return parseJsonBody(await send(url, opts));
}

module.exports = { request, fetchJsonWith, parseJsonBody };
