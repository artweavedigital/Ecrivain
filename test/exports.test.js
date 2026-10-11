'use strict';

/*
 * Exports : sélection des chapitres, pagination (DOCX, ODT, PDF), EPUB.
 * Les tests passent par les vrais gestionnaires IPC (« export:* ») et relisent
 * les fichiers produits.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness } = require('./helpers/mock-electron');
const { readZip } = require('../lib/zip');

async function newBook(h, settings = {}) {
    h.answers.open.push({ canceled: false, filePaths: [h.projects] });
    await h.invoke('project:create', { title: 'Le Livre & « Cie »', author: 'A. Auteur' });
    if (Object.keys(settings).length) await h.invoke('project:updateLayout', settings);

    const one = await h.invoke('chapter:create', { title: 'Un', parent: null });
    const sub = await h.invoke('chapter:create', { title: 'Un bis', parent: one.id });
    const two = await h.invoke('chapter:create', { title: 'Deux', parent: null });
    const cut = await h.invoke('chapter:create', { title: 'Scène coupée', parent: null });
    const hidden = await h.invoke('chapter:create', { title: 'Brouillon caché', parent: null });
    const hiddenChild = await h.invoke('chapter:create', { title: 'Enfant du caché', parent: hidden.id });
    await h.invoke('chapter:save', { ...one, content: '<p>— Bonjour, dit-il : « tout va bien ? »</p><p>La 2<sup>e</sup> fois.</p>', status: 'final' });
    await h.invoke('chapter:save', { ...sub, content: '<p>Sous-chapitre visible.</p>', status: 'final' });
    await h.invoke('chapter:save', { ...two, content: '<p>Deuxième chapitre.</p>', status: 'writing' });
    await h.invoke('chapter:save', { ...cut, content: '<p>Texte coupé.</p>', status: 'cut' });
    await h.invoke('chapter:save', { ...hidden, content: '<p>Texte exclu.</p>', status: 'draft' });
    await h.invoke('chapter:save', { ...hiddenChild, content: '<p>Texte de l’enfant exclu.</p>', status: 'final' });
    await h.invoke('chapter:setExcluded', hidden.id, true);
    return { one, sub, two, cut, hidden, hiddenChild };
}

async function exportTo(h, channel, name) {
    const filePath = path.join(h.root, name);
    h.answers.save.push({ canceled: false, filePath });
    const result = await h.invoke(channel);
    assert.equal(result.canceled, false);
    return { result, buffer: fs.readFileSync(filePath), filePath };
}

const entryText = (zip, name) => {
    const entry = zip.find((e) => e.name === name);
    assert.ok(entry, `entrée manquante : ${name}`);
    return entry.data.toString('utf8');
};

// Petit contrôle d'équilibre des balises XML (pas d'analyseur XML dans Node) ;
// la validation complète est faite par les outils externes (voir RELEASE-CHECKLIST.md).
function assertBalancedXml(xml, label) {
    const stack = [];
    const tag = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
    const cleaned = xml.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!DOCTYPE[^>]*>/gi, '');
    let match;
    let last = 0;
    while ((match = tag.exec(cleaned)) !== null) {
        const between = cleaned.slice(last, match.index);
        assert.ok(!/</.test(between), `${label} : « < » inattendu près de ${between.slice(0, 40)}`);
        last = tag.lastIndex;
        const [, closing, name, , selfClosing] = match;
        if (selfClosing) continue;
        if (closing) assert.equal(stack.pop(), name, `${label} : balise fermante inattendue </${name}>`);
        else stack.push(name);
    }
    assert.deepEqual(stack, [], `${label} : balises non fermées`);
}

test('sélection : « Coupé » et « Exclure de l’export » sont écartés avec leurs sous-chapitres', async (t) => {
    const h = createHarness();
    t.after(h.cleanup);
    await newBook(h);
    const state = await h.invoke('project:verify');
    const { chapters, excluded } = h.internals.selectChaptersForExport(state.state.project, state.state.chapters);
    assert.deepEqual(chapters.map((c) => c.title), ['Un', 'Un bis', 'Deux']);
    assert.equal(excluded, 3, 'Scène coupée, Brouillon caché et son enfant');

    // Réglage : « Brouillon » exclu à son tour ; « Coupé » réintégré.
    const custom = h.internals.selectChaptersForExport({ ...state.state.project, exportExcludeStatuses: ['draft'] }, state.state.chapters);
    assert.ok(custom.chapters.some((c) => c.title === 'Scène coupée'));
});

test('EPUB : identifiant stable, sommaire imbriqué, exclusions, mimetype non compressé en premier', async (t) => {
    const h = createHarness();
    t.after(h.cleanup);
    await newBook(h);
    const first = await exportTo(h, 'export:epub', 'a.epub');
    const second = await exportTo(h, 'export:epub', 'b.epub');
    assert.equal(first.result.excluded, 3);

    const zip = readZip(first.buffer);
    assert.equal(zip[0].name, 'mimetype');
    assert.equal(zip[0].method, 0, 'mimetype doit être stocké sans compression');
    assert.equal(zip[0].data.toString(), 'application/epub+zip');

    const opf = entryText(zip, 'OEBPS/content.opf');
    const opf2 = entryText(readZip(second.buffer), 'OEBPS/content.opf');
    const id = /<dc:identifier id="bookid">(urn:uuid:[0-9a-f-]{36})<\/dc:identifier>/.exec(opf);
    assert.ok(id, 'identifiant urn:uuid');
    assert.equal(/<dc:identifier id="bookid">([^<]+)</.exec(opf2)[1], id[1], 'même livre, même identifiant');
    const project = (await h.invoke('project:verify')).state.project;
    assert.equal(id[1], `urn:uuid:${project.uuid}`);
    assert.match(opf, /<dc:language>fr<\/dc:language>/);
    assert.match(opf, /<dc:title>Le Livre &amp; « Cie »<\/dc:title>/);
    assert.match(opf, /<meta property="dcterms:modified">\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z<\/meta>/);

    const chapterFiles = zip.filter((e) => /^OEBPS\/chapter-\d+\.xhtml$/.test(e.name));
    assert.equal(chapterFiles.length, 3);
    const all = chapterFiles.map((e) => e.data.toString('utf8')).join('\n');
    assert.ok(!/Texte coupé|Texte exclu|Texte de l’enfant exclu/.test(all));
    assert.match(all, /Sous-chapitre visible/);

    const nav = entryText(zip, 'OEBPS/nav.xhtml');
    assert.match(nav, /epub:type="toc"/);
    assert.match(nav, /<li><a href="chapter-001\.xhtml">Un<\/a><ol>\s*<li><a href="chapter-002\.xhtml">Un bis<\/a><\/li><\/ol><\/li>/, 'le sous-chapitre est imbriqué dans le sommaire');
    assert.ok(!/Scène coupée|Brouillon caché/.test(nav));

    for (const entry of zip) {
        if (/\.(xhtml|opf|xml)$/.test(entry.name)) assertBalancedXml(entry.data.toString('utf8'), entry.name);
    }
});

test('DOCX : numéros de page, page de titre vierge, en-têtes courants, exclusions', async (t) => {
    const h = createHarness();
    t.after(h.cleanup);
    await newBook(h);
    const plain = await exportTo(h, 'export:docx', 'a.docx');
    assert.equal(plain.result.excluded, 3);
    let zip = readZip(plain.buffer);
    const document = entryText(zip, 'word/document.xml');
    assert.ok(!/Scène coupée|Texte coupé|Brouillon caché|Texte exclu/.test(document));
    assert.match(document, /Sous-chapitre visible/);
    assert.match(document, /<w:titlePg\/>/, 'la page de titre est exclue de la pagination visible');
    assert.match(document, /<w:footerReference w:type="default"/);
    assert.ok(!/w:footerReference w:type="first"/.test(document), 'pas de pied de page propre à la première page : elle reste vierge');
    assert.ok(!/w:evenAndOddHeaders/.test(zip.find((e) => e.name === 'word/settings.xml')?.data.toString('utf8') || ''));
    const footer = entryText(zip, 'word/footer1.xml');
    assert.match(footer, /<w:instrText xml:space="preserve"> PAGE <\/w:instrText>/);
    const names = zip.map((e) => e.name);
    assert.ok(!names.includes('word/header1.xml'), 'sans en-tête courant, aucune partie d’en-tête');
    const types = entryText(zip, '[Content_Types].xml');
    const rels = entryText(zip, 'word/_rels/document.xml.rels');
    for (const name of names.filter((n) => /^word\/(header|footer)\d+\.xml$/.test(n))) {
        assert.ok(types.includes(`/${name}"`), `${name} déclaré dans [Content_Types].xml`);
        assert.ok(rels.includes(`Target="${path.basename(name)}"`), `${name} déclaré dans les relations`);
    }
    for (const entry of zip) if (/\.(xml|rels)$/.test(entry.name)) assertBalancedXml(entry.data.toString('utf8'), entry.name);

    // En-têtes courants « auteur / titre » en pages paire/impaire.
    await h.invoke('project:updateLayout', { runningHeader: 'author-title' });
    const mirrored = await exportTo(h, 'export:docx', 'b.docx');
    zip = readZip(mirrored.buffer);
    assert.match(entryText(zip, 'word/settings.xml'), /<w:evenAndOddHeaders\/>/);
    const headers = zip.filter((e) => /^word\/header\d+\.xml$/.test(e.name)).map((e) => e.data.toString('utf8')).join('\n');
    assert.match(headers, /Le Livre &amp; «.Cie.»/, 'guillemets français avec espaces insécables');
    assert.match(headers, /A\. Auteur/);
    for (const entry of zip) if (/\.(xml|rels)$/.test(entry.name)) assertBalancedXml(entry.data.toString('utf8'), entry.name);

    // Pagination désactivée : pas de pied de page numéroté.
    await h.invoke('project:updateLayout', { pageNumbers: false, runningHeader: 'none' });
    const bare = readZip((await exportTo(h, 'export:docx', 'c.docx')).buffer);
    assert.ok(!bare.some((e) => /^word\/footer\d+\.xml$/.test(e.name) && /PAGE/.test(e.data.toString('utf8'))));
});

test('ODT : pied de page numéroté, page de titre vierge, en-têtes miroir', async (t) => {
    const h = createHarness();
    t.after(h.cleanup);
    await newBook(h, { runningHeader: 'author-title' });
    const { buffer, result } = await exportTo(h, 'export:odt', 'a.odt');
    assert.equal(result.excluded, 3);
    const zip = readZip(buffer);
    assert.equal(zip[0].name, 'mimetype');
    assert.equal(zip[0].method, 0);
    const styles = entryText(zip, 'styles.xml');
    assert.match(styles, /<style:footer>.*<text:page-number text:select-page="current">/s);
    assert.match(styles, /<style:header-first>/);
    assert.match(styles, /<style:header-left>.*A\. Auteur/s);
    const content = entryText(zip, 'content.xml');
    assert.ok(!/Texte coupé|Texte exclu/.test(content));
    for (const entry of zip) if (/\.xml$/.test(entry.name)) assertBalancedXml(entry.data.toString('utf8'), entry.name);
});

test('PDF (HTML d’impression) : numéros de page, page de titre sans numéro, CSP stricte', async (t) => {
    const h = createHarness();
    t.after(h.cleanup);
    await newBook(h, { runningHeader: 'title' });
    const state = (await h.invoke('project:verify')).state;
    const selection = h.internals.selectChaptersForExport(state.project, state.chapters);
    const html = h.internals.buildPrintHtml(state.project, selection.chapters);
    assert.match(html, /@page \{ size: 12cm 19cm; margin: 15mm 15mm 15mm 15mm; \}/, 'une mise à jour partielle des réglages ne réduit pas la page');
    assert.match(html, /@bottom-center \{ content: counter\(page\);/);
    assert.match(html, /@page :first \{ @top-center \{ content: none; \} @bottom-center \{ content: none; \} \}/);
    assert.match(html, /@top-center \{ content: "Le Livre & «.Cie.»"/);
    assert.match(html, /http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"/);
    assert.ok(!/Texte coupé|Texte exclu/.test(html));

    const off = h.internals.buildPrintHtml({ ...state.project, pageNumbers: false, runningHeader: 'none' }, selection.chapters);
    assert.ok(!/counter\(page\)/.test(off));
    assert.ok(!/@page :first/.test(off), 'rien à masquer sur la page de titre');

    // Un titre hostile ne sort pas de la chaîne CSS ni de la page.
    const hostile = h.internals.buildPrintHtml({ ...state.project, title: 'x"; } </style><script>alert(1)</script>', runningHeader: 'title' }, selection.chapters);
    assert.ok(!/<script>/i.test(hostile));
    assert.ok(!/content: "x"; \}/.test(hostile));
});

test('export Markdown : mêmes exclusions et compteur renvoyé', async (t) => {
    const h = createHarness();
    t.after(h.cleanup);
    await newBook(h);
    const { buffer, result } = await exportTo(h, 'export:markdown', 'a.md');
    const text = buffer.toString('utf8');
    assert.equal(result.excluded, 3);
    assert.match(text, /Sous-chapitre visible/);
    assert.ok(!/Texte coupé|Texte exclu/.test(text));
});

test('annuler la boîte d’enregistrement n’écrit rien', async (t) => {
    const h = createHarness();
    t.after(h.cleanup);
    await newBook(h);
    h.answers.save.push({ canceled: true });
    assert.deepEqual(await h.invoke('export:epub'), { canceled: true });
});

// ---------------------------------------------------------------------------
// Espaces insécables ordinaires (U+00A0) dans les fichiers destinés à la mise en page
// ---------------------------------------------------------------------------

const NBSP = '\u00a0';
const NNBSP = '\u202f';

async function typoBook(h) {
    h.answers.open.push({ canceled: false, filePaths: [h.projects] });
    await h.invoke('project:create', { title: 'Qui es-tu ? « Cie »', author: 'A. Auteur' });
    await h.invoke('project:updateLayout', { runningHeader: 'title' });
    const chapter = await h.invoke('chapter:create', { title: 'Et alors ?', parent: null });
    await h.invoke('chapter:save', { ...chapter, status: 'final', content: '<p>— Vraiment ? dit-il ; non ! Voici : « oui ». 5 % de 10 €.</p><p>Quoi?! Ah!</p>' });
    return chapter;
}

test('espaces insécables : U+00A0 dans les fichiers Word, OpenDocument et Markdown', async (t) => {
    const h = createHarness();
    t.after(h.cleanup);
    await typoBook(h);
    const docx = await exportTo(h, 'export:docx', 'a.docx');
    const docxZip = readZip(docx.buffer);
    const odt = await exportTo(h, 'export:odt', 'a.odt');
    const odtZip = readZip(odt.buffer);
    const md = await exportTo(h, 'export:markdown', 'a.md');
    const outputs = {
        docx: ['word/document.xml', 'word/header1.xml'].map((name) => entryText(docxZip, name)).join('\n'),
        odt: ['content.xml', 'styles.xml'].map((name) => entryText(odtZip, name)).join('\n'),
        md: md.buffer.toString('utf8')
    };
    for (const [kind, text] of Object.entries(outputs)) {
        assert.ok(!text.includes(NNBSP), `${kind} : aucune espace fine insécable`);
        assert.ok(text.includes(`Vraiment${NBSP}?`), `${kind} : « ? » précédé d'une espace insécable`);
        assert.ok(text.includes(`dit-il${NBSP};`), `${kind} : « ; » précédé d'une espace insécable`);
        assert.ok(text.includes(`non${NBSP}!`), `${kind} : « ! » précédé d'une espace insécable`);
        assert.ok(text.includes(`Quoi${NBSP}?!`), `${kind} : une seule espace pour « ?! »`);
        assert.ok(text.includes(`Voici${NBSP}:`), `${kind} : « : » précédé d'une espace insécable`);
        assert.ok(text.includes(`«${NBSP}oui${NBSP}»`), `${kind} : espaces insécables dans les guillemets`);
        assert.ok(text.includes(`5${NBSP}%`) && text.includes(`10${NBSP}€`), `${kind} : espace insécable avant % et €`);
    }
    // Titres et en-tête courant de Word et d'OpenDocument.
    for (const kind of ['docx', 'odt']) {
        assert.ok(outputs[kind].includes(`Qui es-tu${NBSP}?`), `${kind} : titre du livre`);
        assert.ok(outputs[kind].includes(`Et alors${NBSP}?`), `${kind} : titre de chapitre`);
    }
});

test('espaces insécables : l’EPUB et le PDF gardent l’espace fine insécable de la bêta.11', async (t) => {
    const h = createHarness();
    t.after(h.cleanup);
    await typoBook(h);
    const epub = readZip((await exportTo(h, 'export:epub', 'a.epub')).buffer);
    const chapter = epub.filter((e) => /^OEBPS\/chapter-\d+\.xhtml$/.test(e.name)).map((e) => e.data.toString('utf8')).join('\n');
    assert.ok(chapter.includes(`Vraiment${NNBSP}?`));
    assert.ok(!chapter.includes(`Vraiment${NBSP}?`));
    const state = (await h.invoke('project:verify')).state;
    const html = h.internals.buildPrintHtml(state.project, h.internals.selectChaptersForExport(state.project, state.chapters).chapters);
    assert.ok(html.includes(`Vraiment${NNBSP}?`));
    assert.ok(!html.includes(`Vraiment${NBSP}?`));
});

test('exports Word, OpenDocument et PDF : un saut de page avant chaque chapitre et sous-chapitre', async (t) => {
    const h = createHarness();
    t.after(h.cleanup);
    await newBook(h);
    const docx = entryText(readZip((await exportTo(h, 'export:docx', 'p.docx')).buffer), 'word/document.xml');
    const paragraph = (title) => docx.match(/<w:p>[\s\S]*?<\/w:p>/g).find((p) => p.includes(`>${title}</w:t>`));
    // Le premier chapitre suit la page de titre : il porte lui aussi un saut de page.
    for (const title of ['Un', 'Un bis', 'Deux']) assert.match(paragraph(title), /<w:pageBreakBefore\/>/, `saut de page avant « ${title} »`);

    const odtStyles = entryText(readZip((await exportTo(h, 'export:odt', 'p.odt')).buffer), 'styles.xml');
    assert.match(odtStyles, /style:name="ChapterTitle"[^>]*><style:paragraph-properties fo:break-before="page"/);
    assert.match(odtStyles, /style:name="SubchapterTitle"[^>]*><style:paragraph-properties fo:break-before="page"/);

    const state = (await h.invoke('project:verify')).state;
    const html = h.internals.buildPrintHtml(state.project, h.internals.selectChaptersForExport(state.project, state.chapters).chapters);
    assert.match(html, /\.chapter:not\(\.first-chapter\) \{ break-before: page; page-break-before: always; \}/);
    assert.match(html, /\.chapter\.first-chapter \{ break-before: page; page-break-before: always; \}/);
});

