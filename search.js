'use strict';

(() => {
    const ui = {
        bar: document.getElementById('chapterSearchBar'),
        query: document.getElementById('chapterSearchQuery'),
        prev: document.getElementById('chapterSearchPrev'),
        next: document.getElementById('chapterSearchNext'),
        all: document.getElementById('chapterSearchAll'),
        count: document.getElementById('chapterSearchCount'),
        caseSensitive: document.getElementById('chapterSearchCase'),
        wholeWord: document.getElementById('chapterSearchWholeWord'),
        searchFormatBtn: document.getElementById('chapterSearchFormatBtn'),
        searchClearFormatBtn: document.getElementById('chapterSearchClearFormatBtn'),
        searchFormatSummary: document.getElementById('chapterSearchFormatSummary'),
        replaceRow: document.getElementById('chapterReplaceRow'),
        replace: document.getElementById('chapterReplaceValue'),
        replaceOne: document.getElementById('chapterReplaceOne'),
        replaceAll: document.getElementById('chapterReplaceAll'),
        replaceFormatBtn: document.getElementById('chapterReplaceFormatBtn'),
        replaceClearFormatBtn: document.getElementById('chapterReplaceClearFormatBtn'),
        replaceFormatSummary: document.getElementById('chapterReplaceFormatSummary'),
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
        projectConfirmRun: document.getElementById('projectReplaceConfirmRun'),
        projectSearchFormatBtn: document.getElementById('projectSearchFormatBtn'),
        projectSearchClearFormatBtn: document.getElementById('projectSearchClearFormatBtn'),
        projectSearchFormatSummary: document.getElementById('projectSearchFormatSummary'),
        projectReplaceFormatControls: document.getElementById('projectReplaceFormatControls'),
        projectReplaceFormatBtn: document.getElementById('projectReplaceFormatBtn'),
        projectReplaceClearFormatBtn: document.getElementById('projectReplaceClearFormatBtn'),
        projectReplaceFormatSummary: document.getElementById('projectReplaceFormatSummary'),

        formatBackdrop: document.getElementById('searchFormatBackdrop'),
        formatClose: document.getElementById('searchFormatClose'),
        formatTitle: document.getElementById('searchFormatTitle'),
        formatIntro: document.getElementById('searchFormatIntro'),
        formatTabs: Array.from(document.querySelectorAll('[data-format-tab]')),
        formatPanels: Array.from(document.querySelectorAll('[data-format-panel]')),
        formatFontFamily: document.getElementById('searchFormatFontFamily'),
        formatFontStyle: document.getElementById('searchFormatFontStyle'),
        formatFontSize: document.getElementById('searchFormatFontSize'),
        formatUnderline: document.getElementById('searchFormatUnderline'),
        formatStrike: document.getElementById('searchFormatStrike'),
        formatUseColor: document.getElementById('searchFormatUseColor'),
        formatColor: document.getElementById('searchFormatColor'),
        formatPosition: document.getElementById('searchFormatPosition'),
        formatUseBackground: document.getElementById('searchFormatUseBackground'),
        formatBackground: document.getElementById('searchFormatBackground'),
        formatPreview: document.getElementById('searchFormatPreview'),
        formatReset: document.getElementById('searchFormatReset'),
        formatCancel: document.getElementById('searchFormatCancel'),
        formatApply: document.getElementById('searchFormatApply')
    };

    const state = {
        chapterMatches: [],
        chapterIndex: -1,
        chapterReplaceMode: false,
        projectReplaceMode: false,
        lastProjectResult: null,
        highlightAll: false,
        chapterSearchFormat: {},
        chapterReplaceFormat: {},
        projectSearchFormat: {},
        projectReplaceFormat: {},
        formatTarget: null,
        chapterSearchDirty: true,
        chapterAnchorRange: null,
        chapterLastSelectedText: ''
    };

    const EMPTY_FORMAT = Object.freeze({
        fontFamily: null,
        fontStyle: null,
        fontSizePt: null,
        underline: null,
        strike: null,
        position: null,
        color: null,
        backgroundColor: null
    });

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

    function normalizeFontName(value) {
        const first = String(value || '').split(',')[0].trim();
        return first.replace(/^['"]|['"]$/g, '').trim().toLocaleLowerCase('fr');
    }

    function rgbToHex(value) {
        const text = String(value || '').trim().toLowerCase();
        if (!text || text === 'transparent' || text === 'rgba(0, 0, 0, 0)') return null;
        if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase();
        if (/^#[0-9a-f]{3}$/i.test(text)) {
            return `#${text.slice(1).split('').map((c) => c + c).join('')}`.toLowerCase();
        }
        const match = text.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*([\d.]+))?\s*\)$/);
        if (!match) return text;
        if (match[4] !== undefined && Number(match[4]) === 0) return null;
        return `#${[match[1], match[2], match[3]].map((n) => Math.max(0, Math.min(255, Math.round(Number(n)))).toString(16).padStart(2, '0')).join('')}`;
    }

    function effectiveDecoration(element, type) {
        let el = element;
        while (el && el !== ui.content?.parentElement) {
            const line = getComputedStyle(el).textDecorationLine || '';
            if (line.includes(type)) return true;
            if (el === ui.content) break;
            el = el.parentElement;
        }
        return false;
    }

    function effectivePosition(element) {
        let el = element;
        while (el && el !== ui.content?.parentElement) {
            const tag = el.tagName?.toLowerCase();
            if (tag === 'sup') return 'super';
            if (tag === 'sub') return 'sub';
            const align = String(getComputedStyle(el).verticalAlign || '').toLowerCase();
            if (align === 'super') return 'super';
            if (align === 'sub') return 'sub';
            if (el === ui.content) break;
            el = el.parentElement;
        }
        return 'normal';
    }

    function effectiveBackground(element) {
        let el = element;
        while (el && el !== ui.content?.parentElement) {
            const color = rgbToHex(getComputedStyle(el).backgroundColor);
            if (color) return color;
            if (el === ui.content) break;
            el = el.parentElement;
        }
        return null;
    }

    function actualFormatForNode(node) {
        const element = node?.parentElement || ui.content;
        if (!element) return {};
        const style = getComputedStyle(element);
        const weightValue = String(style.fontWeight || '').toLowerCase();
        const numericWeight = Number.parseInt(weightValue, 10);
        const bold = weightValue === 'bold' || weightValue === 'bolder' || (Number.isFinite(numericWeight) && numericWeight >= 600);
        const italic = ['italic', 'oblique'].includes(String(style.fontStyle || '').toLowerCase());
        const pxSize = Number.parseFloat(style.fontSize || '');
        return {
            fontFamily: normalizeFontName(style.fontFamily),
            fontSizePt: Number.isFinite(pxSize) ? pxSize * 72 / 96 : null,
            bold,
            italic,
            underline: effectiveDecoration(element, 'underline'),
            strike: effectiveDecoration(element, 'line-through'),
            position: effectivePosition(element),
            color: rgbToHex(style.color),
            backgroundColor: effectiveBackground(element)
        };
    }

    function cleanFormatSpec(input = {}) {
        const size = Number(String(input.fontSizePt ?? '').replace(',', '.'));
        const style = ['normal', 'bold', 'italic', 'bold-italic'].includes(input.fontStyle) ? input.fontStyle : null;
        const position = ['normal', 'super', 'sub'].includes(input.position) ? input.position : null;
        return {
            fontFamily: String(input.fontFamily || '').trim() || null,
            fontStyle: style,
            fontSizePt: Number.isFinite(size) && size > 0 ? size : null,
            underline: typeof input.underline === 'boolean' ? input.underline : null,
            strike: typeof input.strike === 'boolean' ? input.strike : null,
            position,
            color: input.color ? rgbToHex(input.color) : null,
            backgroundColor: input.backgroundColor ? rgbToHex(input.backgroundColor) : null
        };
    }

    function hasFormatSpec(spec = {}) {
        const value = cleanFormatSpec(spec);
        return Object.values(value).some((item) => item !== null && item !== '');
    }

    function formatMatches(actual, wanted) {
        const spec = cleanFormatSpec(wanted);
        if (!hasFormatSpec(spec)) return true;
        if (spec.fontFamily && normalizeFontName(actual.fontFamily) !== normalizeFontName(spec.fontFamily)) return false;
        if (spec.fontSizePt !== null) {
            if (!Number.isFinite(Number(actual.fontSizePt)) || Math.abs(Number(actual.fontSizePt) - spec.fontSizePt) > 0.35) return false;
        }
        if (spec.fontStyle) {
            const isBold = Boolean(actual.bold);
            const isItalic = Boolean(actual.italic);
            if (spec.fontStyle === 'normal' && (isBold || isItalic)) return false;
            if (spec.fontStyle === 'bold' && (!isBold || isItalic)) return false;
            if (spec.fontStyle === 'italic' && (isBold || !isItalic)) return false;
            if (spec.fontStyle === 'bold-italic' && (!isBold || !isItalic)) return false;
        }
        if (spec.underline !== null && Boolean(actual.underline) !== spec.underline) return false;
        if (spec.strike !== null && Boolean(actual.strike) !== spec.strike) return false;
        if (spec.position && String(actual.position || 'normal') !== spec.position) return false;
        if (spec.color && rgbToHex(actual.color) !== spec.color) return false;
        if (spec.backgroundColor && rgbToHex(actual.backgroundColor) !== spec.backgroundColor) return false;
        return true;
    }

    function formatSummary(spec = {}) {
        const value = cleanFormatSpec(spec);
        const parts = [];
        if (value.fontFamily) parts.push(value.fontFamily);
        if (value.fontSizePt !== null) parts.push(`${String(value.fontSizePt).replace('.', ',')} pt`);
        if (value.fontStyle === 'normal') parts.push('normal');
        if (value.fontStyle === 'bold') parts.push('gras');
        if (value.fontStyle === 'italic') parts.push('italique');
        if (value.fontStyle === 'bold-italic') parts.push('gras italique');
        if (value.underline === true) parts.push('souligné');
        if (value.underline === false) parts.push('non souligné');
        if (value.strike === true) parts.push('barré');
        if (value.strike === false) parts.push('non barré');
        if (value.position === 'normal') parts.push('position normale');
        if (value.position === 'super') parts.push('exposant');
        if (value.position === 'sub') parts.push('indice');
        if (value.color) parts.push(`texte ${value.color}`);
        if (value.backgroundColor) parts.push(`surlignage ${value.backgroundColor}`);
        return parts.join(' · ');
    }

    function applyFormatStyles(element, spec = {}) {
        const value = cleanFormatSpec(spec);
        if (value.fontFamily) element.style.fontFamily = value.fontFamily;
        if (value.fontSizePt !== null) element.style.fontSize = `${value.fontSizePt}pt`;
        if (value.fontStyle) {
            element.style.fontWeight = value.fontStyle.includes('bold') ? '700' : '400';
            element.style.fontStyle = value.fontStyle.includes('italic') ? 'italic' : 'normal';
        }
        if (value.underline !== null || value.strike !== null) {
            const lines = [];
            if (value.underline === true) lines.push('underline');
            if (value.strike === true) lines.push('line-through');
            element.style.textDecorationLine = lines.length ? lines.join(' ') : 'none';
        }
        if (value.position) element.style.verticalAlign = value.position === 'normal' ? 'baseline' : value.position;
        if (value.color) element.style.color = value.color;
        if (value.backgroundColor) element.style.backgroundColor = value.backgroundColor;
    }

    function createReplacementNode(text, format) {
        const value = String(text ?? '');
        if (!value) return null;
        if (!hasFormatSpec(format)) return document.createTextNode(value);
        const span = document.createElement('span');
        span.dataset.ecrivainFormat = 'replace';
        applyFormatStyles(span, format);
        span.textContent = value;
        return span;
    }

    function replaceTextNodeMatches(node, positions, replacement, replacementFormat) {
        if (!node?.isConnected || !positions?.length) return 0;
        const source = node.nodeValue || '';
        const fragment = document.createDocumentFragment();
        const replacementText = String(replacement ?? '');
        // Si l'auteur choisit un format de remplacement sans saisir de nouveau
        // texte, Écrivain conserve l'occurrence trouvée et ne modifie que sa
        // mise en forme. Une chaîne vide sans format reste, elle, une suppression.
        const formatOnly = replacementText.length === 0 && hasFormatSpec(replacementFormat);
        let cursor = 0;
        for (const pos of positions) {
            if (pos.start > cursor) fragment.appendChild(document.createTextNode(source.slice(cursor, pos.start)));
            const value = formatOnly ? source.slice(pos.start, pos.end) : replacementText;
            const replacementNode = createReplacementNode(value, replacementFormat);
            if (replacementNode) fragment.appendChild(replacementNode);
            cursor = pos.end;
        }
        if (cursor < source.length) fragment.appendChild(document.createTextNode(source.slice(cursor)));
        node.parentNode?.replaceChild(fragment, node);
        return positions.length;
    }

    function clearSearchHighlights() {
        try { CSS.highlights?.delete('ecrivain-search-match'); } catch (_) {}
    }

    function renderSearchHighlights() {
        clearSearchHighlights();
        if (!state.highlightAll || !state.chapterMatches.length || !window.Highlight || !CSS.highlights) return;
        try {
            const ranges = [];
            for (const match of state.chapterMatches) {
                if (!match.node?.isConnected) continue;
                const range = new Range();
                range.setStart(match.node, match.start);
                range.setEnd(match.node, match.end);
                ranges.push(range);
            }
            CSS.highlights.set('ecrivain-search-match', new Highlight(...ranges));
        } catch (_) {
            clearSearchHighlights();
        }
    }

    function chapterOptions() {
        return {
            caseSensitive: Boolean(ui.caseSensitive?.checked),
            wholeWord: Boolean(ui.wholeWord?.checked),
            searchFormat: cleanFormatSpec(state.chapterSearchFormat)
        };
    }

    function collectChapterMatches() {
        const query = ui.query?.value || '';
        if (!query || !ui.content) return [];
        const options = chapterOptions();
        const matches = [];
        for (const node of textNodes(ui.content)) {
            if (!formatMatches(actualFormatForNode(node), options.searchFormat)) continue;
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
        ui.count.textContent = `${Math.max(0, state.chapterIndex + 1)} / ${state.chapterMatches.length}`;
    }

    function selectionRangeInChapter() {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return null;
        const range = selection.getRangeAt(0);
        const common = range.commonAncestorContainer;
        if (common !== ui.content && !ui.content?.contains(common)) return null;
        try {
            return range.cloneRange();
        } catch (_) {
            return null;
        }
    }

    function textFromChapterRange(range) {
        if (!range || range.collapsed) return '';
        const text = range.toString().trim();
        // La recherche dans le chapitre travaille dans les nœuds de texte :
        // on préremplit donc une sélection sur une seule ligne (mot ou expression).
        if (!text || /[\r\n]/.test(text)) return '';
        return text;
    }

    function selectedChapterText() {
        const liveRange = selectionRangeInChapter();
        const liveText = textFromChapterRange(liveRange);
        if (liveText) return liveText;
        // Si l’éditeur a réellement le focus et que la sélection est réduite
        // à un simple caret, il n’y a rien à préremplir. En revanche, lorsque
        // le menu natif a pris le focus, on réutilise la dernière sélection.
        if (liveRange && document.activeElement === ui.content) return '';
        return state.chapterLastSelectedText || '';
    }

    function rememberChapterAnchor() {
        const range = selectionRangeInChapter();
        if (!range) return;
        state.chapterAnchorRange = range;
        state.chapterLastSelectedText = textFromChapterRange(range);
    }

    function invalidateChapterSearch({ keepAnchor = true } = {}) {
        state.chapterMatches = [];
        state.chapterIndex = -1;
        state.chapterSearchDirty = true;
        state.highlightAll = false;
        clearSearchHighlights();
        if (!keepAnchor) state.chapterAnchorRange = null;
        updateChapterCounter();
    }

    function rangeAtMatch(match, atEnd = false) {
        if (!match?.node?.isConnected) return null;
        try {
            const range = document.createRange();
            const offset = atEnd ? match.end : match.start;
            range.setStart(match.node, offset);
            range.collapse(true);
            return range;
        } catch (_) {
            return null;
        }
    }

    function firstMatchFromAnchor(direction) {
        if (!state.chapterMatches.length) return -1;
        const anchor = state.chapterAnchorRange;
        if (!anchor || !anchor.startContainer?.isConnected || !anchor.endContainer?.isConnected) {
            return direction < 0 ? state.chapterMatches.length - 1 : 0;
        }

        try {
            const anchorPoint = anchor.cloneRange();
            anchorPoint.collapse(direction < 0); // précédent : début ; suivant : fin

            if (direction < 0) {
                for (let i = state.chapterMatches.length - 1; i >= 0; i -= 1) {
                    const point = rangeAtMatch(state.chapterMatches[i], true);
                    if (point && point.compareBoundaryPoints(Range.START_TO_START, anchorPoint) <= 0) return i;
                }
                return state.chapterMatches.length - 1;
            }

            for (let i = 0; i < state.chapterMatches.length; i += 1) {
                const point = rangeAtMatch(state.chapterMatches[i], false);
                if (point && point.compareBoundaryPoints(Range.START_TO_START, anchorPoint) >= 0) return i;
            }
            return 0;
        } catch (_) {
            return direction < 0 ? state.chapterMatches.length - 1 : 0;
        }
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

    function refreshChapterMatches(keepIndex = true, selectMatch = true) {
        const previous = state.chapterIndex;
        state.chapterMatches = collectChapterMatches();
        state.chapterSearchDirty = false;
        renderSearchHighlights();
        if (!state.chapterMatches.length) {
            state.chapterIndex = -1;
            updateChapterCounter();
            return;
        }
        state.chapterIndex = keepIndex && previous >= 0
            ? Math.min(previous, state.chapterMatches.length - 1)
            : -1;
        if (selectMatch) {
            selectChapterMatch(state.chapterIndex >= 0 ? state.chapterIndex : 0);
        } else {
            updateChapterCounter();
        }
    }

    function navigateChapterMatch(direction) {
        const query = ui.query?.value || '';
        if (!query.trim()) {
            invalidateChapterSearch();
            return;
        }

        const needsRefresh = state.chapterSearchDirty || !state.chapterMatches.length;
        if (needsRefresh) refreshChapterMatches(false, false);
        if (!state.chapterMatches.length) return;

        if (needsRefresh || state.chapterIndex < 0) {
            selectChapterMatch(firstMatchFromAnchor(direction));
            return;
        }
        selectChapterMatch(state.chapterIndex + direction);
    }

    function updateFormatBadges() {
        const pairs = [
            [state.chapterSearchFormat, ui.searchFormatSummary, ui.searchClearFormatBtn],
            [state.chapterReplaceFormat, ui.replaceFormatSummary, ui.replaceClearFormatBtn],
            [state.projectSearchFormat, ui.projectSearchFormatSummary, ui.projectSearchClearFormatBtn],
            [state.projectReplaceFormat, ui.projectReplaceFormatSummary, ui.projectReplaceClearFormatBtn]
        ];
        for (const [spec, summaryEl, clearBtn] of pairs) {
            const active = hasFormatSpec(spec);
            if (summaryEl) {
                summaryEl.hidden = !active;
                summaryEl.textContent = active ? formatSummary(spec) : '';
            }
            if (clearBtn) clearBtn.hidden = !active;
        }
    }

    function openChapterSearch(replaceMode = false, initial = {}) {
        if (!ui.bar) return;
        // Capturer la sélection AVANT de donner le focus au champ de recherche.
        // Ainsi, sélectionner « Darkside » puis appeler Rechercher/Remplacer
        // préremplit immédiatement le champ sans lancer de recherche automatique.
        const selectedText = selectedChapterText();
        rememberChapterAnchor();
        window.ecrivainApp?.showManuscript?.();
        state.chapterReplaceMode = Boolean(replaceMode);
        ui.bar.hidden = false;
        ui.replaceRow.hidden = !state.chapterReplaceMode;
        if (initial.query !== undefined) ui.query.value = initial.query;
        else if (selectedText) ui.query.value = selectedText;
        if (initial.caseSensitive !== undefined) ui.caseSensitive.checked = Boolean(initial.caseSensitive);
        if (initial.wholeWord !== undefined) ui.wholeWord.checked = Boolean(initial.wholeWord);
        if (initial.searchFormat !== undefined) state.chapterSearchFormat = cleanFormatSpec(initial.searchFormat);
        if (replaceMode && initial.replacement !== undefined) ui.replace.value = initial.replacement;
        if (replaceMode && initial.replacementFormat !== undefined) state.chapterReplaceFormat = cleanFormatSpec(initial.replacementFormat);
        updateFormatBadges();
        invalidateChapterSearch();
        window.setTimeout(() => {
            ui.query.focus();
            ui.query.select();
        }, 20);
    }

    function closeChapterSearch() {
        if (!ui.bar) return;
        ui.bar.hidden = true;
        state.chapterMatches = [];
        state.chapterIndex = -1;
        state.highlightAll = false;
        state.chapterSearchDirty = true;
        state.chapterAnchorRange = null;
        clearSearchHighlights();
    }

    function replaceCurrentChapterOccurrence() {
        if (!state.chapterMatches.length || state.chapterIndex < 0) refreshChapterMatches(false);
        const match = state.chapterMatches[state.chapterIndex];
        if (!match?.node?.isConnected) return;
        const oldIndex = state.chapterIndex;
        const value = String(ui.replace?.value ?? '');
        replaceTextNodeMatches(match.node, [{ start: match.start, end: match.end }], value, state.chapterReplaceFormat);
        ui.content.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: value }));

        state.chapterMatches = collectChapterMatches();
        renderSearchHighlights();
        if (!state.chapterMatches.length) {
            state.chapterIndex = -1;
            updateChapterCounter();
            return;
        }
        const replacementStillContainsQuery = findPositions(value, ui.query?.value || '', chapterOptions()).length > 0
            && !hasFormatSpec(state.chapterSearchFormat);
        selectChapterMatch(Math.min(oldIndex + (replacementStillContainsQuery ? 1 : 0), state.chapterMatches.length - 1));
    }

    function replaceAllChapterOccurrences() {
        const query = ui.query?.value || '';
        if (!query) return;
        refreshChapterMatches(false);
        if (!state.chapterMatches.length) {
            toast('Aucune occurrence à remplacer.');
            return;
        }
        const replacement = String(ui.replace?.value ?? '');
        const grouped = new Map();
        for (const match of state.chapterMatches) {
            if (!grouped.has(match.node)) grouped.set(match.node, []);
            grouped.get(match.node).push({ start: match.start, end: match.end });
        }
        let total = 0;
        for (const [node, positions] of grouped.entries()) {
            total += replaceTextNodeMatches(node, positions.sort((a, b) => a.start - b.start), replacement, state.chapterReplaceFormat);
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
        const selectedText = selectedChapterText();
        state.projectReplaceMode = Boolean(replaceMode);
        hideKnownViews();
        ui.projectView.hidden = false;
        ui.projectTitle.textContent = replaceMode ? 'Remplacer dans tout le projet' : 'Rechercher dans le projet';
        ui.projectReplaceWrap.hidden = !replaceMode;
        if (ui.projectReplaceFormatControls) ui.projectReplaceFormatControls.hidden = !replaceMode;
        ui.projectRun.textContent = replaceMode ? 'Prévisualiser' : 'Rechercher';
        updateFormatBadges();
        resetProjectResults();
        if (selectedText) ui.projectQuery.value = selectedText;
        window.setTimeout(() => {
            ui.projectQuery.focus();
            ui.projectQuery.select();
        }, 20);
    }

    function projectOptions() {
        return {
            caseSensitive: Boolean(ui.projectCase.checked),
            wholeWord: Boolean(ui.projectWhole.checked),
            searchFormat: cleanFormatSpec(state.projectSearchFormat)
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
            state.chapterSearchFormat = cleanFormatSpec(options.searchFormat);
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
        const replacementText = String(ui.projectReplace?.value ?? '');
        const formatOnly = replacementText.length === 0 && hasFormatSpec(state.projectReplaceFormat);
        const actionText = formatOnly
            ? `${result.totalOccurrences} ${result.totalOccurrences > 1 ? 'occurrences conserveront leur texte et recevront le nouveau format' : 'occurrence conservera son texte et recevra le nouveau format'}`
            : replacementText.length === 0
                ? `${result.totalOccurrences} ${result.totalOccurrences > 1 ? 'occurrences seront supprimées' : 'occurrence sera supprimée'}`
                : `${result.totalOccurrences} ${result.totalOccurrences > 1 ? 'occurrences seront remplacées' : 'occurrence sera remplacée'}`;
        ui.projectConfirmText.textContent = `${actionText} dans ${result.chapterCount} ${result.chapterCount > 1 ? 'chapitres' : 'chapitre'}. Une sauvegarde complète et un jalon d’historique seront créés avant les modifications.`;
        ui.projectConfirm.hidden = false;
        ui.projectConfirmRun.textContent = 'Confirmer le remplacement global';
        ui.projectConfirm.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    async function executeGlobalReplace() {
        const query = ui.projectQuery.value.trim();
        if (!query) return;
        const replacement = String(ui.projectReplace.value ?? '');
        ui.projectConfirmRun.disabled = true;
        try {
            // Le remplacement global travaille sur les fichiers du projet.
            // Sauvegarder d'abord le chapitre courant évite qu'une version encore
            // en mémoire ne soit perdue ou ne réécrase ensuite le résultat.
            const flushed = await window.ecrivainApp?.flushActiveChapter?.();
            if (flushed === false) throw new Error('Impossible d’enregistrer le chapitre courant avant le remplacement global.');
            const options = {
                ...projectOptions(),
                replacementFormat: cleanFormatSpec(state.projectReplaceFormat)
            };
            const result = await window.ecrivain.search.replaceProject(query, replacement, options);
            ui.projectConfirm.hidden = true;
            await window.ecrivainApp?.reloadProject?.();
            openProjectSearch(true);
            ui.projectQuery.value = query;
            ui.projectReplace.value = replacement;
            ui.projectCase.checked = Boolean(options.caseSensitive);
            ui.projectWhole.checked = Boolean(options.wholeWord);
            toast(`${result.replacements} ${result.replacements > 1 ? 'remplacements effectués' : 'remplacement effectué'} dans ${result.chapterCount} ${result.chapterCount > 1 ? 'chapitres' : 'chapitre'}.`);
            const refreshed = await window.ecrivain.search.project(query, projectOptions());
            renderProjectResults(refreshed);
        } catch (error) {
            toast(error.message || 'Remplacement global impossible.', true);
        } finally {
            ui.projectConfirmRun.disabled = false;
        }
    }

    function targetFormat(target) {
        if (target === 'chapter-search') return state.chapterSearchFormat;
        if (target === 'chapter-replace') return state.chapterReplaceFormat;
        if (target === 'project-search') return state.projectSearchFormat;
        if (target === 'project-replace') return state.projectReplaceFormat;
        return {};
    }

    function setTargetFormat(target, spec) {
        const value = cleanFormatSpec(spec);
        if (target === 'chapter-search') state.chapterSearchFormat = value;
        if (target === 'chapter-replace') state.chapterReplaceFormat = value;
        if (target === 'project-search') state.projectSearchFormat = value;
        if (target === 'project-replace') state.projectReplaceFormat = value;
        updateFormatBadges();
    }

    function switchFormatTab(name) {
        for (const tab of ui.formatTabs) tab.classList.toggle('is-active', tab.dataset.formatTab === name);
        for (const panel of ui.formatPanels) panel.classList.toggle('is-active', panel.dataset.formatPanel === name);
    }

    function populateFormatForm(spec = {}) {
        const value = cleanFormatSpec(spec);
        ui.formatFontFamily.value = value.fontFamily || '';
        ui.formatFontStyle.value = value.fontStyle || '';
        ui.formatFontSize.value = value.fontSizePt ?? '';
        ui.formatUnderline.value = value.underline === true ? 'yes' : value.underline === false ? 'no' : '';
        ui.formatStrike.value = value.strike === true ? 'yes' : value.strike === false ? 'no' : '';
        ui.formatUseColor.checked = Boolean(value.color);
        if (value.color && /^#[0-9a-f]{6}$/i.test(value.color)) ui.formatColor.value = value.color;
        ui.formatPosition.value = value.position || '';
        ui.formatUseBackground.checked = Boolean(value.backgroundColor);
        if (value.backgroundColor && /^#[0-9a-f]{6}$/i.test(value.backgroundColor)) ui.formatBackground.value = value.backgroundColor;
        updateFormatPreview();
    }

    function readFormatForm() {
        return cleanFormatSpec({
            fontFamily: ui.formatFontFamily.value,
            fontStyle: ui.formatFontStyle.value,
            fontSizePt: ui.formatFontSize.value,
            underline: ui.formatUnderline.value === 'yes' ? true : ui.formatUnderline.value === 'no' ? false : null,
            strike: ui.formatStrike.value === 'yes' ? true : ui.formatStrike.value === 'no' ? false : null,
            position: ui.formatPosition.value,
            color: ui.formatUseColor.checked ? ui.formatColor.value : null,
            backgroundColor: ui.formatUseBackground.checked ? ui.formatBackground.value : null
        });
    }

    function updateFormatPreview() {
        if (!ui.formatPreview) return;
        ui.formatPreview.removeAttribute('style');
        ui.formatPreview.className = 'search-format-preview';
        const spec = readFormatForm();
        applyFormatStyles(ui.formatPreview, spec);
        if (!spec.color) ui.formatPreview.style.color = '#2e2a27';
        if (!spec.backgroundColor) ui.formatPreview.style.backgroundColor = '#fff';
    }

    function openFormatDialog(target) {
        if (!ui.formatBackdrop) return;
        state.formatTarget = target;
        const replacementTarget = target.endsWith('replace');
        ui.formatTitle.textContent = replacementTarget ? 'Format du remplacement' : 'Format à rechercher';
        ui.formatIntro.textContent = replacementTarget
            ? 'Choisissez uniquement les attributs à appliquer au texte remplacé. « Indifférent » conserve le format existant pour cet attribut.'
            : 'Choisissez les attributs que le texte recherché doit posséder. « Indifférent » accepte tous les formats pour cet attribut.';
        populateFormatForm(targetFormat(target));
        switchFormatTab('font');
        ui.formatBackdrop.hidden = false;
        window.setTimeout(() => ui.formatFontFamily?.focus(), 20);
    }

    function closeFormatDialog() {
        if (ui.formatBackdrop) ui.formatBackdrop.hidden = true;
        state.formatTarget = null;
    }

    function applyFormatDialog() {
        const target = state.formatTarget;
        if (!target) return closeFormatDialog();
        setTargetFormat(target, readFormatForm());
        closeFormatDialog();
        if (target === 'chapter-search') invalidateChapterSearch();
        if (target === 'project-search' && state.lastProjectResult) runProjectSearch();
    }

    function clearFormatTarget(target) {
        setTargetFormat(target, EMPTY_FORMAT);
        if (target === 'chapter-search') invalidateChapterSearch();
        if (target === 'project-search' && state.lastProjectResult) runProjectSearch();
    }

    document.addEventListener('selectionchange', () => {
        // Ne mémoriser que les mouvements réellement effectués dans l’éditeur.
        // Ainsi l’ouverture du menu natif ne détruit pas la sélection sauvegardée.
        if (document.activeElement === ui.content) rememberChapterAnchor();
    });

    // La saisie ne déclenche jamais de recherche : l'auteur garde le contrôle
    // de son curseur. La recherche démarre uniquement avec ↑, ↓, Entrée ou
    // « Tout rechercher ».
    ui.query?.addEventListener('input', () => invalidateChapterSearch());
    ui.caseSensitive?.addEventListener('change', () => invalidateChapterSearch());
    ui.wholeWord?.addEventListener('change', () => invalidateChapterSearch());
    ui.prev?.addEventListener('click', () => navigateChapterMatch(-1));
    ui.next?.addEventListener('click', () => navigateChapterMatch(1));
    ui.all?.addEventListener('click', () => {
        state.highlightAll = true;
        refreshChapterMatches(false, false);
        const total = state.chapterMatches.length;
        toast(total ? `${total} ${total > 1 ? 'occurrences trouvées' : 'occurrence trouvée'} dans ce chapitre.` : 'Aucune occurrence trouvée.');
    });
    ui.close?.addEventListener('click', closeChapterSearch);
    ui.replaceOne?.addEventListener('click', replaceCurrentChapterOccurrence);
    ui.replaceAll?.addEventListener('click', replaceAllChapterOccurrences);
    ui.searchFormatBtn?.addEventListener('click', () => openFormatDialog('chapter-search'));
    ui.searchClearFormatBtn?.addEventListener('click', () => clearFormatTarget('chapter-search'));
    ui.replaceFormatBtn?.addEventListener('click', () => openFormatDialog('chapter-replace'));
    ui.replaceClearFormatBtn?.addEventListener('click', () => clearFormatTarget('chapter-replace'));
    ui.query?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            navigateChapterMatch(event.shiftKey ? -1 : 1);
        }
        if (event.key === 'Escape') closeChapterSearch();
    });
    ui.content?.addEventListener('input', () => {
        if (ui.bar?.hidden) return;
        // IMPORTANT : ne jamais sélectionner une occurrence pendant la frappe.
        // C'était la cause du curseur qui quittait le texte en bêta.7.
        window.setTimeout(() => {
            rememberChapterAnchor();
            invalidateChapterSearch();
        }, 0);
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
    ui.projectSearchFormatBtn?.addEventListener('click', () => openFormatDialog('project-search'));
    ui.projectSearchClearFormatBtn?.addEventListener('click', () => clearFormatTarget('project-search'));
    ui.projectReplaceFormatBtn?.addEventListener('click', () => openFormatDialog('project-replace'));
    ui.projectReplaceClearFormatBtn?.addEventListener('click', () => clearFormatTarget('project-replace'));
    ui.projectReplaceAction?.addEventListener('click', showGlobalReplaceConfirmation);
    ui.projectConfirmCancel?.addEventListener('click', () => { ui.projectConfirm.hidden = true; });
    ui.projectConfirmRun?.addEventListener('click', executeGlobalReplace);

    for (const tab of ui.formatTabs) tab.addEventListener('click', () => switchFormatTab(tab.dataset.formatTab));
    for (const control of [
        ui.formatFontFamily, ui.formatFontStyle, ui.formatFontSize, ui.formatUnderline,
        ui.formatStrike, ui.formatUseColor, ui.formatColor, ui.formatPosition,
        ui.formatUseBackground, ui.formatBackground
    ]) {
        control?.addEventListener('input', updateFormatPreview);
        control?.addEventListener('change', updateFormatPreview);
    }

    // Choisir réellement une couleur doit suffire à l'activer. La case à cocher
    // reste utile pour désactiver le critère sans perdre la couleur choisie,
    // mais l'auteur n'a plus à penser à la cocher après avoir utilisé le sélecteur.
    ui.formatColor?.addEventListener('input', () => {
        if (ui.formatUseColor) ui.formatUseColor.checked = true;
        updateFormatPreview();
    });
    ui.formatColor?.addEventListener('change', () => {
        if (ui.formatUseColor) ui.formatUseColor.checked = true;
        updateFormatPreview();
    });
    ui.formatBackground?.addEventListener('input', () => {
        if (ui.formatUseBackground) ui.formatUseBackground.checked = true;
        updateFormatPreview();
    });
    ui.formatBackground?.addEventListener('change', () => {
        if (ui.formatUseBackground) ui.formatUseBackground.checked = true;
        updateFormatPreview();
    });
    ui.formatReset?.addEventListener('click', () => populateFormatForm(EMPTY_FORMAT));
    ui.formatCancel?.addEventListener('click', closeFormatDialog);
    ui.formatClose?.addEventListener('click', closeFormatDialog);
    ui.formatApply?.addEventListener('click', applyFormatDialog);
    ui.formatBackdrop?.addEventListener('mousedown', (event) => {
        if (event.target === ui.formatBackdrop) closeFormatDialog();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && ui.formatBackdrop && !ui.formatBackdrop.hidden) {
            event.preventDefault();
            closeFormatDialog();
        }
    });

    updateFormatBadges();

    window.ecrivainSearch = {
        openChapterSearch,
        closeChapterSearch,
        openProjectSearch,
        closeProjectView
    };
})();
