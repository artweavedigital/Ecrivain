(() => {
    'use strict';

    const editor = document.getElementById('chapterContent');
    const dialogueButton = document.getElementById('insertDialogueDash');
    const typographyButton = document.getElementById('normalizeTypography');
    const invisibleOverlay = document.getElementById('chapterInvisibleOverlay');
    const paperWrap = editor?.closest('.paper-wrap');

    if (!editor) return;

    const NBSP = '\u00A0';
    const NNBSP = '\u202F';

    function editorIsAvailable() {
        return !editor.closest('[hidden]') && editor.isContentEditable;
    }

    function markEditorChanged() {
        editor.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            inputType: 'insertText',
            data: null
        }));
    }

    function insertText(text) {
        if (!editorIsAvailable()) return;
        editor.focus();
        document.execCommand('insertText', false, text);
        markEditorChanged();
    }

    function selectionInsideEditor() {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return false;
        const node = selection.getRangeAt(0).commonAncestorContainer;
        const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
        return Boolean(element && editor.contains(element));
    }

    function normalizeText(text) {
        let value = String(text || '');

        // Apostrophes et points de suspension.
        value = value.replace(/([\p{L}\p{N}])'(?=[\p{L}\p{N}])/gu, '$1’');
        value = value.replace(/\.\.\./g, '…');

        // Espaces indésirables avant ponctuation basse.
        value = value.replace(/[ \t\u00A0\u202F]+([,.])/g, '$1');

        // Ponctuation haute française : insécable devant « : », fine insécable
        // devant « ; ? ! ». Les espaces après restent normales.
        value = value.replace(/[ \t\u00A0\u202F]*:/g, `${NBSP}:`);
        value = value.replace(/[ \t\u00A0\u202F]*([;?!])/g, `${NNBSP}$1`);

        // Guillemets français : insécables à l'intérieur.
        value = value.replace(/«[ \t\u00A0\u202F]*/g, `«${NBSP}`);
        value = value.replace(/[ \t\u00A0\u202F]*»/g, `${NBSP}»`);

        // Une seule espace après la ponctuation, sans toucher aux retours de ligne.
        value = value.replace(/([,:;?!])[ \t\u00A0\u202F]{2,}/g, '$1 ');

        // Espace insécable devant certains symboles typographiques fréquents.
        value = value.replace(/[ \t\u00A0\u202F]*([%€])/g, `${NBSP}$1`);

        return value;
    }

    function firstTextNode(block) {
        const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
        return walker.nextNode();
    }

    function normalizeBlock(block) {
        const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
        const nodes = [];
        let node;
        while ((node = walker.nextNode())) nodes.push(node);

        for (const textNode of nodes) {
            textNode.nodeValue = normalizeText(textNode.nodeValue);
        }

        // Dialogue français : un paragraphe qui commence par « - » devient
        // automatiquement un tiret cadratin. On ne touche pas aux tirets
        // placés au milieu d'une phrase.
        const first = firstTextNode(block);
        if (first) {
            first.nodeValue = first.nodeValue.replace(/^\s*-\s+/, '— ');
        }
    }

    let invisiblesVisible = false;
    let invisibleRefreshTimer = null;

    // Les caractères invisibles sont dessinés sur un canevas à partir des
    // coordonnées RÉELLES du texte affiché (Range.getClientRects()).
    // Le manuscrit n'est jamais cloné ni modifié : les repères restent donc
    // exactement entre les mots et au bout des lignes/paragraphes.
    function visibleRectsForRange(textNode, startOffset, endOffset) {
        const range = document.createRange();
        try {
            range.setStart(textNode, startOffset);
            range.setEnd(textNode, endOffset);
        } catch {
            return [];
        }

        return Array.from(range.getClientRects()).filter((rect) =>
            Number.isFinite(rect.left) &&
            Number.isFinite(rect.top) &&
            rect.height > 2 &&
            rect.width > 0.35
        );
    }

    function overlayPoint(rect, wrapRect) {
        return {
            x: rect.left - wrapRect.left + paperWrap.scrollLeft + (rect.width / 2),
            y: rect.top - wrapRect.top + paperWrap.scrollTop + (rect.height / 2)
        };
    }

    function prepareInvisibleCanvas() {
        if (!invisibleOverlay || !paperWrap) return null;

        invisibleOverlay.innerHTML = '';

        const width = Math.max(paperWrap.scrollWidth, paperWrap.clientWidth);
        const height = Math.max(paperWrap.scrollHeight, paperWrap.clientHeight);
        const dpr = Math.max(1, window.devicePixelRatio || 1);

        const canvas = document.createElement('canvas');
        canvas.className = 'invisible-canvas';
        canvas.width = Math.ceil(width * dpr);
        canvas.height = Math.ceil(height * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        canvas.setAttribute('aria-hidden', 'true');

        invisibleOverlay.style.width = `${width}px`;
        invisibleOverlay.style.height = `${height}px`;
        invisibleOverlay.appendChild(canvas);

        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        return { ctx, width, height };
    }

    function drawMarker(ctx, symbol, x, y, kind = 'space') {
        const styles = {
            space:     { font: '800 18px "Segoe UI Symbol", Arial, sans-serif', color: '#d71920', dy: -0.5 },
            nbsp:      { font: '800 17px "Segoe UI Symbol", Arial, sans-serif', color: '#c3151b', dy: -0.5 },
            nnbsp:     { font: '900 15px "Segoe UI Symbol", Arial, sans-serif', color: '#b90f17', dy: -0.5 },
            paragraph: { font: '800 19px "Segoe UI Symbol", Arial, sans-serif', color: '#d71920', dy: -0.5 },
            break:     { font: '900 19px "Segoe UI Symbol", Arial, sans-serif', color: '#d71920', dy: -0.5 }
        };
        const style = styles[kind] || styles.space;

        ctx.save();
        ctx.font = style.font;
        ctx.fillStyle = style.color;
        // Un fin halo clair garde le repère lisible au-dessus des soulignements
        // du correcteur orthographique sans masquer le texte.
        ctx.shadowColor = 'rgba(255,255,255,.95)';
        ctx.shadowBlur = 1.4;
        ctx.fillText(symbol, x, y + style.dy);
        ctx.restore();
    }

    function drawWhitespaceMarkers(ctx, wrapRect) {
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        });

        let node;
        while ((node = walker.nextNode())) {
            const text = node.nodeValue || '';
            if (!/[ \t\r\n\u00A0\u202F]/.test(text)) continue;

            // Une suite d'espaces / tabulations / retours techniques HTML est
            // fusionnée par Chromium en un seul espace visuel. On dessine donc
            // un seul point par rectangle réellement rendu.
            const re = /[ \t\r\n]+|\u00A0|\u202F/g;
            let match;
            while ((match = re.exec(text))) {
                const token = match[0];
                const start = match.index;
                const end = start + token.length;
                const kind = token === NBSP ? 'nbsp' : token === NNBSP ? 'nnbsp' : 'space';
                const symbol = kind === 'space' ? '·' : kind === 'nbsp' ? '°' : '•';

                for (const rect of visibleRectsForRange(node, start, end)) {
                    const point = overlayPoint(rect, wrapRect);
                    drawMarker(ctx, symbol, point.x, point.y, kind);
                }
            }
        }
    }

    function lastRenderedRect(block) {
        const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
        const nodes = [];
        let node;
        while ((node = walker.nextNode())) nodes.push(node);

        for (let i = nodes.length - 1; i >= 0; i -= 1) {
            const textNode = nodes[i];
            const text = textNode.nodeValue || '';
            for (let j = text.length - 1; j >= 0; j -= 1) {
                if (/[ \t\r\n\u00A0\u202F]/.test(text[j])) continue;
                const rects = visibleRectsForRange(textNode, j, j + 1);
                if (rects.length) return rects[rects.length - 1];
            }
        }

        // Bloc vide : le marqueur ¶ est placé au début de la ligne du bloc.
        const blockRect = block.getBoundingClientRect();
        if (blockRect.height > 0) {
            return {
                left: blockRect.left + 2,
                right: blockRect.left + 2,
                top: blockRect.top,
                bottom: blockRect.top + Math.min(blockRect.height, 24),
                width: 0,
                height: Math.min(blockRect.height, 24)
            };
        }
        return null;
    }

    function isPlaceholderBreak(br) {
        const parent = br.parentElement;
        if (!parent) return false;
        const tag = parent.tagName.toLowerCase();
        if (!['p', 'div', 'blockquote', 'h1', 'h2', 'h3', 'li'].includes(tag)) return false;
        return parent.textContent.trim() === '' && parent.querySelectorAll('br').length === 1;
    }

    function drawBreakMarkers(ctx, wrapRect) {
        for (const br of editor.querySelectorAll('br')) {
            // Le <br> créé automatiquement dans un paragraphe vide n'est pas
            // un retour manuel saisi par l'auteur : on n'affiche que ¶.
            if (isPlaceholderBreak(br)) continue;

            let rect = null;
            const parent = br.parentNode;

            // On prend le dernier rectangle réellement rendu AVANT le <br>.
            // Le symbole ↵ se place ainsi à la fin exacte de la ligne quittée.
            if (parent) {
                try {
                    const range = document.createRange();
                    range.setStart(parent, 0);
                    range.setEndBefore(br);
                    const rects = Array.from(range.getClientRects()).filter((item) => item.height > 2 && item.width > 0.35);
                    if (rects.length) rect = rects[rects.length - 1];
                } catch {
                    rect = null;
                }
            }

            if (rect) {
                const x = rect.right - wrapRect.left + paperWrap.scrollLeft + 10;
                const y = rect.top - wrapRect.top + paperWrap.scrollTop + (rect.height / 2);
                drawMarker(ctx, '↵', x, y, 'break');
                continue;
            }

            // Retour en début de ligne ou ligne vide : position de secours.
            const brRect = br.getBoundingClientRect();
            const baseRect = brRect.height > 0 ? brRect : br.parentElement?.getBoundingClientRect();
            if (!baseRect || baseRect.height <= 0) continue;
            const x = baseRect.left - wrapRect.left + paperWrap.scrollLeft + 8;
            const y = baseRect.top - wrapRect.top + paperWrap.scrollTop + (baseRect.height / 2);
            drawMarker(ctx, '↵', x, y, 'break');
        }
    }

    function drawParagraphMarkers(ctx, wrapRect) {
        const blocks = editor.querySelectorAll('p, div, blockquote, h1, h2, h3, li');
        for (const block of blocks) {
            // Évite un ¶ sur un conteneur qui ne fait qu'englober d'autres blocs.
            if (block.querySelector(':scope > p, :scope > div, :scope > blockquote, :scope > h1, :scope > h2, :scope > h3, :scope > li')) continue;

            const rect = lastRenderedRect(block);
            if (!rect) continue;

            const x = rect.right - wrapRect.left + paperWrap.scrollLeft + 10;
            const y = rect.top - wrapRect.top + paperWrap.scrollTop + (rect.height / 2);
            drawMarker(ctx, '¶', x, y, 'paragraph');
        }
    }

    function renderInvisibleMarkers() {
        if (!invisiblesVisible || !invisibleOverlay || !paperWrap || editor.closest('[hidden]')) return;

        const prepared = prepareInvisibleCanvas();
        if (!prepared) return;

        const { ctx } = prepared;
        const wrapRect = paperWrap.getBoundingClientRect();

        drawWhitespaceMarkers(ctx, wrapRect);
        drawBreakMarkers(ctx, wrapRect);
        drawParagraphMarkers(ctx, wrapRect);
    }

    function scheduleInvisibleRefresh() {
        if (!invisiblesVisible) return;
        window.clearTimeout(invisibleRefreshTimer);
        invisibleRefreshTimer = window.setTimeout(renderInvisibleMarkers, 60);
    }

    function toggleInvisibles(force) {
        invisiblesVisible = typeof force === 'boolean' ? force : !invisiblesVisible;
        invisibleOverlay?.classList.toggle('is-visible', invisiblesVisible);
        if (invisiblesVisible) window.requestAnimationFrame(renderInvisibleMarkers);
        else if (invisibleOverlay) invisibleOverlay.innerHTML = '';
        return invisiblesVisible;
    }

    function normalizeTypography() {
        if (!editorIsAvailable()) return false;

        const blocks = Array.from(editor.querySelectorAll('p, div, blockquote, h1, h2, h3, li'));
        if (blocks.length) {
            for (const block of blocks) normalizeBlock(block);
        } else {
            normalizeBlock(editor);
        }

        markEditorChanged();
        editor.focus();
        scheduleInvisibleRefresh();
        return true;
    }

    // Empêche les boutons de voler la sélection dans le texte.
    document.querySelectorAll('[data-insert], #insertDialogueDash, #normalizeTypography').forEach((button) => {
        button.addEventListener('mousedown', (event) => event.preventDefault());
    });

    document.querySelectorAll('[data-insert]').forEach((button) => {
        button.addEventListener('click', () => insertText(button.dataset.insert || ''));
    });

    dialogueButton?.addEventListener('click', () => insertText('— '));
    typographyButton?.addEventListener('click', () => normalizeTypography());

    // Apostrophe française pendant la frappe. Cette correction est volontairement
    // limitée à l'apostrophe : la ponctuation haute est normalisée via « Typo FR »
    // pour ne pas perturber le curseur pendant l'écriture.
    editor.addEventListener('input', scheduleInvisibleRefresh);
    window.addEventListener('resize', scheduleInvisibleRefresh);

    editor.addEventListener('beforeinput', (event) => {
        if (event.inputType !== 'insertText' || event.data !== "'") return;
        if (!selectionInsideEditor()) return;
        event.preventDefault();
        document.execCommand('insertText', false, '’');
        markEditorChanged();
    });

    window.ecrivainEditor = {
        insertText,
        insertDialogue: () => insertText('— '),
        normalizeTypography,
        toggleInvisibles,
        refreshInvisibles: scheduleInvisibleRefresh
    };
})();
