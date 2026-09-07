'use strict';

(() => {
    const $ = (id) => document.getElementById(id);

    const ui = {
        view: $('notesView'),
        back: $('notesBackBtn'),
        newText: $('notesNewTextBtn'),
        newFile: $('notesNewFileBtn'),
        openFolder: $('notesOpenFolderBtn'),
        listPane: $('notesListPane'),
        search: $('notesSearch'),
        category: $('notesCategoryFilter'),
        scope: $('notesScopeFilter'),
        count: $('notesCount'),
        empty: $('notesEmpty'),
        grid: $('notesGrid'),
        reader: $('noteReader'),
        readerBack: $('noteReaderBackBtn'),
        readerCard: $('noteReaderCard'),
        readerMeta: $('noteReaderMeta'),
        readerTitle: $('noteReaderTitle'),
        readerContent: $('noteReaderContent'),
        readerFile: $('noteReaderFile'),
        readerUpdated: $('noteReaderUpdated'),
        readerOpenFile: $('noteReaderOpenFileBtn'),
        readerEdit: $('noteReaderEditBtn'),
        readerDelete: $('noteReaderDeleteBtn'),
        modalBackdrop: $('noteModalBackdrop'),
        modal: $('noteModalBackdrop')?.querySelector('.note-modal'),
        modalTitle: $('noteModalTitle'),
        modalBody: $('noteModalBody'),
        modalCancel: $('noteModalCancel'),
        modalConfirm: $('noteModalConfirm'),
        editorArea: $('editorArea'),
        welcome: $('welcome'),
        synopsis: $('synopsisView'),
        timeline: $('timelineView'),
        stats: $('statsView'),
        toast: $('toast')
    };

    if (!ui.view || !window.ecrivain?.notes) return;

    const state = {
        notes: [],
        categories: {},
        colors: {},
        chapters: [],
        activeNoteId: null,
        search: '',
        category: 'all',
        scope: 'all'
    };

    function toast(message, error = false) {
        if (!ui.toast) return;
        ui.toast.textContent = message;
        ui.toast.classList.toggle('is-error', error);
        ui.toast.hidden = false;
        window.clearTimeout(toast.timer);
        toast.timer = window.setTimeout(() => { ui.toast.hidden = true; }, 3200);
    }

    function currentChapterId() {
        return document.querySelector('.chapter-item.is-active')?.dataset.id || '';
    }

    function chapterLabel(chapterId) {
        if (!chapterId) return 'Livre entier';
        const chapter = state.chapters.find((item) => item.id === chapterId);
        return chapter ? chapter.title : 'Chapitre lié';
    }

    function stripHtml(html) {
        const box = document.createElement('div');
        box.innerHTML = html || '';
        return (box.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function sanitizeHtml(html) {
        const doc = new DOMParser().parseFromString(`<div>${String(html || '')}</div>`, 'text/html');
        doc.querySelectorAll('script,style,iframe,object,embed,link,meta,base').forEach((el) => el.remove());
        doc.querySelectorAll('*').forEach((el) => {
            for (const attr of Array.from(el.attributes)) {
                const name = attr.name.toLowerCase();
                const value = String(attr.value || '').trim().toLowerCase();
                if (name.startsWith('on')) el.removeAttribute(attr.name);
                if ((name === 'href' || name === 'src') && value.startsWith('javascript:')) el.removeAttribute(attr.name);
            }
        });
        return doc.body.firstElementChild?.innerHTML || '<p></p>';
    }

    function colorInfo(key) {
        return state.colors[key] || state.colors.none || { label: 'Aucune', bg: '#fff', border: '#d8d2ca', text: '#3d3833' };
    }

    function noteById(id) {
        return state.notes.find((note) => note.id === id) || null;
    }

    function activeNote() {
        return noteById(state.activeNoteId);
    }

    function setCategoryOptions() {
        const previous = ui.category.value || state.category;
        ui.category.innerHTML = '';
        const all = document.createElement('option');
        all.value = 'all';
        all.textContent = 'Toutes';
        ui.category.appendChild(all);
        for (const [value, label] of Object.entries(state.categories)) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            ui.category.appendChild(option);
        }
        ui.category.value = Object.hasOwn(state.categories, previous) ? previous : 'all';
        state.category = ui.category.value;
    }

    async function refresh() {
        const [notesPayload, projectPayload] = await Promise.all([
            window.ecrivain.notes.state(),
            window.ecrivain.project.state()
        ]);
        state.notes = Array.isArray(notesPayload?.notes) ? notesPayload.notes : [];
        state.categories = notesPayload?.categories || {};
        state.colors = notesPayload?.colors || {};
        state.chapters = Array.isArray(projectPayload?.chapters) ? projectPayload.chapters : [];
        setCategoryOptions();
    }

    async function open() {
        try {
            const project = await window.ecrivain.project.state();
            if (!project?.project) {
                toast('Ouvrez d’abord un projet.', true);
                return;
            }
            await refresh();
            state.activeNoteId = null;
            state.search = '';
            state.category = 'all';
            state.scope = 'all';
            ui.search.value = '';
            ui.category.value = 'all';
            ui.scope.value = 'all';
            if (ui.synopsis) ui.synopsis.hidden = true;
            if (ui.timeline) ui.timeline.hidden = true;
            if (ui.stats) ui.stats.hidden = true;
            const mindmapView = document.getElementById('mindmapView');
            if (mindmapView) mindmapView.hidden = true;
            if (ui.editorArea) ui.editorArea.hidden = true;
            if (ui.welcome) ui.welcome.hidden = true;
            ui.view.hidden = false;
            showList();
            renderList();
        } catch (error) {
            toast(error.message || 'Impossible d’ouvrir les notes.', true);
        }
    }

    function backToManuscript() {
        ui.view.hidden = true;
        state.activeNoteId = null;
        const active = document.querySelector('.chapter-item.is-active');
        if (active) {
            if (ui.welcome) ui.welcome.hidden = true;
            if (ui.editorArea) ui.editorArea.hidden = false;
        } else {
            if (ui.editorArea) ui.editorArea.hidden = true;
            if (ui.welcome) ui.welcome.hidden = false;
        }
    }

    function showList() {
        ui.listPane.hidden = false;
        ui.reader.hidden = true;
    }

    function filteredNotes() {
        const q = state.search.trim().toLocaleLowerCase('fr');
        const activeChapter = currentChapterId();
        return state.notes.filter((note) => {
            if (state.category !== 'all' && note.category !== state.category) return false;
            if (state.scope === 'book' && note.chapterId) return false;
            if (state.scope === 'chapter' && (!activeChapter || note.chapterId !== activeChapter)) return false;
            if (q) {
                const haystack = [
                    note.title,
                    note.type === 'text' ? stripHtml(note.content) : note.originalName,
                    state.categories[note.category] || note.category,
                    chapterLabel(note.chapterId)
                ].join(' ').toLocaleLowerCase('fr');
                if (!haystack.includes(q)) return false;
            }
            return true;
        });
    }

    function formatBytes(value) {
        const n = Number(value || 0);
        if (!n) return '';
        if (n < 1024) return `${n} o`;
        if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
        return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
    }

    function attachmentInfo(note) {
        const name = String(note?.originalName || note?.title || 'Document');
        const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
        if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return { kind: 'image', label: 'IMG', description: 'Image' };
        if (ext === 'pdf') return { kind: 'pdf', label: 'PDF', description: 'Document PDF' };
        if (['doc', 'docx'].includes(ext)) return { kind: 'word', label: 'DOC', description: 'Document Word' };
        if (ext === 'odt') return { kind: 'odt', label: 'ODT', description: 'Document OpenDocument' };
        if (['txt', 'md', 'rtf'].includes(ext)) return { kind: 'text', label: ext ? ext.toUpperCase() : 'TXT', description: 'Document texte' };
        if (ext === 'zip') return { kind: 'archive', label: 'ZIP', description: 'Archive' };
        return { kind: 'file', label: ext ? ext.slice(0, 4).toUpperCase() : 'FIC', description: 'Fichier' };
    }

    function attachmentCategory(filename) {
        const ext = String(filename || '').split('.').pop().toLowerCase();
        if (ext === 'pdf') return 'pdf';
        if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'image';
        return 'documentation';
    }

    function attachmentButton(note, reader = false) {
        const info = attachmentInfo(note);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `note-attachment note-attachment--${info.kind}${reader ? ' note-attachment--reader' : ''}`;
        button.title = `Ouvrir ${note.originalName || 'le fichier'} avec l’application Windows associée`;

        const icon = document.createElement('span');
        icon.className = 'note-attachment__icon';
        icon.textContent = info.label;

        const body = document.createElement('span');
        body.className = 'note-attachment__body';
        const name = document.createElement('strong');
        name.className = 'note-attachment__name';
        name.textContent = note.originalName || note.title || 'Document';
        const meta = document.createElement('span');
        meta.className = 'note-attachment__meta';
        meta.textContent = `${info.description}${note.size ? ` · ${formatBytes(note.size)}` : ''} · Cliquer pour ouvrir`;
        body.append(name, meta);

        const arrow = document.createElement('span');
        arrow.className = 'note-attachment__open';
        arrow.textContent = '↗';
        arrow.setAttribute('aria-hidden', 'true');

        button.append(icon, body, arrow);
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            openAttachment(note);
        });
        return button;
    }

    function renderList() {
        const notes = filteredNotes();
        ui.grid.innerHTML = '';
        ui.empty.hidden = notes.length > 0;
        ui.grid.hidden = notes.length === 0;
        ui.count.textContent = `${notes.length} ${notes.length > 1 ? 'notes' : 'note'}`;

        for (const note of notes) {
            const color = colorInfo(note.color);
            const card = document.createElement('article');
            card.className = 'note-card';
            card.dataset.id = note.id;
            card.style.setProperty('--note-bg', color.bg || '#fff');
            card.style.setProperty('--note-border', color.border || '#d8d2ca');
            card.style.setProperty('--note-text', color.text || '#3d3833');

            const head = document.createElement('div');
            head.className = 'note-card__head';
            const badges = document.createElement('div');
            badges.className = 'note-card__badges';
            const category = document.createElement('span');
            category.className = 'note-pill';
            category.textContent = state.categories[note.category] || note.category || 'Libre';
            const type = document.createElement('span');
            type.className = 'note-pill note-pill--muted';
            type.textContent = note.type === 'file' ? 'Fichier' : 'Texte';
            badges.append(category, type);
            head.appendChild(badges);

            const title = document.createElement('h3');
            title.textContent = note.title || 'Note';

            const scope = document.createElement('p');
            scope.className = 'note-card__scope';
            scope.textContent = chapterLabel(note.chapterId);

            let preview;
            if (note.type === 'file') {
                preview = attachmentButton(note);
            } else {
                preview = document.createElement('p');
                preview.className = 'note-card__preview';
                const text = stripHtml(note.content);
                preview.textContent = text || 'Note vide';
            }

            const footer = document.createElement('div');
            footer.className = 'note-card__footer';
            const date = document.createElement('small');
            date.textContent = note.updatedAt ? `Modifiée le ${note.updatedAt}` : '';
            const actions = document.createElement('div');
            actions.className = 'note-card__actions';

            const openBtn = actionButton('Ouvrir', () => openReader(note.id));
            const editBtn = actionButton('Modifier', () => editNote(note));
            actions.append(openBtn, editBtn);
            actions.append(actionButton('Supprimer', () => removeNote(note), true));
            footer.append(date, actions);

            card.append(head, title, scope, preview, footer);
            card.addEventListener('click', () => openReader(note.id));
            card.querySelectorAll('button').forEach((btn) => btn.addEventListener('click', (e) => e.stopPropagation()));
            ui.grid.appendChild(card);
        }
    }

    function actionButton(label, handler, danger = false) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        if (danger) button.classList.add('danger');
        button.addEventListener('click', handler);
        return button;
    }

    function openReader(noteId) {
        const note = noteById(noteId);
        if (!note) return;
        state.activeNoteId = note.id;
        ui.listPane.hidden = true;
        ui.reader.hidden = false;
        const color = colorInfo(note.color);
        ui.readerCard.style.setProperty('--note-bg', color.bg || '#fff');
        ui.readerCard.style.setProperty('--note-border', color.border || '#d8d2ca');
        ui.readerTitle.textContent = note.title || 'Note';
        ui.readerMeta.innerHTML = '';
        for (const text of [state.categories[note.category] || note.category || 'Libre', chapterLabel(note.chapterId)]) {
            const pill = document.createElement('span');
            pill.className = 'note-pill';
            pill.textContent = text;
            ui.readerMeta.appendChild(pill);
        }
        ui.readerUpdated.textContent = note.updatedAt ? `Dernière modification : ${note.updatedAt}` : '';
        if (note.type === 'file') {
            ui.readerContent.hidden = true;
            ui.readerContent.innerHTML = '';
            ui.readerFile.hidden = false;
            ui.readerFile.innerHTML = '';
            ui.readerFile.appendChild(attachmentButton(note, true));
            ui.readerOpenFile.hidden = false;
            ui.readerOpenFile.textContent = 'Ouvrir dans Windows';
        } else {
            ui.readerFile.hidden = true;
            ui.readerFile.textContent = '';
            ui.readerOpenFile.hidden = true;
            ui.readerContent.hidden = false;
            ui.readerContent.innerHTML = sanitizeHtml(note.content || '<p></p>');
        }
    }

    async function openAttachment(note) {
        if (!note || note.type !== 'file') return;
        try {
            await window.ecrivain.notes.openFile(note.id);
        } catch (error) {
            toast(error.message || 'Impossible d’ouvrir le fichier.', true);
        }
    }

    async function removeNote(note) {
        if (!note) return;
        const ok = window.confirm(`Supprimer la note « ${note.title || 'Note'} » ?${note.type === 'file' ? '\nLe fichier joint sera également supprimé du projet.' : ''}`);
        if (!ok) return;
        try {
            state.notes = await window.ecrivain.notes.delete(note.id);
            state.activeNoteId = null;
            showList();
            renderList();
            toast('Note supprimée.');
        } catch (error) {
            toast(error.message || 'Impossible de supprimer la note.', true);
        }
    }

    async function newTextNote() {
        await showEditor({
            id: '',
            type: 'text',
            title: '',
            category: 'libre',
            chapterId: currentChapterId(),
            color: 'none',
            content: '<p></p>'
        });
    }

    async function newFileNote() {
        try {
            const attachment = await window.ecrivain.notes.pickAttachment();
            if (!attachment || attachment.canceled) return;
            await showEditor({
                id: '',
                type: 'file',
                title: attachment.originalName || '',
                category: attachmentCategory(attachment.originalName),
                chapterId: currentChapterId(),
                color: 'none',
                originalName: attachment.originalName || '',
                sourcePath: attachment.sourcePath || ''
            });
        } catch (error) {
            toast(error.message || 'Impossible de sélectionner le fichier.', true);
        }
    }

    async function editNote(note) {
        if (!note) return;
        await showEditor({ ...note, sourcePath: '' });
    }

    function optionSelect(id, label, options, value) {
        const wrap = document.createElement('div');
        wrap.className = 'modal-field';
        const lab = document.createElement('label');
        lab.htmlFor = id;
        lab.textContent = label;
        const select = document.createElement('select');
        select.id = id;
        for (const [optValue, optLabel] of options) {
            const option = document.createElement('option');
            option.value = optValue;
            option.textContent = optLabel;
            select.appendChild(option);
        }
        select.value = value || '';
        wrap.append(lab, select);
        return { wrap, input: select };
    }

    function textInput(id, label, value) {
        const wrap = document.createElement('div');
        wrap.className = 'modal-field span-2';
        const lab = document.createElement('label');
        lab.htmlFor = id;
        lab.textContent = label;
        const input = document.createElement('input');
        input.id = id;
        input.type = 'text';
        input.value = value || '';
        wrap.append(lab, input);
        return { wrap, input };
    }

    async function showEditor(note) {
        return new Promise((resolve) => {
            let sourcePath = String(note.sourcePath || '');
            let sourceName = String(note.originalName || '');
            const isFile = note.type === 'file';
            ui.modalTitle.textContent = note.id ? (isFile ? 'Modifier la note fichier' : 'Modifier la note') : (isFile ? 'Nouvelle note fichier' : 'Nouvelle note');
            ui.modalBody.innerHTML = '';

            const grid = document.createElement('div');
            grid.className = 'note-form-grid';
            const title = textInput('noteTitleField', 'Titre', note.title || '');
            const category = optionSelect('noteCategoryField', 'Catégorie', Object.entries(state.categories), note.category || 'libre');
            const chapter = optionSelect('noteChapterField', 'Lien', [['', 'Livre entier'], ...state.chapters.map((ch) => [ch.id, `${'— '.repeat(Number(ch._depth || 0))}${ch.title}`])], note.chapterId || '');
            const color = optionSelect('noteColorField', 'Couleur', Object.entries(state.colors).map(([key, info]) => [key, info.label || key]), note.color || 'none');
            grid.append(title.wrap, category.wrap, chapter.wrap, color.wrap);
            ui.modalBody.appendChild(grid);

            let richEditor = null;
            let selectedFile = null;

            if (isFile) {
                const box = document.createElement('div');
                box.className = 'note-file-editor';
                const label = document.createElement('strong');
                label.textContent = note.id ? 'Fichier actuel / remplacement' : 'Fichier joint';
                selectedFile = document.createElement('div');
                selectedFile.className = 'note-selected-file';
                selectedFile.textContent = sourceName || note.originalName || 'Aucun fichier sélectionné';
                const choose = document.createElement('button');
                choose.type = 'button';
                choose.className = 'button';
                choose.textContent = note.id ? 'Remplacer le fichier…' : 'Choisir un fichier…';
                choose.addEventListener('click', async () => {
                    try {
                        const picked = await window.ecrivain.notes.pickAttachment();
                        if (!picked || picked.canceled) return;
                        sourcePath = picked.sourcePath || '';
                        sourceName = picked.originalName || '';
                        selectedFile.textContent = sourceName || 'Fichier sélectionné';
                        if (!title.input.value.trim() || title.input.value === note.originalName) title.input.value = sourceName;
                    } catch (error) {
                        toast(error.message || 'Impossible de sélectionner le fichier.', true);
                    }
                });
                const hint = document.createElement('p');
                hint.className = 'note-file-hint';
                hint.textContent = 'Une copie du fichier est conservée avec le projet dans assets\\notes. Le document d’origine n’est pas déplacé.';
                box.append(label, selectedFile, choose, hint);
                ui.modalBody.appendChild(box);
            } else {
                const toolbar = document.createElement('div');
                toolbar.className = 'note-editor-toolbar';
                const commandButton = (label, command, titleText) => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.textContent = label;
                    btn.title = titleText;
                    btn.addEventListener('mousedown', (event) => event.preventDefault());
                    btn.addEventListener('click', () => {
                        richEditor.focus();
                        document.execCommand(command, false, null);
                    });
                    return btn;
                };
                toolbar.append(
                    commandButton('G', 'bold', 'Gras'),
                    commandButton('I', 'italic', 'Italique'),
                    commandButton('S', 'underline', 'Souligné'),
                    commandButton('• Liste', 'insertUnorderedList', 'Liste à puces'),
                    commandButton('1. Liste', 'insertOrderedList', 'Liste numérotée')
                );
                const spacer = document.createElement('span');
                spacer.className = 'note-toolbar-spacer';
                toolbar.appendChild(spacer);
                const cnrtlButton = (label, mode) => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.textContent = label;
                    btn.addEventListener('mousedown', (event) => event.preventDefault());
                    btn.addEventListener('click', async () => {
                        const word = String(window.getSelection()?.toString() || '').trim().split(/\s+/)[0] || '';
                        if (!word) {
                            toast('Sélectionnez un mot dans la note.', true);
                            return;
                        }
                        try { await window.ecrivain.notes.cnrtl(mode, word); }
                        catch (error) { toast(error.message || 'Impossible d’ouvrir le CNRTL.', true); }
                    });
                    return btn;
                };
                toolbar.append(cnrtlButton('CNRTL Définition ↗', 'definition'), cnrtlButton('Synonymes ↗', 'synonymie'));

                richEditor = document.createElement('div');
                richEditor.className = 'note-rich-editor';
                richEditor.contentEditable = 'true';
                richEditor.spellcheck = true;
                richEditor.innerHTML = sanitizeHtml(note.content || '<p></p>');
                richEditor.addEventListener('keydown', (event) => {
                    if (event.ctrlKey && event.key === 'Enter') {
                        event.preventDefault();
                        confirm();
                    }
                });
                ui.modalBody.append(toolbar, richEditor);
            }

            ui.modalConfirm.textContent = 'Enregistrer';
            ui.modalBackdrop.hidden = false;
            window.setTimeout(() => title.input.focus(), 20);

            function cleanup(value) {
                ui.modalBackdrop.hidden = true;
                ui.modalBody.innerHTML = '';
                ui.modalConfirm.removeEventListener('click', confirm);
                ui.modalCancel.removeEventListener('click', cancel);
                document.removeEventListener('keydown', keydown);
                resolve(value);
            }

            async function confirm() {
                const noteTitle = title.input.value.trim();
                if (!noteTitle) {
                    title.input.focus();
                    return;
                }
                if (isFile && !note.id && !sourcePath) {
                    toast('Choisissez un fichier pour cette note.', true);
                    return;
                }
                ui.modalConfirm.disabled = true;
                try {
                    let saved;
                    const base = {
                        id: note.id || '',
                        title: noteTitle,
                        category: category.input.value,
                        chapterId: chapter.input.value,
                        color: color.input.value
                    };
                    if (isFile) {
                        saved = await window.ecrivain.notes.saveFile({ ...base, sourcePath });
                    } else {
                        saved = await window.ecrivain.notes.saveText({ ...base, content: sanitizeHtml(richEditor.innerHTML || '<p></p>') });
                    }
                    const index = state.notes.findIndex((item) => item.id === saved.id);
                    if (index >= 0) state.notes[index] = saved;
                    else state.notes.unshift(saved);
                    state.notes.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
                    state.activeNoteId = saved.id;
                    cleanup(saved);
                    renderList();
                    openReader(saved.id);
                    toast('Note enregistrée.');
                } catch (error) {
                    toast(error.message || 'Impossible d’enregistrer la note.', true);
                } finally {
                    ui.modalConfirm.disabled = false;
                }
            }

            function cancel() { cleanup(null); }
            function keydown(event) {
                if (event.key === 'Escape') cancel();
            }
            ui.modalConfirm.addEventListener('click', confirm);
            ui.modalCancel.addEventListener('click', cancel);
            document.addEventListener('keydown', keydown);
        });
    }

    ui.back.addEventListener('click', backToManuscript);
    ui.newText.addEventListener('click', newTextNote);
    ui.newFile.addEventListener('click', newFileNote);
    if (ui.openFolder) ui.openFolder.addEventListener('click', async () => {
        try { await window.ecrivain.notes.openFolder(); }
        catch (error) { toast(error.message || 'Impossible d’ouvrir le dossier des fichiers.', true); }
    });
    ui.search.addEventListener('input', () => {
        state.search = ui.search.value || '';
        renderList();
    });
    ui.category.addEventListener('change', () => {
        state.category = ui.category.value;
        renderList();
    });
    ui.scope.addEventListener('change', () => {
        state.scope = ui.scope.value;
        renderList();
    });
    ui.readerBack.addEventListener('click', () => {
        state.activeNoteId = null;
        showList();
        renderList();
    });
    ui.readerOpenFile.addEventListener('click', () => openAttachment(activeNote()));
    ui.readerEdit.addEventListener('click', () => editNote(activeNote()));
    ui.readerDelete.addEventListener('click', () => removeNote(activeNote()));

    window.ecrivainNotes = { open };
})();
