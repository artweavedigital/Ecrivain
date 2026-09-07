'use strict';

(() => {
    const $ = (id) => document.getElementById(id);
    const ui = {
        view: $('statsView'),
        back: $('statsBackBtn'),
        refresh: $('statsRefreshBtn'),
        totalWords: $('statsTotalWords'),
        exportWords: $('statsExportWords'),
        excluded: $('statsExcluded'),
        todayWords: $('statsTodayWords'),
        weekWords: $('statsWeekWords'),
        chapterCount: $('statsChapterCount'),
        averageWords: $('statsAverageWords'),
        dailyChart: $('statsDailyChart'),
        statusList: $('statsStatusList'),
        chapterList: $('statsChapterList'),
        editorArea: $('editorArea'),
        welcome: $('welcome'),
        synopsis: $('synopsisView'),
        notes: $('notesView'),
        timeline: $('timelineView'),
        toast: $('toast')
    };

    if (!ui.view || !window.ecrivain?.stats) return;

    const statusLabels = {
        draft: 'Brouillon',
        writing: 'En cours',
        review: 'À relire',
        'in-progress': 'En cours',
        final: 'Finalisé',
        done: 'Finalisé',
        cut: 'Coupé'
    };

    const nf = new Intl.NumberFormat('fr-FR');

    function toast(message, error = false) {
        if (!ui.toast) return;
        ui.toast.textContent = message;
        ui.toast.classList.toggle('is-error', error);
        ui.toast.hidden = false;
        window.clearTimeout(toast.timer);
        toast.timer = window.setTimeout(() => { ui.toast.hidden = true; }, 3000);
    }

    function formatNumber(value) {
        return nf.format(Math.max(0, Number(value || 0)));
    }

    function formatShortDate(value) {
        const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) return value || '';
        const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0);
        return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric' }).format(date).replace('.', '');
    }

    function mergedStatusCounts(counts = {}) {
        const result = {};
        for (const [key, raw] of Object.entries(counts || {})) {
            const label = statusLabels[key] || key || 'Autre';
            result[label] = Number(result[label] || 0) + Math.max(0, Number(raw || 0));
        }
        return result;
    }

    function renderDaily(series = []) {
        ui.dailyChart.innerHTML = '';
        const values = series.map((item) => Math.max(0, Number(item.words || 0)));
        const max = Math.max(1, ...values);

        for (const item of series) {
            const words = Math.max(0, Number(item.words || 0));
            const column = document.createElement('div');
            column.className = 'stats-day';
            column.title = `${formatShortDate(item.date)} : ${formatNumber(words)} mots`;

            const value = document.createElement('strong');
            value.textContent = formatNumber(words);
            const track = document.createElement('div');
            track.className = 'stats-day__track';
            const bar = document.createElement('span');
            bar.className = 'stats-day__bar';
            bar.style.height = `${Math.max(words ? 6 : 2, Math.round((words / max) * 100))}%`;
            track.appendChild(bar);
            const label = document.createElement('small');
            label.textContent = formatShortDate(item.date);

            column.append(value, track, label);
            ui.dailyChart.appendChild(column);
        }
    }

    function renderStatuses(counts = {}, chapterCount = 0) {
        ui.statusList.innerHTML = '';
        const merged = mergedStatusCounts(counts);
        const entries = Object.entries(merged).sort((a, b) => b[1] - a[1]);
        if (!entries.length) {
            ui.statusList.innerHTML = '<p class="stats-empty">Aucun chapitre.</p>';
            return;
        }
        const total = Math.max(1, Number(chapterCount || entries.reduce((sum, [, n]) => sum + n, 0)));
        for (const [label, count] of entries) {
            const row = document.createElement('div');
            row.className = 'stats-status-row';
            const head = document.createElement('div');
            const name = document.createElement('span');
            name.textContent = label;
            const value = document.createElement('strong');
            value.textContent = `${formatNumber(count)} · ${Math.round((count / total) * 100)} %`;
            head.append(name, value);
            const track = document.createElement('div');
            track.className = 'stats-status-track';
            const bar = document.createElement('span');
            bar.style.width = `${Math.max(2, (count / total) * 100)}%`;
            track.appendChild(bar);
            row.append(head, track);
            ui.statusList.appendChild(row);
        }
    }

    function renderChapters(chapters = []) {
        ui.chapterList.innerHTML = '';
        if (!chapters.length) {
            ui.chapterList.innerHTML = '<p class="stats-empty">Aucun chapitre dans le projet.</p>';
            return;
        }
        const max = Math.max(1, ...chapters.map((item) => Math.max(0, Number(item.words || 0))));
        for (const chapter of chapters) {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'stats-chapter-row';
            row.title = 'Ouvrir ce chapitre';

            const titleWrap = document.createElement('div');
            titleWrap.className = 'stats-chapter-row__title';
            titleWrap.style.paddingLeft = `${Math.min(4, Number(chapter.depth || 0)) * 12}px`;
            const title = document.createElement('strong');
            title.textContent = chapter.title || 'Sans titre';
            const meta = document.createElement('small');
            const status = statusLabels[chapter.status] || chapter.status || 'Brouillon';
            meta.textContent = chapter.excluded ? `${status} · exclu de l’export` : status;
            titleWrap.append(title, meta);

            const meter = document.createElement('div');
            meter.className = 'stats-chapter-row__meter';
            const track = document.createElement('span');
            track.style.width = `${Math.max(1.5, (Math.max(0, Number(chapter.words || 0)) / max) * 100)}%`;
            meter.appendChild(track);

            const value = document.createElement('strong');
            value.className = 'stats-chapter-row__words';
            value.textContent = `${formatNumber(chapter.words)} mots`;

            row.append(titleWrap, meter, value);
            row.addEventListener('click', async () => {
                if (chapter.id && window.ecrivainApp?.openChapter) await window.ecrivainApp.openChapter(chapter.id);
            });
            ui.chapterList.appendChild(row);
        }
    }

    function render(payload = {}) {
        ui.totalWords.textContent = formatNumber(payload.totalWords);
        ui.exportWords.textContent = formatNumber(payload.exportWords);
        const excluded = Math.max(0, Number(payload.excludedChapters || 0));
        ui.excluded.textContent = `${formatNumber(excluded)} ${excluded > 1 ? 'chapitres exclus' : 'chapitre exclu'}`;
        ui.todayWords.textContent = formatNumber(payload.todayWords);
        ui.weekWords.textContent = formatNumber(payload.weekWords);
        ui.chapterCount.textContent = formatNumber(payload.chapters);
        ui.averageWords.textContent = formatNumber(payload.averageWordsPerChapter);
        renderDaily(Array.isArray(payload.dailySeries) ? payload.dailySeries : []);
        renderStatuses(payload.statusCounts || {}, payload.chapters || 0);
        renderChapters(Array.isArray(payload.chapterStats) ? payload.chapterStats : []);
    }

    async function refresh() {
        const payload = await window.ecrivain.stats.state();
        render(payload || {});
    }

    async function open() {
        try {
            const project = await window.ecrivain.project.state();
            if (!project?.project) {
                toast('Ouvrez d’abord un projet.', true);
                return;
            }
            if (ui.synopsis) ui.synopsis.hidden = true;
            if (ui.notes) ui.notes.hidden = true;
            if (ui.timeline) ui.timeline.hidden = true;
            const mindmapView = document.getElementById('mindmapView');
            if (mindmapView) mindmapView.hidden = true;
            if (ui.editorArea) ui.editorArea.hidden = true;
            if (ui.welcome) ui.welcome.hidden = true;
            ui.view.hidden = false;
            await refresh();
        } catch (error) {
            toast(error.message || 'Impossible d’ouvrir les statistiques.', true);
        }
    }

    function backToManuscript() {
        ui.view.hidden = true;
        if (window.ecrivainApp?.showManuscript) window.ecrivainApp.showManuscript();
    }

    ui.back?.addEventListener('click', backToManuscript);
    ui.refresh?.addEventListener('click', async () => {
        try {
            await refresh();
            toast('Statistiques actualisées.');
        } catch (error) {
            toast(error.message || 'Actualisation impossible.', true);
        }
    });

    window.ecrivainStats = { open, refresh };
})();
