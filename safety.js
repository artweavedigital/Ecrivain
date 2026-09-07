'use strict';

(() => {
    const $ = (id) => document.getElementById(id);
    const ui = {
        backupsView: $('backupsView'),
        backupsBack: $('backupsBackBtn'),
        backupsCreate: $('backupsCreateBtn'),
        backupsOpenFolder: $('backupsOpenFolderBtn'),
        backupsCount: $('backupsCount'),
        backupsEmpty: $('backupsEmpty'),
        backupsGrid: $('backupsGrid'),
        historyView: $('historyView'),
        historyBack: $('historyBackBtn'),
        historyRefresh: $('historyRefreshBtn'),
        historyChapter: $('historyChapterSelect'),
        historyCount: $('historyCount'),
        historyEmpty: $('historyEmpty'),
        historyVersions: $('historyVersions'),
        versionA: $('historyVersionA'),
        versionB: $('historyVersionB'),
        compareBtn: $('historyCompareBtn'),
        comparePlaceholder: $('historyComparePlaceholder'),
        compareResult: $('historyCompareResult'),
        compareLabelA: $('historyCompareLabelA'),
        compareLabelB: $('historyCompareLabelB'),
        diffRows: $('historyDiffRows'),
        editorArea: $('editorArea'),
        welcome: $('welcome'),
        synopsis: $('synopsisView'),
        notes: $('notesView'),
        timeline: $('timelineView'),
        stats: $('statsView'),
        mindmap: $('mindmapView'),
        toast: $('toast')
    };

    if (!ui.backupsView || !ui.historyView || !window.ecrivain?.backups || !window.ecrivain?.history) return;

    const state = {
        project: null,
        chapters: [],
        backups: [],
        history: null,
        chapterId: ''
    };

    function toast(message, error = false) {
        if (!ui.toast) return;
        ui.toast.textContent = message;
        ui.toast.classList.toggle('is-error', error);
        ui.toast.hidden = false;
        window.clearTimeout(toast.timer);
        toast.timer = window.setTimeout(() => { ui.toast.hidden = true; }, 3200);
    }

    function hideAllFeatureViews(except = '') {
        const views = [ui.editorArea, ui.welcome, ui.synopsis, ui.notes, ui.timeline, ui.stats, ui.mindmap, ui.backupsView, ui.historyView];
        for (const view of views) {
            if (!view) continue;
            view.hidden = view.id !== except;
        }
    }

    function formatDateTime(value) {
        const date = value ? new Date(value) : null;
        if (!date || Number.isNaN(date.getTime())) return 'Date inconnue';
        const pad = (n) => String(n).padStart(2, '0');
        return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} à ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    function formatBytes(bytes) {
        const n = Number(bytes || 0);
        if (n < 1024) return `${n} o`;
        if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace('.', ',')} Ko`;
        if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
        return `${(n / (1024 * 1024 * 1024)).toFixed(2).replace('.', ',')} Go`;
    }

    function sourceLabel(source) {
        switch (source) {
            case 'manual': return 'Enregistrement manuel';
            case 'autosave': return 'Autosauvegarde';
            case 'avant-restauration': return 'Avant restauration';
            case 'remplacement-global': return 'Avant remplacement global';
            case 'current': return 'Version actuelle';
            default: return 'Historique';
        }
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    async function projectState() {
        const payload = await window.ecrivain.project.state();
        if (!payload) throw new Error('Aucun projet ouvert.');
        state.project = payload.project || null;
        state.chapters = Array.isArray(payload.chapters) ? payload.chapters : [];
        return payload;
    }

    async function openBackups() {
        try {
            await projectState();
            hideAllFeatureViews('backupsView');
            await refreshBackups();
        } catch (error) {
            toast(error.message || 'Impossible d’ouvrir les sauvegardes.', true);
        }
    }

    async function refreshBackups() {
        const payload = await window.ecrivain.backups.state();
        state.backups = Array.isArray(payload?.backups) ? payload.backups : [];
        const n = state.backups.length;
        ui.backupsCount.textContent = `${n} ${n > 1 ? 'sauvegardes' : 'sauvegarde'} sur ${payload?.maxBackups || 5}`;
        ui.backupsEmpty.hidden = n > 0;
        ui.backupsGrid.innerHTML = '';

        for (let i = 0; i < state.backups.length; i += 1) {
            const item = state.backups[i];
            const card = document.createElement('article');
            card.className = 'backup-card';

            const rank = document.createElement('span');
            rank.className = 'backup-card__rank';
            rank.textContent = i === 0 ? 'La plus récente' : `Sauvegarde ${i + 1}`;

            const title = document.createElement('h3');
            title.textContent = formatDateTime(item.createdAt);

            const reason = document.createElement('p');
            reason.textContent = item.reason || 'Sauvegarde';

            const meta = document.createElement('div');
            meta.className = 'backup-card__meta';
            meta.innerHTML = `<span>${formatBytes(item.sizeBytes)}</span><span>Projet complet</span>`;

            const actions = document.createElement('div');
            actions.className = 'backup-card__actions';
            const restore = document.createElement('button');
            restore.type = 'button';
            restore.className = 'button';
            restore.textContent = 'Restaurer';
            restore.addEventListener('click', async () => {
                restore.disabled = true;
                try {
                    const result = await window.ecrivain.backups.restore(item.id);
                    if (!result || result.canceled) return;
                    if (window.ecrivainApp?.reloadProject) await window.ecrivainApp.reloadProject();
                    toast('Sauvegarde restaurée. L’état précédent a été sauvegardé automatiquement.');
                } catch (error) {
                    toast(error.message || 'Restauration impossible.', true);
                } finally {
                    restore.disabled = false;
                }
            });
            actions.appendChild(restore);
            card.append(rank, title, reason, meta, actions);
            ui.backupsGrid.appendChild(card);
        }
    }

    async function createBackup() {
        ui.backupsCreate.disabled = true;
        try {
            await window.ecrivain.backups.create('Sauvegarde manuelle');
            await refreshBackups();
            toast('Sauvegarde du projet créée.');
        } catch (error) {
            toast(error.message || 'Sauvegarde impossible.', true);
        } finally {
            ui.backupsCreate.disabled = false;
        }
    }

    async function openHistory(chapterId = '') {
        try {
            await projectState();
            if (!state.chapters.length) {
                toast('Aucun chapitre dans ce projet.', true);
                return;
            }
            hideAllFeatureViews('historyView');
            populateChapterSelect(chapterId || window.ecrivainApp?.activeChapterId?.() || state.chapters[0].id);
            await refreshHistory();
        } catch (error) {
            toast(error.message || 'Impossible d’ouvrir l’historique.', true);
        }
    }

    function populateChapterSelect(preferredId) {
        ui.historyChapter.innerHTML = '';
        for (const chapter of state.chapters) {
            const option = document.createElement('option');
            option.value = chapter.id;
            const depth = Number(chapter._depth || 0);
            option.textContent = `${depth ? '— '.repeat(depth) : ''}${chapter.title || 'Sans titre'}`;
            ui.historyChapter.appendChild(option);
        }
        const found = state.chapters.some((chapter) => chapter.id === preferredId);
        ui.historyChapter.value = found ? preferredId : state.chapters[0].id;
        state.chapterId = ui.historyChapter.value;
    }

    async function refreshHistory() {
        const chapterId = ui.historyChapter.value || state.chapterId;
        if (!chapterId) return;
        state.chapterId = chapterId;
        const payload = await window.ecrivain.history.state(chapterId);
        state.history = payload;
        const versions = Array.isArray(payload?.versions) ? payload.versions : [];
        ui.historyCount.textContent = `${versions.length} ${versions.length > 1 ? 'versions' : 'version'} conservée${versions.length > 1 ? 's' : ''}`;
        ui.historyEmpty.hidden = versions.length > 0;
        renderHistoryVersions(versions);
        populateVersionSelects(payload);
        ui.compareResult.hidden = true;
        ui.comparePlaceholder.hidden = false;
    }

    function versionLabel(item) {
        if (!item || item.id === 'current') return 'Version actuelle';
        return `${formatDateTime(item.savedAt)} — ${sourceLabel(item.source)}`;
    }

    function renderHistoryVersions(versions) {
        ui.historyVersions.innerHTML = '';
        for (const item of versions) {
            const card = document.createElement('article');
            card.className = 'history-version-card';

            const date = document.createElement('strong');
            date.textContent = formatDateTime(item.savedAt);
            const source = document.createElement('span');
            source.className = 'history-version-card__source';
            source.textContent = sourceLabel(item.source);
            const meta = document.createElement('small');
            meta.textContent = `${Number(item.wordCount || 0).toLocaleString('fr-FR')} mots`;

            const actions = document.createElement('div');
            actions.className = 'history-version-card__actions';

            const compare = document.createElement('button');
            compare.type = 'button';
            compare.className = 'button';
            compare.textContent = 'Comparer';
            compare.addEventListener('click', async () => {
                ui.versionA.value = item.id;
                ui.versionB.value = 'current';
                await compareSelectedVersions();
            });

            const restore = document.createElement('button');
            restore.type = 'button';
            restore.className = 'button';
            restore.textContent = 'Restaurer';
            restore.addEventListener('click', async () => {
                const ok = window.confirm(`Restaurer la version du ${formatDateTime(item.savedAt)} ?\n\nLa version actuelle sera conservée dans l’historique avant la restauration.`);
                if (!ok) return;
                restore.disabled = true;
                try {
                    await window.ecrivain.history.restore(state.chapterId, item.id);
                    if (window.ecrivainApp?.reloadProject) await window.ecrivainApp.reloadProject(state.chapterId);
                    toast('Version restaurée. La version précédente reste disponible dans l’historique.');
                } catch (error) {
                    toast(error.message || 'Restauration impossible.', true);
                } finally {
                    restore.disabled = false;
                }
            });

            actions.append(compare, restore);
            card.append(date, source, meta, actions);
            ui.historyVersions.appendChild(card);
        }
    }

    function populateVersionSelects(payload) {
        const current = payload?.current || { id: 'current', source: 'current' };
        const versions = Array.isArray(payload?.versions) ? payload.versions : [];
        const all = [current, ...versions];
        for (const select of [ui.versionA, ui.versionB]) {
            select.innerHTML = '';
            for (const item of all) {
                const option = document.createElement('option');
                option.value = item.id;
                option.textContent = versionLabel(item);
                select.appendChild(option);
            }
        }
        ui.versionA.value = versions[0]?.id || 'current';
        ui.versionB.value = 'current';
    }

    function htmlToParagraphs(html) {
        const doc = new DOMParser().parseFromString(`<div id="root">${String(html || '')}</div>`, 'text/html');
        const root = doc.getElementById('root');
        if (!root) return [''];
        const blocks = Array.from(root.querySelectorAll('p, h1, h2, h3, h4, h5, h6, blockquote, li'));
        if (!blocks.length) {
            const text = root.textContent.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
            return text ? [text] : [''];
        }
        return blocks.map((block) => block.textContent.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim());
    }

    function lcsOps(a, b) {
        const n = a.length;
        const m = b.length;
        const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
        for (let i = n - 1; i >= 0; i -= 1) {
            for (let j = m - 1; j >= 0; j -= 1) {
                dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
            }
        }
        const ops = [];
        let i = 0;
        let j = 0;
        while (i < n && j < m) {
            if (a[i] === b[j]) {
                ops.push({ type: 'equal', value: a[i] });
                i += 1;
                j += 1;
            } else if (dp[i + 1][j] >= dp[i][j + 1]) {
                ops.push({ type: 'delete', value: a[i++] });
            } else {
                ops.push({ type: 'add', value: b[j++] });
            }
        }
        while (i < n) ops.push({ type: 'delete', value: a[i++] });
        while (j < m) ops.push({ type: 'add', value: b[j++] });
        return ops;
    }

    function tokenizeWords(text) {
        return String(text || '').match(/\s+|[\p{L}\p{N}’'’-]+|[^\s\p{L}\p{N}]/gu) || [];
    }

    function wordDiff(leftText, rightText) {
        const left = tokenizeWords(leftText);
        const right = tokenizeWords(rightText);
        if (left.length * right.length > 220000) {
            return {
                left: leftText ? `<mark class="diff-delete">${escapeHtml(leftText)}</mark>` : '',
                right: rightText ? `<mark class="diff-add">${escapeHtml(rightText)}</mark>` : ''
            };
        }
        const ops = lcsOps(left, right);
        let l = '';
        let r = '';
        for (const op of ops) {
            if (op.type === 'equal') {
                const safe = escapeHtml(op.value);
                l += safe;
                r += safe;
            } else if (op.type === 'delete') {
                l += `<mark class="diff-delete">${escapeHtml(op.value)}</mark>`;
            } else if (op.type === 'add') {
                r += `<mark class="diff-add">${escapeHtml(op.value)}</mark>`;
            }
        }
        return { left: l, right: r };
    }

    function buildDiffRows(leftParagraphs, rightParagraphs) {
        const ops = lcsOps(leftParagraphs, rightParagraphs);
        const rows = [];
        let i = 0;
        while (i < ops.length) {
            if (ops[i].type === 'equal') {
                rows.push({ left: escapeHtml(ops[i].value), right: escapeHtml(ops[i].value), same: true });
                i += 1;
                continue;
            }
            const deleted = [];
            const added = [];
            while (i < ops.length && ops[i].type !== 'equal') {
                if (ops[i].type === 'delete') deleted.push(ops[i].value);
                else if (ops[i].type === 'add') added.push(ops[i].value);
                i += 1;
            }
            const count = Math.max(deleted.length, added.length);
            for (let k = 0; k < count; k += 1) {
                const oldText = deleted[k] || '';
                const newText = added[k] || '';
                const diff = wordDiff(oldText, newText);
                rows.push({ left: diff.left, right: diff.right, same: false });
            }
        }
        return rows;
    }

    async function compareSelectedVersions() {
        const idA = ui.versionA.value;
        const idB = ui.versionB.value;
        if (!idA || !idB) return;
        ui.compareBtn.disabled = true;
        try {
            const [a, b] = await Promise.all([
                window.ecrivain.history.get(state.chapterId, idA),
                window.ecrivain.history.get(state.chapterId, idB)
            ]);
            const rows = buildDiffRows(htmlToParagraphs(a.content), htmlToParagraphs(b.content));
            ui.compareLabelA.textContent = ui.versionA.options[ui.versionA.selectedIndex]?.textContent || 'Version A';
            ui.compareLabelB.textContent = ui.versionB.options[ui.versionB.selectedIndex]?.textContent || 'Version B';
            ui.diffRows.innerHTML = '';
            for (const row of rows) {
                const line = document.createElement('div');
                line.className = `history-diff-row${row.same ? ' is-same' : ' is-changed'}`;
                const left = document.createElement('div');
                left.className = 'history-diff-cell history-diff-cell--left';
                left.innerHTML = row.left || '<span class="diff-empty">∅</span>';
                const right = document.createElement('div');
                right.className = 'history-diff-cell history-diff-cell--right';
                right.innerHTML = row.right || '<span class="diff-empty">∅</span>';
                line.append(left, right);
                ui.diffRows.appendChild(line);
            }
            ui.comparePlaceholder.hidden = true;
            ui.compareResult.hidden = false;
        } catch (error) {
            toast(error.message || 'Comparaison impossible.', true);
        } finally {
            ui.compareBtn.disabled = false;
        }
    }

    ui.backupsBack.addEventListener('click', () => window.ecrivainApp?.showManuscript?.());
    ui.backupsCreate.addEventListener('click', createBackup);
    ui.backupsOpenFolder.addEventListener('click', async () => {
        try { await window.ecrivain.backups.openFolder(); }
        catch (error) { toast(error.message || 'Impossible d’ouvrir le dossier.', true); }
    });
    ui.historyBack.addEventListener('click', () => window.ecrivainApp?.showManuscript?.());
    ui.historyRefresh.addEventListener('click', refreshHistory);
    ui.historyChapter.addEventListener('change', refreshHistory);
    ui.compareBtn.addEventListener('click', compareSelectedVersions);

    window.ecrivainSafety = {
        openBackups,
        openHistory
    };
})();
