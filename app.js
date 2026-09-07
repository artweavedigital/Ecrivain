'use strict';

window.addEventListener('error', (event) => {
    window.ecrivain?.diagnostics?.log?.('error', 'Erreur JavaScript dans l’interface.', {
        message: event.message || '',
        filename: event.filename || '',
        line: event.lineno || 0,
        column: event.colno || 0,
        stack: event.error?.stack || ''
    }).catch(() => {});
});

window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    window.ecrivain?.diagnostics?.log?.('error', 'Promesse rejetée dans l’interface.', {
        message: reason?.message || String(reason || ''),
        stack: reason?.stack || ''
    }).catch(() => {});
});

(() => {
    const state = {
        projectDir: null,
        project: null,
        chapters: [],
        activeId: null,
        dirty: false,
        autosaveTimer: null,
        draggedId: null,
        currentView: 'manuscript',
        synopsisCards: [],
        synopsisTypes: {},
        synopsisStatuses: {},
        synopsisColors: {},
        synopsisFilter: 'all',
        synopsisDraggedId: null,
        contextChapterId: null,
        preferences: { autosaveDelayMs: 1800 }
    };

    const $ = (id) => document.getElementById(id);

    const ui = {
        projectTitle: $('projectTitle'),
        projectSubtitle: $('projectSubtitle'),
        languageChip: $('languageChip'),
        chapterCount: $('chapterCount'),
        wordCount: $('wordCount'),
        sidebar: $('sidebar'),
        chapterList: $('chapterList'),
        emptySidebar: $('emptySidebar'),
        newChapterBtn: $('newChapterBtn'),
        welcome: $('welcome'),
        welcomeNew: $('welcomeNew'),
        welcomeOpen: $('welcomeOpen'),
        editorArea: $('editorArea'),
        synopsisView: $('synopsisView'),
        synopsisBackBtn: $('synopsisBackBtn'),
        synopsisNewBtn: $('synopsisNewBtn'),
        synopsisFilters: $('synopsisFilters'),
        synopsisCount: $('synopsisCount'),
        synopsisEmpty: $('synopsisEmpty'),
        synopsisBoard: $('synopsisBoard'),
        chapterTitle: $('chapterTitle'),
        chapterStatus: $('chapterStatus'),
        chapterContent: $('chapterContent'),
        saveState: $('saveState'),
        saveBtn: $('saveBtn'),
        activeProjectPath: $('activeProjectPath'),
        chapterWords: $('chapterWords'),
        zoomOutBtn: $('zoomOutBtn'),
        zoomInBtn: $('zoomInBtn'),
        zoomSlider: $('zoomSlider'),
        zoomLabel: $('zoomLabel'),
        fullscreenExitBtn: $('fullscreenExitBtn'),
        modalBackdrop: $('modalBackdrop'),
        modalTitle: $('modalTitle'),
        modalBody: $('modalBody'),
        modalCancel: $('modalCancel'),
        modalConfirm: $('modalConfirm'),
        chapterContextMenu: $('chapterContextMenu'),
        toast: $('toast')
    };

    const statusLabels = {
        draft: 'Brouillon',
        writing: 'En cours',
        review: 'À relire',
        final: 'Finalisé',
        'in-progress': 'En cours',
        done: 'Finalisé',
        cut: 'Coupé'
    };


    const manuscriptFonts = [
        'Garamond', 'EB Garamond', 'Georgia', 'Palatino Linotype', 'Book Antiqua',
        'Times New Roman', 'Cambria', 'Constantia', 'Calibri', 'Arial'
    ];

    function activeChapter() {
        return state.chapters.find((ch) => ch.id === state.activeId) || null;
    }

    function countWordsFromHtml(html) {
        const box = document.createElement('div');
        box.innerHTML = html || '';
        const text = (box.textContent || '').replace(/\s+/g, ' ').trim();
        return text ? text.split(' ').filter(Boolean).length : 0;
    }


    function numericValue(value, fallback) {
        const parsed = Number(String(value ?? '').replace(',', '.'));
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function applyDocumentSettings() {
        const project = state.project || {};
        const indentMm = numericValue(project.paragraphIndentMm, 5);
        const beforeMm = numericValue(project.paragraphSpacingBeforeMm, 0);
        const afterMm = numericValue(project.paragraphSpacingAfterMm, 0);

        ui.chapterContent.style.setProperty('--paragraph-indent', `${indentMm}mm`);
        ui.chapterContent.style.setProperty('--paragraph-space-before', `${beforeMm}mm`);
        ui.chapterContent.style.setProperty('--paragraph-space-after', `${afterMm}mm`);
        ui.chapterContent.style.textAlign = 'justify';

        // IMPORTANT : la police et le corps choisis dans la configuration sont
        // des paramètres d'EXPORT. On ne les injecte pas dans le contenu HTML
        // de l'éditeur et on ne modifie jamais le HTML source à l'ouverture.
        // Cela évite qu'un ancien contenu importé (font, styles LibreOffice, etc.)
        // soit masqué ou réinterprété par l'interface.
        ui.chapterContent.style.removeProperty('font-family');
        ui.chapterContent.style.removeProperty('font-size');
        ui.chapterContent.style.removeProperty('color');

        const endMarker = document.getElementById('chapterEndMarker');
        if (endMarker) endMarker.hidden = project.chapterPageBreak === false;
        window.ecrivainEditor?.refreshInvisibles?.();
    }

    function markDirty() {
        if (!activeChapter()) return;
        state.dirty = true;
        ui.saveState.textContent = 'À enregistrer';
        ui.saveState.classList.add('is-dirty');
        updateWordIndicators();

        window.clearTimeout(state.autosaveTimer);
        state.autosaveTimer = window.setTimeout(() => saveActiveChapter(true), Number(state.preferences?.autosaveDelayMs || 1800));
    }

    function markSaved(auto = false) {
        state.dirty = false;
        ui.saveState.textContent = auto ? 'Enregistré automatiquement' : 'Enregistré';
        ui.saveState.classList.remove('is-dirty');
    }

    function updateWordIndicators() {
        const ch = activeChapter();
        const currentWords = ch && state.activeId === ch.id ? countWordsFromHtml(ui.chapterContent.innerHTML) : 0;
        ui.chapterWords.textContent = `${currentWords} ${currentWords > 1 ? 'mots' : 'mot'}`;

        let total = 0;
        for (const chapter of state.chapters) {
            if (chapter.id === state.activeId) total += currentWords;
            else total += Number(chapter.wordCount || countWordsFromHtml(chapter.content || ''));
        }
        ui.wordCount.textContent = `${total} ${total > 1 ? 'mots' : 'mot'}`;
    }

    function setProjectState(payload) {
        if (!payload) return;
        state.projectDir = payload.projectDir;
        state.project = payload.project;
        state.chapters = Array.isArray(payload.chapters) ? payload.chapters : [];
        state.activeId = state.chapters[0]?.id || null;
        state.dirty = false;
        state.currentView = 'manuscript';
        state.synopsisCards = [];
        state.synopsisFilter = 'all';
        ui.synopsisView.hidden = true;
        const globalSynopsisView = document.getElementById('globalSynopsisView');
        if (globalSynopsisView) globalSynopsisView.hidden = true;
        const notesView = document.getElementById('notesView');
        if (notesView) notesView.hidden = true;
        const timelineView = document.getElementById('timelineView');
        if (timelineView) timelineView.hidden = true;
        const statsView = document.getElementById('statsView');
        if (statsView) statsView.hidden = true;
        const mindmapView = document.getElementById('mindmapView');
        if (mindmapView) mindmapView.hidden = true;
        const backupsView = document.getElementById('backupsView');
        if (backupsView) backupsView.hidden = true;
        const historyView = document.getElementById('historyView');
        if (historyView) historyView.hidden = true;
        const projectSearchView = document.getElementById('projectSearchView');
        if (projectSearchView) projectSearchView.hidden = true;
        const aiView = document.getElementById('aiView');
        if (aiView) aiView.hidden = true;
        const preferencesView = document.getElementById('preferencesView');
        if (preferencesView) preferencesView.hidden = true;

        ui.projectTitle.textContent = state.project?.title || 'Projet';
        ui.projectSubtitle.textContent = state.project?.subtitle || state.project?.author || 'Projet d’écriture';
        ui.languageChip.textContent = String(state.project?.language || 'fr').toUpperCase();
        ui.activeProjectPath.textContent = state.projectDir || '';
        applyDocumentSettings();

        renderChapters();
        renderActiveChapter();
        updateProjectIndicators();
    }

    function updateProjectIndicators() {
        const n = state.chapters.length;
        ui.chapterCount.textContent = `${n} ${n > 1 ? 'chapitres' : 'chapitre'}`;
        updateWordIndicators();
    }

    function chapterDisplayNumber(chapter) {
        let rootNo = 0;
        for (const ch of state.chapters) {
            if (Number(ch._depth || 0) === 0) rootNo += 1;
            if (ch.id === chapter.id) return Number(ch._depth || 0) === 0 ? rootNo : '';
        }
        return '';
    }

    function chapterById(id) {
        return state.chapters.find((chapter) => chapter.id === id) || null;
    }

    function chapterSiblings(chapter) {
        if (!chapter) return [];
        const parentKey = chapter.parent || '';
        return state.chapters.filter((item) => (item.parent || '') === parentKey);
    }

    function isLastSibling(chapter) {
        const siblings = chapterSiblings(chapter);
        return Boolean(chapter && siblings.length && siblings[siblings.length - 1]?.id === chapter.id);
    }

    function chapterAncestors(chapter) {
        const ancestors = [];
        const visited = new Set();
        let current = chapter;
        while (current?.parent && !visited.has(current.parent)) {
            visited.add(current.parent);
            const parent = chapterById(current.parent);
            if (!parent) break;
            ancestors.unshift(parent);
            current = parent;
        }
        return ancestors;
    }

    function buildTreeGuides(chapter) {
        const depth = Number(chapter?._depth || 0);
        const wrap = document.createElement('span');
        wrap.className = 'chapter-tree-guides';
        wrap.setAttribute('aria-hidden', 'true');
        if (depth <= 0) return wrap;

        const ancestors = chapterAncestors(chapter);
        for (let level = 0; level < depth; level += 1) {
            const guide = document.createElement('span');
            guide.className = 'chapter-tree-guide';
            guide.style.setProperty('--tree-level', level);
            if (level === depth - 1) {
                guide.classList.add(isLastSibling(chapter) ? 'is-branch-last' : 'is-branch');
            } else {
                const ancestor = ancestors[level];
                if (ancestor && !isLastSibling(ancestor)) guide.classList.add('is-continuation');
            }
            wrap.appendChild(guide);
        }
        return wrap;
    }

    function canIndentChapter(chapter) {
        if (!chapter) return false;
        const siblings = chapterSiblings(chapter);
        return siblings.findIndex((item) => item.id === chapter.id) > 0;
    }

    function closeChapterContextMenu() {
        if (!ui.chapterContextMenu) return;
        ui.chapterContextMenu.hidden = true;
        state.contextChapterId = null;
    }

    function updateContextMenuState(chapter) {
        if (!ui.chapterContextMenu || !chapter) return;
        ui.chapterContextMenu.querySelectorAll('[data-context-status]').forEach((button) => {
            const active = button.dataset.contextStatus === normalizeStatus(chapter.status);
            button.classList.toggle('is-current', active);
            button.setAttribute('aria-checked', active ? 'true' : 'false');
        });
        const indent = ui.chapterContextMenu.querySelector('[data-context-action="indent"]');
        const outdent = ui.chapterContextMenu.querySelector('[data-context-action="outdent"]');
        if (indent) indent.disabled = !canIndentChapter(chapter);
        if (outdent) outdent.disabled = !chapter.parent;
    }

    async function openChapterContextMenu(event, chapterId) {
        event.preventDefault();
        event.stopPropagation();
        if (!ui.chapterContextMenu) return;

        if (chapterId !== state.activeId) {
            if (state.dirty) await saveActiveChapter(true);
            state.activeId = chapterId;
            renderChapters();
            renderActiveChapter();
        }

        const chapter = activeChapter();
        if (!chapter) return;
        state.contextChapterId = chapter.id;
        updateContextMenuState(chapter);
        ui.chapterContextMenu.hidden = false;

        requestAnimationFrame(() => {
            const rect = ui.chapterContextMenu.getBoundingClientRect();
            const pad = 8;
            const left = Math.max(pad, Math.min(event.clientX, window.innerWidth - rect.width - pad));
            const top = Math.max(pad, Math.min(event.clientY, window.innerHeight - rect.height - pad));
            ui.chapterContextMenu.style.left = `${left}px`;
            ui.chapterContextMenu.style.top = `${top}px`;
        });
    }

    async function setActiveChapterStatus(status) {
        const chapter = activeChapter();
        const normalized = normalizeStatus(status);
        if (!chapter || !['draft', 'writing', 'review', 'final', 'cut'].includes(normalized)) return;
        ui.chapterStatus.value = normalized;
        markDirty();
        await saveActiveChapter(false);
        showToast(`Statut : ${statusLabels[normalized]}.`);
    }

    async function handleChapterContextAction(event) {
        const button = event.target.closest('button');
        if (!button || button.disabled) return;
        const status = button.dataset.contextStatus;
        const action = button.dataset.contextAction;
        closeChapterContextMenu();

        if (status) return setActiveChapterStatus(status);
        if (action === 'open') return;
        if (action === 'new-child') return newSubchapter();
        if (action === 'indent') return changeActiveChapterLevel('right');
        if (action === 'outdent') return changeActiveChapterLevel('left');
        if (action === 'rename') return renameActiveChapter();
        if (action === 'duplicate') return duplicateActiveChapter();
        if (action === 'delete') return deleteActiveChapter();
    }

    function renderChapters() {
        ui.chapterList.innerHTML = '';
        ui.emptySidebar.hidden = state.chapters.length > 0;

        for (const chapter of state.chapters) {
            const item = document.createElement('div');
            item.className = `chapter-item${chapter.id === state.activeId ? ' is-active' : ''}`;
            item.dataset.id = chapter.id;
            item.dataset.parent = chapter.parent || '';
            item.dataset.depth = String(Number(chapter._depth || 0));
            item.draggable = true;
            item.style.setProperty('--depth', Number(chapter._depth || 0));

            const guides = buildTreeGuides(chapter);

            const handle = document.createElement('span');
            handle.className = 'drag-handle';
            handle.textContent = '⋮⋮';
            handle.title = 'Déplacer le chapitre';

            const copy = document.createElement('div');
            copy.className = 'chapter-copy';
            const titleLine = document.createElement('div');
            titleLine.className = 'chapter-title-line';
            const dot = document.createElement('span');
            const normalizedStatus = normalizeStatus(chapter.status);
            dot.className = `chapter-status-dot status-${normalizedStatus}`;
            dot.title = statusLabels[normalizedStatus] || 'Brouillon';
            const name = document.createElement('span');
            name.className = 'chapter-name';
            name.textContent = chapter.title || 'Sans titre';
            titleLine.append(dot, name);
            const sub = document.createElement('small');
            sub.className = 'chapter-state';
            const chapterStatus = statusLabels[normalizedStatus] || 'Brouillon';
            sub.textContent = Number(chapter._depth || 0) > 0 ? `Sous-chapitre · ${chapterStatus}` : chapterStatus;
            copy.append(titleLine, sub);

            const number = document.createElement('span');
            number.className = 'chapter-no';
            number.textContent = chapterDisplayNumber(chapter);

            item.append(guides, handle, copy, number);
            item.addEventListener('click', () => selectChapter(chapter.id));
            item.addEventListener('contextmenu', (event) => openChapterContextMenu(event, chapter.id));
            item.addEventListener('dragstart', onDragStart);
            item.addEventListener('dragover', onDragOver);
            item.addEventListener('dragleave', clearDropMarkers);
            item.addEventListener('drop', onDrop);
            item.addEventListener('dragend', onDragEnd);
            ui.chapterList.appendChild(item);
        }
    }

    async function selectChapter(id) {
        if (id === state.activeId) return;
        if (state.dirty) await saveActiveChapter(true);
        state.activeId = id;
        showManuscriptView(false);
        renderChapters();
        renderActiveChapter();
    }

    function renderActiveChapter() {
        const chapter = activeChapter();
        if (!state.project) {
            ui.welcome.hidden = false;
            ui.editorArea.hidden = true;
            return;
        }

        if (!chapter) {
            ui.welcome.hidden = false;
            ui.editorArea.hidden = true;
            ui.welcome.querySelector('h2').textContent = state.project.title || 'Projet';
            ui.welcome.querySelector('p').textContent = 'Le projet est ouvert. Créez votre premier chapitre avec le bouton + ou le menu Chapitres.';
            return;
        }

        ui.welcome.hidden = true;
        ui.editorArea.hidden = false;
        ui.chapterTitle.value = chapter.title || '';
        ui.chapterStatus.value = normalizeStatus(chapter.status);
        ui.chapterContent.innerHTML = chapter.content || '<p></p>';
        applyDocumentSettings();
        markSaved(false);
        updateWordIndicators();
    }

    function normalizeStatus(status) {
        if (status === 'in-progress') return 'writing';
        if (status === 'done') return 'final';
        return ['draft', 'writing', 'review', 'final', 'cut'].includes(status) ? status : 'draft';
    }

    async function saveActiveChapter(auto = false) {
        const chapter = activeChapter();
        if (!chapter || !state.projectDir) return;
        window.clearTimeout(state.autosaveTimer);

        const payload = {
            ...chapter,
            title: ui.chapterTitle.value.trim() || 'Sans titre',
            status: ui.chapterStatus.value,
            content: ui.chapterContent.innerHTML || '<p></p>'
        };

        try {
            const saved = await window.ecrivain.chapters.save(payload, { mode: auto ? 'autosave' : 'manual' });
            const index = state.chapters.findIndex((ch) => ch.id === saved.id);
            if (index >= 0) state.chapters[index] = { ...state.chapters[index], ...saved };
            markSaved(auto);
            renderChapters();
            updateProjectIndicators();
        } catch (error) {
            showToast(error.message || 'Impossible d’enregistrer le chapitre.', true);
        }
    }

    async function newProject() {
        const values = await showFormModal('Nouveau projet', [
            { id: 'title', label: 'Titre du projet', value: 'Nouveau roman', required: true },
            { id: 'author', label: 'Auteur', value: '' }
        ]);
        if (!values) return;

        try {
            const result = await window.ecrivain.project.create(values);
            if (!result || result.canceled) return;
            setProjectState(result);
            showToast('Projet créé.');
        } catch (error) {
            showToast(error.message || 'Impossible de créer le projet.', true);
        }
    }

    async function openProject() {
        if (state.dirty) await saveActiveChapter(true);
        try {
            const result = await window.ecrivain.project.open();
            if (!result || result.canceled) return;
            setProjectState(result);
            showToast('Projet ouvert.');
        } catch (error) {
            showToast(error.message || 'Impossible d’ouvrir le projet.', true);
        }
    }

    async function openRecentProject(projectDir) {
        if (!projectDir) return;
        if (state.dirty) await saveActiveChapter(true);
        try {
            const result = await window.ecrivain.project.openRecent(projectDir);
            if (!result || result.canceled) return;
            setProjectState(result);
            showToast(`Projet ouvert : ${result.project?.title || 'projet'}.`);
        } catch (error) {
            showToast(error.message || 'Impossible d’ouvrir ce projet récent.', true);
        }
    }

    async function newChapter() {
        if (!state.project) {
            showToast('Ouvrez ou créez d’abord un projet.', true);
            return;
        }
        const values = await showFormModal('Nouveau chapitre', [
            { id: 'title', label: 'Titre du chapitre', value: 'Nouveau chapitre', required: true }
        ]);
        if (!values) return;
        try {
            const chapter = await window.ecrivain.chapters.create({ title: values.title, parent: null });
            const refreshed = await window.ecrivain.project.state();
            setProjectState(refreshed);
            state.activeId = chapter.id;
            renderChapters();
            renderActiveChapter();
            ui.chapterTitle.focus();
        } catch (error) {
            showToast(error.message || 'Impossible de créer le chapitre.', true);
        }
    }

    async function newSubchapter() {
        const parent = activeChapter();
        if (!state.project) {
            showToast('Ouvrez ou créez d’abord un projet.', true);
            return;
        }
        if (!parent) {
            showToast('Sélectionnez d’abord le chapitre qui doit recevoir le sous-chapitre.', true);
            return;
        }
        const values = await showFormModal('Nouveau sous-chapitre', [
            { id: 'title', label: 'Titre du sous-chapitre', value: 'Nouveau sous-chapitre', required: true }
        ]);
        if (!values) return;
        try {
            const chapter = await window.ecrivain.chapters.create({ title: values.title, parent: parent.id });
            const refreshed = await window.ecrivain.project.state();
            setProjectState(refreshed);
            state.activeId = chapter.id;
            renderChapters();
            renderActiveChapter();
            ui.chapterTitle.focus();
        } catch (error) {
            showToast(error.message || 'Impossible de créer le sous-chapitre.', true);
        }
    }

    async function changeActiveChapterLevel(direction) {
        const chapter = activeChapter();
        if (!chapter) return;
        if (state.dirty) await saveActiveChapter(true);
        try {
            state.chapters = await window.ecrivain.chapters.changeLevel(chapter.id, direction);
            state.activeId = chapter.id;
            renderChapters();
            renderActiveChapter();
            updateProjectIndicators();
            showToast(direction === 'right' ? 'Chapitre transformé en sous-chapitre.' : 'Sous-chapitre remonté d’un niveau.');
        } catch (error) {
            showToast(error.message || 'Impossible de modifier le niveau du chapitre.', true);
        }
    }

    async function duplicateActiveChapter() {
        const ch = activeChapter();
        if (!ch) return;
        await saveActiveChapter(true);
        try {
            const duplicate = await window.ecrivain.chapters.duplicate(ch.id);
            const refreshed = await window.ecrivain.project.state();
            setProjectState(refreshed);
            state.activeId = duplicate.id;
            renderChapters();
            renderActiveChapter();
        } catch (error) {
            showToast(error.message || 'Duplication impossible.', true);
        }
    }

    async function renameActiveChapter() {
        const ch = activeChapter();
        if (!ch) return;
        const values = await showFormModal('Renommer le chapitre', [
            { id: 'title', label: 'Titre', value: ui.chapterTitle.value || ch.title, required: true }
        ]);
        if (!values) return;
        ui.chapterTitle.value = values.title;
        markDirty();
        await saveActiveChapter(false);
    }

    async function deleteActiveChapter() {
        const ch = activeChapter();
        if (!ch) return;
        const ok = await showConfirm(`Supprimer « ${ch.title || 'ce chapitre'} » ?`, 'Les éventuels sous-chapitres associés seront également supprimés.');
        if (!ok) return;
        try {
            await window.ecrivain.chapters.delete(ch.id);
            const refreshed = await window.ecrivain.project.state();
            setProjectState(refreshed);
            showToast('Chapitre supprimé.');
        } catch (error) {
            showToast(error.message || 'Suppression impossible.', true);
        }
    }

    function onDragStart(event) {
        state.draggedId = event.currentTarget.dataset.id;
        event.currentTarget.classList.add('is-dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', state.draggedId);
    }

    function draggedChapter() {
        return state.chapters.find((ch) => ch.id === state.draggedId) || null;
    }

    function onDragOver(event) {
        event.preventDefault();
        event.stopPropagation();
        const target = event.currentTarget;
        if (!state.draggedId || target.dataset.id === state.draggedId) return;

        const dragged = draggedChapter();
        const targetCh = state.chapters.find((ch) => ch.id === target.dataset.id);
        if (!dragged || !targetCh) return;

        // Première version : réordonne à l'intérieur du même niveau hiérarchique.
        if ((dragged.parent || '') !== (targetCh.parent || '')) {
            event.dataTransfer.dropEffect = 'none';
            return;
        }

        event.dataTransfer.dropEffect = 'move';
        clearDropMarkers();
        const rect = target.getBoundingClientRect();
        const before = event.clientY < rect.top + rect.height / 2;
        target.classList.add(before ? 'is-drop-before' : 'is-drop-after');
    }

    function clearDropMarkers() {
        document.querySelectorAll('.chapter-item.is-drop-before, .chapter-item.is-drop-after').forEach((el) => {
            el.classList.remove('is-drop-before', 'is-drop-after');
        });
        ui.chapterList.classList.remove('is-drop-end');
    }

    async function applyChapterOrder(draggedId, targetId, before) {
        const dragged = state.chapters.find((ch) => ch.id === draggedId);
        const target = state.chapters.find((ch) => ch.id === targetId);
        if (!dragged || !target || (dragged.parent || '') !== (target.parent || '')) return;

        // Ne réordonne que les frères du chapitre déplacé. Les éventuels
        // sous-chapitres restent attachés à leur parent et suivent celui-ci.
        const parentKey = dragged.parent || '';
        const siblings = state.chapters
            .filter((ch) => (ch.parent || '') === parentKey)
            .map((ch) => ch.id);

        const from = siblings.indexOf(draggedId);
        const targetIndex = siblings.indexOf(targetId);
        if (from < 0 || targetIndex < 0) return;

        siblings.splice(from, 1);
        let insertAt = siblings.indexOf(targetId);
        if (!before) insertAt += 1;
        siblings.splice(insertAt, 0, draggedId);

        // L'API accepte la liste globale ; on remplace uniquement l'ordre des
        // frères concernés tout en préservant les autres niveaux.
        const siblingQueue = [...siblings];
        const ordered = state.chapters.map((ch) => {
            if ((ch.parent || '') !== parentKey) return ch.id;
            return siblingQueue.shift();
        });

        state.chapters = await window.ecrivain.chapters.reorder(ordered);
        renderChapters();
        updateProjectIndicators();
        showToast('Ordre des chapitres enregistré.');
    }

    async function onDrop(event) {
        event.preventDefault();
        event.stopPropagation();
        const targetEl = event.currentTarget;
        const draggedId = state.draggedId;
        const targetId = targetEl.dataset.id;
        if (!draggedId || !targetId || draggedId === targetId) return;

        const dragged = draggedChapter();
        const target = state.chapters.find((ch) => ch.id === targetId);
        if (!dragged || !target || (dragged.parent || '') !== (target.parent || '')) return;

        const rect = targetEl.getBoundingClientRect();
        const before = event.clientY < rect.top + rect.height / 2;

        try {
            await applyChapterOrder(draggedId, targetId, before);
        } catch (error) {
            showToast(error.message || 'Impossible de modifier l’ordre.', true);
        } finally {
            clearDropMarkers();
        }
    }

    function onChapterListDragOver(event) {
        if (!state.draggedId) return;
        const dragged = draggedChapter();
        if (!dragged) return;

        const siblingEls = [...ui.chapterList.querySelectorAll('.chapter-item')]
            .filter((el) => {
                const chapter = state.chapters.find((ch) => ch.id === el.dataset.id);
                return chapter && (chapter.parent || '') === (dragged.parent || '') && chapter.id !== dragged.id;
            });
        if (!siblingEls.length) return;

        const last = siblingEls[siblingEls.length - 1];
        const lastRect = last.getBoundingClientRect();
        // Autorise le dépôt dans l'espace sous le dernier chapitre. C'est ce
        // qui permet notamment de déplacer le chapitre 1 après le chapitre 3.
        if (event.clientY >= lastRect.bottom) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            clearDropMarkers();
            ui.chapterList.classList.add('is-drop-end');
        }
    }

    async function onChapterListDrop(event) {
        if (!state.draggedId || !ui.chapterList.classList.contains('is-drop-end')) return;
        event.preventDefault();
        const dragged = draggedChapter();
        if (!dragged) return;

        const siblings = state.chapters.filter((ch) => (ch.parent || '') === (dragged.parent || '') && ch.id !== dragged.id);
        const last = siblings[siblings.length - 1];
        if (!last) return;

        try {
            await applyChapterOrder(dragged.id, last.id, false);
        } catch (error) {
            showToast(error.message || 'Impossible de modifier l’ordre.', true);
        } finally {
            clearDropMarkers();
        }
    }

    function onDragEnd(event) {
        event.currentTarget.classList.remove('is-dragging');
        state.draggedId = null;
        clearDropMarkers();
    }

    async function runExport(kind, label) {
        if (!state.project) {
            showToast('Ouvrez d’abord un projet.', true);
            return;
        }
        if (state.dirty) await saveActiveChapter(true);
        try {
            const fn = window.ecrivain.export[kind];
            if (typeof fn !== 'function') throw new Error(`Export ${label} indisponible.`);
            const result = await fn();
            if (result && !result.canceled) showToast(`${label} créé : ${result.filePath}`);
        } catch (error) {
            showToast(error.message || `Impossible d’exporter en ${label}.`, true);
        }
    }

    async function exportMarkdown() {
        return runExport('markdown', 'Markdown');
    }


    async function configureDocument() {
        if (!state.project) {
            showToast('Ouvrez d’abord un projet.', true);
            return;
        }
        if (state.dirty) await saveActiveChapter(true);

        const project = state.project;
        const fields = [
            { section: 'Typographie' },
            { id: 'exportFont', label: 'Police du manuscrit', value: String(project.exportFont || 'Garamond'), type: 'select', options: manuscriptFonts },
            { id: 'exportFontSizePt', label: 'Corps (pt)', value: numericValue(project.exportFontSizePt, 11), unit: 'pt', min: 7, max: 30, step: 0.5 },
            { id: 'lineSpacingPt', label: 'Interligne (pt)', value: numericValue(project.lineSpacingPt, 13), unit: 'pt', min: 8, max: 60, step: 0.5 },
            { section: 'Format de page' },
            { id: 'pageWidthCm', label: 'Largeur', value: numericValue(project.pageWidthCm, 12), unit: 'cm', min: 5, max: 50, step: 0.1 },
            { id: 'pageHeightCm', label: 'Hauteur', value: numericValue(project.pageHeightCm, 19), unit: 'cm', min: 5, max: 70, step: 0.1 },
            { section: 'Marges' },
            { id: 'marginTopMm', label: 'Marge supérieure', value: numericValue(project.marginTopMm, 15), unit: 'mm', min: 0, max: 100, step: 0.5 },
            { id: 'marginBottomMm', label: 'Marge inférieure', value: numericValue(project.marginBottomMm, 15), unit: 'mm', min: 0, max: 100, step: 0.5 },
            { id: 'marginLeftMm', label: 'Marge gauche', value: numericValue(project.marginLeftMm, 15), unit: 'mm', min: 0, max: 100, step: 0.5 },
            { id: 'marginRightMm', label: 'Marge droite', value: numericValue(project.marginRightMm, 15), unit: 'mm', min: 0, max: 100, step: 0.5 },
            { section: 'Paragraphes' },
            { id: 'paragraphIndentMm', label: 'Alinéa de première ligne', value: numericValue(project.paragraphIndentMm, 5), unit: 'mm', min: 0, max: 30, step: 0.1 },
            { id: 'paragraphSpacingBeforeMm', label: 'Espace avant', value: numericValue(project.paragraphSpacingBeforeMm, 0), unit: 'mm', min: 0, max: 30, step: 0.1 },
            { id: 'paragraphSpacingAfterMm', label: 'Espace après', value: numericValue(project.paragraphSpacingAfterMm, 0), unit: 'mm', min: 0, max: 30, step: 0.1 },
            { section: 'Chapitres' },
            { id: 'chapterPageBreak', label: 'Commencer chaque chapitre sur une nouvelle page à l’export', value: project.chapterPageBreak !== false, type: 'checkbox' }
        ];

        const values = await showSettingsModal('Configuration du document', fields);
        if (!values) return;

        try {
            const updated = await window.ecrivain.project.updateLayout(values);
            state.project = updated;
            applyDocumentSettings();
            showToast('Configuration du document enregistrée.');
        } catch (error) {
            showToast(error.message || 'Impossible d’enregistrer la configuration.', true);
        }
    }

    function showSettingsModal(title, fields) {
        return new Promise((resolve) => {
            ui.modalTitle.textContent = title;
            ui.modalBody.innerHTML = '';
            const inputs = {};
            const modal = ui.modalBackdrop.querySelector('.modal');
            modal?.classList.add('modal--document-settings');

            const note = document.createElement('p');
            note.className = 'document-settings-note';
            note.textContent = 'Réglages communs à l’édition et aux exports : typographie, page, marges, paragraphes et comportement des chapitres. Les dimensions de page sont en cm ; marges et retraits en mm.';
            ui.modalBody.appendChild(note);

            const grid = document.createElement('div');
            grid.className = 'settings-grid';
            ui.modalBody.appendChild(grid);

            let currentGroupFields = null;
            for (const field of fields) {
                if (field.section) {
                    const group = document.createElement('section');
                    group.className = 'settings-group';
                    group.dataset.section = field.section.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-');

                    const heading = document.createElement('h3');
                    heading.className = 'settings-section';
                    heading.textContent = field.section;

                    currentGroupFields = document.createElement('div');
                    currentGroupFields.className = 'settings-group-fields';
                    group.append(heading, currentGroupFields);
                    grid.appendChild(group);
                    continue;
                }

                const target = currentGroupFields || grid;

                if (field.type === 'checkbox') {
                    const wrap = document.createElement('label');
                    wrap.className = 'settings-checkbox';
                    const input = document.createElement('input');
                    input.id = `setting-${field.id}`;
                    input.type = 'checkbox';
                    input.checked = Boolean(field.value);
                    const text = document.createElement('span');
                    text.textContent = field.label;
                    wrap.append(input, text);
                    target.appendChild(wrap);
                    inputs[field.id] = input;
                    continue;
                }

                const wrap = document.createElement('div');
                wrap.className = 'modal-field modal-field--unit';
                const label = document.createElement('label');
                label.htmlFor = `setting-${field.id}`;
                label.textContent = field.label;
                const row = document.createElement('div');
                row.className = 'field-row';
                const input = field.type === 'select' ? document.createElement('select') : document.createElement('input');
                input.id = `setting-${field.id}`;
                if (field.type === 'select') {
                    const options = Array.isArray(field.options) ? field.options.slice() : [];
                    if (field.value && !options.includes(String(field.value))) options.unshift(String(field.value));
                    for (const optionValue of options) {
                        const option = document.createElement('option');
                        option.value = optionValue;
                        option.textContent = optionValue;
                        input.appendChild(option);
                    }
                    input.value = String(field.value);
                } else {
                    input.type = field.type === 'text' ? 'text' : 'number';
                    input.value = String(field.value);
                    if (input.type === 'number') {
                        input.min = String(field.min);
                        input.max = String(field.max);
                        input.step = String(field.step);
                    }
                }
                const unit = document.createElement('span');
                unit.className = 'field-unit';
                unit.textContent = field.unit || '';
                row.append(input, unit);
                wrap.append(label, row);
                target.appendChild(wrap);
                inputs[field.id] = input;
            }

            grid.querySelectorAll('.settings-group').forEach((group) => {
                const count = group.querySelectorAll('.modal-field, .settings-checkbox').length;
                if (count >= 4) group.classList.add('settings-group--dense');
            });

            ui.modalConfirm.textContent = 'Enregistrer';
            ui.modalBackdrop.hidden = false;
            window.setTimeout(() => Object.values(inputs)[0]?.focus(), 20);

            function cleanup(value) {
                ui.modalBackdrop.hidden = true;
                modal?.classList.remove('modal--document-settings');
                ui.modalConfirm.textContent = 'Valider';
                ui.modalConfirm.removeEventListener('click', confirm);
                ui.modalCancel.removeEventListener('click', cancel);
                document.removeEventListener('keydown', keydown);
                resolve(value);
            }
            function confirm() {
                const result = {};
                for (const [id, input] of Object.entries(inputs)) {
                    if (!input.checkValidity()) {
                        input.focus();
                        return;
                    }
                    result[id] = input.type === 'checkbox' ? input.checked : input.value;
                }
                cleanup(result);
            }
            function cancel() { cleanup(null); }
            function keydown(e) {
                if (e.key === 'Escape') cancel();
                if (e.key === 'Enter' && !e.shiftKey) confirm();
            }
            ui.modalConfirm.addEventListener('click', confirm);
            ui.modalCancel.addEventListener('click', cancel);
            document.addEventListener('keydown', keydown);
        });
    }

    function showManuscriptView(render = true) {
        state.currentView = 'manuscript';
        ui.synopsisView.hidden = true;
        const globalSynopsisView = document.getElementById('globalSynopsisView');
        if (globalSynopsisView) globalSynopsisView.hidden = true;
        const notesView = document.getElementById('notesView');
        if (notesView) notesView.hidden = true;
        const timelineView = document.getElementById('timelineView');
        if (timelineView) timelineView.hidden = true;
        const statsView = document.getElementById('statsView');
        if (statsView) statsView.hidden = true;
        const mindmapView = document.getElementById('mindmapView');
        if (mindmapView) mindmapView.hidden = true;
        const backupsView = document.getElementById('backupsView');
        if (backupsView) backupsView.hidden = true;
        const historyView = document.getElementById('historyView');
        if (historyView) historyView.hidden = true;
        const projectSearchView = document.getElementById('projectSearchView');
        if (projectSearchView) projectSearchView.hidden = true;
        const aiView = document.getElementById('aiView');
        if (aiView) aiView.hidden = true;
        const preferencesView = document.getElementById('preferencesView');
        if (preferencesView) preferencesView.hidden = true;
        const pluginsView = document.getElementById('pluginsView');
        if (pluginsView) pluginsView.hidden = true;
        if (render) renderActiveChapter();
    }

    async function openSynopsis() {
        if (!state.project) {
            showToast('Ouvrez d’abord un projet.', true);
            return;
        }
        if (state.dirty) await saveActiveChapter(true);
        try {
            const payload = await window.ecrivain.synopsis.state();
            state.synopsisCards = Array.isArray(payload.cards) ? payload.cards : [];
            state.synopsisTypes = payload.types || {};
            state.synopsisStatuses = payload.statuses || {};
            state.synopsisColors = payload.colors || {};
            state.synopsisFilter = 'all';
            state.currentView = 'synopsis';
            ui.welcome.hidden = true;
            ui.editorArea.hidden = true;
            const globalSynopsisView = document.getElementById('globalSynopsisView');
            if (globalSynopsisView) globalSynopsisView.hidden = true;
            const notesView = document.getElementById('notesView');
            if (notesView) notesView.hidden = true;
            const timelineView = document.getElementById('timelineView');
            if (timelineView) timelineView.hidden = true;
            const statsView = document.getElementById('statsView');
            if (statsView) statsView.hidden = true;
            const mindmapView = document.getElementById('mindmapView');
            if (mindmapView) mindmapView.hidden = true;
            const projectSearchView = document.getElementById('projectSearchView');
            if (projectSearchView) projectSearchView.hidden = true;
            ui.synopsisView.hidden = false;
            renderSynopsis();
        } catch (error) {
            showToast(error.message || 'Impossible d’ouvrir le synoptique.', true);
        }
    }

    function renderSynopsis() {
        renderSynopsisFilters();
        renderSynopsisBoard();
        const n = state.synopsisCards.length;
        ui.synopsisCount.textContent = `${n} ${n > 1 ? 'fiches' : 'fiche'}`;
    }

    function renderSynopsisFilters() {
        ui.synopsisFilters.innerHTML = '';
        const filters = [['all', 'Toutes'], ...Object.entries(state.synopsisTypes)];
        for (const [value, label] of filters) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `synopsis-filter${state.synopsisFilter === value ? ' is-active' : ''}`;
            button.textContent = label;
            button.addEventListener('click', () => {
                state.synopsisFilter = value;
                renderSynopsisFilters();
                renderSynopsisBoard();
            });
            ui.synopsisFilters.appendChild(button);
        }
    }

    function synopsisChapterLabel(card) {
        if (!card.chapterId) return 'Non lié au manuscrit';
        const chapter = state.chapters.find((item) => item.id === card.chapterId);
        return chapter ? chapter.title : 'Chapitre lié';
    }

    function synopsisLead(card) {
        if (card.type === 'personnage' && card.role) return card.role;
        if (card.type === 'lieu' && card.ambiance) return card.ambiance;
        if (card.type === 'scene' && card.tension) return `Tension : ${card.tension}`;
        if (card.type === 'documentation' && card.links) return card.links;
        return '';
    }

    function excerpt(value, max = 150) {
        const text = String(value || '').trim();
        return text.length > max ? `${text.slice(0, max).trim()}…` : text;
    }

    function renderSynopsisBoard() {
        ui.synopsisBoard.innerHTML = '';
        const visible = state.synopsisCards.filter((card) => state.synopsisFilter === 'all' || card.type === state.synopsisFilter);
        ui.synopsisEmpty.hidden = visible.length > 0;
        ui.synopsisBoard.hidden = visible.length === 0;

        for (const card of visible) {
            const article = document.createElement('article');
            article.className = `synopsis-card synopsis-card--${card.color || 'ivoire'}`;
            article.dataset.id = card.id;
            article.draggable = state.synopsisFilter === 'all';

            const top = document.createElement('div');
            top.className = 'synopsis-card__top';
            const badges = document.createElement('div');
            badges.className = 'synopsis-card__badges';
            const type = document.createElement('span');
            type.className = 'synopsis-badge';
            type.textContent = state.synopsisTypes[card.type] || card.type || 'Fiche';
            const status = document.createElement('span');
            status.className = 'synopsis-badge';
            status.textContent = state.synopsisStatuses[card.status] || card.status || 'À écrire';
            badges.append(type, status);
            const drag = document.createElement('span');
            drag.className = 'synopsis-drag';
            drag.textContent = '⋮⋮';
            drag.title = state.synopsisFilter === 'all' ? 'Déplacer la fiche' : 'Affichez Toutes pour réorganiser';
            top.append(badges, drag);

            const title = document.createElement('h3');
            title.textContent = card.title || 'Fiche';
            const leadValue = synopsisLead(card);
            const lead = document.createElement('div');
            lead.className = 'synopsis-card__lead';
            lead.textContent = leadValue;
            lead.hidden = !leadValue;

            const summary = document.createElement('p');
            summary.className = 'synopsis-card__summary';
            summary.textContent = card.summary || '';
            summary.hidden = !card.summary;

            const ideas = document.createElement('p');
            ideas.className = 'synopsis-card__ideas';
            const ideasText = excerpt(card.ideas, 150);
            ideas.textContent = ideasText ? `Idées — ${ideasText}` : '';
            ideas.hidden = !ideasText;

            const footer = document.createElement('div');
            footer.className = 'synopsis-card__footer';
            const linked = document.createElement('span');
            linked.className = 'synopsis-card__chapter';
            linked.textContent = synopsisChapterLabel(card);
            const actions = document.createElement('div');
            actions.className = 'synopsis-card__actions';
            const edit = document.createElement('button');
            edit.type = 'button';
            edit.textContent = 'Ouvrir';
            edit.addEventListener('click', (event) => {
                event.stopPropagation();
                editSynopsisCard(card);
            });
            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'danger';
            del.textContent = 'Supprimer';
            del.addEventListener('click', (event) => {
                event.stopPropagation();
                deleteSynopsisCard(card);
            });
            actions.append(edit, del);
            footer.append(linked, actions);

            article.append(top, title, lead, summary, ideas, footer);
            article.addEventListener('dblclick', () => editSynopsisCard(card));
            article.addEventListener('dragstart', onSynopsisDragStart);
            article.addEventListener('dragover', onSynopsisDragOver);
            article.addEventListener('dragleave', () => article.classList.remove('is-drop-target'));
            article.addEventListener('drop', onSynopsisDrop);
            article.addEventListener('dragend', onSynopsisDragEnd);
            ui.synopsisBoard.appendChild(article);
        }
    }

    async function newSynopsisCard() {
        await editSynopsisCard({
            id: '', title: '', summary: '', ideas: '', notes: '', role: '', traits: '', objective: '', links: '', ambiance: '', characters: '', tension: '',
            type: 'scene', status: 'a-ecrire', chapterId: state.activeId || '', color: 'ivoire'
        });
    }

    async function editSynopsisCard(card) {
        const values = await showSynopsisCardModal(card || {});
        if (!values) return;
        try {
            const saved = await window.ecrivain.synopsis.save({ ...card, ...values });
            const index = state.synopsisCards.findIndex((item) => item.id === saved.id);
            if (index >= 0) state.synopsisCards[index] = saved;
            else state.synopsisCards.push(saved);
            state.synopsisCards.sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
            renderSynopsis();
            showToast(card?.id ? 'Fiche enregistrée.' : 'Fiche créée.');
        } catch (error) {
            showToast(error.message || 'Impossible d’enregistrer la fiche.', true);
        }
    }

    async function deleteSynopsisCard(card) {
        const ok = await showConfirm('Supprimer la fiche', `Supprimer « ${card.title || 'cette fiche'} » ? Le manuscrit ne sera pas modifié.`);
        if (!ok) return;
        try {
            state.synopsisCards = await window.ecrivain.synopsis.delete(card.id);
            renderSynopsis();
            showToast('Fiche supprimée.');
        } catch (error) {
            showToast(error.message || 'Impossible de supprimer la fiche.', true);
        }
    }

    function onSynopsisDragStart(event) {
        if (state.synopsisFilter !== 'all') {
            event.preventDefault();
            return;
        }
        state.synopsisDraggedId = event.currentTarget.dataset.id;
        event.currentTarget.classList.add('is-dragging');
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', state.synopsisDraggedId);
        }
    }

    function onSynopsisDragOver(event) {
        event.preventDefault();
        const target = event.currentTarget;
        if (!state.synopsisDraggedId || target.dataset.id === state.synopsisDraggedId) return;
        const dragged = ui.synopsisBoard.querySelector(`[data-id="${CSS.escape(state.synopsisDraggedId)}"]`);
        if (!dragged) return;
        ui.synopsisBoard.querySelectorAll('.synopsis-card').forEach((item) => item.classList.remove('is-drop-target'));
        target.classList.add('is-drop-target');
        const rect = target.getBoundingClientRect();
        const before = event.clientY < rect.top + rect.height / 2;
        ui.synopsisBoard.insertBefore(dragged, before ? target : target.nextSibling);
    }

    async function onSynopsisDrop(event) {
        event.preventDefault();
        event.currentTarget.classList.remove('is-drop-target');
        await persistSynopsisOrder();
    }

    async function persistSynopsisOrder() {
        if (!state.synopsisDraggedId) return;
        const ids = Array.from(ui.synopsisBoard.querySelectorAll('.synopsis-card')).map((item) => item.dataset.id);
        try {
            state.synopsisCards = await window.ecrivain.synopsis.reorder(ids);
            renderSynopsis();
        } catch (error) {
            showToast(error.message || 'Impossible d’enregistrer l’ordre des fiches.', true);
        }
    }

    function onSynopsisDragEnd(event) {
        event.currentTarget.classList.remove('is-dragging');
        ui.synopsisBoard.querySelectorAll('.synopsis-card').forEach((item) => item.classList.remove('is-drop-target'));
        state.synopsisDraggedId = null;
    }

    function showSynopsisCardModal(card) {
        return new Promise((resolve) => {
            const modal = ui.modalBackdrop.querySelector('.modal');
            modal.classList.add('modal--wide');
            ui.modalTitle.textContent = card.id ? 'Modifier la fiche' : 'Nouvelle fiche';
            ui.modalBody.innerHTML = '';
            const grid = document.createElement('div');
            grid.className = 'synopsis-form-grid';
            const inputs = {};

            const addField = (id, labelText, options = {}) => {
                const wrap = document.createElement('div');
                wrap.className = `modal-field${options.span ? ' span-2' : ''}`;
                const label = document.createElement('label');
                label.htmlFor = `synopsis-${id}`;
                label.textContent = labelText;
                let input;
                if (options.type === 'select') {
                    input = document.createElement('select');
                    for (const [value, text] of options.options || []) {
                        const opt = document.createElement('option');
                        opt.value = value;
                        opt.textContent = text;
                        input.appendChild(opt);
                    }
                    input.value = String(options.value ?? '');
                } else if (options.type === 'textarea') {
                    input = document.createElement('textarea');
                    input.value = String(options.value ?? '');
                    if (options.rows) input.rows = options.rows;
                } else {
                    input = document.createElement('input');
                    input.type = 'text';
                    input.value = String(options.value ?? '');
                }
                input.id = `synopsis-${id}`;
                if (options.required) input.required = true;
                wrap.append(label, input);
                grid.appendChild(wrap);
                inputs[id] = input;
            };

            addField('type', 'Type', { type: 'select', value: card.type || 'scene', options: Object.entries(state.synopsisTypes) });
            addField('status', 'Statut', { type: 'select', value: card.status || 'a-ecrire', options: Object.entries(state.synopsisStatuses) });
            addField('color', 'Couleur', { type: 'select', value: card.color || 'ivoire', options: Object.entries(state.synopsisColors) });
            addField('chapterId', 'Chapitre lié', { type: 'select', value: card.chapterId || '', options: [['', 'Aucun chapitre lié'], ...state.chapters.map((ch) => [ch.id, `${'— '.repeat(Number(ch._depth || 0))}${ch.title}`])] });
            addField('title', 'Titre', { value: card.title || '', required: true, span: true });
            addField('summary', 'Résumé', { type: 'textarea', value: card.summary || '', rows: 4, span: true });
            addField('ideas', 'Idées', { type: 'textarea', value: card.ideas || '', rows: 4, span: true });

            const hint = document.createElement('p');
            hint.className = 'synopsis-form-hint';
            hint.textContent = 'Les champs ci-dessous sont libres : utilisez uniquement ceux qui sont utiles à cette fiche.';
            grid.appendChild(hint);

            addField('role', 'Rôle', { value: card.role || '' });
            addField('tension', 'Tension', { value: card.tension || '' });
            addField('ambiance', 'Ambiance', { value: card.ambiance || '' });
            addField('characters', 'Personnages impliqués', { value: card.characters || '' });
            addField('traits', 'Traits', { type: 'textarea', value: card.traits || '', rows: 3 });
            addField('objective', 'Objectif', { type: 'textarea', value: card.objective || '', rows: 3 });
            addField('links', 'Liens / sources', { type: 'textarea', value: card.links || '', rows: 3 });
            addField('notes', 'Notes', { type: 'textarea', value: card.notes || '', rows: 3 });

            ui.modalBody.appendChild(grid);
            ui.modalConfirm.textContent = 'Enregistrer';
            ui.modalBackdrop.hidden = false;
            window.setTimeout(() => inputs.title?.focus(), 20);

            function cleanup(value) {
                ui.modalBackdrop.hidden = true;
                ui.modalConfirm.textContent = 'Valider';
                modal.classList.remove('modal--wide');
                ui.modalConfirm.removeEventListener('click', confirm);
                ui.modalCancel.removeEventListener('click', cancel);
                document.removeEventListener('keydown', keydown);
                resolve(value);
            }
            function confirm() {
                if (!inputs.title.value.trim()) {
                    inputs.title.focus();
                    return;
                }
                const values = {};
                for (const [id, input] of Object.entries(inputs)) values[id] = input.value.trim();
                cleanup(values);
            }
            function cancel() { cleanup(null); }
            function keydown(event) {
                if (event.key === 'Escape') cancel();
                if (event.ctrlKey && event.key === 'Enter') confirm();
            }
            ui.modalConfirm.addEventListener('click', confirm);
            ui.modalCancel.addEventListener('click', cancel);
            document.addEventListener('keydown', keydown);
        });
    }

    function featureComing(label) {
        showToast(`${label} : prévu dans les prochaines étapes du portage.`);
    }

    function formatBlock(tag) {
        ui.chapterContent.focus();
        document.execCommand('formatBlock', false, tag);
        markDirty();
    }

    function runCommand(command) {
        ui.chapterContent.focus();
        document.execCommand(command, false, null);
        markDirty();
    }

    function findInChapter() {
        const valuesPromise = showFormModal('Rechercher dans le chapitre', [
            { id: 'query', label: 'Texte à rechercher', value: '', required: true }
        ]);
        valuesPromise.then((values) => {
            if (!values) return;
            window.find(values.query, false, false, true, false, true, false);
        });
    }

    function showToast(message, error = false) {
        ui.toast.textContent = message;
        ui.toast.classList.toggle('is-error', error);
        ui.toast.hidden = false;
        window.clearTimeout(showToast.timer);
        showToast.timer = window.setTimeout(() => { ui.toast.hidden = true; }, 3000);
    }

    function showFormModal(title, fields) {
        return new Promise((resolve) => {
            ui.modalTitle.textContent = title;
            ui.modalBody.innerHTML = '';
            const inputs = {};

            for (const field of fields) {
                const wrap = document.createElement('div');
                wrap.className = 'modal-field';
                const label = document.createElement('label');
                label.htmlFor = `modal-${field.id}`;
                label.textContent = field.label;
                const input = document.createElement('input');
                input.id = `modal-${field.id}`;
                input.type = 'text';
                input.value = field.value || '';
                input.required = Boolean(field.required);
                wrap.append(label, input);
                ui.modalBody.appendChild(wrap);
                inputs[field.id] = input;
            }

            ui.modalBackdrop.hidden = false;
            const first = Object.values(inputs)[0];
            window.setTimeout(() => first?.focus(), 20);

            function cleanup(value) {
                ui.modalBackdrop.hidden = true;
                ui.modalConfirm.removeEventListener('click', confirm);
                ui.modalCancel.removeEventListener('click', cancel);
                document.removeEventListener('keydown', keydown);
                resolve(value);
            }
            function confirm() {
                const result = {};
                for (const field of fields) {
                    const value = inputs[field.id].value.trim();
                    if (field.required && !value) {
                        inputs[field.id].focus();
                        return;
                    }
                    result[field.id] = value;
                }
                cleanup(result);
            }
            function cancel() { cleanup(null); }
            function keydown(e) {
                if (e.key === 'Escape') cancel();
                if (e.key === 'Enter') confirm();
            }
            ui.modalConfirm.addEventListener('click', confirm);
            ui.modalCancel.addEventListener('click', cancel);
            document.addEventListener('keydown', keydown);
        });
    }

    function showConfirm(title, detail) {
        return new Promise((resolve) => {
            ui.modalTitle.textContent = title;
            ui.modalBody.innerHTML = '';
            const p = document.createElement('p');
            p.textContent = detail || '';
            p.style.color = '#6f6962';
            p.style.lineHeight = '1.5';
            ui.modalBody.appendChild(p);
            ui.modalConfirm.textContent = 'Supprimer';
            ui.modalBackdrop.hidden = false;

            function cleanup(value) {
                ui.modalBackdrop.hidden = true;
                ui.modalConfirm.textContent = 'Valider';
                ui.modalConfirm.removeEventListener('click', confirm);
                ui.modalCancel.removeEventListener('click', cancel);
                document.removeEventListener('keydown', keydown);
                resolve(value);
            }
            function confirm() { cleanup(true); }
            function cancel() { cleanup(false); }
            function keydown(e) {
                if (e.key === 'Escape') cancel();
                if (e.key === 'Enter') confirm();
            }
            ui.modalConfirm.addEventListener('click', confirm);
            ui.modalCancel.addEventListener('click', cancel);
            document.addEventListener('keydown', keydown);
        });
    }

    async function closeGlobalSynopsisForSwitch() {
        if (!window.ecrivainGlobalSynopsis?.isOpen?.()) return;
        if (window.ecrivainGlobalSynopsis?.isDirty?.()) {
            await window.ecrivainGlobalSynopsis.save(true);
        }
        const view = document.getElementById('globalSynopsisView');
        if (view) view.hidden = true;
    }

    async function handleMenuAction(action) {
        if (action && typeof action === 'object') {
            if (action.type === 'plugin:command') {
                await closeGlobalSynopsisForSwitch();
                window.ecrivainSearch?.closeProjectView?.(false);
                window.ecrivainAI?.closeForSwitch?.();
                if (state.dirty) await saveActiveChapter(true);
                return window.ecrivainPlugins?.runCommand
                    ? window.ecrivainPlugins.runCommand(action.pluginId, action.commandId)
                    : featureComing('Extensions');
            }
            window.ecrivainPlugins?.closeForSwitch?.();
            if (action.type === 'project:openRecent') {
                await closeGlobalSynopsisForSwitch();
                return openRecentProject(action.projectDir);
            }
            return undefined;
        }
        if (action !== 'tool:plugins') window.ecrivainPlugins?.closeForSwitch?.();
        if (action !== 'tool:preferences' && !String(action || '').startsWith('help:')) window.ecrivainSettings?.closeForSwitch?.();
        switch (action) {
            case 'project:new':
                await closeGlobalSynopsisForSwitch();
                return newProject();
            case 'project:open':
                await closeGlobalSynopsisForSwitch();
                return openProject();
            case 'chapter:save':
                if (window.ecrivainGlobalSynopsis?.isOpen?.()) return window.ecrivainGlobalSynopsis.save(false);
                return saveActiveChapter(false);
            case 'chapter:new': return newChapter();
            case 'chapter:newChild': return newSubchapter();
            case 'chapter:duplicate': return duplicateActiveChapter();
            case 'chapter:rename': return renameActiveChapter();
            case 'chapter:indent': return changeActiveChapterLevel('right');
            case 'chapter:outdent': return changeActiveChapterLevel('left');
            case 'chapter:delete': return deleteActiveChapter();
            case 'view:sidebar': return ui.sidebar.classList.toggle('is-hidden');
            case 'view:invisibles':
                return window.ecrivainEditor?.toggleInvisibles ? window.ecrivainEditor.toggleInvisibles() : undefined;
            case 'edit:findChapter':
                return window.ecrivainSearch?.openChapterSearch ? window.ecrivainSearch.openChapterSearch(false) : findInChapter();
            case 'edit:replaceChapter':
                return window.ecrivainSearch?.openChapterSearch ? window.ecrivainSearch.openChapterSearch(true) : findInChapter();
            case 'edit:findProject':
                await closeGlobalSynopsisForSwitch();
                if (state.dirty) await saveActiveChapter(true);
                return window.ecrivainSearch?.openProjectSearch ? window.ecrivainSearch.openProjectSearch(false) : featureComing('Recherche dans le projet');
            case 'edit:replaceProject':
                await closeGlobalSynopsisForSwitch();
                if (state.dirty) await saveActiveChapter(true);
                return window.ecrivainSearch?.openProjectSearch ? window.ecrivainSearch.openProjectSearch(true) : featureComing('Remplacement global');
            case 'export:md': return exportMarkdown();
            case 'export:docx': return runExport('docx', 'DOCX');
            case 'export:odt': return runExport('odt', 'ODT');
            case 'export:epub': return runExport('epub', 'EPUB');
            case 'export:pdf': return runExport('pdf', 'PDF');
            case 'project:info': return window.ecrivainSettings?.openProjectInfo ? window.ecrivainSettings.openProjectInfo() : featureComing('Informations du projet');
            case 'project:layout': return configureDocument();
            case 'project:verify': {
                await closeGlobalSynopsisForSwitch();
                if (state.dirty) await saveActiveChapter(true);
                try {
                    const result = await window.ecrivain.project.verify();
                    if (result?.state) setProjectState(result.state);
                    const repairs = Number(result?.report?.repaired?.length || 0);
                    const warnings = Number(result?.report?.warnings?.length || 0);
                    showToast(warnings ? `Vérification terminée : ${warnings} avertissement(s)` : (repairs ? `Projet réparé : ${repairs} correction(s)` : 'Projet vérifié : aucune anomalie'));
                } catch (error) {
                    showToast(error.message || 'Vérification impossible', true);
                }
                return;
            }
            case 'feature:globalSynopsis':
                window.ecrivainSearch?.closeProjectView?.(false);
                window.ecrivainAI?.closeForSwitch?.();
                if (state.dirty) await saveActiveChapter(true);
                return window.ecrivainGlobalSynopsis?.open ? window.ecrivainGlobalSynopsis.open() : featureComing('Synopsis global');
            case 'feature:synopsis':
                await closeGlobalSynopsisForSwitch();
                window.ecrivainSearch?.closeProjectView?.(false);
                window.ecrivainAI?.closeForSwitch?.();
                return openSynopsis();
            case 'feature:notes':
                await closeGlobalSynopsisForSwitch();
                window.ecrivainSearch?.closeProjectView?.(false);
                window.ecrivainAI?.closeForSwitch?.();
                return window.ecrivainNotes?.open ? window.ecrivainNotes.open() : featureComing('Notes');
            case 'feature:timeline':
                await closeGlobalSynopsisForSwitch();
                window.ecrivainSearch?.closeProjectView?.(false);
                window.ecrivainAI?.closeForSwitch?.();
                return window.ecrivainTimeline?.open ? window.ecrivainTimeline.open() : featureComing('Chronologie');
            case 'feature:mindmap':
                await closeGlobalSynopsisForSwitch();
                window.ecrivainSearch?.closeProjectView?.(false);
                window.ecrivainAI?.closeForSwitch?.();
                if (state.dirty) await saveActiveChapter(true);
                return window.ecrivainMindmap?.open ? window.ecrivainMindmap.open() : featureComing('Carte mentale');
            case 'feature:stats':
                await closeGlobalSynopsisForSwitch();
                window.ecrivainSearch?.closeProjectView?.(false);
                window.ecrivainAI?.closeForSwitch?.();
                if (state.dirty) await saveActiveChapter(true);
                return window.ecrivainStats?.open ? window.ecrivainStats.open() : featureComing('Statistiques');
            case 'feature:backups':
                await closeGlobalSynopsisForSwitch();
                window.ecrivainSearch?.closeProjectView?.(false);
                window.ecrivainAI?.closeForSwitch?.();
                if (state.dirty) await saveActiveChapter(true);
                return window.ecrivainSafety?.openBackups ? window.ecrivainSafety.openBackups() : featureComing('Sauvegardes');
            case 'feature:history':
                await closeGlobalSynopsisForSwitch();
                window.ecrivainSearch?.closeProjectView?.(false);
                window.ecrivainAI?.closeForSwitch?.();
                if (state.dirty) await saveActiveChapter(true);
                return window.ecrivainSafety?.openHistory ? window.ecrivainSafety.openHistory(state.activeId) : featureComing('Historique');
            case 'tool:typography':
                return window.ecrivainEditor?.normalizeTypography ? window.ecrivainEditor.normalizeTypography() : featureComing('Typographie française');
            case 'tool:search': return window.ecrivainSearch?.openProjectSearch ? window.ecrivainSearch.openProjectSearch(false) : featureComing('Recherche dans le projet');
            case 'tool:ai':
                await closeGlobalSynopsisForSwitch();
                window.ecrivainSearch?.closeProjectView?.(false);
                window.ecrivainAI?.closeForSwitch?.();
                if (state.dirty) await saveActiveChapter(true);
                return window.ecrivainAI?.open ? window.ecrivainAI.open() : featureComing('Assistant IA');
            case 'tool:plugins':
                await closeGlobalSynopsisForSwitch();
                window.ecrivainSearch?.closeProjectView?.(false);
                window.ecrivainAI?.closeForSwitch?.();
                if (state.dirty) await saveActiveChapter(true);
                return window.ecrivainPlugins?.open ? window.ecrivainPlugins.open() : featureComing('Extensions');
            case 'tool:preferences':
                await closeGlobalSynopsisForSwitch();
                window.ecrivainSearch?.closeProjectView?.(false);
                window.ecrivainAI?.closeForSwitch?.();
                window.ecrivainPlugins?.closeForSwitch?.();
                if (state.dirty) await saveActiveChapter(true);
                return window.ecrivainSettings?.openPreferences ? window.ecrivainSettings.openPreferences() : featureComing('Préférences');
            case 'help:guide': return window.ecrivainSettings?.showGuide?.();
            case 'help:shortcuts': return window.ecrivainSettings?.showShortcuts?.();
            case 'help:systemInfo': return window.ecrivainSettings?.showSystemInfo?.();
            case 'help:about': return window.ecrivainSettings?.showAbout?.();
            default: return undefined;
        }
    }

    // Chromium utilisera des <p> lors de la création de nouveaux paragraphes.
    document.execCommand('defaultParagraphSeparator', false, 'p');

    ui.welcomeNew.addEventListener('click', newProject);
    ui.welcomeOpen.addEventListener('click', openProject);
    ui.newChapterBtn.addEventListener('click', newChapter);
    ui.synopsisBackBtn.addEventListener('click', () => showManuscriptView(true));
    ui.synopsisNewBtn.addEventListener('click', newSynopsisCard);
    ui.chapterList.addEventListener('dragover', onChapterListDragOver);
    ui.chapterList.addEventListener('drop', onChapterListDrop);
    ui.chapterContextMenu?.addEventListener('click', handleChapterContextAction);
    ui.chapterContextMenu?.addEventListener('contextmenu', (event) => event.preventDefault());
    document.addEventListener('pointerdown', (event) => {
        if (!ui.chapterContextMenu || ui.chapterContextMenu.hidden) return;
        if (!ui.chapterContextMenu.contains(event.target)) closeChapterContextMenu();
    });
    window.addEventListener('blur', closeChapterContextMenu);
    window.addEventListener('resize', closeChapterContextMenu);
    ui.chapterList.addEventListener('scroll', closeChapterContextMenu, { passive: true });
    ui.saveBtn.addEventListener('click', () => saveActiveChapter(false));
    ui.chapterTitle.addEventListener('input', markDirty);
    ui.chapterStatus.addEventListener('change', markDirty);
    ui.chapterContent.addEventListener('input', markDirty);

    document.querySelectorAll('[data-command]').forEach((button) => {
        button.addEventListener('mousedown', (e) => e.preventDefault());
        button.addEventListener('click', () => runCommand(button.dataset.command));
    });
    document.querySelectorAll('[data-block]').forEach((button) => {
        button.addEventListener('mousedown', (e) => e.preventDefault());
        button.addEventListener('click', () => formatBlock(button.dataset.block));
    });

    async function openChapterFromFeature(id) {
        const chapter = state.chapters.find((item) => item.id === id);
        if (!chapter) return;
        if (state.dirty) await saveActiveChapter(true);
        state.activeId = id;
        showManuscriptView(false);
        renderChapters();
        renderActiveChapter();
    }

    window.ecrivainApp = {
        showManuscript: () => showManuscriptView(true),
        openChapter: (id) => openChapterFromFeature(id),
        activeChapterId: () => state.activeId,
        updatePreferences: (prefs) => { state.preferences = { ...state.preferences, ...(prefs || {}) }; },
        loadProjectState: (payload) => setProjectState(payload),
        openRecentProject: (projectDir) => openRecentProject(projectDir),
        reloadProject: async (preferredChapterId = null) => {
            const payload = await window.ecrivain.project.state();
            if (!payload) return null;
            const wanted = preferredChapterId || state.activeId;
            setProjectState(payload);
            if (wanted && state.chapters.some((chapter) => chapter.id === wanted)) {
                state.activeId = wanted;
                renderChapters();
                renderActiveChapter();
            }
            return payload;
        }
    };


    function applyWindowUiState(payload) {
        const zoom = Math.round(Number(payload?.zoom || 1) * 100);
        if (ui.zoomSlider) ui.zoomSlider.value = String(Math.min(150, Math.max(80, zoom)));
        if (ui.zoomLabel) ui.zoomLabel.textContent = `${zoom} %`;
        const fullscreen = Boolean(payload?.fullscreen);
        document.body.classList.toggle('is-fullscreen', fullscreen);
        if (ui.fullscreenExitBtn) ui.fullscreenExitBtn.hidden = !fullscreen;
    }

    async function setZoomFromSlider(value) {
        try {
            const payload = await window.ecrivain.windowControl.setZoom(Number(value) / 100);
            applyWindowUiState(payload);
            state.preferences = { ...state.preferences, uiZoom: Number(payload?.zoom || 1) };
        } catch (_) {}
    }

    ui.zoomOutBtn?.addEventListener('click', async () => {
        try { applyWindowUiState(await window.ecrivain.windowControl.adjustZoom(-0.05)); } catch (_) {}
    });
    ui.zoomInBtn?.addEventListener('click', async () => {
        try { applyWindowUiState(await window.ecrivain.windowControl.adjustZoom(0.05)); } catch (_) {}
    });
    ui.zoomSlider?.addEventListener('input', (event) => setZoomFromSlider(event.target.value));
    ui.fullscreenExitBtn?.addEventListener('click', async () => {
        try { applyWindowUiState(await window.ecrivain.windowControl.exitFullscreen()); } catch (_) {}
    });
    window.ecrivain.windowControl?.onState?.(applyWindowUiState);
    window.ecrivain.windowControl?.state?.().then(applyWindowUiState).catch(() => {});

    window.ecrivain.menu.onAction(handleMenuAction);

    // Vérification automatique du projet : totalement silencieuse tant qu’aucun
    // problème ne demande l’intervention de l’utilisateur. Si Écrivain a réparé
    // des données en arrière-plan, l’état affiché est simplement rafraîchi.
    window.ecrivain.project.onBackgroundValidation?.((payload) => {
        const refreshed = payload?.state;
        if (!refreshed || !state.projectDir || refreshed.projectDir !== state.projectDir) return;
        if (state.dirty) return;

        const wanted = state.activeId;
        setProjectState(refreshed);
        if (wanted && state.chapters.some((chapter) => chapter.id === wanted)) {
            state.activeId = wanted;
            renderChapters();
            renderActiveChapter();
        }
    });

    window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && document.body.classList.contains('is-fullscreen')) {
            event.preventDefault();
            window.ecrivain.windowControl?.exitFullscreen?.().then(applyWindowUiState).catch(() => {});
            return;
        }
        if (event.key === 'Escape' && ui.chapterContextMenu && !ui.chapterContextMenu.hidden) {
            closeChapterContextMenu();
            return;
        }
        if (event.ctrlKey && event.key.toLowerCase() === 's') {
            if (window.ecrivainGlobalSynopsis?.isOpen?.()) return; // géré par global-synopsis.js
            event.preventDefault();
            saveActiveChapter(false);
        }
    });

    // Préférences globales : autosauvegarde, zoom et comportement au démarrage.
    window.ecrivain.preferences?.state?.().then(async (payload) => {
        state.preferences = { ...state.preferences, ...(payload?.preferences || {}) };
        if (payload?.preferences?.startupBehavior === 'last-project' && payload?.lastProject && !state.projectDir) {
            try { await openRecentProject(payload.lastProject); } catch (_) { /* accueil normal si le projet n'existe plus */ }
        }
    }).catch(() => {});

    window.addEventListener('beforeunload', () => {
        if (state.dirty) saveActiveChapter(true);
    });
})();
