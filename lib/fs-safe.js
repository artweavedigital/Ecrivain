'use strict';

/*
 * Écrivain — écriture sûre sur disque et validation des identifiants.
 *
 *  - writeFileAtomic : écrit dans un fichier temporaire unique, force l'écriture
 *    physique (fsync), puis remplace le fichier cible par un renommage atomique.
 *    Un arrêt brutal laisse donc soit l'ancienne version, soit la nouvelle,
 *    jamais un fichier tronqué.
 *  - runExclusive : exécute les opérations portant sur une même clé (un chapitre,
 *    un fichier) l'une après l'autre, pour éviter que deux sauvegardes
 *    simultanées ne s'écrasent ou ne se mélangent.
 *  - whenIdle : permet d'attendre la fin de toutes les écritures en cours avant
 *    de quitter l'application.
 *  - safeSegment / resolveInside : empêchent qu'un identifiant venu de
 *    l'interface (« ../../x ») ne fasse sortir une lecture ou une écriture du
 *    dossier prévu.
 */

const fs = require('node:fs/promises');
const path = require('node:path');

// ---------------------------------------------------------------------------
// Identifiants et chemins
// ---------------------------------------------------------------------------

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * Valide un identifiant destiné à devenir un nom de fichier ou de dossier.
 * Accepte les identifiants historiques (lettres, chiffres, point, tiret,
 * soulignement) mais refuse tout séparateur de chemin et toute séquence « .. ».
 */
function safeSegment(value, label = 'Identifiant') {
    const text = String(value ?? '');
    if (!SAFE_SEGMENT.test(text) || text.includes('..') || /[. ]$/.test(text)) {
        throw new Error(`${label} invalide.`);
    }
    return text;
}

function isInside(base, target) {
    const relative = path.relative(path.resolve(base), path.resolve(target));
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** Construit un chemin et vérifie qu'il reste à l'intérieur de `base`. */
function resolveInside(base, ...segments) {
    const target = path.join(base, ...segments);
    if (!isInside(base, target)) throw new Error('Chemin en dehors du dossier autorisé.');
    return target;
}

// ---------------------------------------------------------------------------
// Opérations exclusives et suivi des écritures en cours
// ---------------------------------------------------------------------------

const queues = new Map();
const pending = new Set();

function track(promise) {
    pending.add(promise);
    const forget = () => { pending.delete(promise); };
    promise.then(forget, forget);
    return promise;
}

/**
 * Exécute `task` après toutes les tâches déjà en attente sur la même clé.
 * Une tâche qui échoue ne bloque pas les suivantes.
 */
function runExclusive(key, task) {
    const previous = queues.get(key) || Promise.resolve();
    const run = previous.catch(() => {}).then(task);
    const tail = run.catch(() => {});
    queues.set(key, tail);
    tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
    return track(run);
}

/** Attend la fin de toutes les opérations suivies (y compris celles ajoutées entre-temps). */
async function whenIdle(timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    while (pending.size && Date.now() < deadline) {
        let timer = null;
        await Promise.race([
            Promise.allSettled([...pending]),
            new Promise((resolve) => { timer = setTimeout(resolve, Math.max(10, deadline - Date.now())); })
        ]);
        clearTimeout(timer);
    }
    return pending.size === 0;
}

function pendingCount() {
    return pending.size;
}

// ---------------------------------------------------------------------------
// Écriture atomique
// ---------------------------------------------------------------------------

let tmpCounter = 0;
const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);

async function renameWithRetry(from, to) {
    let lastError = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            await fs.rename(from, to);
            return;
        } catch (error) {
            lastError = error;
            // Windows : un antivirus ou un indexeur peut verrouiller brièvement le fichier.
            if (!RETRYABLE.has(error?.code)) break;
            await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
        }
    }
    throw lastError;
}

async function writeFileAtomic(filePath, data, encoding = 'utf8') {
    const tmp = `${filePath}.${process.pid}.${(tmpCounter += 1)}.tmp`;
    const handle = await fs.open(tmp, 'w');
    try {
        if (Buffer.isBuffer(data) || data instanceof Uint8Array) await handle.writeFile(data);
        else await handle.writeFile(String(data), encoding);
        await handle.sync();
    } catch (error) {
        await handle.close().catch(() => {});
        await fs.rm(tmp, { force: true }).catch(() => {});
        throw error;
    }
    await handle.close();
    try {
        await renameWithRetry(tmp, filePath);
    } catch (error) {
        await fs.rm(tmp, { force: true }).catch(() => {});
        throw error;
    }
}

/** Écrit un objet en JSON de façon atomique, en série pour un même fichier. */
function writeJsonAtomic(filePath, value) {
    const text = `${JSON.stringify(value, null, 2)}\n`;
    return runExclusive(`file:${path.resolve(filePath)}`, () => writeFileAtomic(filePath, text));
}

/** Supprime les fichiers temporaires orphelins laissés par un arrêt brutal. */
async function cleanStaleTempFiles(directory, olderThanMs = 60 * 60 * 1000) {
    let removed = 0;
    let entries = [];
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch (_) { return 0; }
    const limit = Date.now() - olderThanMs;
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.tmp')) continue;
        const full = path.join(directory, entry.name);
        try {
            const stat = await fs.stat(full);
            if (stat.mtimeMs < limit) {
                await fs.rm(full, { force: true });
                removed += 1;
            }
        } catch (_) { /* ignoré */ }
    }
    return removed;
}

module.exports = {
    safeSegment,
    isInside,
    resolveInside,
    runExclusive,
    whenIdle,
    pendingCount,
    track,
    writeFileAtomic,
    writeJsonAtomic,
    cleanStaleTempFiles
};
