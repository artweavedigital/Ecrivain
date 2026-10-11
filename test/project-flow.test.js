'use strict';

/*
 * Tests d'intégration : les vrais gestionnaires IPC de main.js, avec un faux
 * module « electron » et un projet réel dans un dossier temporaire.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness } = require('./helpers/mock-electron');

async function newProject(h, metadata = { title: 'Mon roman', author: 'A. Auteur' }) {
    h.answers.open.push({ canceled: false, filePaths: [h.projects] });
    const created = await h.invoke('project:create', metadata);
    assert.equal(created.canceled, false);
    return created;
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

test('création de projet : format, schéma, identifiant stable, réglages d’export', async (t) => {
    const h = createHarness();
    t.after(h.cleanup);
    const { project, projectDir } = await newProject(h);
    assert.equal(project.format, 'ecrivain-project');
    assert.equal(project.formatVersion, 1);
    assert.equal(project.schemaVersion, '1.5.0');
    assert.equal(project.appVersion, h.internals.APP_VERSION);
    assert.match(project.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.equal(project.pageNumbers, true);
    assert.equal(project.runningHeader, 'none');
    assert.deepEqual(project.exportExcludeStatuses, ['cut']);
    assert.ok(fs.existsSync(path.join(projectDir, 'project.json')));
});

test('un projet ancien reçoit un identifiant à l’ouverture, sans perdre ses champs', async (t) => {
    const h = createHarness();
    t.after(h.cleanup);
    const { projectDir } = await newProject(h);
    const file = path.join(projectDir, 'project.json');
    const old = readJson(file);
    delete old.uuid;
    delete old.pageNumbers;
    old.schemaVersion = '1.4.0';
    old.champPersonnalise = 'à conserver';
    fs.writeFileSync(file, JSON.stringify(old));
    await h.invoke('project:openRecent', projectDir);
    // La vérification complète s'exécute en tâche de fond à l'ouverture ; ici on la lance explicitement.
    const verified = await h.invoke('project:verify');
    assert.match(verified.state.project.uuid, /^[0-9a-f-]{36}$/);
    assert.equal(verified.state.project.champPersonnalise, 'à conserver');
    assert.equal(verified.state.project.schemaVersion, '1.5.0');
    assert.equal(verified.state.project.pageNumbers, undefined, 'les anciens projets gardent le comportement par défaut sans réécriture inutile');
    await h.invoke('project:openRecent', projectDir);
    const again = await h.invoke('project:verify');
    assert.equal(again.state.project.uuid, verified.state.project.uuid, 'l’identifiant ne change plus');
});

test('enregistrement : compteur de mots unique, version du compteur, typographie du dialogue', async (t) => {
    const h = createHarness();
    t.after(h.cleanup);
    await newProject(h);
    const chapter = await h.invoke('chapter:create', { title: 'Un', parent: null });
    const saved = await h.invoke('chapter:save', { ...chapter, content: '<p>— Bonjour, dit-il.</p><p>— Salut !</p>' }, { mode: 'manual' });
    assert.equal(saved.wordCount, 3);
    assert.equal(saved.wcv, 2);
});

test('enregistrements simultanés : jamais de fichier tronqué ni temporaire, la dernière version gagne', async (t) => {
    const h = createHarness();
    t.after(h.cleanup);
    const { projectDir } = await newProject(h);
    const chapter = await h.invoke('chapter:create', { title: 'Course', parent: null });
    const saves = [];
    for (let i = 0; i < 40; i += 1) {
        saves.push(h.invoke('chapter:save', { ...chapter, content: `<p>version ${i} ${'mot '.repeat(i)}</p>` }, { mode: 'autosave' }));
    }
    await Promise.all(saves);
    const stored = readJson(path.join(projectDir, 'chapters', `${chapter.id}.json`));
    assert.match(stored.content, /^<p>version 39 /);
    const leftovers = fs.readdirSync(path.join(projectDir, 'chapters')).filter((name) => name.endsWith('.tmp'));
    assert.deepEqual(leftovers, []);
});

test('identifiants hostiles : refusés avant toute lecture ou écriture', async (t) => {
    const h = createHarness();
    t.after(h.cleanup);
    const { projectDir } = await newProject(h);
    const outside = path.join(path.dirname(projectDir), 'secret.json');
    fs.writeFileSync(outside, '{"secret":true}');
    for (const bad of ['../../secret', '..\\..\\secret', '../secret', 'a/b', '']) {
        await assert.rejects(h.invoke('chapter:save', { id: bad, title: 'x', content: '<p>x</p>' }), /invalide/i, bad);
        await assert.rejects(h.invoke('chapter:delete', bad), /invalide/i, bad);
        await assert.rejects(h.invoke('chapter:deletePreview', bad), /invalide/i, bad);
        await assert.rejects(h.invoke('history:state', bad), /invalide|introuvable/i, bad);
    }
    assert.equal(fs.readFileSync(outside, 'utf8'), '{"secret":true}');
});

test('corbeille : suppression d’un chapitre et de ses sous-chapitres, puis restauration', async (t) => {
    const h = createHarness();
    t.after(h.cleanup);
    const { projectDir } = await newProject(h);
    const parent = await h.invoke('chapter:create', { title: 'Parent', parent: null });
    const child = await h.invoke('chapter:create', { title: 'Enfant', parent: parent.id });
    const other = await h.invoke('chapter:create', { title: 'Autre', parent: null });
    await h.invoke('chapter:save', { ...parent, content: '<p>un deux trois</p>' });
    await h.invoke('chapter:save', { ...child, content: '<p>quatre cinq</p>' });
    const note = await h.invoke('notes:saveText', { title: 'Note liée', chapterId: child.id, content: '<p>Souvenir</p>' });

    const preview = await h.invoke('chapter:deletePreview', parent.id);
    assert.deepEqual(preview, { chapters: 2, subchapters: 1, notes: 1, words: 5 });

    const deleted = await h.invoke('chapter:delete', parent.id);
    assert.equal(deleted.length, 2);
    assert.ok(!fs.existsSync(path.join(projectDir, 'chapters', `${parent.id}.json`)));
    assert.ok(!fs.existsSync(path.join(projectDir, 'chapters', `${child.id}.json`)));
    assert.ok(fs.existsSync(path.join(projectDir, 'chapters', `${other.id}.json`)), 'les autres chapitres ne bougent pas');
    assert.ok(!fs.existsSync(path.join(projectDir, 'notes', `${note.id}.json`)), 'la note liée suit le chapitre');

    const trash = await h.invoke('trash:state');
    assert.equal(trash.items.length, 1);
    assert.equal(trash.items[0].kind, 'chapters');
    assert.equal(trash.items[0].chapterCount, 2);
    assert.equal(trash.items[0].noteCount, 1);
    assert.equal(trash.items[0].wordCount, 5);

    const restored = await h.invoke('trash:restore', trash.items[0].id);
    assert.equal(restored.restored.chapters, 2);
    assert.equal(restored.restored.notes, 1);
    assert.equal((await h.invoke('trash:state')).items.length, 0);
    const back = restored.project.chapters.find((c) => c.id === child.id);
    assert.equal(back.parent, parent.id);
    assert.match(back.content, /quatre cinq/);
    assert.ok(fs.existsSync(path.join(projectDir, 'notes', `${note.id}.json`)));
});

test('corbeille : restauration partielle quand un chapitre existe déjà, dossier conservé', async (t) => {
    const h = createHarness();
    t.after(h.cleanup);
    const { projectDir } = await newProject(h);
    const chapter = await h.invoke('chapter:create', { title: 'Seul', parent: null });
    await h.invoke('chapter:delete', chapter.id);
    const entry = (await h.invoke('trash:state')).items[0];
    // Un chapitre de même identifiant réapparaît entre-temps.
    fs.writeFileSync(path.join(projectDir, 'chapters', `${chapter.id}.json`), JSON.stringify({ id: chapter.id, title: 'Revenu', content: '<p></p>', position: 1 }));
    const result = await h.invoke('trash:restore', entry.id);
    assert.equal(result.restored.chapters, 0);
    assert.equal(result.restored.skipped.length, 1);
    assert.equal((await h.invoke('trash:state')).items.length, 1, 'rien n’est perdu : l’élément reste dans la corbeille');
});

test('corbeille : suppression définitive et vidage demandent confirmation', async (t) => {
    const h = createHarness();
    t.after(h.cleanup);
    await newProject(h);
    const a = await h.invoke('chapter:create', { title: 'A', parent: null });
    const b = await h.invoke('chapter:create', { title: 'B', parent: null });
    await h.invoke('chapter:delete', a.id);
    await h.invoke('chapter:delete', b.id);
    assert.equal((await h.invoke('trash:state')).items.length, 2);

    const first = (await h.invoke('trash:state')).items[0];
    h.answers.message.push({ response: 0 }); // Annuler
    assert.equal((await h.invoke('trash:purge', first.id)).canceled, true);
    assert.equal((await h.invoke('trash:state')).items.length, 2);

    h.answers.message.push({ response: 1 });
    assert.equal((await h.invoke('trash:purge', first.id)).canceled, false);
    assert.equal((await h.invoke('trash:state')).items.length, 1);

    h.answers.message.push({ response: 0 });
    assert.equal((await h.invoke('trash:empty')).canceled, true);
    h.answers.message.push({ response: 1 });
    await h.invoke('trash:empty');
    assert.equal((await h.invoke('trash:state')).items.length, 0);

    await assert.rejects(h.invoke('trash:purge', '../..'), /invalide/i);
    await assert.rejects(h.invoke('trash:restore', '../../x'), /invalide/i);
});

test('notes : suppression vers la corbeille, restauration, chemins de pièce jointe hostiles', async (t) => {
    const h = createHarness();
    t.after(h.cleanup);
    const { projectDir } = await newProject(h);
    const note = await h.invoke('notes:saveText', { title: 'Idée', content: '<p>un mot</p>' });
    await h.invoke('notes:delete', note.id);
    assert.ok(!fs.existsSync(path.join(projectDir, 'notes', `${note.id}.json`)));
    const [entry] = (await h.invoke('trash:state')).items;
    assert.equal(entry.kind, 'note');
    await h.invoke('trash:restore', entry.id);
    assert.ok(fs.existsSync(path.join(projectDir, 'notes', `${note.id}.json`)));

    // Un projet reçu d'un tiers désigne un fichier extérieur comme « pièce jointe ».
    const secret = path.join(path.dirname(projectDir), 'secret.txt');
    fs.writeFileSync(secret, 'secret');
    const evil = { id: 'nt-evil', type: 'file', title: 'Piège', path: '../../secret.txt', originalName: 'secret.txt', mime: 'text/plain', size: 6, createdAt: '2024-01-01 00:00:00', updatedAt: '2024-01-01 00:00:00' };
    fs.writeFileSync(path.join(projectDir, 'notes', 'nt-evil.json'), JSON.stringify(evil));
    await assert.rejects(h.invoke('notes:openFile', 'nt-evil'), /invalide/i);
    await h.invoke('notes:delete', 'nt-evil');
    assert.equal(fs.readFileSync(secret, 'utf8'), 'secret', 'le fichier extérieur n’est ni déplacé ni supprimé');
    assert.equal(h.log.openedPaths.includes(secret), false);
});

test('notes : seul un fichier choisi dans la boîte de dialogue peut être joint', async (t) => {
    const h = createHarness();
    t.after(h.cleanup);
    await newProject(h);
    const picked = path.join(h.root, 'choisi.txt');
    const sneaky = path.join(h.root, 'autre.txt');
    fs.writeFileSync(picked, 'a');
    fs.writeFileSync(sneaky, 'b');
    await assert.rejects(h.invoke('notes:saveFile', { title: 'x', sourcePath: sneaky }), /Choisissez le fichier/);
    h.answers.open.push({ canceled: false, filePaths: [picked] });
    const choice = await h.invoke('notes:pickAttachment');
    assert.equal(choice.sourcePath, picked);
    const note = await h.invoke('notes:saveFile', { title: 'ok', sourcePath: picked });
    assert.match(note.path, /^assets\/notes\//);
    await assert.rejects(h.invoke('notes:saveFile', { title: 'encore', sourcePath: picked }), /Choisissez le fichier/, 'chaque choix ne sert qu’une fois');
});

test('migration du compteur de mots à l’ouverture : recompte unique, statistiques inchangées', async (t) => {
    const h = createHarness();
    t.after(h.cleanup);
    const { projectDir } = await newProject(h);
    const chapter = await h.invoke('chapter:create', { title: 'Ancien', parent: null });
    const file = path.join(projectDir, 'chapters', `${chapter.id}.json`);
    const stored = readJson(file);
    stored.content = '<p>— Bonjour, dit-il.</p><p>— Salut !</p>';
    stored.wordCount = 6; // ancien compteur, trop généreux
    delete stored.wcv;
    fs.writeFileSync(file, JSON.stringify(stored));
    await h.invoke('project:openRecent', projectDir);
    const reopened = (await h.invoke('project:verify')).state;
    const migrated = reopened.chapters.find((c) => c.id === chapter.id);
    assert.equal(migrated.wordCount, 3);
    assert.equal(migrated.wcv, 2);
    const stats = await h.invoke('stats:state');
    assert.equal(stats.totalWords, 3);
    const todayBefore = stats.todayWords;
    // Un second enregistrement identique n'ajoute aucun mot écrit.
    await h.invoke('chapter:save', { ...migrated }, { mode: 'manual' });
    assert.equal((await h.invoke('stats:state')).todayWords, todayBefore);
});

test('métadonnées du projet : écritures simultanées sans corruption', async (t) => {
    const h = createHarness();
    t.after(h.cleanup);
    const { projectDir } = await newProject(h);
    const jobs = [];
    for (let i = 0; i < 12; i += 1) {
        jobs.push(h.invoke('project:updateLayout', { marginTopMm: 10 + i, pageNumbers: i % 2 === 0, runningHeader: 'title' }));
        jobs.push(h.invoke('project:updateInfo', { title: 'Titre', subtitle: `Sous-titre ${i}` }));
    }
    await Promise.all(jobs);
    const project = readJson(path.join(projectDir, 'project.json'));
    assert.equal(project.title, 'Titre');
    assert.equal(project.runningHeader, 'title');
    assert.equal(typeof project.pageNumbers, 'boolean');
    assert.ok(project.uuid);
    assert.deepEqual(fs.readdirSync(projectDir).filter((n) => n.endsWith('.tmp')), []);
});

test('exclusion d’un chapitre de l’export : indicateur conservé à l’enregistrement', async (t) => {
    const h = createHarness();
    t.after(h.cleanup);
    const { projectDir } = await newProject(h);
    const chapter = await h.invoke('chapter:create', { title: 'Brouillon d’idées', parent: null });
    assert.deepEqual(await h.invoke('chapter:setExcluded', chapter.id, true), { id: chapter.id, excludeFromExport: true });
    const reread = await h.invoke('project:state');
    const entry = reread.chapters.find((c) => c.id === chapter.id);
    assert.equal(entry.excludeFromExport, true);
    // La mise à jour de position ne touche pas à la date de modification du texte.
    const stored = readJson(path.join(projectDir, 'chapters', `${chapter.id}.json`));
    assert.equal(stored.updatedAt, chapter.updatedAt);
    await h.invoke('chapter:save', { ...entry, content: '<p>texte</p>' });
    assert.equal(readJson(path.join(projectDir, 'chapters', `${chapter.id}.json`)).excludeFromExport, true);
    const stats = await h.invoke('stats:state');
    assert.equal(stats.excludedChapters, 1);
});
