'use strict';

(() => {
    const ui = {
        bar: document.getElementById('chapterSearchBar'),
        query: document.getElementById('chapterSearchQuery'),
        prev: document.getElementById('chapterSearchPrev'),
        next: document.getElementById('chapterSearchNext'),
        count: document.getElementById('chapterSearchCount'),
        caseSensitive: document.getElementById('chapterSearchCase'),
        wholeWord: document.getElementById('chapterSearchWholeWord'),
        replaceRow: document.getElementById('chapterReplaceRow'),
        replace: document.getElementById('chapterReplaceValue'),
        replaceOne: document.getElementById('chapterReplaceOne'),
        replaceAll: document.getElementById('chapterReplaceAll'),
        close: document.getElementById('chapterSearchClose'),
        content: document.getElementById('chapterContent'),

        projectView: document.getElementById('projectSearchView'),
        projectBack: document.getElementById('projectSearchBackBtn'),
        projectTitle: document.getElementById('projectSearchTitle'),
        projectQuery: document.getElementById('projectSearchQuery'),
        projectReplaceWrap: document.getElementById('projectSearchReplaceWrap'),
        projectReplace: document.getElementById('projectSearchReplace'),
        projectCase: document.getElementById('projectSearchCase'),
        projectWhole: document.getElementById('projectSearchWholeWord'),
        projectRun: document.getElementById('projectSearchRunBtn'),
        projectSummary: document.getElementById('projectSearchSummary'),
        projectResults: document.getElementById('projectSearchResults'),
        projectEmpty: document.getElementById('projectSearchEmpty'),
        projectReplaceAction: document.getElementById('projectReplaceAction'),
        projectConfirm: document.getElementById('projectReplaceConfirm'),
        projectConfirmText: document.getElementById('projectReplaceConfirmText'),
        projectConfirmCancel: document.getElementById('projectReplaceConfirmCancel'),
        projectConfirmRun: document.getElementById('projectReplaceConfirmRun')
    };

    const state = {
        chapterMatches: [],
        chapterIndex: -1,
        chapterReplaceMode: false,
        projectReplaceMode: false,
        lastProjectResult: null
    };

    function toast(message, error = false) {
        const el = document.getElementById('toast');
        if (!el) return;
        el.textContent = message;
        el.classList.toggle('is-error', error);
        el.hidden = false;
        window.clearTimeout(toast.timer);
        toast.timer = window.setTimeout(() => { el.hidden = true; }, 3500);
    }

    function isWordChar(char) {
        return Boolean(char) && /[\p{L}\p{N}_]/u.test(char);
    }

    function findPositions(text, query, { caseSensitive = false, wholeWord = false } = {}) {
        const source = String(text ?? '');
        const needle = String(query ?? '').trim();
        if (!needle) return [];

        const escapedParts = needle.split(/\s+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        const pattern = escapedParts.join('[\\s\\u00A0\\u202F]+');
        const regex = new RegExp(pattern, caseSensitive ? 'gu' : 'giu');
        const positions = [];
        let match;

        while ((match = regex.exec(source)) !== null) {
            const index = match.index;
            const end = index + match[0].length;
            const validBoundary = !wholeWord || (!isWordChar(source[index - 1]) && !isWordChar(source[end]));
            if (validBoundary) positions.push({ start: index, end });
            if (match[0].length === 0) regex.lastIndex += 1;
        }
        return positions;
    }

    function textNodes(container) {
        if (!container) return [];
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
        const nodes = [];
        let node;
        while ((node = walker.nextNode())) nodes.push(node);
        return nodes;
    }

    function chapterOptions() {
        return {
            caseSensitive: Boolean(ui.caseSensitive?.checked),
            wholeWord: Boolean(ui.wholeWord?.checked)
        };
    }

    function collectChapterMatches() {
        const query = ui.query?.value || '';
        if (!query || !ui.content) return [];
        const options = chapterOptions();
        const matches = [];
        for (const node of textNodes(ui.content)) {
            for (const pos of findPositions(node.nodeValue || '', query, options)) {
                matches.push({ node, start: pos.start, end: pos.end });
            }
        }
        return matches;
    }

    function updateChapterCounter() {
        if (!ui.count) return;
        if (!state.chapterMatches.length) {
            ui.count.textContent = '0 / 0';
            return;
        }
        ui.count.textContent = `${state.chapterIndex + 1} / ${state.chapterMatches.length}`;
    }

    function selectChapterMatch(index) {
        if (!state.chapterMatches.length) {
            state.chapterIndex = -1;
            updateChapterCounter();
            return;
        }
        const normalized = ((index % state.chapterMatches.length) + state.chapterMatches.length) % state.chapterMatches.length;
        state.chapterIndex = normalized;
        const match = state.chapterMatches[normalized];
        if (!match?.node?.isConnected) {
            refreshChapterMatches(false);
            return;
        }

        const selection = window.getSelection();
        const range = document.createRange();
        range.setStart(match.node, match.start);
        range.setEnd(match.node, match.end);
        selection.removeAllRanges();
        selection.addRange(range);
        match.node.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        updateChapterCounter();
    }

    function refreshChapterMatches(keepIndex = true) {
        const previous = state.chapterIndex;
        state.chapterMatches = collectChapterMatches();
        if (!state.chapterMatches.length) {
            state.chapterIndex = -1;
            updateChapterCounter();
            return;
        }
        state.chapterIndex = keepIndex && previous >= 0
            ? Math.min(previous, state.chapterMatches.length - 1)
            : 0;
        selectChapterMatch(state.chapterIndex);
    }

    function openChapterSearch(replaceMode = false, initial = {}) {
        if (!ui.bar) return;
        window.ecrivainApp?.showManuscript?.();
        state.chapterReplaceMode = Boolean(replaceMode);
        ui.bar.hidden = false;
        ui.replaceRow.hidden = !state.chapterReplaceMode;
        if (initial.query !== undefined) ui.query.value = initial.query;
        if (initial.caseSensitive !== undefined) ui.caseSensitive.checked = Boolean(initial.caseSensitive);
        if (initial.wholeWord !== undefined) ui.wholeWord.checked = Boolean(initial.wholeWord);
        if (replaceMode && initial.replacement !== undefined) ui.replace.value = initial.replacement;
        window.setTimeout(() => {
            ui.query.focus();
            ui.query.select();
            refreshChapterMatches(false);
        }, 20);
    }

    function closeChapterSearch() {
        if (!ui.bar) return;
        ui.bar.hidden = true;
        state.chapterMatches = [];
        state.chapterIndex = -1;
        const selection = window.getSelection();
        selection?.removeAllRanges();
    }

    function replaceCurrentChapterOccurrence() {
        if (!state.chapterMatches.length || state.chapterIndex < 0) refreshChapterMatches(false);
        const match = state.chapterMatches[state.chapterIndex];
        if (!match?.node?.isConnected) return;
        const value = String(ui.replace?.value ?? '');
        const text = match.node.nodeValue || '';
        match.node.nodeValue = text.slice(0, match.start) + value + text.slice(match.end);
        ui.content.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: value }));
        refreshChapterMatches(true);
    }

    function replaceAllChapterOccurrences() {
        const query = ui.query?.value || '';
        if (!query) return;
        const replacement = String(ui.replace?.value ?? '');
        const options = chapterOptions();
        let total = 0;

        for (const node of textNodes(ui.content)) {
            const positions = findPositions(node.nodeValue || '', query, options);
            if (!positions.length) continue;
            let value = node.nodeValue || '';
            for (let i = positions.length - 1; i >= 0; i -= 1) {
                const pos = positions[i];
                value = value.slice(0, pos.start) + replacement + value.slice(pos.end);
            }
            node.nodeValue = value;
            total += positions.length;
        }

        if (total) {
            ui.content.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: replacement }));
            toast(`${total} ${total > 1 ? 'remplacements effectués' : 'remplacement effectué'} dans ce chapitre.`);
        }
        refreshChapterMatches(false);
    }

    function hideKnownViews() {
        const ids = [
            'welcome', 'editorArea', 'synopsisView', 'notesView', 'timelineView',
            'mindmapView', 'statsView', 'backupsView', 'historyView'
        ];
        for (const id of ids) {
            const el = document.getElementById(id);
            if (el) el.hidden = true;
        }
    }

    function closeProjectView(showManuscript = true) {
        if (ui.projectView) ui.projectView.hidden = true;
        if (showManuscript) window.ecrivainApp?.showManuscript?.();
    }

    function resetProjectResults() {
        state.lastProjectResult = null;
        ui.projectResults.innerHTML = '';
        ui.projectSummary.textContent = 'Saisissez un mot ou une expression.';
        ui.projectEmpty.hidden = true;
        ui.projectReplaceAction.hidden = true;
        ui.projectConfirm.hidden = true;
    }

    function openProjectSearch(replaceMode = false) {
        if (!ui.projectView) return;
        state.projectReplaceMode = Boolean(replaceMode);
        hideKnownViews();
        ui.projectView.hidden = false;
        ui.projectTitle.textContent = replaceMode ? 'Remplacer dans tout le projet' : 'Rechercher dans le projet';
        ui.projectReplaceWrap.hidden = !replaceMode;
        ui.projectRun.textContent = replaceMode ? 'Prévisualiser' : 'Rechercher';
        resetProjectResults();
        window.setTimeout(() => {
            ui.projectQuery.focus();
            ui.projectQuery.select();
        }, 20);
    }

    function projectOptions() {
        return {
            caseSensitive: Boolean(ui.projectCase.checked),
            wholeWord: Boolean(ui.projectWhole.checked)
        };
    }

    function resultCard(item, query, options) {
        const card = document.createElement('article');
        card.className = 'project-search-result-card';

        const head = document.createElement('button');
        head.type = 'button';
        head.className = 'project-search-result-head';
        const title = document.createElement('strong');
        title.textContent = item.title || 'Sans titre';
        const badge = document.createElement('span');
        badge.textContent = `${item.count} ${item.count > 1 ? 'occurrences' : 'occurrence'}`;
        head.append(title, badge);
        head.addEventListener('click', async () => {
            await window.ecrivainApp?.openChapter?.(item.id);
            openChapterSearch(false, { query, ...options });
        });
        card.appendChild(head);

        const snippets = document.createElement('div');
        snippets.className = 'project-search-snippets';
        for (const snippetText of item.snippets || []) {
            const p = document.createElement('p');
            p.textContent = snippetText;
            snippets.appendChild(p);
        }
        card.appendChild(snippets);
        return card;
    }

    function renderProjectResults(payload) {
        state.lastProjectResult = payload;
        ui.projectResults.innerHTML = '';
        ui.projectConfirm.hidden = true;

        const total = Number(payload?.totalOccurrences || 0);
        const chapterCount = Number(payload?.chapterCount || 0);
        ui.projectSummary.textContent = total
            ? `${total} ${total > 1 ? 'occurrences' : 'occurrence'} dans ${chapterCount} ${chapterCount > 1 ? 'chapitres' : 'chapitre'}.`
            : 'Aucune occurrence trouvée.';
        ui.projectEmpty.hidden = total !== 0;

        const query = ui.projectQuery.value;
        const options = projectOptions();
        for (const item of payload?.results || []) {
            ui.projectResults.appendChild(resultCard(item, query, options));
        }

        ui.projectReplaceAction.hidden = !(state.projectReplaceMode && total > 0);
        if (!ui.projectReplaceAction.hidden) {
            ui.projectReplaceAction.textContent = `Remplacer les ${total} ${total > 1 ? 'occurrences' : 'occurrence'} dans tout le projet`;
        }
    }

    async function runProjectSearch() {
        const query = ui.projectQuery.value.trim();
        if (!query) {
            ui.projectQuery.focus();
            return;
        }
        ui.projectRun.disabled = true;
        try {
            const payload = await window.ecrivain.search.project(query, projectOptions());
            renderProjectResults(payload);
        } catch (error) {
            toast(error.message || 'Recherche impossible.', true);
        } finally {
            ui.projectRun.disabled = false;
        }
    }

    function showGlobalReplaceConfirmation() {
        const result = state.lastProjectResult;
        if (!result?.totalOccurrences) return;
        const replacement = String(ui.projectReplace.value ?? '');
        ui.projectConfirmText.textContent = `${result.totalOccurrences} ${result.totalOccurrences > 1 ? 'occurrences seront remplacées' : 'occurrence sera remplacée'} dans ${result.chapterCount} ${result.chapterCount > 1 ? 'chapitres' : 'chapitre'}. Une sauvegarde complète et un jalon d’historique seront créés avant les modifications.`;
        ui.projectConfirm.hidden = false;
        ui.projectConfirmRun.textContent = 'Confirmer le remplacement global';
        ui.projectConfirmRun.dataset.replacement = replacement;
        ui.projectConfirm.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    async function executeGlobalReplace() {
        const query = ui.projectQuery.value.trim();
        if (!query) return;
        const replacement = String(ui.projectReplace.value ?? '');
        ui.projectConfirmRun.disabled = true;
        try {
            const options = projectOptions();
            const result = await window.ecrivain.search.replaceProject(query, replacement, options);
            ui.projectConfirm.hidden = true;
            await window.ecrivainApp?.reloadProject?.();
            openProjectSearch(true);
            ui.projectQuery.value = query;
            ui.projectReplace.value = replacement;
            ui.projectCase.checked = Boolean(options.caseSensitive);
            ui.projectWhole.checked = Boolean(options.wholeWord);
            toast(`${result.replacements} ${result.replacements > 1 ? 'remplacements effectués' : 'remplacement effectué'} dans ${result.chapterCount} ${result.chapterCount > 1 ? 'chapitres' : 'chapitre'}.`);
            const refreshed = await window.ecrivain.search.project(query, options);
            renderProjectResults(refreshed);
        } catch (error) {
            toast(error.message || 'Remplacement global impossible.', true);
        } finally {
            ui.projectConfirmRun.disabled = false;
        }
    }

    ui.query?.addEventListener('input', () => refreshChapterMatches(false));
    ui.caseSensitive?.addEventListener('change', () => refreshChapterMatches(false));
    ui.wholeWord?.addEventListener('change', () => refreshChapterMatches(false));
    ui.prev?.addEventListener('click', () => selectChapterMatch(state.chapterIndex - 1));
    ui.next?.addEventListener('click', () => selectChapterMatch(state.chapterIndex + 1));
    ui.close?.addEventListener('click', closeChapterSearch);
    ui.replaceOne?.addEventListener('click', replaceCurrentChapterOccurrence);
    ui.replaceAll?.addEventListener('click', replaceAllChapterOccurrences);
    ui.query?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            selectChapterMatch(state.chapterIndex + (event.shiftKey ? -1 : 1));
        }
        if (event.key === 'Escape') closeChapterSearch();
    });
    ui.content?.addEventListener('input', () => {
        if (!ui.bar?.hidden) window.setTimeout(() => refreshChapterMatches(true), 0);
    });

    ui.projectBack?.addEventListener('click', () => closeProjectView(true));
    ui.projectRun?.addEventListener('click', runProjectSearch);
    ui.projectQuery?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            runProjectSearch();
        }
    });
    ui.projectCase?.addEventListener('change', () => state.lastProjectResult && runProjectSearch());
    ui.projectWhole?.addEventListener('change', () => state.lastProjectResult && runProjectSearch());
    ui.projectReplaceAction?.addEventListener('click', showGlobalReplaceConfirmation);
    ui.projectConfirmCancel?.addEventListener('click', () => { ui.projectConfirm.hidden = true; });
    ui.projectConfirmRun?.addEventListener('click', executeGlobalReplace);

    window.ecrivainSearch = {
        openChapterSearch,
        closeChapterSearch,
        openProjectSearch,
        closeProjectView
    };
})();
