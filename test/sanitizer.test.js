'use strict';

/*
 * Nettoyage HTML de l'interface (shared/html-sanitize.js).
 *
 * Le filtre a besoin d'un DOM (DOMParser). Le test utilise « jsdom » s'il est
 * installé, sinon Chromium via Playwright s'il est disponible ; à défaut il est
 * ignoré (et signalé comme tel) plutôt que de passer pour un succès.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { HOSTILE, BENIGN } = require('./fixtures/sanitizer-cases');

const SANITIZER_FILE = path.resolve(__dirname, '..', 'shared', 'html-sanitize.js');

async function createProvider() {
    try {
        const { JSDOM } = require('jsdom');
        const window = new JSDOM('').window;
        global.DOMParser = window.DOMParser;
        const { sanitizeHtml } = require(SANITIZER_FILE);
        return { name: 'jsdom', run: async (html) => sanitizeHtml(html), serialize: async (html) => {
            const div = window.document.createElement('div');
            div.innerHTML = html;
            return div.innerHTML;
        }, close: async () => {} };
    } catch (_) { /* jsdom absent */ }
    try {
        const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
        const browser = await chromium.launch();
        const page = await browser.newPage();
        await page.goto('about:blank');
        await page.addScriptTag({ path: SANITIZER_FILE });
        return {
            name: 'chromium',
            run: (html) => page.evaluate((value) => window.EcrivainSanitize.sanitizeHtml(value), html),
            serialize: (html) => page.evaluate((value) => { const div = document.createElement('div'); div.innerHTML = value; return div.innerHTML; }, html),
            close: () => browser.close()
        };
    } catch (_) { /* Playwright absent */ }
    return null;
}

const DANGEROUS = /<\s*(?:script|iframe|object|embed|svg|math|form|input|meta|base|template|noscript|link|style)\b|\son[a-z]+\s*=|javascript\s*:|vbscript\s*:|evil\.example|position\s*:|expression\s*\(|url\s*\(/i;

test('nettoyage HTML : charges hostiles neutralisées, contenu légitime intact', async (t) => {
    const provider = await createProvider();
    if (!provider) {
        t.skip('ni jsdom ni Playwright : npm install --save-dev jsdom pour activer ce test');
        return;
    }
    t.after(() => provider.close());
    t.diagnostic(`moteur DOM : ${provider.name}`);

    for (const [name, payload] of Object.entries(HOSTILE)) {
        const result = await provider.run(payload);
        assert.ok(!DANGEROUS.test(result.html), `${name} : reste dangereux → ${result.html}`);
        assert.ok(result.removed > 0, `${name} : rien n’a été signalé comme retiré`);
    }

    const benign = await provider.run(BENIGN);
    assert.equal(benign.removed, 0, 'du contenu légitime a été retiré');
    assert.equal(benign.html, await provider.serialize(BENIGN), 'le contenu légitime doit rester identique à la sérialisation du navigateur');

    // Liens : rel ajouté, schémas autorisés conservés.
    const links = await provider.run('<a href="https://exemple.fr">a</a><a href="mailto:x@y.fr">b</a><a href="#note">c</a>');
    assert.match(links.html, /href="https:\/\/exemple\.fr"/);
    assert.match(links.html, /rel="noopener noreferrer"/);
    assert.match(links.html, /href="mailto:x@y\.fr"/);
    assert.match(links.html, /href="#note"/);

    // Contenu Word : balises inconnues déroulées, texte conservé.
    const word = await provider.run('<p class="MsoNormal"><o:p>Texte</o:p> <span style="mso-fareast-font-family:x;font-family:Garamond">suite</span></p>');
    assert.match(word.html, /Texte/);
    assert.match(word.html, /suite/);
    assert.ok(!/mso-/.test(word.html));
});
