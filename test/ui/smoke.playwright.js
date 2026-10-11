'use strict';

/*
 * Test de fumée de l'interface complète (facultatif, non lancé par « npm test »).
 *
 * Le vrai code de l'interface (index.html + scripts) tourne dans Chromium. Le pont
 * « preload.js » est exécuté tel quel, et ses appels sont routés vers les vrais
 * gestionnaires IPC de main.js (faux module « electron », dossier temporaire réel).
 * Le test échoue à la moindre erreur JavaScript, violation de la politique de
 * sécurité du contenu (CSP) ou requête réseau inattendue.
 *
 * Prérequis : npm install --no-save playwright && npx playwright install chromium
 * Lancement  : npm run test:ui
 */

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { createHarness } = require('../helpers/mock-electron');

let playwright;
try { playwright = require('playwright'); } catch (_) {
    try { playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core'); } catch (error) {
        console.error('Playwright est introuvable : npm install --no-save playwright');
        process.exit(2);
    }
}

const ROOT = path.resolve(__dirname, '..', '..');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

async function main() {
    const h = createHarness();
    const failures = [];
    const problems = [];
    const check = async (label, fn) => {
        try { await fn(); console.log(`  ok   ${label}`); } catch (error) {
            failures.push(label);
            console.log(`  ÉCHEC ${label}\n       ${String(error.message).split('\n')[0]}`);
        }
    };

    // --- Projet de départ -------------------------------------------------------
    h.answers.open.push({ canceled: false, filePaths: [h.projects] });
    const created = await h.invoke('project:create', { title: 'Roman de test', author: 'A. Auteur' });
    const projectDir = created.projectDir;
    const one = await h.invoke('chapter:create', { title: 'Un', parent: null });
    const sub = await h.invoke('chapter:create', { title: 'Un bis', parent: one.id });
    const two = await h.invoke('chapter:create', { title: 'Deux', parent: null });
    const hostile = await h.invoke('chapter:create', { title: 'Piégé', parent: null });
    await h.invoke('chapter:save', { ...one, content: '<p>Premier chapitre, quelques mots.</p>' });
    await h.invoke('chapter:save', { ...sub, content: '<p>Sous-chapitre.</p>' });
    await h.invoke('chapter:save', { ...two, content: '<p>Deuxième chapitre.</p>' });
    // Un projet reçu d'un tiers : contenu hostile écrit directement sur le disque.
    const hostileFile = path.join(projectDir, 'chapters', `${hostile.id}.json`);
    const hostileData = readJson(hostileFile);
    hostileData.content = '<p>Texte <b>gras</b></p><img src="x" onerror="window.__pwned=1"><script>window.__pwned=2</script><iframe src="https://example.invalid/"></iframe><a href="javascript:window.__pwned=3">lien</a><p style="position:fixed;background:url(https://example.invalid/x)">stylé</p>';
    fs.writeFileSync(hostileFile, JSON.stringify(hostileData));
    await h.invoke('preferences:save', { startupBehavior: 'last-project' });

    // --- Navigateur --------------------------------------------------------------
    const browser = await playwright.chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
    page.on('console', (msg) => { if (msg.type() === 'error' || /Content Security Policy|Refused to/i.test(msg.text())) problems.push(`console: ${msg.text()}`); });
    page.on('requestfailed', (request) => { if (!/^(file|data|blob):/.test(request.url())) problems.push(`requête bloquée : ${request.url()}`); });
    await context.route(/^https?:/, (route) => { problems.push(`requête réseau inattendue : ${route.request().url()}`); return route.abort(); });
    page.on('dialog', (dialog) => { problems.push(`boîte de dialogue inattendue : ${dialog.message()}`); return dialog.dismiss(); });

    const flushDone = [];
    await page.exposeFunction('__ipcInvoke', async (channel, args) => {
        try { return { ok: true, value: await h.invoke(channel, ...args) }; } catch (error) { return { ok: false, message: error.message }; }
    });
    await page.exposeFunction('__ipcSend', (channel) => { if (channel === 'app:flushDone') flushDone.push(Date.now()); });

    const preloadSource = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
    await page.addInitScript(`(() => {
        const listeners = {};
        const electron = {
            contextBridge: { exposeInMainWorld: (name, api) => { window[name] = api; } },
            ipcRenderer: {
                invoke: async (channel, ...args) => {
                    const reply = await window.__ipcInvoke(channel, args);
                    if (!reply.ok) throw new Error(reply.message);
                    return reply.value;
                },
                send: (channel, ...args) => { window.__ipcSend(channel, args); },
                on: (channel, handler) => { (listeners[channel] = listeners[channel] || []).push(handler); },
                removeListener: (channel, handler) => { listeners[channel] = (listeners[channel] || []).filter((item) => item !== handler); }
            }
        };
        window.__emit = (channel, ...args) => (listeners[channel] || []).forEach((handler) => handler({}, ...args));
        const require = (name) => { if (name === 'electron') return electron; throw new Error('require ' + name); };
        ${preloadSource}
    })();`);

    await page.goto(pathToFileURL(path.join(ROOT, 'index.html')).href);

    await check('le dernier projet s’ouvre et la liste des chapitres s’affiche', async () => {
        await page.waitForSelector('.chapter-item', { timeout: 10000 });
        assert.equal(await page.locator('.chapter-item').count(), 4);
    });

    await check('contenu hostile : rien ne s’exécute, rien n’est conservé dans la page', async () => {
        await page.locator(`.chapter-item[data-id="${hostile.id}"]`).click();
        await page.waitForFunction(() => document.getElementById('chapterContent').textContent.includes('Texte gras'));
        const dom = await page.evaluate(() => {
            const root = document.getElementById('chapterContent');
            return {
                pwned: window.__pwned,
                dangerous: root.querySelectorAll('script,iframe,img[onerror],object,embed').length,
                onAttrs: [...root.querySelectorAll('*')].filter((el) => [...el.attributes].some((a) => /^on/i.test(a.name))).length,
                jsHref: [...root.querySelectorAll('a')].some((a) => /^javascript:/i.test(a.getAttribute('href') || '')),
                style: root.innerHTML.includes('position') || root.innerHTML.includes('example.invalid')
            };
        });
        assert.equal(dom.pwned, undefined);
        assert.deepEqual({ ...dom, pwned: undefined }, { pwned: undefined, dangerous: 0, onAttrs: 0, jsHref: false, style: false });
    });

    await check('saisie puis demande de fermeture : tout est écrit avant l’accusé', async () => {
        await page.locator(`.chapter-item[data-id="${two.id}"]`).click();
        await page.waitForFunction(() => document.getElementById('chapterContent').textContent.includes('Deuxième'));
        await page.locator('#chapterContent').click();
        await page.keyboard.press('Control+End');
        await page.keyboard.type(' Ajout tapé juste avant la fermeture.');
        const before = flushDone.length;
        await page.evaluate(() => window.__emit('app:flush-request'));
        const deadline = Date.now() + 8000;
        while (flushDone.length === before && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
        assert.ok(flushDone.length > before, 'accusé app:flushDone reçu');
        const saved = readJson(path.join(projectDir, 'chapters', `${two.id}.json`));
        assert.match(saved.content, /Ajout tapé juste avant la fermeture/);
        assert.ok(saved.wordCount >= 8);
    });

    await check('menu contextuel : « Exclure de l’export » s’enregistre et se coche', async () => {
        await page.locator(`.chapter-item[data-id="${two.id}"]`).click({ button: 'right' });
        await page.locator('#chapterContextMenu [data-context-action="toggle-export"]').click();
        const deadline = Date.now() + 5000;
        let stored;
        while (Date.now() < deadline) {
            stored = readJson(path.join(projectDir, 'chapters', `${two.id}.json`));
            if (stored.excludeFromExport === true) break;
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        assert.equal(stored.excludeFromExport, true);
        await page.locator(`.chapter-item[data-id="${two.id}"]`).click({ button: 'right' });
        assert.equal(await page.locator('#chapterContextMenu [data-context-action="toggle-export"]').getAttribute('aria-checked'), 'true');
        await page.keyboard.press('Escape');
    });

    await check('suppression : confirmation explicite, chapitre déplacé dans la corbeille', async () => {
        await page.locator(`.chapter-item[data-id="${sub.id}"]`).click({ button: 'right' });
        await page.locator('#chapterContextMenu [data-context-action="delete"]').click();
        await page.waitForSelector('#modalBackdrop:not([hidden])');
        const title = await page.locator('#modalTitle').textContent();
        assert.match(title, /corbeille/i);
        assert.match(await page.locator('#modalConfirm').textContent(), /corbeille/i);
        await page.locator('#modalConfirm').click();
        await page.waitForSelector(`.chapter-item[data-id="${sub.id}"]`, { state: 'detached' });
        const trash = await h.invoke('trash:state');
        assert.equal(trash.items.length, 1);
    });

    await check('écran Corbeille : l’élément est listé puis restauré', async () => {
        await page.evaluate(() => window.__emit('menu:action', 'feature:trash'));
        await page.waitForSelector('#trashGrid .trash-card');
        assert.equal(await page.locator('#trashGrid .trash-card').count(), 1);
        assert.equal(await page.locator('#trashPanel').isVisible(), true);
        await page.locator('#trashGrid .trash-card button.button-primary').click();
        await page.waitForSelector('#trashGrid .trash-card', { state: 'detached' });
        assert.ok(fs.existsSync(path.join(projectDir, 'chapters', `${sub.id}.json`)));
    });

    await check('écran Sauvegardes : création manuelle et affichage', async () => {
        await page.evaluate(() => window.__emit('menu:action', 'feature:backups'));
        await page.waitForSelector('#backupsCreateBtn', { state: 'visible' });
        await page.locator('#backupsCreateBtn').click();
        await page.waitForSelector('#backupsGrid .backup-card');
        assert.equal(await page.locator('#backupsGrid .backup-card').count(), 1);
        assert.match(await page.locator('#backupsQuota').textContent(), /5 manuelles et 5 automatiques/);
    });

    await check('configuration du document : pagination et chapitres exportés enregistrés', async () => {
        await page.evaluate(() => window.__emit('menu:action', 'project:layout'));
        await page.waitForSelector('#modalBackdrop:not([hidden]) .settings-group');
        const body = await page.locator('#modalBody').textContent();
        assert.match(body, /Numéroter les pages/);
        assert.match(body, /En-tête courant/);
        assert.match(body, /Chapitres exportés/);
        const checkbox = page.locator('#modalBody label', { hasText: /Numéroter les pages/ }).locator('input[type="checkbox"]');
        await checkbox.uncheck();
        await page.locator('#modalBody select').last().waitFor();
        await page.locator('#modalConfirm').click();
        const deadline = Date.now() + 5000;
        let project;
        while (Date.now() < deadline) {
            project = readJson(path.join(projectDir, 'project.json'));
            if (project.pageNumbers === false) break;
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        assert.equal(project.pageNumbers, false);
        assert.deepEqual(project.exportExcludeStatuses, ['cut']);
    });

    await check('bouton « Typo FR » et tiret de dialogue : mêmes règles que les exports, enregistrées', async () => {
        await page.evaluate(() => window.__emit('menu:action', 'project:verify'));
        await page.waitForTimeout(300);
        await page.locator(`.chapter-item[data-id="${one.id}"]`).click();
        await page.waitForFunction(() => document.getElementById('chapterContent').textContent.includes('Premier'));
        await page.locator('#chapterContent').click();
        await page.keyboard.press('Control+A');
        await page.keyboard.type("Il dit: « oui » ; bien ?! Rendez-vous à 12:30 sur https://exemple.fr/a?b=1 aujourd'hui...");
        await page.locator('#normalizeTypography').click();
        const text = await page.locator('#chapterContent').evaluate((el) => el.textContent);
        assert.ok(text.includes('dit\u00A0:'), 'espace insécable avant « : »');
        assert.ok(text.includes('\u202F;'), 'espace fine insécable avant « ; »');
        assert.ok(text.includes('?!') && text.includes('\u202F?!'), 'une seule espace fine avant « ?! »');
        assert.ok(text.includes('12:30'), 'l’heure est intacte');
        assert.ok(text.includes('https://exemple.fr/a?b=1'), 'l’adresse web est intacte');
        assert.ok(text.includes('aujourd’hui…'), 'apostrophe et points de suspension typographiques');
        await page.locator('#insertDialogueDash').click();
        const before = flushDone.length;
        await page.evaluate(() => window.__emit('app:flush-request'));
        const deadline = Date.now() + 8000;
        while (flushDone.length === before && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
        const saved = readJson(path.join(projectDir, 'chapters', `${one.id}.json`));
        assert.ok(saved.content.includes('12:30'));
        assert.equal(saved.wcv, 2);
        assert.ok(saved.wordCount >= 10);
    });

    await check('toutes les vues et fenêtres s’ouvrent sans erreur', async () => {
        const actions = ['feature:globalSynopsis', 'feature:synopsis', 'feature:notes', 'feature:timeline', 'feature:mindmap', 'feature:stats',
            'feature:history', 'feature:backups', 'feature:trash', 'tool:search', 'tool:ai', 'tool:plugins', 'tool:preferences',
            'help:guide', 'help:shortcuts', 'help:systemInfo', 'help:about', 'project:info', 'project:layout'];
        for (const action of actions) {
            await page.evaluate((name) => window.__emit('menu:action', name), action);
            await page.waitForTimeout(350);
            // Referme une éventuelle fenêtre modale avant l'action suivante.
            for (const selector of ['#modalBackdrop:not([hidden]) #modalCancel', '#settingsInfoBackdrop:not([hidden]) button']) {
                const button = page.locator(selector).first();
                if (await button.count()) await button.click({ timeout: 2000 }).catch(() => {});
            }
        }
        await page.evaluate(() => window.__emit('menu:action', 'feature:stats'));
        await page.waitForTimeout(300);
        assert.equal(await page.locator('#statsView').isVisible(), true);
    });

    await check('aucune erreur JavaScript, aucune violation de CSP, aucune requête réseau', async () => {
        assert.deepEqual(problems, []);
    });

    await browser.close();
    h.cleanup();
    if (failures.length) {
        console.error(`\n${failures.length} vérification(s) en échec.`);
        process.exit(1);
    }
    console.log('\nInterface : toutes les vérifications passent.');
}

main().catch((error) => { console.error(error); process.exit(1); });
