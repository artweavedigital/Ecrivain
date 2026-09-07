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
        if (state.saving) return state.data;
        window.clearTimeout(state.timer);
        state.timer = null;
        state.saving = true;
        setSaveState('Enregistrement…', true);
        try {
            const saved = await window.ecrivain.globalSynopsis.save(values());
            state.data = saved || values();
            state.dirty = false;
            ui.updated.textContent = `Dernière modification : ${formatDateTime(saved?.updatedAt)}`;
            setSaveState(silent ? 'Enregistré automatiquement' : 'Enregistré', false);
            if (!silent) toast('Synopsis global enregistré.');
            return saved;
        } catch (error) {
            state.dirty = true;
            setSaveState('Erreur d’enregistrement', true);
            toast(error.message || 'Impossible d’enregistrer le synopsis global.', true);
            throw error;
        } finally {
            state.saving = false;
        }
    }

    function markDirty() {
        state.dirty = true;
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
        isOpen: () => !ui.view.hidden,
        isDirty: () => state.dirty
    };
})();
