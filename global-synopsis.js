'use strict';

(() => {
    const $ = (id) => document.getElementById(id);

    const ui = {
        view: $('globalSynopsisView'),
        back: $('globalSynopsisBackBtn'),
        save: $('globalSynopsisSaveBtn'),
        saveState: $('globalSynopsisSaveState'),
        title: $('globalSynopsisTitle'),
        pitch: $('globalSynopsisPitch'),
        synopsis: $('globalSynopsisMain'),
        notes: $('globalSynopsisNotes'),
        pitchCount: $('globalSynopsisPitchCount'),
        synopsisCount: $('globalSynopsisMainCount'),
        notesCount: $('globalSynopsisNotesCount'),
        totalCount: $('globalSynopsisTotalCount'),
        updated: $('globalSynopsisUpdated'),
        toast: $('toast')
    };

    if (!ui.view || !window.ecrivain?.globalSynopsis) return;

    const state = {
        data: null,
        dirty: false,
        revision: 0,          // incrémenté à chaque frappe : détecte une modification pendant un enregistrement
        saving: false,
        timer: null
    };

    function toast(message, error = false) {
        if (!ui.toast) return;
        ui.toast.textContent = message;
        ui.toast.classList.toggle('is-error', error);
        ui.toast.hidden = false;
        window.clearTimeout(toast.timer);
        toast.timer = window.setTimeout(() => { ui.toast.hidden = true; }, 3000);
    }

    function countWords(value) {
        const text = String(value || '').replace(/\s+/g, ' ').trim();
        return text ? text.split(' ').filter(Boolean).length : 0;
    }

    function wordLabel(value) {
        const n = countWords(value);
        return `${n} ${n > 1 ? 'mots' : 'mot'}`;
    }

    function formatDateTime(value) {
        const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
        if (!match) return value || '—';
        const [, year, month, day, hour, minute] = match;
        return hour ? `${day}/${month}/${year} à ${hour}:${minute}` : `${day}/${month}/${year}`;
    }

    function values() {
        return {
            title: ui.title.value,
            pitch: ui.pitch.value,
            synopsis: ui.synopsis.value,
            structureNotes: ui.notes.value
        };
    }

    function renderCounters() {
        ui.pitchCount.textContent = wordLabel(ui.pitch.value);
        ui.synopsisCount.textContent = wordLabel(ui.synopsis.value);
        ui.notesCount.textContent = wordLabel(ui.notes.value);
        const total = countWords(ui.pitch.value) + countWords(ui.synopsis.value) + countWords(ui.notes.value);
        ui.totalCount.textContent = `${total} ${total > 1 ? 'mots au total' : 'mot au total'}`;
    }

    function setSaveState(label, dirty = false) {
        ui.saveState.textContent = label;
        ui.saveState.classList.toggle('is-dirty', dirty);
    }

    function fill(data = {}) {
        state.data = data;
        ui.title.value = String(data.title || '');
        ui.pitch.value = String(data.pitch || '');
        ui.synopsis.value = String(data.synopsis || '');
        ui.notes.value = String(data.structureNotes || '');
        ui.updated.textContent = `Dernière modification : ${formatDateTime(data.updatedAt)}`;
        state.dirty = false;
        setSaveState('Enregistré', false);
        renderCounters();
    }

    function hideOtherViews() {
        const ids = [
            'editorArea', 'welcome', 'synopsisView', 'notesView', 'timelineView',
            'statsView', 'mindmapView', 'backupsView', 'historyView', 'projectSearchView'
        ];
        for (const id of ids) {
            const el = document.getElementById(id);
            if (el) el.hidden = true;
        }
    }

    async function load() {
        const data = await window.ecrivain.globalSynopsis.state();
        fill(data || {});
        return data;
    }

    async function save(silent = false) {
        // Un enregistrement est déjà en cours : on attend sa fin, puis on enregistre
        // à nouveau si du texte a été saisi entre-temps (rien n'est jamais ignoré).
        if (state.saving) {
            await state.savingPromise?.catch(() => {});
            return state.dirty ? save(true) : state.data;
        }
        window.clearTimeout(state.timer);
        state.timer = null;
        state.saving = true;
        const revision = state.revision;
        setSaveState('Enregistrement…', true);
        state.savingPromise = (async () => {
            const saved = await window.ecrivain.globalSynopsis.save(values());
            state.data = saved || values();
            // Si l'utilisateur a continué à écrire pendant l'enregistrement, le texte reste « à enregistrer ».
            state.dirty = state.revision !== revision;
            ui.updated.textContent = `Dernière modification : ${formatDateTime(saved?.updatedAt)}`;
            setSaveState(state.dirty ? 'À enregistrer' : (silent ? 'Enregistré automatiquement' : 'Enregistré'), state.dirty);
            if (!silent && !state.dirty) toast('Synopsis global enregistré.');
            return saved;
        })();
        try {
            const saved = await state.savingPromise;
            state.saving = false;
            if (state.dirty) state.timer = window.setTimeout(() => save(true).catch(() => {}), 400);
            return saved;
        } catch (error) {
            state.saving = false;
            state.dirty = true;
            setSaveState('Erreur d’enregistrement', true);
            toast(error.message || 'Impossible d’enregistrer le synopsis global.', true);
            throw error;
        }
    }

    // Termine tout enregistrement en cours ou en attente (fermeture de la fenêtre).
    async function flush() {
        window.clearTimeout(state.timer);
        state.timer = null;
        if (state.saving) await state.savingPromise?.catch(() => {});
        if (state.dirty) await save(true);
        return !state.dirty;
    }

    function markDirty() {
        state.dirty = true;
        state.revision += 1;
        setSaveState('À enregistrer', true);
        renderCounters();
        window.clearTimeout(state.timer);
        state.timer = window.setTimeout(() => save(true).catch(() => {}), 1200);
    }

    async function open() {
        try {
            const project = await window.ecrivain.project.state();
            if (!project?.project) {
                toast('Ouvrez d’abord un projet.', true);
                return;
            }
            hideOtherViews();
            ui.view.hidden = false;
            await load();
            window.setTimeout(() => ui.synopsis.focus(), 30);
        } catch (error) {
            ui.view.hidden = true;
            toast(error.message || 'Impossible d’ouvrir le synopsis global.', true);
        }
    }

    async function backToManuscript() {
        try {
            if (state.dirty) await save(true);
        } catch (_) {
            return;
        }
        ui.view.hidden = true;
        if (window.ecrivainApp?.showManuscript) window.ecrivainApp.showManuscript();
    }

    for (const input of [ui.title, ui.pitch, ui.synopsis, ui.notes]) {
        input?.addEventListener('input', markDirty);
    }

    ui.save?.addEventListener('click', () => save(false));
    ui.back?.addEventListener('click', backToManuscript);

    window.addEventListener('keydown', (event) => {
        if (ui.view.hidden) return;
        if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 's') {
            event.preventDefault();
            event.stopImmediatePropagation();
            save(false);
        }
    }, true);

    window.ecrivainGlobalSynopsis = {
        open,
        save,
        flush,
        isOpen: () => !ui.view.hidden,
        isDirty: () => state.dirty
    };
})();
