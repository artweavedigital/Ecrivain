function textFromHtml(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    return doc.body.textContent || '';
}

function countWords(text) {
    return (String(text || '').trim().match(/\S+/g) || []).length;
}

function countDialogueParagraphs(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const blocks = [...doc.body.querySelectorAll('p, div, blockquote')];
    if (!blocks.length) {
        return String(doc.body.textContent || '').split(/\r?\n/).filter((line) => /^\s*—/.test(line)).length;
    }
    return blocks.filter((block) => /^\s*—/.test(block.textContent || '')).length;
}

function escapeHtml(value) {
    return String(value || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

ecrivain.onCommand('analyser-dialogues', async () => {
    const root = document.getElementById('plugin-root');
    root.innerHTML = `
        <div class="analysis-loading">
            <strong>Lecture du projet…</strong>
            <span>Écrivain rassemble les chapitres et leur contenu.</span>
        </div>
    `;

    const project = await ecrivain.project.getCurrent();
    const chapters = await ecrivain.chapters.readAll();

    if (!chapters.length) {
        root.innerHTML = `
            <div class="analysis-empty">
                <strong>Aucun chapitre à analyser.</strong>
                <p>Créez au moins un chapitre dans le projet, puis relancez l’analyse.</p>
            </div>
        `;
        ecrivain.notify('Aucun chapitre à analyser.');
        return;
    }

    let totalDialogues = 0;
    let totalWords = 0;
    const rows = chapters.map((chapter) => {
        const dialogues = countDialogueParagraphs(chapter.content);
        const words = countWords(textFromHtml(chapter.content));
        totalDialogues += dialogues;
        totalWords += words;
        return { ...chapter, dialogues, words };
    });

    const cards = rows.map((row) => `
        <article class="dialogue-card">
            <div class="dialogue-card__identity" style="padding-left:${Math.min(4, row.depth || 0) * 14}px">
                <strong>${escapeHtml(row.title || 'Sans titre')}</strong>
                <small>${row.words.toLocaleString('fr-FR')} mots</small>
            </div>
            <div class="dialogue-card__count">
                <strong>${row.dialogues}</strong>
                <span>dialogue${row.dialogues > 1 ? 's' : ''}</span>
            </div>
        </article>
    `).join('');

    root.innerHTML = `
        <header class="plugin-title">
            <div>
                <span>ANALYSE DU PROJET</span>
                <h1>${escapeHtml(project.title || 'Manuscrit')}</h1>
            </div>
        </header>
        <div class="summary-grid">
            <article><strong>${chapters.length}</strong><span>chapitre${chapters.length > 1 ? 's' : ''}</span></article>
            <article><strong>${totalWords.toLocaleString('fr-FR')}</strong><span>mots</span></article>
            <article><strong>${totalDialogues.toLocaleString('fr-FR')}</strong><span>paragraphes de dialogue</span></article>
        </div>
        <div class="result-title">
            <h2>Dialogues par chapitre</h2>
            <span>${rows.length} résultat${rows.length > 1 ? 's' : ''}</span>
        </div>
        <div class="dialogue-list">${cards}</div>
        <p class="footnote">Lecture seule : cette extension ne modifie aucun chapitre.</p>
    `;

    ecrivain.notify(`Analyse terminée : ${chapters.length} chapitre${chapters.length > 1 ? 's' : ''}.`);
});
