'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const F = require('../lib/fs-safe');

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'ecrivain-fs-'));
}

test('safeSegment : identifiants valides et traversées refusées', () => {
    for (const ok of ['ch-1700000000000', 'abc_DEF.1', 'a']) assert.equal(F.safeSegment(ok), ok);
    for (const bad of ['', '..', '../x', 'a/b', 'a\\b', '.cache', 'a..b', 'fin.', 'avec espace', 'x'.repeat(200), null, undefined]) {
        assert.throws(() => F.safeSegment(bad), /invalide/, String(bad));
    }
});

test('resolveInside : reste dans le dossier de base', () => {
    const base = tempDir();
    assert.equal(F.resolveInside(base, 'a', 'b.json'), path.join(base, 'a', 'b.json'));
    assert.throws(() => F.resolveInside(base, '..', 'x'), /dossier autoris/);
    assert.throws(() => F.resolveInside(base, '..'), /dossier autoris/);
    fs.rmSync(base, { recursive: true, force: true });
});

test('runExclusive : exécution en série par clé, une erreur ne bloque pas la suite', async () => {
    const order = [];
    const slow = F.runExclusive('k', async () => { await new Promise((r) => setTimeout(r, 30)); order.push('a'); });
    const failing = F.runExclusive('k', async () => { order.push('b'); throw new Error('échec'); });
    const last = F.runExclusive('k', async () => { order.push('c'); return 42; });
    const other = F.runExclusive('autre', async () => { order.push('x'); });
    await assert.rejects(failing, /échec/);
    assert.equal(await last, 42);
    await slow; await other;
    assert.deepEqual(order.filter((v) => v !== 'x'), ['a', 'b', 'c']);
    assert.ok(order.indexOf('x') < order.indexOf('a'), 'une autre clé n’attend pas');
});

test('writeJsonAtomic : 60 écritures simultanées, la dernière gagne, aucun fichier temporaire', async () => {
    const dir = tempDir();
    const file = path.join(dir, 'chapitre.json');
    const writes = [];
    for (let i = 0; i < 60; i += 1) writes.push(F.writeJsonAtomic(file, { n: i, texte: 'é'.repeat(5000) }));
    await Promise.all(writes);
    const data = JSON.parse(await fsp.readFile(file, 'utf8'));
    assert.equal(data.n, 59);
    assert.deepEqual((await fsp.readdir(dir)).filter((name) => name.endsWith('.tmp')), []);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('writeFileAtomic : accepte Buffer et Uint8Array', async () => {
    const dir = tempDir();
    await F.writeFileAtomic(path.join(dir, 'a.bin'), Buffer.from([1, 2, 3]));
    await F.writeFileAtomic(path.join(dir, 'b.bin'), new Uint8Array([4, 5, 6]));
    assert.deepEqual([...fs.readFileSync(path.join(dir, 'a.bin'))], [1, 2, 3]);
    assert.deepEqual([...fs.readFileSync(path.join(dir, 'b.bin'))], [4, 5, 6]);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('whenIdle : attend la fin des écritures en cours', async () => {
    let done = false;
    F.runExclusive('idle', async () => { await new Promise((r) => setTimeout(r, 60)); done = true; });
    assert.ok(F.pendingCount() >= 1);
    assert.equal(await F.whenIdle(2000), true);
    assert.equal(done, true);
    assert.equal(F.pendingCount(), 0);
});

test('cleanStaleTempFiles : ne supprime que les anciens .tmp', async () => {
    const dir = tempDir();
    const oldTmp = path.join(dir, 'vieux.json.1.2.tmp');
    const freshTmp = path.join(dir, 'neuf.json.1.3.tmp');
    const keep = path.join(dir, 'garde.json');
    for (const f of [oldTmp, freshTmp, keep]) fs.writeFileSync(f, 'x');
    const past = new Date(Date.now() - 3 * 60 * 60 * 1000);
    fs.utimesSync(oldTmp, past, past);
    assert.equal(await F.cleanStaleTempFiles(dir), 1);
    assert.ok(!fs.existsSync(oldTmp));
    assert.ok(fs.existsSync(freshTmp));
    assert.ok(fs.existsSync(keep));
    fs.rmSync(dir, { recursive: true, force: true });
});
