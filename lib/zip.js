'use strict';

/*
 * Écrivain — fabrication de fichiers ZIP (DOCX, ODT, EPUB, rapport de diagnostic).
 *
 * Les entrées sont compressées en « deflate » (zlib, intégré à Node), sauf :
 *  - le fichier « mimetype » des EPUB/ODT, qui doit rester non compressé et
 *    placé en premier ;
 *  - les images déjà compressées (PNG, JPEG, WebP…) ;
 *  - les entrées que la compression ferait grossir.
 */

const zlib = require('node:zlib');

const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(buffer) {
    let crc = 0xFFFFFFFF;
    for (const byte of buffer) crc = CRC32_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    const time = ((date.getHours() & 0x1F) << 11) | ((date.getMinutes() & 0x3F) << 5) | ((Math.floor(date.getSeconds() / 2)) & 0x1F);
    const day = ((year - 1980) << 9) | (((date.getMonth() + 1) & 0x0F) << 5) | (date.getDate() & 0x1F);
    return { time, day };
}

const ALREADY_COMPRESSED = /\.(?:png|jpe?g|gif|webp|woff2?|zip|epub|docx|odt|pdf|mp3|mp4)$/i;
const MIN_COMPRESSIBLE_BYTES = 64;
const MAX_ENTRIES = 0xFFFF;
const MAX_BYTES = 0xFFFFFFFF;

function shouldStore(entry, data) {
    if (entry.store === true) return true;
    if (entry.store === false) return false;
    if (entry.name === 'mimetype') return true;
    if (ALREADY_COMPRESSED.test(entry.name)) return true;
    return data.length < MIN_COMPRESSIBLE_BYTES;
}

/**
 * @param {Array<{name: string, data: Buffer|string, store?: boolean}>} entries
 * @returns {Buffer}
 */
function makeZip(entries) {
    if (!Array.isArray(entries)) throw new TypeError('makeZip attend un tableau d’entrées.');
    if (entries.length > MAX_ENTRIES) throw new Error('Trop de fichiers pour une archive ZIP.');

    const locals = [];
    const centrals = [];
    let offset = 0;
    const stamp = dosDateTime();

    for (const entry of entries) {
        const name = Buffer.from(String(entry.name).replace(/\\/g, '/'), 'utf8');
        const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8');
        const crc = crc32(data);

        let method = 0;
        let payload = data;
        if (!shouldStore(entry, data)) {
            const deflated = zlib.deflateRawSync(data, { level: 9 });
            if (deflated.length < data.length) {
                method = 8;
                payload = deflated;
            }
        }
        if (data.length > MAX_BYTES || offset + payload.length > MAX_BYTES) {
            throw new Error('L’archive dépasse la taille maximale du format ZIP classique (4 Go).');
        }

        const flags = 0x0800; // noms de fichiers en UTF-8

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(flags, 6);
        local.writeUInt16LE(method, 8);
        local.writeUInt16LE(stamp.time, 10);
        local.writeUInt16LE(stamp.day, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(payload.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(name.length, 26);
        local.writeUInt16LE(0, 28);
        locals.push(local, name, payload);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(flags, 8);
        central.writeUInt16LE(method, 10);
        central.writeUInt16LE(stamp.time, 12);
        central.writeUInt16LE(stamp.day, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(payload.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt16LE(0, 30);
        central.writeUInt16LE(0, 32);
        central.writeUInt16LE(0, 34);
        central.writeUInt16LE(0, 36);
        central.writeUInt32LE(0, 38);
        central.writeUInt32LE(offset, 42);
        centrals.push(central, name);
        offset += local.length + name.length + payload.length;
    }

    const centralBuffer = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralBuffer.length, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20);
    return Buffer.concat([...locals, centralBuffer, end]);
}

/**
 * Lecture minimale d'une archive produite par makeZip (utilisée par les tests
 * et pour vérifier un export sans dépendance externe).
 * @returns {Array<{name: string, method: number, compressedSize: number, size: number, data: Buffer}>}
 */
function readZip(buffer) {
    const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (eocd < 0) throw new Error('Archive ZIP invalide : fin de répertoire introuvable.');
    const count = buffer.readUInt16LE(eocd + 10);
    let pos = buffer.readUInt32LE(eocd + 16);
    const result = [];
    for (let index = 0; index < count; index += 1) {
        if (buffer.readUInt32LE(pos) !== 0x02014b50) throw new Error('Archive ZIP invalide : entrée centrale corrompue.');
        const method = buffer.readUInt16LE(pos + 10);
        const expectedCrc = buffer.readUInt32LE(pos + 16);
        const compressedSize = buffer.readUInt32LE(pos + 20);
        const size = buffer.readUInt32LE(pos + 24);
        const nameLength = buffer.readUInt16LE(pos + 28);
        const extraLength = buffer.readUInt16LE(pos + 30);
        const commentLength = buffer.readUInt16LE(pos + 32);
        const localOffset = buffer.readUInt32LE(pos + 42);
        const name = buffer.slice(pos + 46, pos + 46 + nameLength).toString('utf8');
        const localNameLength = buffer.readUInt16LE(localOffset + 26);
        const localExtraLength = buffer.readUInt16LE(localOffset + 28);
        const start = localOffset + 30 + localNameLength + localExtraLength;
        const raw = buffer.slice(start, start + compressedSize);
        const data = method === 8 ? zlib.inflateRawSync(raw) : raw;
        if (data.length !== size) throw new Error(`Archive ZIP invalide : taille inattendue pour ${name}.`);
        if (crc32(data) !== expectedCrc) throw new Error(`Archive ZIP invalide : somme de contrôle incorrecte pour ${name}.`);
        result.push({ name, method, compressedSize, size, data });
        pos += 46 + nameLength + extraLength + commentLength;
    }
    return result;
}

module.exports = { crc32, dosDateTime, makeZip, readZip };
