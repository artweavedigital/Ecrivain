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

function collectResources(dir, prefix = '') {
    const resources = {};
    if (!fs.existsSync(dir)) return resources;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            Object.assign(resources, collectResources(absolute, relative));
        } else if (entry.isFile()) {
            resources[relative.replace(/\\/g, '/')] = fs.readFileSync(absolute).toString('base64');
        }
    }
    return resources;
}

try {
    const manifest = JSON.parse(read('manifest.json'));
    const code = read('plugin.js');
    const style = read('style.css', false);
    const resources = collectResources(path.join(sourceDir, 'resources'));
    const pkg = {
        format: 'ecrivain-plugin',
        packageVersion: 1,
        manifest,
        code,
        style,
        resources
    };
    const defaultName = `${manifest.id || path.basename(sourceDir)}.ecrivain-plugin`;
    const output = process.argv[3] ? path.resolve(process.argv[3]) : path.join(path.dirname(sourceDir), defaultName);
    fs.writeFileSync(output, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
    console.log(`Extension créée : ${output}`);
} catch (error) {
    console.error(`Erreur : ${error.message}`);
    process.exit(1);
}
