 'use strict';

(() => {
    const $ = (id) => document.getElementById(id);
    const view = $('preferencesView');
    const fields = {
        startup: $('prefStartup'), recentLimit: $('prefRecentLimit'), projectsDir: $('prefProjectsDir'), autosave: $('prefAutosave'),
        author: $('prefAuthor'), font: $('prefFont'), fontSize: $('prefFontSize'), lineSpacing: $('prefLineSpacing'),
        pageWidth: $('prefPageWidth'), pageHeight: $('prefPageHeight'), margin: $('prefMargin'), indent: $('prefIndent'), zoom: $('prefZoom')
    };
    let state = null;

    const overlay = $('settingsInfoBackdrop');
    const infoTitle = $('settingsInfoTitle');
    const infoSubtitle = $('settingsInfoSubtitle');
    const infoKicker = $('settingsInfoKicker');
    const infoBody = $('settingsInfoBody');
    const infoLogo = $('settingsInfoLogo');
    const infoClose = $('settingsInfoClose');
    const infoSecondary = $('settingsInfoSecondary');

    function esc(value) {
        return String(value ?? '').replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    }
    function frenchDate(raw) {
        if (!raw) return '—';
        const m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
        if (!m) return esc(raw);
        return `${m[3]}/${m[2]}/${m[1]}${m[4] ? ` à ${m[4]}:${m[5]}` : ''}`;
    }
    function hideOtherViews() {
        ['globalSynopsisView','synopsisView','notesView','timelineView','mindmapView','projectSearchView','backupsView','historyView','statsView','aiView','pluginsView'].forEach((id) => {
            const el = $(id); if (el) el.hidden = true;
        });
    }
    function closeForSwitch() { if (view) view.hidden = true; closeOverlay(); }

    function renderPreferences(payload) {
        state = payload || {};
        const p = state.preferences || {};
        fields.startup.value = p.startupBehavior || 'welcome';
        fields.recentLimit.value = String(p.recentProjectsLimit || 5);
        fields.projectsDir.value = p.defaultProjectsDir || '';
        fields.autosave.value = String(p.autosaveDelayMs || 1800);
        fields.author.value = p.defaultAuthor || '';
        const preferredFont = p.newProjectFont || 'Garamond';
        if (fields.font && !Array.from(fields.font.options || []).some((option) => option.value === preferredFont)) {
            const option = document.createElement('option'); option.value = preferredFont; option.textContent = preferredFont; fields.font.prepend(option);
        }
        fields.font.value = preferredFont;
        fields.fontSize.value = p.newProjectFontSizePt ?? 11;
        fields.lineSpacing.value = p.newProjectLineSpacingPt ?? 13;
        fields.pageWidth.value = p.newProjectPageWidthCm ?? 12;
        fields.pageHeight.value = p.newProjectPageHeightCm ?? 19;
        fields.margin.value = p.newProjectMarginMm ?? 15;
        fields.indent.value = p.newProjectParagraphIndentMm ?? 5;
        fields.zoom.value = String(p.uiZoom ?? 1);
        $('prefDataPath').textContent = state.userDataDir || '';
    }

    async function openPreferences() {
        hideOtherViews();
        if (view) view.hidden = false;
        const payload = await window.ecrivain.preferences.state();
        renderPreferences(payload);
    }

    function collectPreferences() {
        return {
            startupBehavior: fields.startup.value,
            recentProjectsLimit: Number(fields.recentLimit.value),
            defaultProjectsDir: fields.projectsDir.value.trim(),
            autosaveDelayMs: Number(fields.autosave.value),
            defaultAuthor: fields.author.value.trim(),
            newProjectFont: fields.font.value.trim() || 'Garamond',
            newProjectFontSizePt: Number(fields.fontSize.value),
            newProjectLineSpacingPt: Number(fields.lineSpacing.value),
            newProjectPageWidthCm: Number(fields.pageWidth.value),
            newProjectPageHeightCm: Number(fields.pageHeight.value),
            newProjectMarginMm: Number(fields.margin.value),
            newProjectParagraphIndentMm: Number(fields.indent.value),
            uiZoom: Number(fields.zoom.value)
        };
    }

    async function savePreferences() {
        const saveState = $('preferencesSaveState');
        saveState.textContent = 'Enregistrement…';
        try {
            const payload = await window.ecrivain.preferences.save(collectPreferences());
            renderPreferences(payload);
            window.ecrivainApp?.updatePreferences?.(payload.preferences);
            saveState.textContent = 'Préférences enregistrées.';
        } catch (error) {
            saveState.textContent = error.message || 'Impossible d’enregistrer.';
        }
    }

    async function resetPreferences() {
        const payload = await window.ecrivain.preferences.reset();
        renderPreferences(payload);
        window.ecrivainApp?.updatePreferences?.(payload.preferences);
        $('preferencesSaveState').textContent = 'Valeurs par défaut restaurées.';
    }

    function closeOverlay() { if (overlay) overlay.hidden = true; infoSecondary.hidden = true; infoSecondary.onclick = null; }
    function openOverlay({ title, subtitle = '', kicker = 'ÉCRIVAIN', logo = false, html = '', closeLabel = 'Fermer', secondary = null }) {
        infoTitle.textContent = title;
        infoSubtitle.textContent = subtitle;
        infoKicker.textContent = kicker;
        infoLogo.hidden = !logo;
        infoBody.innerHTML = html;
        infoClose.textContent = closeLabel;
        infoClose.onclick = closeOverlay;
        if (secondary) {
            infoSecondary.hidden = false;
            infoSecondary.textContent = secondary.label;
            infoSecondary.onclick = secondary.onClick;
        } else {
            infoSecondary.hidden = true;
            infoSecondary.onclick = null;
        }
        overlay.hidden = false;
    }

    async function openProjectInfo() {
        const payload = await window.ecrivain.project.state();
        if (!payload?.project) {
            openOverlay({ title: 'Informations du projet', subtitle: 'Aucun projet n’est actuellement ouvert.', html: '<div class="settings-info-box"><p>Ouvrez ou créez un projet pour afficher ses informations.</p></div>' });
            return;
        }
        const p = payload.project;
        openOverlay({
            title: 'Informations du projet',
            subtitle: payload.projectDir || '',
            html: `<div class="settings-info-form">
                <label>Titre<input id="projectInfoTitle" value="${esc(p.title || '')}"></label>
                <label>Sous-titre<input id="projectInfoSubtitle" value="${esc(p.subtitle || '')}"></label>
                <label>Auteur<input id="projectInfoAuthor" value="${esc(p.author || '')}"></label>
                <label>Langue<select id="projectInfoLanguage"><option value="fr" ${p.language==='fr'?'selected':''}>Français</option><option value="en" ${p.language==='en'?'selected':''}>Anglais</option><option value="nl" ${p.language==='nl'?'selected':''}>Néerlandais</option><option value="de" ${p.language==='de'?'selected':''}>Allemand</option></select></label>
                <label class="span-2">Description<textarea id="projectInfoDescription">${esc(p.description || '')}</textarea></label>
                <div class="settings-info-box"><strong>Créé</strong><span>${frenchDate(p.createdAt)}</span></div>
                <div class="settings-info-box"><strong>Dernière modification</strong><span>${frenchDate(p.updatedAt)}</span></div>
                <div class="settings-info-box"><strong>Chapitres</strong><span>${payload.chapters?.length || 0}</span></div>
                <div class="settings-info-box"><strong>Format</strong><span>${esc(p.format || 'ecrivain-project')} · version ${esc(p.formatVersion || 1)}</span></div>
            </div>`,
            closeLabel: 'Enregistrer',
            secondary: { label: 'Ouvrir le dossier', onClick: () => window.ecrivain.project.openFolder().catch(() => {}) }
        });
        infoClose.onclick = async () => {
            try {
                const wantedChapter = window.ecrivainApp?.activeChapterId?.();
                await window.ecrivain.project.updateInfo({
                    title: $('projectInfoTitle').value, subtitle: $('projectInfoSubtitle').value, author: $('projectInfoAuthor').value,
                    language: $('projectInfoLanguage').value, description: $('projectInfoDescription').value
                });
                await window.ecrivainApp?.reloadProject?.(wantedChapter);
                closeOverlay();
            } catch (error) { infoSubtitle.textContent = error.message || 'Enregistrement impossible.'; }
        };
    }

    function showShortcuts() {
        const rows = [
            ['Enregistrer','Ctrl+S'], ['Nouveau projet','Ctrl+N'], ['Ouvrir un projet','Ctrl+O'],
            ['Nouveau chapitre','Ctrl+Maj+N'], ['Rechercher dans le chapitre','Ctrl+F'], ['Remplacer dans le chapitre','Ctrl+H'],
            ['Rechercher dans le projet','Ctrl+Maj+F'], ['Remplacer dans tout le projet','Ctrl+Maj+H'],
            ['Afficher les caractères invisibles','F6'], ['Plein écran / quitter','F11 / Échap'], ['Zoom avant / arrière','Ctrl + + / Ctrl + −'], ['Taille réelle','Ctrl+0'],
            ['Sous-chapitre','Alt+→'], ['Remonter d’un niveau','Alt+←'], ['Gras / italique / souligné','Ctrl+B / I / U']
        ];
        openOverlay({ title: 'Raccourcis clavier', subtitle: 'Les commandes les plus utiles pendant l’écriture.', html: `<div class="shortcut-grid">${rows.map(([a,b])=>`<div class="shortcut-row"><span>${esc(a)}</span><kbd>${esc(b)}</kbd></div>`).join('')}</div>` });
    }

    function showGuide() {
        openOverlay({ title: 'Prise en main', subtitle: 'Les quatre repères essentiels pour commencer sans se perdre.', logo: true, html: `
            <div class="settings-info-grid">
                <div class="settings-info-box"><strong>1 · Écrire</strong><p>Créez vos chapitres dans la colonne de gauche. Glissez-les à la souris pour changer leur ordre. Le clic droit donne accès au statut et à la hiérarchie.</p></div>
                <div class="settings-info-box"><strong>2 · Organiser</strong><p>Synopsis global, Synoptique, Notes, Chronologie et Carte mentale sont accessibles dans le menu Projet.</p></div>
                <div class="settings-info-box"><strong>3 · Sécuriser</strong><p>Écrivain sauvegarde automatiquement, conserve l’historique des chapitres et jusqu’à 5 sauvegardes complètes du projet.</p></div>
                <div class="settings-info-box"><strong>4 · Exporter</strong><p>Fichier → Exporter produit Markdown, DOCX, ODT, EPUB ou PDF selon la configuration du document.</p></div>
            </div>` });
    }

    async function showSystemInfo() {
        const i = await window.ecrivain.appInfo.state();
        openOverlay({ title: 'Informations techniques', subtitle: 'Informations utiles en cas de dépannage pendant la bêta.', html: `<div class="settings-info-grid">
            <div class="settings-info-box"><strong>Écrivain</strong><span>Version ${esc(i.version)}</span></div>
            <div class="settings-info-box"><strong>Format des projets</strong><span>${esc(i.projectFormat)} · schéma ${esc(i.schemaVersion)}</span></div>
            <div class="settings-info-box"><strong>Electron</strong><span>${esc(i.electron)}</span></div>
            <div class="settings-info-box"><strong>Chromium</strong><span>${esc(i.chromium)}</span></div>
            <div class="settings-info-box"><strong>Node.js</strong><span>${esc(i.node)}</span></div>
            <div class="settings-info-box"><strong>Système</strong><span>${esc(i.platform)} · ${esc(i.arch)}</span></div>
            <div class="settings-info-box" style="grid-column:1/-1"><strong>Données d’Écrivain</strong><span>${esc(i.userDataDir)}</span></div>
            <div class="settings-info-box" style="grid-column:1/-1"><strong>Journal technique</strong><span>${esc(i.logDir || '')}</span></div>
            ${i.currentProjectDir ? `<div class="settings-info-box" style="grid-column:1/-1"><strong>Projet ouvert</strong><span>${esc(i.currentProjectDir)}</span></div>` : ''}
        </div>
        <div class="settings-action-row" style="margin-top:14px">
            <button id="openDiagnosticFolder" type="button" class="button button-secondary">Ouvrir les journaux</button>
            <button id="createDiagnosticReport" type="button" class="button">Créer un rapport de diagnostic…</button>
        </div>
        <p class="settings-help" style="margin-top:10px">Le rapport ne contient ni le texte du manuscrit ni les clés API. Il regroupe uniquement les informations techniques utiles pour reproduire un problème.</p>` });
        window.setTimeout(() => {
            $('openDiagnosticFolder')?.addEventListener('click', () => window.ecrivain.diagnostics.openFolder().catch(() => {}));
            $('createDiagnosticReport')?.addEventListener('click', async () => {
                const btn = $('createDiagnosticReport');
                if (btn) { btn.disabled = true; btn.textContent = 'Création…'; }
                try {
                    const result = await window.ecrivain.diagnostics.report();
                    if (result && !result.canceled && btn) btn.textContent = 'Rapport créé';
                    else if (btn) { btn.disabled = false; btn.textContent = 'Créer un rapport de diagnostic…'; }
                } catch (error) {
                    if (btn) { btn.disabled = false; btn.textContent = 'Créer un rapport de diagnostic…'; }
                    infoSubtitle.textContent = error.message || 'Impossible de créer le rapport.';
                }
            });
        }, 0);
    }

    async function showAbout() {
        const i = await window.ecrivain.appInfo.state();
        openOverlay({ title: 'Écrivain', subtitle: `Version ${i.version}`, kicker: 'ATELIER D’ÉCRITURE · VERSION BÊTA', logo: true, html: `
            <div class="settings-info-box about-intro"><p><strong style="font-size:14px;text-transform:none;letter-spacing:0">Écrire sans usine à gaz.</strong></p><p>Écrivain réunit le manuscrit, les notes et les outils narratifs à portée de souris, tout en laissant l’écriture au centre.</p></div>
            <div class="about-origin">
                <div><strong>Projet initié par</strong><span>Pantélis Matsos</span></div>
                <div><strong>Conception fonctionnelle et poursuite</strong><span>Stéphane Matsos</span></div>
                <div><strong>Développement technique</strong><span>Assisté par intelligence artificielle</span></div>
                <div><strong>Origines</strong><span>Next Horizon — projet historique</span></div>
            </div>
            <div class="about-memory">À la mémoire de Pantélis Matsos, initiateur du projet Écrivain.</div>
            <div class="about-license">
                <strong>Logiciel gratuit à code source disponible</strong>
                <p>Le cœur d’Écrivain est distribué sous Apache License 2.0, complétée par la Commons Clause 1.0. Le code peut être consulté, étudié, modifié et partagé selon ces conditions, mais Écrivain ou une copie essentiellement rebaptisée ne peut pas être commercialisé sans autorisation.</p>
                <p><b>Vos œuvres vous appartiennent.</b> Écrivain ne revendique aucun droit sur les manuscrits, notes, images ou documents créés avec le logiciel, y compris lorsqu’ils sont exploités commercialement.</p>
                <p>Le nom Écrivain, son emblème et son identité visuelle sont réservés. La documentation officielle est publiée séparément sous CC BY-NC-ND 4.0.</p>
                <div class="settings-action-row">
                    <button id="aboutCommonsClause" type="button" class="button button-small">Commons Clause</button>
                    <button id="aboutApache" type="button" class="button button-small button-secondary">Apache 2.0</button>
                </div>
            </div>
            <div class="about-signature">Écrivain — pour que l’outil s’efface derrière le manuscrit.</div>` });
        window.setTimeout(() => {
            $('aboutCommonsClause')?.addEventListener('click', () => window.ecrivain.appInfo.openExternal('https://commonsclause.com/').catch(() => {}));
            $('aboutApache')?.addEventListener('click', () => window.ecrivain.appInfo.openExternal('https://www.apache.org/licenses/LICENSE-2.0').catch(() => {}));
        }, 0);
    }

    $('preferencesBack')?.addEventListener('click', () => { view.hidden = true; window.ecrivainApp?.showManuscript?.(); });
    $('preferencesSave')?.addEventListener('click', savePreferences);
    $('preferencesReset')?.addEventListener('click', resetPreferences);
    $('prefChooseProjectsDir')?.addEventListener('click', async () => { const r = await window.ecrivain.preferences.pickProjectsDir(); if (!r?.canceled && r?.path) fields.projectsDir.value = r.path; });
    $('prefOpenData')?.addEventListener('click', () => window.ecrivain.appInfo.openDataFolder().catch(() => {}));
    $('prefOpenExtensions')?.addEventListener('click', async () => { try { await window.ecrivain.plugins.openFolder(); } catch (_) {} });
    overlay?.addEventListener('mousedown', (e) => { if (e.target === overlay) closeOverlay(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay && !overlay.hidden) closeOverlay(); });

    window.ecrivainSettings = { openPreferences, closeForSwitch, openProjectInfo, showShortcuts, showGuide, showSystemInfo, showAbout };
})();
