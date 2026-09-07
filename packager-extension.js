'use strict';

const fs = require('node:fs');
const path = require('node:path');

const sourceDir = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (!sourceDir || !fs.existsSync(sourceDir)) {
    console.error('Usage : node packager-extension.js <dossier-extension> [fichier-sortie]');
    process.exit(1);
}

function read(file, required = true) {
    const target = path.join(sourceDir, file);
    if (!fs.existsSync(target)) {
        if (required) throw new Error(`Fichier manquant : ${file}`);
        return '';
    }
    return fs.readFileSync(target, 'utf8');
}

try {
    const manifest = JSON.parse(read('manifest.json'));
    const code = read('plugin.js');
    const style = read('style.css', false);
    const pkg = {
        format: 'ecrivain-plugin',
        packageVersion: 1,
        manifest,
        code,
        style
    };
    const defaultName = `${manifest.id || path.basename(sourceDir)}.ecrivain-plugin`;
    const output = process.argv[3] ? path.resolve(process.argv[3]) : path.join(path.dirname(sourceDir), defaultName);
    fs.writeFileSync(output, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
    console.log(`Extension créée : ${output}`);
} catch (error) {
    console.error(`Erreur : ${error.message}`);
    process.exit(1);
}
