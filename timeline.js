'use strict';

(() => {
    const $ = (id) => document.getElementById(id);

    const ui = {
        view: $('timelineView'),
        back: $('timelineBackBtn'),
        newEvent: $('timelineNewBtn'),
        scale: $('timelineScale'),
        fit: $('timelineFitBtn'),
        count: $('timelineCount'),
        empty: $('timelineEmpty'),
        canvas: $('timelineCanvas'),
        tempo: $('timelineTempo'),
        tempoBars: $('timelineTempoBars'),
        list: $('timelineList'),
        form: $('timelineForm'),
        formTitle: $('timelineFormTitle'),
        clear: $('timelineClearBtn'),
        id: $('timelineId'),
        title: $('timelineTitle'),
        lane: $('timelineLane'),
        laneList: $('timelineLaneList'),
        startDate: $('timelineStartDate'),
        startTime: $('timelineStartTime'),
        endDate: $('timelineEndDate'),
        endTime: $('timelineEndTime'),
        primaryCharacter: $('timelinePrimaryCharacter'),
        location: $('timelineLocation'),
        characters: $('timelineCharacters'),
        chapter: $('timelineChapter'),
        summary: $('timelineSummary'),
        deleteBtn: $('timelineDeleteBtn'),
        paletteRows: $('timelinePaletteRows'),
        addColor: $('timelineAddColorBtn'),
        savePalette: $('timelineSavePaletteBtn'),
        editorArea: $('editorArea'),
        welcome: $('welcome'),
        synopsis: $('synopsisView'),
        notes: $('notesView'),
        stats: $('statsView'),
        toast: $('toast')
    };

    if (!ui.view || !window.ecrivain?.timeline) return;

    const state = {
        events: [],
        chapters: [],
        palette: {},
        lanes: ['Récit principal', 'Intrigue secondaire'],
        timeline: null,
        items: null,
        groups: null,
        selectedId: '',
        scale: 'week'
    };

    function toast(message, error = false) {
        if (!ui.toast) return;
        ui.toast.textContent = message;
        ui.toast.classList.toggle('is-error', error);
        ui.toast.hidden = false;
        window.clearTimeout(toast.timer);
        toast.timer = window.setTimeout(() => { ui.toast.hidden = true; }, 3200);
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function charactersList(event) {
        const values = [];
        if (String(event?.primaryCharacter || '').trim()) values.push(String(event.primaryCharacter).trim());
        for (const part of String(event?.characters || '').split(/[,;\n]+/u)) {
            const name = part.trim();
            if (name) values.push(name);
        }
        const seen = new Set();
        return values.filter((name) => {
            const key = name.toLocaleLowerCase('fr');
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    function colorFromName(name) {
        const colors = ['#7C3AED', '#0F766E', '#B45309', '#BE123C', '#1D4ED8', '#047857', '#9F1239', '#7C2D12', '#4338CA', '#A16207'];
        const text = String(name || '').trim().toLocaleLowerCase('fr');
        if (!text) return '#94A3B8';
        let hash = 0;
        for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
        return colors[Math.abs(hash) % colors.length];
    }

    function eventAccent(event) {
        const primary = String(event?.primaryCharacter || '').trim();
        const chars = charactersList(event);
        if (primary) return state.palette[primary] || colorFromName(primary);
        if (chars.length === 1) return state.palette[chars[0]] || colorFromName(chars[0]);
        if (chars.length > 1) return '#2563EB';
        return '#94A3B8';
    }

    function hexToRgba(hex, alpha = 0.10) {
        const match = String(hex || '').replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
        if (!match) return `rgba(100,116,139,${alpha})`;
        return `rgba(${parseInt(match[1], 16)},${parseInt(match[2], 16)},${parseInt(match[3], 16)},${alpha})`;
    }

    function dateObject(date, time = '') {
        const d = String(date || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
        const t = /^\d{2}:\d{2}$/.test(String(time || '').trim()) ? String(time).trim() : '12:00';
        const value = new Date(`${d}T${t}:00`);
        return Number.isNaN(value.getTime()) ? null : value;
    }

    function dateKey(date) {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
        const pad = (n) => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }

    function timeKey(date) {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
        const pad = (n) => String(n).padStart(2, '0');
        return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    function dateLabel(event) {
        if (!event?.startDate) return 'Date libre';
        const date = dateObject(event.startDate, event.startTime);
        if (!date) return String(event.startDate || 'Date libre');
        const base = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
        const start = event.startTime ? `${base} — ${event.startTime.replace(':', ' h ')}` : base;
        if (!event.endDate) return start;
        const sameDate = event.endDate === event.startDate;
        const sameTime = String(event.endTime || '') === String(event.startTime || '');
        if (sameDate && (!event.endTime || sameTime)) return start;
        const endObj = dateObject(event.endDate, event.endTime);
        if (!endObj) return start;
        const endBase = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(endObj);
        const end = event.endTime ? `${endBase} — ${event.endTime.replace(':', ' h ')}` : endBase;
        return `${start} → ${end}`;
    }

    function dayHeading(date) {
        const d = dateObject(date);
        if (!d) return date || 'Date libre';
        const label = new Intl.DateTimeFormat('fr-FR', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
        }).format(d);
        return label.charAt(0).toUpperCase() + label.slice(1);
    }

    function chapterLabel(id) {
        if (!id) return 'Aucun chapitre lié';
        const chapter = state.chapters.find((item) => item.id === id);
        return chapter ? chapter.title : 'Chapitre lié';
    }

    function eventById(id) {
        return state.events.find((event) => event.id === id) || null;
    }

    async function refresh() {
        const payload = await window.ecrivain.timeline.state();
        state.events = Array.isArray(payload?.events) ? payload.events : [];
        state.chapters = Array.isArray(payload?.chapters) ? payload.chapters : [];
        state.palette = payload?.palette || {};
        state.lanes = Array.isArray(payload?.lanes) && payload.lanes.length
            ? payload.lanes
            : ['Récit principal', 'Intrigue secondaire'];
        renderChapterOptions();
        renderLaneOptions();
        renderPalette();
    }

    async function open() {
        try {
            const project = await window.ecrivain.project.state();
            if (!project?.project) {
                toast('Ouvrez d’abord un projet.', true);
                return;
            }
            await refresh();
            if (ui.synopsis) ui.synopsis.hidden = true;
            if (ui.notes) ui.notes.hidden = true;
            if (ui.stats) ui.stats.hidden = true;
            const mindmapView = document.getElementById('mindmapView');
            if (mindmapView) mindmapView.hidden = true;
            if (ui.editorArea) ui.editorArea.hidden = true;
            if (ui.welcome) ui.welcome.hidden = true;
            ui.view.hidden = false;
            clearForm();
            renderAll();
        } catch (error) {
            toast(error.message || 'Impossible d’ouvrir la chronologie.', true);
        }
    }

    function backToManuscript() {
        ui.view.hidden = true;
        if (window.ecrivainApp?.showManuscript) {
            window.ecrivainApp.showManuscript();
            return;
        }
        const active = document.querySelector('.chapter-item.is-active');
        if (active) {
            if (ui.welcome) ui.welcome.hidden = true;
            if (ui.editorArea) ui.editorArea.hidden = false;
        } else {
            if (ui.editorArea) ui.editorArea.hidden = true;
            if (ui.welcome) ui.welcome.hidden = false;
        }
    }

    function renderAll() {
        const n = state.events.length;
        ui.count.textContent = `${n} ${n > 1 ? 'événements' : 'événement'}`;
        renderTimeline();
        renderTempo();
        renderList();
    }

    function renderChapterOptions() {
        const value = ui.chapter.value || '';
        ui.chapter.innerHTML = '<option value="">Aucun chapitre lié</option>';
        for (const chapter of state.chapters) {
            const option = document.createElement('option');
            option.value = chapter.id;
            option.textContent = `${'— '.repeat(Number(chapter.depth || 0))}${chapter.title}`;
            ui.chapter.appendChild(option);
        }
        ui.chapter.value = state.chapters.some((chapter) => chapter.id === value) ? value : '';
    }

    function renderLaneOptions() {
        const current = ui.lane.value || 'Récit principal';
        ui.laneList.innerHTML = '';
        for (const lane of state.lanes) {
            const option = document.createElement('option');
            option.value = lane;
            ui.laneList.appendChild(option);
        }
        ui.lane.value = current;
    }

    function buildGroups() {
        const lanes = new Set(state.lanes);
        for (const event of state.events) lanes.add(String(event.lane || 'Récit principal').trim() || 'Récit principal');
        return Array.from(lanes).map((lane) => ({ id: lane, content: escapeHtml(lane) }));
    }

    function eventToItem(event) {
        const start = dateObject(event.startDate, event.startTime);
        if (!start) return null;
        const end = dateObject(event.endDate, event.endTime);
        const accent = eventAccent(event);
        const soft = hexToRgba(accent, 0.14);
        const item = {
            id: event.id,
            group: String(event.lane || 'Récit principal').trim() || 'Récit principal',
            content: `<span class="timeline-item-title">${escapeHtml(event.title || 'Événement')}</span>`,
            start,
            title: `${escapeHtml(event.title || 'Événement')}<br>${escapeHtml(dateLabel(event))}<br>${escapeHtml(event.location || '')}`,
            style: `border-color:${accent};background:${soft};color:#2f2925;`
        };
        const hasRange = end && (end.getTime() > start.getTime()) && (event.endDate !== event.startDate || event.endTime !== event.startTime);
        if (hasRange) {
            item.end = end;
            item.type = 'range';
        } else {
            item.type = 'box';
        }
        return item;
    }

    function renderTimeline() {
        const datedItems = state.events.map(eventToItem).filter(Boolean);
        ui.empty.hidden = datedItems.length > 0;
        ui.canvas.hidden = datedItems.length === 0;

        if (!datedItems.length) {
            if (state.timeline) {
                state.timeline.destroy();
                state.timeline = null;
            }
            return;
        }
        if (!window.vis?.Timeline || !window.vis?.DataSet) {
            ui.empty.hidden = false;
            ui.empty.textContent = 'La bibliothèque de chronologie locale n’a pas pu être chargée.';
            ui.canvas.hidden = true;
            return;
        }

        if (state.timeline) state.timeline.destroy();
        state.items = new window.vis.DataSet(datedItems);
        state.groups = new window.vis.DataSet(buildGroups());

        const options = {
            locale: 'fr',
            orientation: { axis: 'top' },
            stack: true,
            selectable: true,
            multiselect: false,
            moveable: true,
            zoomable: true,
            horizontalScroll: true,
            verticalScroll: true,
            showCurrentTime: false,
            editable: { updateTime: true, updateGroup: true, remove: false, add: false },
            itemsAlwaysDraggable: { item: true, range: true },
            margin: { item: { horizontal: 10, vertical: 12 }, axis: 12 },
            minHeight: '340px',
            maxHeight: '620px',
            tooltip: { followMouse: true, overflowMethod: 'flip' },
            onMove: async (item, callback) => {
                const original = eventById(item.id);
                if (!original) return callback(null);
                try {
                    const moved = {
                        ...original,
                        id: original.id,
                        startDate: dateKey(item.start),
                        startTime: original.startTime ? timeKey(item.start) : '',
                        lane: String(item.group || original.lane || 'Récit principal')
                    };
                    if (item.end instanceof Date) {
                        moved.endDate = dateKey(item.end);
                        moved.endTime = original.endTime ? timeKey(item.end) : '';
                    } else if (original.endDate) {
                        // Un événement ponctuel conserve sa fin sur le même jour.
                        moved.endDate = moved.startDate;
                        moved.endTime = original.endTime || moved.startTime;
                    }
                    const saved = await window.ecrivain.timeline.move(moved);
                    const idx = state.events.findIndex((event) => event.id === saved.id);
                    if (idx >= 0) state.events[idx] = saved;
                    callback(item);
                    await refresh();
                    renderAll();
                    populateForm(saved.id);
                } catch (error) {
                    toast(error.message || 'Impossible de déplacer cet événement.', true);
                    callback(null);
                }
            }
        };

        state.timeline = new window.vis.Timeline(ui.canvas, state.items, state.groups, options);
        state.timeline.on('doubleClick', (properties) => {
            if (properties.item) populateForm(String(properties.item));
        });
        state.timeline.on('select', (properties) => {
            if (properties.items?.[0]) populateForm(String(properties.items[0]));
        });
        applyScale();
    }

    function timelineAnchor() {
        if (state.timeline) {
            try {
                const range = state.timeline.getWindow();
                if (range?.start instanceof Date && range?.end instanceof Date) {
                    return new Date((range.start.getTime() + range.end.getTime()) / 2);
                }
            } catch (_) {}
        }
        const first = state.events.find((event) => event.startDate);
        return first ? dateObject(first.startDate, first.startTime) : new Date();
    }

    function applyScale() {
        if (!state.timeline) return;
        const value = ui.scale.value || state.scale || 'week';
        state.scale = value;
        const anchor = timelineAnchor() || new Date();
        let start;
        let end;
        if (value === 'day') {
            start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), 0, 0, 0);
            end = new Date(start);
            end.setDate(end.getDate() + 1);
            state.timeline.setOptions({ timeAxis: { scale: 'hour', step: 2 } });
        } else if (value === 'month') {
            start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
            end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
            state.timeline.setOptions({ timeAxis: { scale: 'day', step: 1 } });
        } else {
            start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), 0, 0, 0);
            end = new Date(start);
            end.setDate(end.getDate() + 14);
            state.timeline.setOptions({ timeAxis: { scale: 'day', step: 1 } });
        }
        state.timeline.setWindow(start, end, { animation: false });
    }

    function renderTempo() {
        const counts = new Map();
        for (const event of state.events) {
            if (!event.chapterId) continue;
            counts.set(event.chapterId, (counts.get(event.chapterId) || 0) + 1);
        }
        const rows = state.chapters
            .filter((chapter) => counts.has(chapter.id))
            .map((chapter) => ({ ...chapter, events: counts.get(chapter.id) || 0 }));
        ui.tempo.hidden = rows.length === 0;
        ui.tempoBars.innerHTML = '';
        if (!rows.length) return;
        const maxWords = Math.max(1, ...rows.map((row) => Number(row.wordCount || 0)));
        for (const row of rows) {
            const line = document.createElement('div');
            line.className = 'timeline-tempo-bar';
            const label = document.createElement('span');
            label.className = 'timeline-tempo-bar__label';
            label.textContent = row.title;
            label.title = row.title;
            const track = document.createElement('div');
            track.className = 'timeline-tempo-bar__track';
            const fill = document.createElement('div');
            fill.className = 'timeline-tempo-bar__fill';
            fill.style.width = `${Math.max(2, Math.round((Number(row.wordCount || 0) / maxWords) * 100))}%`;
            track.appendChild(fill);
            const meta = document.createElement('span');
            meta.className = 'timeline-tempo-bar__count';
            meta.textContent = `${Number(row.wordCount || 0).toLocaleString('fr-FR')} mots · ${row.events} scène${row.events > 1 ? 's' : ''}`;
            line.append(label, track, meta);
            ui.tempoBars.appendChild(line);
        }
    }

    function renderList() {
        ui.list.innerHTML = '';
        if (!state.events.length) {
            const empty = document.createElement('div');
            empty.className = 'timeline-empty timeline-empty--list';
            empty.textContent = 'Aucun événement dans la chronologie.';
            ui.list.appendChild(empty);
            return;
        }
        // Les cartes restent triées chronologiquement, mais chaque événement
        // porte désormais sa propre date. Cela permet un affichage compact
        // sur plusieurs colonnes, même lorsque les événements sont sur des jours différents.
        for (const event of state.events) {
            const accent = eventAccent(event);
            const article = document.createElement('article');
            article.className = `timeline-list-item${event.id === state.selectedId ? ' is-selected' : ''}`;
            article.style.setProperty('--timeline-accent', accent);
            article.style.setProperty('--timeline-soft', hexToRgba(accent, 0.09));

            const dot = document.createElement('span');
            dot.className = 'timeline-list-item__dot';
            const body = document.createElement('div');
            body.className = 'timeline-list-item__body';
            const title = document.createElement('div');
            title.className = 'timeline-list-item__title';
            title.textContent = event.title || 'Événement';
            const date = document.createElement('small');
            date.innerHTML = `<strong>Temps :</strong> ${escapeHtml(dateLabel(event))}`;
            const chars = document.createElement('p');
            const charValues = charactersList(event);
            chars.innerHTML = `<strong>Personnages :</strong> ${escapeHtml(charValues.length ? charValues.join(' • ') : 'Aucun personnage renseigné')}`;
            const place = document.createElement('div');
            place.className = 'timeline-list-item__place';
            place.innerHTML = `<strong>Lieu :</strong> ${escapeHtml(event.location || 'À préciser')}`;
            body.append(title, date, chars, place);

            const actions = document.createElement('div');
            actions.className = 'timeline-list-item__actions';
            const edit = document.createElement('button');
            edit.type = 'button';
            edit.className = 'link-button';
            edit.textContent = 'Modifier';
            edit.addEventListener('click', () => populateForm(event.id));
            actions.appendChild(edit);
            if (event.chapterId) {
                const chapter = document.createElement('button');
                chapter.type = 'button';
                chapter.className = 'link-button';
                chapter.textContent = 'Chapitre';
                chapter.title = chapterLabel(event.chapterId);
                chapter.addEventListener('click', async () => {
                    if (window.ecrivainApp?.openChapter) await window.ecrivainApp.openChapter(event.chapterId);
                });
                actions.appendChild(chapter);
            }
            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'link-button is-delete';
            del.textContent = '✕';
            del.title = 'Supprimer';
            del.addEventListener('click', () => removeEvent(event.id));
            actions.appendChild(del);

            article.append(dot, body, actions);
            ui.list.appendChild(article);
        }
    }

    function clearForm() {
        state.selectedId = '';
        ui.id.value = '';
        ui.title.value = '';
        ui.lane.value = 'Récit principal';
        ui.startDate.value = '';
        ui.startTime.value = '';
        ui.endDate.value = '';
        ui.endTime.value = '';
        ui.primaryCharacter.value = '';
        ui.location.value = '';
        ui.characters.value = '';
        ui.chapter.value = '';
        ui.summary.value = '';
        ui.formTitle.textContent = 'Nouvel événement';
        ui.deleteBtn.hidden = true;
        if (state.timeline) state.timeline.setSelection([]);
        renderList();
    }

    function populateForm(id) {
        const event = eventById(id);
        if (!event) return;
        state.selectedId = event.id;
        ui.id.value = event.id;
        ui.title.value = event.title || '';
        ui.lane.value = event.lane || 'Récit principal';
        ui.startDate.value = event.startDate || '';
        ui.startTime.value = event.startTime || '';
        ui.endDate.value = event.endDate || '';
        ui.endTime.value = event.endTime || '';
        ui.primaryCharacter.value = event.primaryCharacter || '';
        ui.location.value = event.location || '';
        ui.characters.value = event.characters || '';
        ui.chapter.value = event.chapterId || '';
        ui.summary.value = event.summary || '';
        ui.formTitle.textContent = 'Modifier l’événement';
        ui.deleteBtn.hidden = false;
        if (state.timeline && event.startDate) state.timeline.setSelection([event.id], { focus: false });
        renderList();
    }

    async function saveEvent(event) {
        event.preventDefault();
        const data = {
            id: ui.id.value || '',
            title: ui.title.value,
            lane: ui.lane.value || 'Récit principal',
            startDate: ui.startDate.value,
            startTime: ui.startTime.value,
            endDate: ui.endDate.value,
            endTime: ui.endTime.value,
            primaryCharacter: ui.primaryCharacter.value,
            location: ui.location.value,
            characters: ui.characters.value,
            chapterId: ui.chapter.value,
            summary: ui.summary.value,
            type: 'personnage',
            color: 'bleu'
        };
        try {
            const saved = await window.ecrivain.timeline.save(data);
            await refresh();
            state.selectedId = saved.id;
            renderAll();
            populateForm(saved.id);
            toast('Événement enregistré.');
        } catch (error) {
            toast(error.message || 'Impossible d’enregistrer cet événement.', true);
        }
    }

    async function removeEvent(id) {
        const event = eventById(id);
        if (!event) return;
        const ok = window.confirm(`Supprimer « ${event.title || 'cet événement'} » ?`);
        if (!ok) return;
        try {
            state.events = await window.ecrivain.timeline.delete(id);
            if (state.selectedId === id) clearForm();
            await refresh();
            renderAll();
            toast('Événement supprimé.');
        } catch (error) {
            toast(error.message || 'Impossible de supprimer cet événement.', true);
        }
    }

    function paletteRow(name = '', color = '#64748B') {
        const row = document.createElement('div');
        row.className = 'timeline-palette-row';
        const input = document.createElement('input');
        input.type = 'text';
        input.value = name;
        input.placeholder = 'Nom du personnage';
        const picker = document.createElement('input');
        picker.type = 'color';
        picker.value = /^#[0-9a-f]{6}$/i.test(color) ? color : '#64748B';
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'link-button is-delete';
        remove.textContent = '✕';
        remove.title = 'Supprimer cette couleur';
        remove.addEventListener('click', () => row.remove());
        row.append(input, picker, remove);
        return row;
    }

    function renderPalette() {
        ui.paletteRows.innerHTML = '';
        const entries = Object.entries(state.palette || {});
        if (!entries.length) ui.paletteRows.appendChild(paletteRow());
        else for (const [name, color] of entries) ui.paletteRows.appendChild(paletteRow(name, color));
    }

    async function savePalette() {
        const entries = {};
        ui.paletteRows.querySelectorAll('.timeline-palette-row').forEach((row) => {
            const [nameInput, colorInput] = row.querySelectorAll('input');
            const name = String(nameInput?.value || '').trim();
            if (name) entries[name] = colorInput?.value || '#64748B';
        });
        try {
            state.palette = await window.ecrivain.timeline.savePalette(entries);
            renderPalette();
            renderAll();
            toast('Palette enregistrée.');
        } catch (error) {
            toast(error.message || 'Impossible d’enregistrer les couleurs.', true);
        }
    }

    ui.back.addEventListener('click', backToManuscript);
    ui.newEvent.addEventListener('click', clearForm);
    ui.clear.addEventListener('click', clearForm);
    ui.form.addEventListener('submit', saveEvent);
    ui.deleteBtn.addEventListener('click', () => removeEvent(ui.id.value));
    ui.scale.addEventListener('change', applyScale);
    ui.fit.addEventListener('click', () => {
        try { state.timeline?.fit({ animation: true }); } catch (_) {}
    });
    ui.addColor.addEventListener('click', () => ui.paletteRows.appendChild(paletteRow()));
    ui.savePalette.addEventListener('click', savePalette);

    window.ecrivainTimeline = { open };
})();
