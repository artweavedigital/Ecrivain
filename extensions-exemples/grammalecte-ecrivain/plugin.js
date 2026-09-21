'use strict';

const root = document.getElementById('plugin-root');

const state = {
    project: null,
    chapters: [],
    activeChapterId: '',
    activeTab: 'correcteur',
    engine: null,
    engineError: '',
    loading: false,
    analyzedChapterId: ''
};

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function htmlToText(html) {
    const box = document.createElement('div');
    box.innerHTML = String(html || '');
    return (box.innerText || box.textContent || '').replace(/\r\n?/g, '\n');
}

function icon(kind) {
    const icons = { grammar: 'Aa', lex: 'Ab', conjugation: '⌁', typo: '¶', ok: '✓', info: 'i' };
    return `<span class="mini-icon mini-icon--${kind}">${icons[kind] || '•'}</span>`;
}

function statusText() {
    if (state.engine) return `Grammalecte ${escapeHtml(state.engine.version)} · local`;
    if (state.engineError) return 'Moteur indisponible';
    return 'Chargement du moteur…';
}

function renderShell() {
    root.innerHTML = `
        <section class="gram-app">
            <header class="gram-topbar">
                <div class="gram-topbar__inner">
                <div class="gram-brand">
                    <div class="gram-mark">G</div>
                    <div>
                        <div class="gram-kicker">CORRECTEUR FRANÇAIS</div>
                        <h1>Grammalecte</h1>
                    </div>
                </div>
                <div class="engine-pill ${state.engine ? 'is-ready' : state.engineError ? 'is-error' : 'is-loading'}" id="enginePill">
                    <span class="engine-dot"></span><span>${statusText()}</span>
                </div>
                </div>
            </header>

            <nav class="gram-tabs" aria-label="Outils Grammalecte">
                <div class="gram-tabs__inner">
                <button data-tab="correcteur" class="gram-tab is-active">${icon('grammar')}<span>Correcteur</span></button>
                <button data-tab="lexicographe" class="gram-tab">${icon('lex')}<span>Lexicographe</span></button>
                <button data-tab="conjugueur" class="gram-tab">${icon('conjugation')}<span>Conjugueur</span></button>
                <button data-tab="typographie" class="gram-tab">${icon('typo')}<span>Typographie</span></button>
                </div>
            </nav>

            <main class="gram-main">
                <div class="gram-main__inner">
                <section class="gram-panel is-active" data-panel="correcteur"></section>
                <section class="gram-panel" data-panel="lexicographe"></section>
                <section class="gram-panel" data-panel="conjugueur"></section>
                <section class="gram-panel" data-panel="typographie"></section>
                </div>
            </main>

            <footer class="gram-footer">
                <div class="gram-footer__inner">
                <span>Analyse locale · aucun texte envoyé en ligne</span>
                <span class="footer-sep">•</span>
                <span>Grammalecte 2.3.0</span>
                <span class="footer-sep">•</span>
                <span>GNU GPL 3.0+</span>
                </div>
            </footer>
        </section>`;

    root.querySelectorAll('[data-tab]').forEach((button) => {
        button.addEventListener('click', () => activateTab(button.dataset.tab));
    });
    renderAllPanels();
}

function updateEngineStatus() {
    const pill = root.querySelector('#enginePill');
    if (!pill) return;
    pill.classList.toggle('is-ready', Boolean(state.engine));
    pill.classList.toggle('is-error', Boolean(state.engineError));
    pill.classList.toggle('is-loading', !state.engine && !state.engineError);
    const label = pill.querySelector('span:last-child');
    if (label) label.textContent = state.engine ? `Grammalecte ${state.engine.version} · local` : state.engineError ? 'Moteur indisponible' : 'Chargement du moteur…';
    root.querySelectorAll('[data-needs-engine]').forEach((button) => { button.disabled = !state.engine; });
}

function activateTab(tab) {
    state.activeTab = tab;
    root.querySelectorAll('.gram-tab').forEach((button) => button.classList.toggle('is-active', button.dataset.tab === tab));
    root.querySelectorAll('.gram-panel').forEach((panel) => panel.classList.toggle('is-active', panel.dataset.panel === tab));
}

function chapterOptions(selectedId = state.activeChapterId) {
    if (!state.chapters.length) return '<option value="">Aucun chapitre</option>';
    return state.chapters.map((chapter) => {
        const indent = '— '.repeat(Math.max(0, Number(chapter.depth || 0)));
        return `<option value="${escapeHtml(chapter.id)}" ${chapter.id === selectedId ? 'selected' : ''}>${escapeHtml(indent + (chapter.title || 'Sans titre'))}</option>`;
    }).join('');
}

function engineMessage() {
    if (state.engineError) {
        return `<div class="engine-message engine-message--error"><strong>Impossible de charger Grammalecte.</strong><p>${escapeHtml(state.engineError)}</p></div>`;
    }
    if (!state.engine) {
        return `<div class="engine-message"><span class="spinner"></span><div><strong>Chargement du moteur Grammalecte…</strong><p>Le premier démarrage peut prendre quelques secondes. Tout reste local.</p></div></div>`;
    }
    return '';
}

function renderCorrecteur() {
    const panel = root.querySelector('[data-panel="correcteur"]');
    panel.innerHTML = `
        <div class="panel-grid panel-grid--corrector">
            <aside class="tool-card tool-card--selector">
                <div class="section-label">TEXTE À ANALYSER</div>
                <label class="field-label" for="chapterSelect">Chapitre</label>
                <select id="chapterSelect" class="gram-select">${chapterOptions()}</select>
                <button id="analyzeBtn" data-needs-engine class="primary-action" ${state.engine ? '' : 'disabled'}>Analyser le chapitre</button>
                <div class="scope-note">Grammaire, accords, conjugaison et orthographe.</div>
                <div class="privacy-note">Le manuscrit n’est jamais envoyé sur Internet.</div>
                ${engineMessage()}
            </aside>
            <section class="tool-card results-card">
                <div class="results-head">
                    <div><div class="section-label">RÉSULTATS</div><h2 id="resultsTitle">Prêt pour l’analyse</h2></div>
                    <span class="result-count" id="resultCount">0</span>
                </div>
                <div id="resultsList" class="results-list">
                    <div class="empty-state"><div class="empty-state__mark">✓</div><h3>Choisissez un chapitre</h3><p>Grammalecte affichera ici les points à vérifier, sans modifier automatiquement le manuscrit.</p></div>
                </div>
            </section>
        </div>`;
    panel.querySelector('#chapterSelect')?.addEventListener('change', (event) => { state.activeChapterId = event.target.value; });
    panel.querySelector('#analyzeBtn')?.addEventListener('click', analyzeSelectedChapter);
}

function friendlyType(issue) {
    if (issue.kind === 'spelling') return 'Orthographe';
    const map = {
        conj: 'Conjugaison', conf: 'Confusion', gram: 'Grammaire', gn: 'Accord', date: 'Date', typo: 'Typographie', esp: 'Espacement', nbsp: 'Espacement'
    };
    return map[String(issue.type || '').toLowerCase()] || 'Grammaire';
}

function renderIssues(target, issues) {
    if (!target) return;
    if (!issues.length) {
        target.innerHTML = `<div class="empty-state"><div class="empty-state__mark">✓</div><h3>Aucun problème détecté</h3><p>Grammalecte n’a rien signalé dans ce chapitre.</p></div>`;
        return;
    }
    target.innerHTML = issues.slice(0, 250).map((issue, index) => {
        const suggestions = (issue.suggestions || []).slice(0, 6);
        const contextBefore = String(issue.before || '').replace(/\n/g, ' ');
        const contextAfter = String(issue.after || '').replace(/\n/g, ' ');
        const correctionButtons = suggestions.length
            ? `<div class="correction-actions"><span>Corriger par :</span>${suggestions.map((suggestion, sIndex) => `<button type="button" class="correction-button" data-correct-issue="${index}" data-suggestion-index="${sIndex}">${escapeHtml(suggestion)}</button>`).join('')}<button type="button" class="ignore-button" data-ignore-issue="${index}">Ignorer</button></div>`
            : `<div class="correction-actions correction-actions--empty"><span>Aucune correction automatique proposée.</span><button type="button" class="ignore-button" data-ignore-issue="${index}">Ignorer</button></div>`;
        return `
            <article class="issue-card ${issue.kind === 'spelling' ? 'issue-card--spelling' : ''}" data-issue-card="${index}">
                <div class="issue-no">${index + 1}</div>
                <div class="issue-body">
                    <div class="issue-meta"><span>${escapeHtml(friendlyType(issue))}</span><strong>${escapeHtml(issue.message)}</strong></div>
                    <div class="issue-excerpt"><span>${escapeHtml(contextBefore)}</span><mark>${escapeHtml(issue.underlined)}</mark><span>${escapeHtml(contextAfter)}</span></div>
                    ${correctionButtons}
                </div>
            </article>`;
    }).join('') + (issues.length > 250 ? `<div class="limit-note">${issues.length - 250} autre(s) résultat(s) non affiché(s) pour préserver la fluidité.</div>` : '');

    target.querySelectorAll('[data-correct-issue]').forEach((button) => {
        button.addEventListener('click', async () => {
            const issue = issues[Number(button.dataset.correctIssue)];
            const suggestion = issue?.suggestions?.[Number(button.dataset.suggestionIndex)];
            if (!issue || suggestion == null) return;
            await applyIssueCorrection(issue, String(suggestion), button);
        });
    });
    target.querySelectorAll('[data-ignore-issue]').forEach((button) => {
        button.addEventListener('click', () => {
            button.closest('[data-issue-card]')?.remove();
        });
    });
}

async function applyIssueCorrection(issue, replacement, button) {
    if (!state.analyzedChapterId) return;
    const originalLabel = button?.textContent || replacement;
    try {
        if (button) {
            button.disabled = true;
            button.textContent = 'Correction…';
        }
        const result = await ecrivain.chapters.applyCorrection(state.analyzedChapterId, {
            start: Number(issue.start || 0),
            end: Number(issue.end || 0),
            target: String(issue.underlined || ''),
            replacement,
            before: String(issue.before || ''),
            after: String(issue.after || ''),
            ruleId: String(issue.ruleId || '')
        });
        if (!result?.applied) throw new Error('La correction n’a pas pu être appliquée.');
        ecrivain.notify(`Correction appliquée : ${String(issue.underlined || '')} → ${replacement}`);
        await analyzeSelectedChapter();
    } catch (error) {
        ecrivain.notify(error?.message || 'Correction impossible.');
        if (button) {
            button.disabled = false;
            button.textContent = originalLabel;
        }
    }
}

async function analyzeSelectedChapter() {
    if (!state.engine || !state.activeChapterId) return;
    const panel = root.querySelector('[data-panel="correcteur"]');
    const btn = panel?.querySelector('#analyzeBtn');
    const title = panel?.querySelector('#resultsTitle');
    const count = panel?.querySelector('#resultCount');
    const list = panel?.querySelector('#resultsList');
    try {
        if (btn) { btn.disabled = true; btn.textContent = 'Analyse en cours…'; }
        if (list) list.innerHTML = `<div class="analysis-progress"><span class="spinner"></span><strong>Grammalecte analyse le chapitre…</strong></div>`;
        const chapter = await ecrivain.chapters.get(state.activeChapterId);
        const text = htmlToText(chapter.content || '');
        await new Promise((resolve) => setTimeout(resolve, 0));
        const result = state.engine.analyze(text);
        state.analyzedChapterId = chapter.id;
        if (title) title.textContent = chapter.title || 'Chapitre';
        if (count) count.textContent = String(result.issues.length);
        renderIssues(list, result.issues);
        ecrivain.notify(`${result.issues.length} point${result.issues.length > 1 ? 's' : ''} à vérifier.`);
    } catch (error) {
        if (list) list.innerHTML = `<div class="engine-message engine-message--error"><strong>Analyse impossible.</strong><p>${escapeHtml(error.message || String(error))}</p></div>`;
    } finally {
        if (btn) { btn.disabled = !state.engine; btn.textContent = 'Analyser le chapitre'; }
    }
}

function renderLexicographe() {
    const panel = root.querySelector('[data-panel="lexicographe"]');
    panel.innerHTML = `
        <div class="single-tool">
            <div class="hero-copy"><div class="section-label">LEXICOGRAPHE</div><h2>Comprendre un mot</h2><p>Nature grammaticale, flexions et informations lexicales fournies par le dictionnaire Grammalecte.</p></div>
            <div class="lookup-row"><input id="lexWord" class="gram-input gram-input--large" type="text" placeholder="Entrez un mot" autocomplete="off"><button id="lexBtn" data-needs-engine class="primary-action" ${state.engine ? '' : 'disabled'}>Analyser</button></div>
            <div id="lexResult" class="placeholder-result">${engineMessage() || '<div class="soft-message">Entrez un mot pour obtenir son analyse lexicale.</div>'}</div>
        </div>`;
    const run = () => analyzeWord();
    panel.querySelector('#lexBtn')?.addEventListener('click', run);
    panel.querySelector('#lexWord')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') run(); });
}

function analyzeWord() {
    if (!state.engine) return;
    const panel = root.querySelector('[data-panel="lexicographe"]');
    const word = panel?.querySelector('#lexWord')?.value.trim();
    const resultNode = panel?.querySelector('#lexResult');
    if (!word || !resultNode) return;
    const result = state.engine.lex(word);
    if (!result.entries.length) {
        resultNode.innerHTML = `<div class="lex-word-head"><h3>${escapeHtml(result.word)}</h3><span class="validity ${result.valid ? 'is-valid' : 'is-unknown'}">${result.valid ? 'Mot reconnu' : 'Mot inconnu'}</span></div>${result.suggestions?.length ? `<div class="suggestions suggestions--large"><span>Suggestions</span>${result.suggestions.map((s) => `<b>${escapeHtml(s)}</b>`).join('')}</div>` : '<div class="soft-message">Aucune analyse morphologique disponible.</div>'}`;
        return;
    }
    resultNode.innerHTML = `<div class="lex-word-head"><h3>${escapeHtml(result.word)}</h3><span class="validity is-valid">Mot reconnu</span></div>` + result.entries.map((entry) => `
        <section class="lex-entry"><h4>${escapeHtml(entry.part)}</h4>${entry.analyses.map((a) => `<div class="lex-analysis"><strong>${escapeHtml(a.label || 'Analyse grammaticale')}</strong><code>${escapeHtml(a.morph)}</code></div>`).join('')}</section>`).join('');
}

function renderConjugueur() {
    const panel = root.querySelector('[data-panel="conjugueur"]');
    panel.innerHTML = `
        <div class="single-tool conjugator">
            <div class="hero-copy hero-copy--center"><div class="section-label">CONJUGUEUR</div><h2>Conjuguer un verbe</h2><p>Les formes sont calculées localement par Grammalecte.</p></div>
            <div class="conj-search"><input id="verbInput" class="gram-input gram-input--large" type="text" placeholder="Entrez un verbe" autocomplete="off"><button id="conjBtn" data-needs-engine class="primary-action" ${state.engine ? '' : 'disabled'}>Conjuguer</button></div>
            <div class="conj-options">
                <label><input id="optNeg" type="checkbox"> Négative</label>
                <label><input id="optInt" type="checkbox"> Interrogative</label>
                <label><input id="optFem" type="checkbox"> Féminin</label>
                <label><input id="optPro" type="checkbox"> Pronominal</label>
                <label><input id="optComp" type="checkbox"> Temps composés</label>
            </div>
            <div id="conjResult" class="conj-result">${engineMessage() || '<div class="empty-state compact"><div class="empty-state__mark">⌁</div><p>Entrez un verbe, par exemple « vaincre ».</p></div>'}</div>
        </div>`;
    const run = () => conjugateVerb();
    panel.querySelector('#conjBtn')?.addEventListener('click', run);
    panel.querySelector('#verbInput')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') run(); });
    panel.querySelectorAll('.conj-options input').forEach((input) => input.addEventListener('change', () => {
        if (panel.querySelector('#verbInput')?.value.trim()) run();
    }));
}

function tenseBlock(title, subtitle, values) {
    const rows = values.filter(Boolean);
    if (!title || !rows.length) return '';
    return `<section class="tense-block"><h4>${escapeHtml(title)}</h4>${subtitle ? `<h5>${escapeHtml(subtitle)}</h5>` : ''}${rows.map((v) => `<div>${escapeHtml(v)}</div>`).join('')}</section>`;
}

function conjugateVerb() {
    if (!state.engine) return;
    const panel = root.querySelector('[data-panel="conjugueur"]');
    const word = panel?.querySelector('#verbInput')?.value.trim();
    const resultNode = panel?.querySelector('#conjResult');
    if (!word || !resultNode) return;
    const result = state.engine.conjugate(word, {
        negative: panel.querySelector('#optNeg')?.checked,
        interrogative: panel.querySelector('#optInt')?.checked,
        feminine: panel.querySelector('#optFem')?.checked,
        pronominal: panel.querySelector('#optPro')?.checked,
        compound: panel.querySelector('#optComp')?.checked
    });
    if (!result) {
        resultNode.innerHTML = `<div class="soft-message"><strong>« ${escapeHtml(word)} »</strong> n’est pas reconnu comme verbe par Grammalecte.</div>`;
        return;
    }
    const t = result.table;
    const groups = [
        tenseBlock(t.t_infi, '', [t.infi]),
        tenseBlock(t.t_ppre, '', [t.ppre]),
        tenseBlock(t.t_ppas, '', [t.ppas1, t.ppas2, t.ppas3, t.ppas4]),
        tenseBlock(t.t_impe, t.t_imp, [t.impe1, t.impe2, t.impe3]),
        tenseBlock(t.t_ipre, 'Indicatif', [t.ipre1, t.ipre2, t.ipre3, t.ipre4, t.ipre5, t.ipre6]),
        tenseBlock(t.t_iimp, 'Indicatif', [t.iimp1, t.iimp2, t.iimp3, t.iimp4, t.iimp5, t.iimp6]),
        tenseBlock(t.t_ipsi, 'Indicatif', [t.ipsi1, t.ipsi2, t.ipsi3, t.ipsi4, t.ipsi5, t.ipsi6]),
        tenseBlock(t.t_ifut, 'Indicatif', [t.ifut1, t.ifut2, t.ifut3, t.ifut4, t.ifut5, t.ifut6]),
        tenseBlock(t.t_conda, t.t_cond, [t.conda1, t.conda2, t.conda3, t.conda4, t.conda5, t.conda6]),
        tenseBlock(t.t_condb, t.t_cond, [t.condb1, t.condb2, t.condb3, t.condb4, t.condb5, t.condb6]),
        tenseBlock(t.t_spre, t.t_subj, [t.spre1, t.spre2, t.spre3, t.spre4, t.spre5, t.spre6]),
        tenseBlock(t.t_simp, t.t_subj, [t.simp1, t.simp2, t.simp3, t.simp4, t.simp5, t.simp6])
    ].filter(Boolean);
    resultNode.innerHTML = `<div class="conj-title">${escapeHtml(result.verb)}</div><p class="conj-subtitle">${escapeHtml(result.info)}</p><div class="conj-grid">${groups.join('')}</div>`;
}

function renderTypographie() {
    const panel = root.querySelector('[data-panel="typographie"]');
    panel.innerHTML = `
        <div class="single-tool single-tool--wide">
            <div class="hero-copy"><div class="section-label">TYPOGRAPHIE FRANÇAISE</div><h2>Formateur de texte</h2><p>Grammalecte prépare une version typographiquement normalisée sans toucher au chapitre original.</p></div>
            <div class="typo-toolbar"><select id="typoChapter" class="gram-select">${chapterOptions()}</select><button id="typoBtn" data-needs-engine class="primary-action" ${state.engine ? '' : 'disabled'}>Préparer l’aperçu</button></div>
            <div id="typoResults" class="typo-results">${engineMessage() || '<div class="empty-state compact"><div class="empty-state__mark">¶</div><p>Aucun aperçu préparé.</p></div>'}</div>
        </div>`;
    panel.querySelector('#typoChapter')?.addEventListener('change', (event) => { state.activeChapterId = event.target.value; });
    panel.querySelector('#typoBtn')?.addEventListener('click', previewTypography);
}

async function previewTypography() {
    if (!state.engine || !state.activeChapterId) return;
    const panel = root.querySelector('[data-panel="typographie"]');
    const target = panel?.querySelector('#typoResults');
    if (!target) return;
    const chapter = await ecrivain.chapters.get(state.activeChapterId);
    const source = htmlToText(chapter.content || '');
    const result = state.engine.format(source);
    const max = 12000;
    const sourcePreview = source.length > max ? source.slice(0, max) + '\n[…]': source;
    const formattedPreview = result.text.length > max ? result.text.slice(0, max) + '\n[…]': result.text;
    target.innerHTML = `<div class="typo-summary"><strong>${result.count}</strong><span>modification${result.count > 1 ? 's' : ''} typographique${result.count > 1 ? 's' : ''} proposée${result.count > 1 ? 's' : ''}</span></div><div class="preview-grid"><section><h4>Original</h4><pre>${escapeHtml(sourcePreview)}</pre></section><section><h4>Aperçu Grammalecte</h4><pre>${escapeHtml(formattedPreview)}</pre></section></div><div class="preview-note">Aucun changement n’est appliqué automatiquement au manuscrit.</div>`;
}

function renderAllPanels() {
    renderCorrecteur();
    renderLexicographe();
    renderConjugueur();
    renderTypographie();
    activateTab(state.activeTab);
    updateEngineStatus();
}

function loadScriptFromText(source, label = 'ressource') {
    return new Promise((resolve, reject) => {
        const blob = new Blob([String(source || '')], { type: 'text/javascript;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const script = document.createElement('script');
        script.src = url;
        script.async = false;
        script.onload = () => {
            URL.revokeObjectURL(url);
            script.remove();
            resolve();
        };
        script.onerror = () => {
            URL.revokeObjectURL(url);
            script.remove();
            reject(new Error(`Impossible de charger ${label}.`));
        };
        document.head.appendChild(script);
    });
}

async function loadEngine() {
    if (state.engine || state.loading) return;
    state.loading = true;
    state.engineError = '';
    updateEngineStatus();
    try {
        const [bundle, dictionary, conj, mfsp, phonet] = await Promise.all([
            ecrivain.resources.text('grammalecte-engine.js'),
            ecrivain.resources.json('dictionary-fr-classic.json'),
            ecrivain.resources.json('conj_data.json'),
            ecrivain.resources.json('mfsp_data.json'),
            ecrivain.resources.json('phonet_data.json')
        ]);

        // Pas d'eval/new Function : le moteur GPL est chargé comme script local
        // isolé dans l'iframe de l'extension, puis appelé via une fabrique temporaire.
        const factoryName = `__ecrivainGramFactory_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const wrapped = `window[${JSON.stringify(factoryName)}] = function(data){\n${bundle}\n};`;
        await loadScriptFromText(wrapped, 'le moteur Grammalecte');
        const factory = window[factoryName];
        if (typeof factory !== 'function') throw new Error('La fabrique Grammalecte n’a pas été créée.');
        try {
            state.engine = factory({ dictionary, conj, mfsp, phonet });
        } finally {
            try { delete window[factoryName]; } catch (_) { window[factoryName] = undefined; }
        }
        if (!state.engine || typeof state.engine.analyze !== 'function') throw new Error('Le moteur Grammalecte n’a pas été initialisé correctement.');
        renderAllPanels();
        ecrivain.notify(`Grammalecte ${state.engine.version} prêt.`);
    } catch (error) {
        state.engine = null;
        state.engineError = error?.message || String(error);
        renderAllPanels();
        ecrivain.notify('Échec du chargement de Grammalecte.');
    } finally {
        state.loading = false;
        updateEngineStatus();
    }
}

async function boot() {
    state.project = await ecrivain.project.getCurrent();
    state.chapters = await ecrivain.chapters.list();
    state.activeChapterId = state.chapters[0]?.id || '';
    renderShell();
    await loadEngine();
}

ecrivain.onCommand('ouvrir', async () => {
    await boot();
});
