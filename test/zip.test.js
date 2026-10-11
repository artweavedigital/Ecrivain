'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { makeZip, readZip, crc32 } = require('../lib/zip');

test('crc32 : valeur connue', () => {
    assert.equal(crc32(Buffer.from('123456789')), 0xCBF43926);
});

test('zip : aller-retour, mimetype en premier et non compressé', () => {
    const big = 'Écrivain '.repeat(2000);
    const zip = makeZip([
        { name: 'mimetype', data: 'application/epub+zip' },
        { name: 'dossier/texte accentué é.txt', data: big },
        { name: 'petit.txt', data: 'ok' },
        { name: 'image.png', data: Buffer.from(big) }
    ]);
    const entries = readZip(zip);
    assert.equal(entries[0].name, 'mimetype');
    assert.equal(entries[0].method, 0);
    assert.equal(entries[0].data.toString(), 'application/epub+zip');
    assert.equal(entries[1].name, 'dossier/texte accentué é.txt');
    assert.equal(entries[1].method, 8, 'un texte volumineux doit être compressé');
    assert.ok(entries[1].compressedSize < entries[1].size / 4);
    assert.equal(entries[1].data.toString(), big);
    assert.equal(entries[2].method, 0, 'une entrée minuscule reste stockée');
    assert.equal(entries[3].method, 0, 'une image (déjà compressée) reste stockée');
    assert.ok(zip.length < big.length * 2);
});

test('zip : accepté par les outils standards', (t) => {
    const probe = spawnSync('python3', ['-c', 'import zipfile']);
    if (probe.status !== 0) return t.skip('python3 indisponible');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecrivain-zip-'));
    try {
        const file = path.join(dir, 'a.zip');
        fs.writeFileSync(file, makeZip([
            { name: 'mimetype', data: 'application/vnd.oasis.opendocument.text' },
            { name: 'a/b.xml', data: '<x>'.repeat(500) }
        ]));
        const result = spawnSync('python3', ['-c', 'import sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert z.namelist()[0] == "mimetype"; assert z.getinfo("mimetype").compress_type == 0', file]);
        assert.equal(result.status, 0, String(result.stderr));
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('zip : une archive corrompue est refusée à la lecture', () => {
    const zip = makeZip([{ name: 'a.txt', data: 'bonjour bonjour bonjour bonjour bonjour bonjour bonjour bonjour bonjour' }]);
    const broken = Buffer.from(zip);
    broken[40] ^= 0xFF; // un octet du contenu
    assert.throws(() => readZip(broken));
    assert.throws(() => readZip(Buffer.from('pas un zip')));
});
