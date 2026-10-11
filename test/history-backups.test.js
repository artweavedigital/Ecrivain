'use strict';

/*
 * Historique des chapitres et sauvegardes du projet : rétention, quotas,
 * copie externe, restauration.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness } = require('./helpers/mock-electron');

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

async function newProject(h) {
    h.answers.open.push({ canceled: false, filePaths: [h.projects] });
    return h.invoke('project:create', { title: 'Mon roman', author: 'A. Auteur' });
}

// Nom de fichier d'historique à l'heure locale, comme le produit l'application.
function historyName(date, source = 'autosave') {
    const p = (n, w = 2) => String(n).padStart(w, '0');
    return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}-${p(date.getMilliseconds(), 3)}-${source}.json`;
}

const DAY = 24 * 60 * 60 * 1000;

test('rétention de l’historique : 7 jours complets, puis un jalon par jour, puis par semaine', () => {
    const h = createHarness();
    try {
        const { historyFilesToPrune } = h.internals;
        const now = new Date(2026, 5, 30, 12, 0, 0).getTime();
        const at = (daysAgo, hour, minute = 0) => new Date(now - daysAgo * DAY + (hour - 12) * 3600 * 1000 + minute * 60000);

        // 0 à 6 jours : tout est conservé, même plusieurs jalons le même jour.
        const recent = [at(0, 9), at(0, 10), at(2, 8), at(2, 9), at(6, 7), at(6, 8)].map((d) => historyName(d));
        assert.deepEqual(historyFilesToPrune(recent, now), []);

        // 10 jours : trois jalons le même jour → seul le plus récent reste.
        const sameDay = [at(10, 8), at(10, 14), at(10, 20)].map((d) => historyName(d));
        const doomedDay = historyFilesToPrune(sameDay, now);
        assert.deepEqual(doomedDay.sort(), [historyName(at(10, 8)), historyName(at(10, 14))].sort());
        assert.ok(!doomedDay.includes(historyName(at(10, 20))));

        // Au-delà de 30 jours : un jalon par semaine (lundi à dimanche).
        const old = [at(60, 8), at(60, 9), at(61, 8), at(75, 8)].map((d) => historyName(d));
        const doomedOld = historyFilesToPrune(old, now);
        assert.ok(doomedOld.length >= 1, 'au moins un doublon de la même semaine est supprimé');
        assert.ok(doomedOld.length <= 3, 'au moins un jalon par semaine survit');
        assert.ok(!doomedOld.includes(historyName(at(75, 8))), 'une semaine isolée garde son jalon');

        // Jamais les jalons manuels, « avant restauration » ou autres sources.
        const special = [
            historyName(at(40, 8), 'manual'), historyName(at(40, 9), 'manual'),
            historyName(at(40, 10), 'before-restore'), 'notes-perso.json', 'readme.txt'
        ];
        assert.deepEqual(historyFilesToPrune(special, now), []);
    } finally {
        h.cleanup();
    }
});

test('historique : un enregistrement manuel crée un jalon, la restauration en crée un « avant »', async (t) => {
    const h = createHarness();
    t.after(h.cleanup);
    const { projectDir } = await newProject(h);
    const chapter = await h.invoke('chapter:create', { title: 'Un', parent: null });
    await h.invoke('chapter:save', { ...chapter, content: '<p>première version</p>' }, { mode: 'manual' });
    await pause(5);
    await h.invoke('chapter:save', { ...chapter, content: '<p>seconde version</p>' }, { mode: 'manual' });

    const state = await h.invoke('history:state', chapter.id);
    assert.ok(state.versions.length >= 1, 'au moins un jalon d’historique');
    let target = null;
    for (const version of state.versions) {
        const snapshot = await h.invoke('history:get', chapter.id, version.id);
        if (/première version/.test(snapshot.content)) target = version;
    }
    assert.ok(target, 'la version précédente est dans l’historique');

    // Une version désignée par un chemin n'est jamais lue hors de l'historique.
    await assert.rejects(h.invoke('history:get', chapter.id, '../../project.json'), /invalide|n’existe plus|Version/i);
    assert.ok(fs.existsSync(path.join(projectDir, 'history', chapter.id)));

    const restored = await h.invoke('history:restore', chapter.id, target.id);
    assert.equal(restored.id, chapter.id);
    assert.equal(restored.wcv, 2);
    assert.match(restored.content, /première version/);
    assert.match(readJson(path.join(projectDir, 'chapters', `${chapter.id}.json`)).content, /première version/);
    const after = await h.invoke('history:state', chapter.id);
    assert.ok(after.versions.length > state.versions.length, 'un jalon « avant restauration » a été ajouté');
    assert.ok(after.versions.some((v) => v.source === 'avant-restauration'), 'source du jalon conservée');
});

test('sauvegardes : quotas manuel et automatique indépendants', async (t) => {
    const h = createHarness();
    t.after(h.cleanup);
    const { projectDir } = await newProject(h);
    const { MAX_MANUAL_BACKUPS, MAX_AUTO_BACKUPS } = h.internals;
    assert.equal(MAX_MANUAL_BACKUPS, 5);
    assert.equal(MAX_AUTO_BACKUPS, 5);

    // Beaucoup d'automatiques ne chassent pas les manuelles, et inversement.
    for (let i = 0; i < 3; i += 1) { await h.invoke('backups:create', 'Sauvegarde manuelle'); await pause(4); }
    for (let i = 0; i < 8; i += 1) { await h.internals.createProjectBackup(`Automatique ${i}`, [], 'auto'); await pause(4); }
    let state = await h.invoke('backups:state');
    assert.equal(state.backups.filter((b) => b.kind === 'manual').length, 3, 'les trois manuelles survivent aux huit automatiques');
    assert.equal(state.backups.filter((b) => b.kind === 'auto').length, 5);

    for (let i = 0; i < 4; i += 1) { await h.invoke('backups:create', 'Sauvegarde manuelle'); await pause(4); }
    state = await h.invoke('backups:state');
    assert.equal(state.backups.filter((b) => b.kind === 'manual').length, 5);
    assert.equal(state.backups.filter((b) => b.kind === 'auto').length, 5);
    assert.equal(fs.readdirSync(path.join(projectDir, 'backups')).filter((n) => n.startsWith('backup-')).length, 10);
});

test('sauvegarde : n’emporte ni l’historique, ni la corbeille, ni les sauvegardes, ni les exports', async (t) => {
    const h = createHarness();
    t.after(h.cleanup);
    const { projectDir } = await newProject(h);
    const keep = await h.invoke('chapter:create', { title: 'Garde', parent: null });
    const gone = await h.invoke('chapter:create', { title: 'Jeté', parent: null });
    await h.invoke('chapter:save', { ...keep, content: '<p>texte</p>' }, { mode: 'manual' });
    await h.invoke('chapter:delete', gone.id);
    fs.mkdirSync(path.join(projectDir, 'exports'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'exports', 'ancien.epub'), 'x');

    const created = await h.invoke('backups:create', 'Sauvegarde manuelle');
    const dir = path.join(projectDir, 'backups', created.id);
    const names = fs.readdirSync(dir);
    assert.ok(names.includes('project.json'));
    assert.ok(names.includes('chapters'));
    assert.ok(names.includes('backup.json'));
    for (const excluded of ['backups', 'history', 'exports', 'trash']) {
        assert.ok(!names.includes(excluded), `${excluded} ne doit pas être dans la sauvegarde`);
    }
    assert.equal(readJson(path.join(dir, 'backup.json')).kind, 'manual');
});

test('sauvegarde externe : copie dans le dossier choisi, rotation, échec sans conséquence', async (t) => {
    const h = createHarness();
    t.after(h.cleanup);
    const { projectDir } = await newProject(h);
    const external = path.join(h.root, 'disque-externe');
    fs.mkdirSync(external, { recursive: true });
    await h.invoke('preferences:save', { externalBackupDir: external });

    const first = await h.invoke('backups:create', 'Sauvegarde manuelle');
    assert.equal(first.external.enabled, true);
    assert.equal(first.external.ok, true);
    const projectFolder = path.join(external, 'Ecrivain-sauvegardes', path.basename(projectDir));
    assert.ok(fs.existsSync(path.join(projectFolder, first.id, 'project.json')));

    // Rotation : dix copies externes au plus.
    for (let i = 0; i < 12; i += 1) { await h.internals.createProjectBackup(`Auto ${i}`, [], 'auto'); await pause(4); }
    const copies = fs.readdirSync(projectFolder).filter((n) => n.startsWith('backup-'));
    assert.equal(copies.length, 10);

    // Dossier devenu introuvable : la sauvegarde locale réussit quand même.
    fs.rmSync(external, { recursive: true, force: true });
    const degraded = await h.invoke('backups:create', 'Sauvegarde manuelle');
    assert.equal(degraded.external.enabled, true);
    assert.equal(degraded.external.ok, false);
    assert.ok(fs.existsSync(path.join(projectDir, 'backups', degraded.id, 'project.json')));
});

test('restauration d’une sauvegarde : état du projet remplacé, corbeille et historique intacts', async (t) => {
    const h = createHarness();
    t.after(h.cleanup);
    const { projectDir } = await newProject(h);
    const a = await h.invoke('chapter:create', { title: 'A', parent: null });
    const b = await h.invoke('chapter:create', { title: 'B', parent: null });
    await h.invoke('chapter:save', { ...a, content: '<p>état sauvegardé</p>' }, { mode: 'manual' });
    const backup = await h.invoke('backups:create', 'Sauvegarde manuelle');

    // Après la sauvegarde : modification de A, suppression de B (corbeille), nouveau chapitre.
    await h.invoke('chapter:save', { ...a, content: '<p>état modifié après</p>' }, { mode: 'manual' });
    await h.invoke('chapter:delete', b.id);
    const c = await h.invoke('chapter:create', { title: 'C', parent: null });
    const trashBefore = (await h.invoke('trash:state')).items.map((i) => i.id);
    assert.equal(trashBefore.length, 1);
    const historyBefore = fs.readdirSync(path.join(projectDir, 'history', a.id));

    h.answers.message.push({ response: 0 });
    assert.equal((await h.invoke('backups:restore', backup.id)).canceled, true, 'Annuler ne change rien');

    h.answers.message.push({ response: 1 });
    const restored = await h.invoke('backups:restore', backup.id);
    assert.equal(restored.canceled, false);

    const ids = fs.readdirSync(path.join(projectDir, 'chapters')).filter((n) => n.endsWith('.json')).map((n) => n.replace(/\.json$/, ''));
    assert.ok(ids.includes(a.id));
    assert.ok(ids.includes(b.id), 'B, présent au moment de la sauvegarde, est de retour');
    assert.ok(!ids.includes(c.id), 'C, créé après, n’existe plus');
    assert.match(readJson(path.join(projectDir, 'chapters', `${a.id}.json`)).content, /état sauvegardé/);

    assert.deepEqual((await h.invoke('trash:state')).items.map((i) => i.id), trashBefore, 'la corbeille n’est pas touchée');
    for (const name of historyBefore) assert.ok(fs.existsSync(path.join(projectDir, 'history', a.id, name)), 'historique conservé');

    const list = (await h.invoke('backups:state')).backups;
    assert.ok(list.some((x) => x.id === backup.id), 'la sauvegarde restaurée est conservée');
    assert.ok(list.some((x) => /Avant restauration/.test(x.reason)), 'l’état précédent est sauvegardé avant restauration');

    // Identifiant de sauvegarde hostile.
    h.answers.message.push({ response: 1 });
    await assert.rejects(h.invoke('backups:restore', '../../x'), /introuvable/i);
});
