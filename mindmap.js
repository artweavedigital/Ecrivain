'use strict';

(() => {
    const $ = (id) => document.getElementById(id);
    const ui = {
        view: $('mindmapView'),
        back: $('mindmapBackBtn'),
        add: $('mindmapAddBtn'),
        auto: $('mindmapAutoBtn'),
        exportPng: $('mindmapExportBtn'),
        search: $('mindmapSearch'),
        canvas: $('mindmapCanvas'),
        world: $('mindmapWorld'),
        edges: $('mindmapEdges'),
        nodes: $('mindmapNodes'),
        empty: $('mindmapEmpty'),
        zoomOut: $('mindmapZoomOut'),
        zoomIn: $('mindmapZoomIn'),
        fit: $('mindmapFit'),
        zoomLabel: $('mindmapZoomLabel'),
        inspector: $('mindmapInspector'),
        inspectorEmpty: $('mindmapInspectorEmpty'),
        inspectorForm: $('mindmapInspectorForm'),
        inspectorTitle: $('mindmapInspectorTitle'),
        nodeId: $('mindmapNodeId'),
        nodeLabel: $('mindmapNodeLabel'),
        nodeType: $('mindmapNodeType'),
        nodeNote: $('mindmapNodeNote'),
        nodeChapter: $('mindmapNodeChapter'),
        nodeDelete: $('mindmapNodeDelete'),
        relations: $('mindmapRelations'),
        relationTarget: $('mindmapRelationTarget'),
        relationLabel: $('mindmapRelationLabel'),
        relationSave: $('mindmapRelationSave'),
        relationCancel: $('mindmapRelationCancel'),
        legend: $('mindmapLegend'),
        editorArea: $('editorArea'),
        welcome: $('welcome'),
        synopsis: $('synopsisView'),
        notes: $('notesView'),
        timeline: $('timelineView'),
        stats: $('statsView'),
        toast: $('toast')
    };

    if (!ui.view || !window.ecrivain?.mindmap) return;

    const WORLD_W = 4200;
    const WORLD_H = 3000;
    const NODE_W = 190;
    const NODE_H = 94;

    const state = {
        nodes: [],
        edges: [],
        types: {},
        colors: {},
        chapters: [],
        selectedNodeId: '',
        editingEdgeId: '',
        scale: 1,
        panX: 0,
        panY: 0,
        panning: false,
        panStart: null,
        drag: null,
        saveTimer: null,
        search: ''
    };

    function toast(message, error = false) {
        if (!ui.toast) return;
        ui.toast.textContent = message;
        ui.toast.classList.toggle('is-error', error);
        ui.toast.hidden = false;
        window.clearTimeout(toast.timer);
        toast.timer = window.setTimeout(() => { ui.toast.hidden = true; }, 2800);
    }

    function makeId(prefix) {
        return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    }

    function selectedNode() {
        return state.nodes.find((node) => node.id === state.selectedNodeId) || null;
    }

    function typeStyle(type) {
        return state.colors[type] || { bg: '#f1f5f9', border: '#94a3b8', text: '#1e293b' };
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function escapeXml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function applyTransform() {
        if (!ui.world) return;
        ui.world.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.scale})`;
        if (ui.zoomLabel) ui.zoomLabel.textContent = `${Math.round(state.scale * 100)} %`;
    }

    function screenToWorld(clientX, clientY) {
        const rect = ui.canvas.getBoundingClientRect();
        return {
            x: (clientX - rect.left - state.panX) / state.scale,
            y: (clientY - rect.top - state.panY) / state.scale
        };
    }

    function centerWorldPoint() {
        const rect = ui.canvas.getBoundingClientRect();
        return {
            x: (rect.width / 2 - state.panX) / state.scale,
            y: (rect.height / 2 - state.panY) / state.scale
        };
    }

    function chapterLabel(id) {
        return state.chapters.find((chapter) => chapter.id === id)?.title || '';
    }

    function renderLegend() {
        ui.legend.innerHTML = '';
        for (const [key, label] of Object.entries(state.types)) {
            const item = document.createElement('span');
            item.className = 'mindmap-legend-item';
            item.dataset.type = key;
            item.innerHTML = `<i></i>${escapeXml(label)}`;
            ui.legend.appendChild(item);
        }
    }

    function edgeGeometry(edge) {
        const a = state.nodes.find((node) => node.id === edge.source);
        const b = state.nodes.find((node) => node.id === edge.target);
        if (!a || !b) return null;

        const ax = Number(a.x || 0) + NODE_W / 2;
        const ay = Number(a.y || 0) + NODE_H / 2;
        const bx = Number(b.x || 0) + NODE_W / 2;
        const by = Number(b.y || 0) + NODE_H / 2;
        const dx = bx - ax;
        const dy = by - ay;
        const bend = Math.max(70, Math.min(240, Math.abs(dx) * 0.45));
        const c1x = ax + (dx >= 0 ? bend : -bend);
        const c2x = bx - (dx >= 0 ? bend : -bend);
        const c1y = ay + dy * 0.08;
        const c2y = by - dy * 0.08;
        return {
            path: `M ${ax} ${ay} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${bx} ${by}`,
            labelX: (ax + bx) / 2,
            labelY: (ay + by) / 2 - 7
        };
    }

    function renderEdges() {
        ui.edges.innerHTML = `
            <defs>
                <marker id="mindmapArrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
                    <path d="M0,0 L8,4 L0,8 Z" fill="#8a7d72"></path>
                </marker>
            </defs>`;

        for (const edge of state.edges) {
            const g = edgeGeometry(edge);
            if (!g) continue;
            const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            group.classList.add('mindmap-edge');
            group.dataset.id = edge.id;

            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', g.path);
            path.setAttribute('marker-end', 'url(#mindmapArrow)');
            path.setAttribute('class', 'mindmap-edge-line');
            group.appendChild(path);

            if (edge.label) {
                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('x', g.labelX);
                text.setAttribute('y', g.labelY);
                text.setAttribute('class', 'mindmap-edge-label');
                text.textContent = edge.label;
                group.appendChild(text);
            }
            ui.edges.appendChild(group);
        }
    }

    function renderNodes() {
        ui.nodes.innerHTML = '';
        const needle = state.search.trim().toLocaleLowerCase('fr');

        for (const node of state.nodes) {
            const style = typeStyle(node.type);
            const el = document.createElement('article');
            el.className = `mindmap-node${node.id === state.selectedNodeId ? ' is-selected' : ''}`;
            el.dataset.id = node.id;
            el.style.left = `${Number(node.x || 0)}px`;
            el.style.top = `${Number(node.y || 0)}px`;
            el.style.setProperty('--node-bg', style.bg);
            el.style.setProperty('--node-border', style.border);
            el.style.setProperty('--node-text', style.text);

            const haystack = `${node.label || ''} ${node.note || ''} ${state.types[node.type] || ''} ${chapterLabel(node.chapterId)}`.toLocaleLowerCase('fr');
            if (needle && !haystack.includes(needle)) el.classList.add('is-search-muted');

            const type = document.createElement('span');
            type.className = 'mindmap-node__type';
            type.textContent = state.types[node.type] || node.type || 'Élément';

            const title = document.createElement('strong');
            title.className = 'mindmap-node__title';
            title.textContent = node.label || 'Sans titre';

            const meta = document.createElement('small');
            meta.className = 'mindmap-node__meta';
            meta.textContent = node.chapterId ? `Chapitre : ${chapterLabel(node.chapterId) || 'introuvable'}` : (node.note || '');

            el.append(type, title, meta);
            el.addEventListener('pointerdown', onNodePointerDown);
            el.addEventListener('click', (event) => {
                event.stopPropagation();
                selectNode(node.id);
            });
            el.addEventListener('dblclick', async (event) => {
                event.stopPropagation();
                if (node.chapterId && window.ecrivainApp?.openChapter) await window.ecrivainApp.openChapter(node.chapterId);
            });
            ui.nodes.appendChild(el);
        }
        ui.empty.hidden = state.nodes.length > 0;
    }

    function renderGraph() {
        renderEdges();
        renderNodes();
        renderInspector();
    }

    function populateNodeForm(node, creating = false) {
        ui.inspectorEmpty.hidden = true;
        ui.inspectorForm.hidden = false;
        ui.inspectorTitle.textContent = creating ? 'Nouvel élément' : 'Élément sélectionné';
        ui.nodeId.value = node?.id || '';
        ui.nodeLabel.value = node?.label || '';
        ui.nodeNote.value = node?.note || '';
        ui.nodeDelete.hidden = creating;

        ui.nodeType.innerHTML = '';
        for (const [value, label] of Object.entries(state.types)) {
            const option = new Option(label, value, false, value === (node?.type || 'idee'));
            ui.nodeType.add(option);
        }

        ui.nodeChapter.innerHTML = '<option value="">Aucun chapitre lié</option>';
        for (const chapter of state.chapters) {
            const prefix = '— '.repeat(Math.max(0, Number(chapter._depth || 0)));
            ui.nodeChapter.add(new Option(`${prefix}${chapter.title || 'Sans titre'}`, chapter.id, false, chapter.id === (node?.chapterId || '')));
        }
        renderRelations(node?.id || '');
        window.setTimeout(() => ui.nodeLabel.focus(), 20);
    }

    function renderInspector() {
        const node = selectedNode();
        if (!node) {
            ui.inspectorForm.hidden = true;
            ui.inspectorEmpty.hidden = false;
            ui.inspectorTitle.textContent = 'Carte mentale';
            return;
        }
        populateNodeForm(node, false);
    }

    function renderRelations(nodeId) {
        ui.relations.innerHTML = '';
        ui.relationTarget.innerHTML = '';
        state.editingEdgeId = '';
        ui.relationSave.textContent = 'Ajouter le lien';
        ui.relationCancel.hidden = true;
        ui.relationLabel.value = '';

        if (!nodeId) return;

        const candidates = state.nodes
            .filter((node) => node.id !== nodeId)
            .sort((a, b) => String(a.label || '').localeCompare(String(b.label || ''), 'fr'));
        for (const node of candidates) ui.relationTarget.add(new Option(node.label || 'Sans titre', node.id));

        const outgoing = state.edges.filter((edge) => edge.source === nodeId);
        if (!outgoing.length) {
            const empty = document.createElement('p');
            empty.className = 'mindmap-rel-empty';
            empty.textContent = 'Aucun lien sortant.';
            ui.relations.appendChild(empty);
            return;
        }

        for (const edge of outgoing) {
            const target = state.nodes.find((node) => node.id === edge.target);
            const row = document.createElement('div');
            row.className = 'mindmap-rel-row';

            const text = document.createElement('div');
            text.className = 'mindmap-rel-row__text';
            const strong = document.createElement('strong');
            strong.textContent = target?.label || 'Élément introuvable';
            const small = document.createElement('small');
            small.textContent = edge.label || 'Lien sans libellé';
            text.append(strong, small);

            const actions = document.createElement('div');
            actions.className = 'mindmap-rel-row__actions';
            const edit = document.createElement('button');
            edit.type = 'button';
            edit.className = 'icon-button';
            edit.title = 'Modifier la relation';
            edit.textContent = '✎';
            edit.addEventListener('click', () => {
                state.editingEdgeId = edge.id;
                ui.relationTarget.value = edge.target;
                ui.relationLabel.value = edge.label || '';
                ui.relationSave.textContent = 'Enregistrer le lien';
                ui.relationCancel.hidden = false;
                ui.relationLabel.focus();
            });
            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'icon-button danger-icon';
            del.title = 'Supprimer la relation';
            del.textContent = '×';
            del.addEventListener('click', async () => {
                state.edges = state.edges.filter((item) => item.id !== edge.id);
                await saveGraph();
                renderGraph();
            });
            actions.append(edit, del);
            row.append(text, actions);
            ui.relations.appendChild(row);
        }
    }

    function selectNode(id) {
        state.selectedNodeId = id || '';
        renderGraph();
    }

    async function saveGraph(silent = true) {
        try {
            const result = await window.ecrivain.mindmap.save({ nodes: state.nodes, edges: state.edges });
            if (result?.nodes) state.nodes = result.nodes;
            if (result?.edges) state.edges = result.edges;
            if (!silent) toast('Carte mentale enregistrée.');
            return result;
        } catch (error) {
            toast(error.message || 'Impossible d’enregistrer la carte mentale.', true);
            return null;
        }
    }

    function scheduleSave() {
        window.clearTimeout(state.saveTimer);
        state.saveTimer = window.setTimeout(() => saveGraph(true), 280);
    }

    function addNewNode() {
        state.selectedNodeId = '';
        const center = centerWorldPoint();
        const draft = {
            id: '', label: '', type: 'idee', note: '', chapterId: '',
            x: clamp(center.x - NODE_W / 2, 40, WORLD_W - NODE_W - 40),
            y: clamp(center.y - NODE_H / 2, 40, WORLD_H - NODE_H - 40)
        };
        ui.inspector.dataset.draftX = String(draft.x);
        ui.inspector.dataset.draftY = String(draft.y);
        populateNodeForm(draft, true);
    }

    async function saveNodeForm(event) {
        event.preventDefault();
        const id = ui.nodeId.value;
        const label = ui.nodeLabel.value.trim();
        if (!label) {
            ui.nodeLabel.focus();
            return;
        }
        const existing = state.nodes.find((node) => node.id === id);
        if (existing) {
            existing.label = label;
            existing.type = ui.nodeType.value || 'idee';
            existing.note = ui.nodeNote.value.trim();
            existing.chapterId = ui.nodeChapter.value || '';
            state.selectedNodeId = existing.id;
        } else {
            const node = {
                id: makeId('mn'),
                label,
                type: ui.nodeType.value || 'idee',
                note: ui.nodeNote.value.trim(),
                chapterId: ui.nodeChapter.value || '',
                x: Number(ui.inspector.dataset.draftX || 300),
                y: Number(ui.inspector.dataset.draftY || 240),
                createdAt: new Date().toISOString()
            };
            state.nodes.push(node);
            state.selectedNodeId = node.id;
        }
        await saveGraph(false);
        renderGraph();
    }

    async function deleteSelectedNode() {
        const node = selectedNode();
        if (!node) return;
        if (!window.confirm(`Supprimer « ${node.label} » et toutes ses relations ?`)) return;
        state.nodes = state.nodes.filter((item) => item.id !== node.id);
        state.edges = state.edges.filter((edge) => edge.source !== node.id && edge.target !== node.id);
        state.selectedNodeId = '';
        await saveGraph(false);
        renderGraph();
    }

    async function saveRelation() {
        const source = selectedNode();
        const targetId = ui.relationTarget.value;
        if (!source || !targetId || source.id === targetId) return;
        const label = ui.relationLabel.value.trim();

        if (state.editingEdgeId) {
            const edge = state.edges.find((item) => item.id === state.editingEdgeId);
            if (edge) {
                edge.target = targetId;
                edge.label = label;
            }
        } else {
            const duplicate = state.edges.find((edge) => edge.source === source.id && edge.target === targetId);
            if (duplicate) {
                duplicate.label = label;
            } else {
                state.edges.push({ id: makeId('me'), source: source.id, target: targetId, type: 'lien', label });
            }
        }
        await saveGraph();
        renderGraph();
    }

    function cancelRelationEdit() {
        state.editingEdgeId = '';
        renderRelations(state.selectedNodeId);
    }

    function onNodePointerDown(event) {
        if (event.button !== 0) return;
        event.stopPropagation();
        const id = event.currentTarget.dataset.id;
        const node = state.nodes.find((item) => item.id === id);
        if (!node) return;
        selectNode(id);
        state.drag = {
            id,
            pointerId: event.pointerId,
            startClientX: event.clientX,
            startClientY: event.clientY,
            startX: Number(node.x || 0),
            startY: Number(node.y || 0),
            moved: false
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
    }

    function onPointerMove(event) {
        if (state.drag) {
            const node = state.nodes.find((item) => item.id === state.drag.id);
            if (!node) return;
            const dx = (event.clientX - state.drag.startClientX) / state.scale;
            const dy = (event.clientY - state.drag.startClientY) / state.scale;
            if (Math.abs(dx) + Math.abs(dy) > 2) state.drag.moved = true;
            node.x = clamp(state.drag.startX + dx, 20, WORLD_W - NODE_W - 20);
            node.y = clamp(state.drag.startY + dy, 20, WORLD_H - NODE_H - 20);
            const el = ui.nodes.querySelector(`[data-id="${CSS.escape(node.id)}"]`);
            if (el) {
                el.style.left = `${node.x}px`;
                el.style.top = `${node.y}px`;
            }
            renderEdges();
            return;
        }

        if (state.panning && state.panStart) {
            state.panX = state.panStart.panX + event.clientX - state.panStart.clientX;
            state.panY = state.panStart.panY + event.clientY - state.panStart.clientY;
            applyTransform();
        }
    }

    function onPointerUp() {
        if (state.drag) {
            const moved = state.drag.moved;
            state.drag = null;
            if (moved) scheduleSave();
        }
        state.panning = false;
        state.panStart = null;
        ui.canvas.classList.remove('is-panning');
    }

    function onCanvasPointerDown(event) {
        if (event.button !== 0) return;
        if (event.target.closest?.('.mindmap-node')) return;
        state.selectedNodeId = '';
        renderNodes();
        renderInspector();
        state.panning = true;
        state.panStart = { clientX: event.clientX, clientY: event.clientY, panX: state.panX, panY: state.panY };
        ui.canvas.classList.add('is-panning');
    }

    function setZoom(nextScale, clientX = null, clientY = null) {
        const previous = state.scale;
        const next = clamp(nextScale, 0.35, 2.2);
        if (next === previous) return;
        const rect = ui.canvas.getBoundingClientRect();
        const px = clientX == null ? rect.width / 2 : clientX - rect.left;
        const py = clientY == null ? rect.height / 2 : clientY - rect.top;
        const worldX = (px - state.panX) / previous;
        const worldY = (py - state.panY) / previous;
        state.scale = next;
        state.panX = px - worldX * next;
        state.panY = py - worldY * next;
        applyTransform();
    }

    function fitGraph() {
        const rect = ui.canvas.getBoundingClientRect();
        if (!state.nodes.length) {
            state.scale = 1;
            state.panX = rect.width / 2 - WORLD_W / 2;
            state.panY = rect.height / 2 - WORLD_H / 2;
            applyTransform();
            return;
        }
        const minX = Math.min(...state.nodes.map((n) => Number(n.x || 0))) - 90;
        const minY = Math.min(...state.nodes.map((n) => Number(n.y || 0))) - 90;
        const maxX = Math.max(...state.nodes.map((n) => Number(n.x || 0) + NODE_W)) + 90;
        const maxY = Math.max(...state.nodes.map((n) => Number(n.y || 0) + NODE_H)) + 90;
        const width = Math.max(1, maxX - minX);
        const height = Math.max(1, maxY - minY);
        state.scale = clamp(Math.min(rect.width / width, rect.height / height), 0.35, 1.35);
        state.panX = (rect.width - width * state.scale) / 2 - minX * state.scale;
        state.panY = (rect.height - height * state.scale) / 2 - minY * state.scale;
        applyTransform();
    }

    async function autoArrange() {
        if (!state.nodes.length) return;
        const degree = new Map(state.nodes.map((node) => [node.id, 0]));
        for (const edge of state.edges) {
            degree.set(edge.source, (degree.get(edge.source) || 0) + 1);
            degree.set(edge.target, (degree.get(edge.target) || 0) + 1);
        }
        const sorted = [...state.nodes].sort((a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0));
        const centerX = WORLD_W / 2 - NODE_W / 2;
        const centerY = WORLD_H / 2 - NODE_H / 2;
        sorted[0].x = centerX;
        sorted[0].y = centerY;
        const rest = sorted.slice(1);
        const rings = [420, 760, 1080];
        let cursor = 0;
        for (let ringIndex = 0; ringIndex < rings.length && cursor < rest.length; ringIndex += 1) {
            const remaining = rest.length - cursor;
            const capacity = Math.min(remaining, 8 + ringIndex * 8);
            const radius = rings[ringIndex];
            for (let i = 0; i < capacity; i += 1) {
                const node = rest[cursor++];
                const angle = -Math.PI / 2 + (Math.PI * 2 * i) / capacity;
                node.x = clamp(centerX + Math.cos(angle) * radius, 30, WORLD_W - NODE_W - 30);
                node.y = clamp(centerY + Math.sin(angle) * radius * 0.72, 30, WORLD_H - NODE_H - 30);
            }
        }
        while (cursor < rest.length) {
            const node = rest[cursor];
            const col = (cursor - 1) % 6;
            const row = Math.floor((cursor - 1) / 6);
            node.x = 180 + col * 600;
            node.y = 2400 + row * 150;
            cursor += 1;
        }
        await saveGraph();
        renderGraph();
        fitGraph();
        toast('Carte réorganisée.');
    }

    async function exportPng() {
        if (!state.nodes.length) {
            toast('La carte mentale est vide.', true);
            return;
        }
        const minX = Math.min(...state.nodes.map((n) => Number(n.x || 0))) - 80;
        const minY = Math.min(...state.nodes.map((n) => Number(n.y || 0))) - 80;
        const maxX = Math.max(...state.nodes.map((n) => Number(n.x || 0) + NODE_W)) + 80;
        const maxY = Math.max(...state.nodes.map((n) => Number(n.y || 0) + NODE_H)) + 80;
        const rawW = Math.max(400, maxX - minX);
        const rawH = Math.max(300, maxY - minY);
        const exportScale = Math.min(2, 3600 / rawW, 2600 / rawH);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(rawW * exportScale));
        canvas.height = Math.max(1, Math.round(rawH * exportScale));
        const ctx = canvas.getContext('2d');
        ctx.scale(exportScale, exportScale);
        ctx.translate(-minX, -minY);
        ctx.fillStyle = '#fbfaf7';
        ctx.fillRect(minX, minY, rawW, rawH);

        ctx.lineWidth = 2;
        ctx.strokeStyle = '#9b8e83';
        ctx.fillStyle = '#6f6258';
        ctx.font = '12px Arial';
        for (const edge of state.edges) {
            const g = edgeGeometry(edge);
            if (!g) continue;
            const match = g.path.match(/M ([\d.]+) ([\d.]+) C ([\d.]+) ([\d.]+), ([\d.]+) ([\d.]+), ([\d.]+) ([\d.]+)/);
            if (!match) continue;
            const nums = match.slice(1).map(Number);
            ctx.beginPath();
            ctx.moveTo(nums[0], nums[1]);
            ctx.bezierCurveTo(nums[2], nums[3], nums[4], nums[5], nums[6], nums[7]);
            ctx.stroke();
            if (edge.label) {
                const text = edge.label.length > 38 ? `${edge.label.slice(0, 35)}…` : edge.label;
                const metrics = ctx.measureText(text);
                ctx.fillStyle = '#fbfaf7';
                ctx.fillRect(g.labelX - metrics.width / 2 - 4, g.labelY - 12, metrics.width + 8, 17);
                ctx.fillStyle = '#6f6258';
                ctx.fillText(text, g.labelX - metrics.width / 2, g.labelY);
            }
        }

        for (const node of state.nodes) {
            const x = Number(node.x || 0);
            const y = Number(node.y || 0);
            const style = typeStyle(node.type);
            ctx.fillStyle = style.bg;
            ctx.strokeStyle = style.border;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.roundRect(x, y, NODE_W, NODE_H, 12);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = style.text;
            ctx.font = 'bold 11px Arial';
            ctx.fillText((state.types[node.type] || node.type || 'Élément').toUpperCase(), x + 12, y + 21);
            ctx.font = 'bold 15px Arial';
            const title = String(node.label || 'Sans titre');
            ctx.fillText(title.length > 22 ? `${title.slice(0, 20)}…` : title, x + 12, y + 48);
            ctx.font = '11px Arial';
            const meta = node.chapterId ? `Chapitre : ${chapterLabel(node.chapterId)}` : String(node.note || '');
            ctx.fillText(meta.length > 30 ? `${meta.slice(0, 28)}…` : meta, x + 12, y + 72);
        }

        const result = await window.ecrivain.mindmap.exportPng(canvas.toDataURL('image/png'));
        if (result?.canceled) return;
        toast('Carte mentale exportée en PNG.');
    }

    async function open() {
        try {
            const project = await window.ecrivain.project.state();
            if (!project?.project) {
                toast('Ouvrez d’abord un projet.', true);
                return;
            }
            const payload = await window.ecrivain.mindmap.state();
            state.nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
            state.edges = Array.isArray(payload.edges) ? payload.edges : [];
            state.types = payload.types || {};
            state.colors = payload.colors || {};
            state.chapters = Array.isArray(payload.chapters) ? payload.chapters : [];
            state.selectedNodeId = '';
            state.search = '';
            ui.search.value = '';

            if (ui.synopsis) ui.synopsis.hidden = true;
            if (ui.notes) ui.notes.hidden = true;
            if (ui.timeline) ui.timeline.hidden = true;
            if (ui.stats) ui.stats.hidden = true;
            if (ui.editorArea) ui.editorArea.hidden = true;
            if (ui.welcome) ui.welcome.hidden = true;
            ui.view.hidden = false;

            renderLegend();
            renderGraph();
            requestAnimationFrame(() => {
                if (state.nodes.length && state.nodes.every((n) => Number(n.x || 0) === 0 && Number(n.y || 0) === 0)) autoArrange();
                else fitGraph();
            });
        } catch (error) {
            toast(error.message || 'Impossible d’ouvrir la carte mentale.', true);
        }
    }

    function backToManuscript() {
        ui.view.hidden = true;
        if (window.ecrivainApp?.showManuscript) window.ecrivainApp.showManuscript();
    }

    ui.back?.addEventListener('click', backToManuscript);
    ui.add?.addEventListener('click', addNewNode);
    ui.auto?.addEventListener('click', autoArrange);
    ui.exportPng?.addEventListener('click', exportPng);
    ui.inspectorForm?.addEventListener('submit', saveNodeForm);
    ui.nodeDelete?.addEventListener('click', deleteSelectedNode);
    ui.relationSave?.addEventListener('click', saveRelation);
    ui.relationCancel?.addEventListener('click', cancelRelationEdit);
    ui.search?.addEventListener('input', () => {
        state.search = ui.search.value || '';
        renderNodes();
    });
    ui.zoomOut?.addEventListener('click', () => setZoom(state.scale - 0.15));
    ui.zoomIn?.addEventListener('click', () => setZoom(state.scale + 0.15));
    ui.fit?.addEventListener('click', fitGraph);
    ui.canvas?.addEventListener('pointerdown', onCanvasPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    ui.canvas?.addEventListener('wheel', (event) => {
        event.preventDefault();
        setZoom(state.scale * (event.deltaY < 0 ? 1.1 : 0.9), event.clientX, event.clientY);
    }, { passive: false });
    ui.canvas?.addEventListener('dblclick', (event) => {
        if (event.target.closest?.('.mindmap-node')) return;
        const p = screenToWorld(event.clientX, event.clientY);
        ui.inspector.dataset.draftX = String(clamp(p.x - NODE_W / 2, 30, WORLD_W - NODE_W - 30));
        ui.inspector.dataset.draftY = String(clamp(p.y - NODE_H / 2, 30, WORLD_H - NODE_H - 30));
        state.selectedNodeId = '';
        populateNodeForm({ id: '', label: '', type: 'idee', note: '', chapterId: '' }, true);
    });

    window.ecrivainMindmap = { open, fit: fitGraph };
})();
