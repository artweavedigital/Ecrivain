'use strict';

(() => {
    const $ = (id) => document.getElementById(id);

    const ui = {
        view: $('aiView'),
        back: $('aiBackBtn'),
        provider: $('aiProvider'),
        providerHelp: $('aiProviderHelp'),
        model: $('aiModel'),
        modelList: $('aiModelList'),
        baseUrl: $('aiBaseUrl'),
        apiKeyField: $('aiApiKeyField'),
        apiKey: $('aiApiKey'),
        keyHint: $('aiKeyHint'),
        secureHint: $('aiSecureHint'),
        saveSettings: $('aiSaveSettingsBtn'),
        clearKey: $('aiClearKeyBtn'),
        testConnection: $('aiTestConnectionBtn'),
        loadModels: $('aiLoadModelsBtn'),
        guide: $('aiGuideBtn'),
        connection: $('aiConnectionState'),
        statusDetail: $('aiStatusDetail'),
        task: $('aiTask'),
        scope: $('aiScope'),
        prompt: $('aiPrompt'),
        scopeHint: $('aiScopeHint'),
        run: $('aiRunBtn'),
        result: $('aiResult'),
        resultMeta: $('aiResultMeta'),
        copy: $('aiCopyBtn'),
        clear: $('aiClearBtn'),
        editorArea: $('editorArea'),
        welcome: $('welcome'),
        chapterContent: $('chapterContent'),
        chapterTitle: $('chapterTitle'),
        toast: $('toast')
    };

    if (!ui.view || !window.ecrivain?.ai) return;

    const PROVIDERS = {
        ollama: {
            label: 'Ollama — local / gratuit',
            defaultUrl: 'http://127.0.0.1:11434',
            needsKey: false,
            note: 'Tout reste sur votre ordinateur.',
            helpTitle: 'Ollama : le plus simple pour une IA locale',
            help: [
                'Installez Ollama sur Windows et lancez-le.',
                'Installez au moins un modèle. Exemple : ollama pull gemma3:4b',
                'Revenez ici, cliquez sur « 1. Tester », puis « 2. Charger les modèles ». '
            ]
        },
        lmstudio: {
            label: 'LM Studio — local / gratuit',
            defaultUrl: 'http://127.0.0.1:1234/v1',
            needsKey: false,
            note: 'Tout reste sur votre ordinateur lorsque le serveur local est utilisé.',
            helpTitle: 'LM Studio : interface graphique locale',
            help: [
                'Installez LM Studio et téléchargez un modèle.',
                'Dans LM Studio, ouvrez Developer et démarrez le serveur local.',
                'Revenez ici, cliquez sur « 1. Tester », puis « 2. Charger les modèles ». '
            ]
        },
        openai: {
            label: 'OpenAI — clé API personnelle',
            defaultUrl: 'https://api.openai.com/v1',
            needsKey: true,
            note: 'La clé API appartient à l’utilisateur et l’usage peut être facturé par OpenAI.',
            helpTitle: 'OpenAI : utilisation avec votre clé API',
            help: [
                'Créez une clé API dans votre compte OpenAI Platform.',
                'Collez-la ci-dessous puis cliquez sur « 1. Tester ».',
                'Chargez les modèles et choisissez un modèle de génération de texte. Un abonnement ChatGPT et l’API sont des services distincts.'
            ]
        },
        anthropic: {
            label: 'Anthropic — clé API personnelle',
            defaultUrl: 'https://api.anthropic.com/v1',
            needsKey: true,
            note: 'La clé API appartient à l’utilisateur et l’usage peut être facturé par Anthropic.',
            helpTitle: 'Anthropic : utilisation avec votre clé API',
            help: [
                'Créez une clé API dans la console Anthropic.',
                'Collez-la ci-dessous puis cliquez sur « 1. Tester ».',
                'Chargez les modèles disponibles pour votre compte et choisissez-en un.'
            ]
        },
        mistral: {
            label: 'Mistral — clé API personnelle',
            defaultUrl: 'https://api.mistral.ai/v1',
            needsKey: true,
            note: 'La clé API appartient à l’utilisateur et l’usage peut être facturé par Mistral.',
            helpTitle: 'Mistral : utilisation avec votre clé API',
            help: [
                'Créez une clé API dans la console Mistral.',
                'Collez-la ci-dessous puis cliquez sur « 1. Tester ».',
                'Chargez les modèles disponibles pour votre compte et choisissez-en un.'
            ]
        }
    };

    const TASK_LABELS = {
        analyse: 'Analyse éditoriale',
        repetitions: 'Répétitions et lourdeurs',
        coherence: 'Cohérence',
        resume: 'Résumé',
        reformulation: 'Reformulation',
        libre: 'Question libre'
    };

    const state = {
        settings: null,
        selectionText: '',
        selectionTitle: '',
        running: false
    };

    function toast(message, error = false) {
        if (!ui.toast) return;
        ui.toast.textContent = message;
        ui.toast.classList.toggle('is-error', error);
        ui.toast.hidden = false;
        window.clearTimeout(toast.timer);
        toast.timer = window.setTimeout(() => { ui.toast.hidden = true; }, 3800);
    }

    function setStatus(label, type = '', detail = '') {
        if (ui.connection) {
            ui.connection.textContent = label;
            ui.connection.className = `ai-connection-state${type ? ` is-${type}` : ''}`;
        }
        if (ui.statusDetail) {
            ui.statusDetail.textContent = detail || '';
            ui.statusDetail.className = `ai-status-detail${type ? ` is-${type}` : ''}`;
            ui.statusDetail.hidden = !detail;
        }
    }

    function stripHtml(html) {
        const box = document.createElement('div');
        box.innerHTML = String(html || '');
        return (box.innerText || box.textContent || '')
            .replace(/\u00a0/g, ' ')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    function captureSelection() {
        state.selectionText = '';
        state.selectionTitle = '';
        const selection = window.getSelection?.();
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
        const range = selection.getRangeAt(0);
        if (!ui.chapterContent?.contains(range.commonAncestorContainer)) return;
        state.selectionText = selection.toString().trim();
        state.selectionTitle = ui.chapterTitle?.value?.trim() || 'Chapitre courant';
    }

    function hideOtherViews() {
        [
            'globalSynopsisView', 'synopsisView', 'notesView', 'timelineView',
            'mindmapView', 'statsView', 'backupsView', 'historyView', 'projectSearchView'
        ].forEach((id) => {
            const element = document.getElementById(id);
            if (element) element.hidden = true;
        });
        if (ui.editorArea) ui.editorArea.hidden = true;
        if (ui.welcome) ui.welcome.hidden = true;
    }

    function backToManuscript() {
        ui.view.hidden = true;
        const active = document.querySelector('.chapter-item.is-active');
        if (active) {
            if (ui.editorArea) ui.editorArea.hidden = false;
            if (ui.welcome) ui.welcome.hidden = true;
        } else {
            if (ui.editorArea) ui.editorArea.hidden = true;
            if (ui.welcome) ui.welcome.hidden = false;
        }
    }

    function providerSettings(provider) {
        return state.settings?.providers?.[provider] || {};
    }

    function renderProviderHelp(provider) {
        const info = PROVIDERS[provider];
        if (!ui.providerHelp || !info) return;
        ui.providerHelp.innerHTML = '';
        const title = document.createElement('strong');
        title.textContent = info.helpTitle;
        const list = document.createElement('ol');
        info.help.forEach((step) => {
            const li = document.createElement('li');
            if (step.includes('ollama pull gemma3:4b')) {
                const [before] = step.split('ollama pull gemma3:4b');
                li.append(document.createTextNode(before));
                const code = document.createElement('code');
                code.textContent = 'ollama pull gemma3:4b';
                li.append(code);
            } else {
                li.textContent = step;
            }
            list.appendChild(li);
        });
        ui.providerHelp.append(title, list);
    }

    function renderProviderSettings() {
        const provider = ui.provider.value || 'ollama';
        const info = PROVIDERS[provider];
        const saved = providerSettings(provider);
        ui.baseUrl.value = saved.baseUrl || info.defaultUrl;
        ui.model.value = saved.model || '';
        ui.apiKey.value = '';
        ui.apiKey.disabled = !info.needsKey;
        if (ui.apiKeyField) ui.apiKeyField.hidden = !info.needsKey;
        if (ui.clearKey) ui.clearKey.hidden = !info.needsKey || !saved.hasKey;
        ui.apiKey.placeholder = saved.hasKey
            ? 'Clé enregistrée — laissez vide pour la conserver'
            : 'Collez votre clé API';
        ui.keyHint.textContent = info.note;
        ui.keyHint.hidden = !info.note;
        ui.secureHint.hidden = !info.needsKey;
        ui.secureHint.textContent = state.settings?.secureStorage
            ? 'La clé est chiffrée par Windows et stockée hors de vos projets.'
            : 'Le stockage sécurisé des clés n’est pas disponible sur ce système.';
        ui.modelList.innerHTML = '';
        renderProviderHelp(provider);
        if (info.needsKey && !saved.hasKey) {
            setStatus('Clé requise', '', 'Collez votre clé API, puis cliquez sur « 1. Tester ».');
        } else {
            setStatus('Non testée', '', 'Cliquez sur « 1. Tester » pour vérifier que le service répond.');
        }
    }

    function setProviderOptions() {
        ui.provider.innerHTML = '';
        for (const [value, info] of Object.entries(PROVIDERS)) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = info.label;
            ui.provider.appendChild(option);
        }
    }

    async function loadSettings() {
        state.settings = await window.ecrivain.ai.settings();
        setProviderOptions();
        ui.provider.value = state.settings?.provider || 'ollama';
        renderProviderSettings();
    }

    async function saveSettings(showMessage = true, rerender = true) {
        const provider = ui.provider.value;
        const payload = {
            provider,
            baseUrl: ui.baseUrl.value.trim(),
            model: ui.model.value.trim(),
            apiKey: ui.apiKey.value.trim()
        };
        state.settings = await window.ecrivain.ai.saveSettings(payload);
        if (rerender) renderProviderSettings();
        else ui.apiKey.value = '';
        if (showMessage) toast('Configuration IA enregistrée.');
        return state.settings;
    }

    async function clearStoredKey() {
        const provider = ui.provider.value;
        if (!PROVIDERS[provider]?.needsKey) return;
        try {
            state.settings = await window.ecrivain.ai.saveSettings({
                provider,
                baseUrl: ui.baseUrl.value.trim(),
                model: ui.model.value.trim(),
                clearKey: true
            });
            renderProviderSettings();
            toast('Clé API effacée.');
        } catch (error) {
            setStatus('Erreur', 'error', error.message || 'Impossible d’effacer la clé API.');
        }
    }

    function fillModels(models) {
        ui.modelList.innerHTML = '';
        models.forEach((model) => {
            const option = document.createElement('option');
            option.value = model;
            ui.modelList.appendChild(option);
        });
        if (!ui.model.value && models[0]) ui.model.value = models[0];
    }

    async function testConnection() {
        const provider = ui.provider.value;
        try {
            ui.testConnection.disabled = true;
            setStatus('Test en cours…', 'pending', 'Écrivain vérifie que le service répond.');
            await saveSettings(false, false);
            const payload = await window.ecrivain.ai.test({ provider });
            const count = Number(payload?.modelCount || 0);
            const detail = payload?.message || (count
                ? `Connexion réussie. ${count} modèle${count > 1 ? 's' : ''} détecté${count > 1 ? 's' : ''}.`
                : 'Connexion réussie, mais aucun modèle n’est disponible.');
            setStatus('Connexion OK', 'ok', detail);
            toast('Connexion IA réussie.');
        } catch (error) {
            setStatus('Connexion impossible', 'error', error.message || 'Le service IA ne répond pas.');
        } finally {
            ui.testConnection.disabled = false;
        }
    }

    async function loadModels() {
        const provider = ui.provider.value;
        try {
            ui.loadModels.disabled = true;
            setStatus('Chargement…', 'pending', 'Lecture de la liste des modèles disponibles.');
            await saveSettings(false, false);
            const payload = await window.ecrivain.ai.models({ provider });
            const models = Array.isArray(payload?.models) ? payload.models : [];
            fillModels(models);
            if (models.length) {
                setStatus(
                    `${models.length} modèle${models.length > 1 ? 's' : ''}`,
                    'ok',
                    `${models.length} modèle${models.length > 1 ? 's sont' : ' est'} disponible${models.length > 1 ? 's' : ''}. Cliquez dans le champ « Modèle » pour choisir.`
                );
                toast('Liste des modèles chargée.');
            } else {
                const local = provider === 'ollama' || provider === 'lmstudio';
                setStatus(
                    'Aucun modèle',
                    'error',
                    local
                        ? 'Le service répond, mais aucun modèle n’est installé ou chargé. Installez/chargez un modèle dans l’application IA, puis recommencez.'
                        : 'Le service répond, mais aucun modèle n’a été retourné pour ce compte.'
                );
            }
        } catch (error) {
            setStatus('Chargement impossible', 'error', error.message || 'Impossible de charger la liste des modèles.');
        } finally {
            ui.loadModels.disabled = false;
        }
    }

    async function openGuide() {
        try {
            await window.ecrivain.ai.openGuide({ provider: ui.provider.value });
        } catch (error) {
            setStatus('Guide indisponible', 'error', error.message || 'Impossible d’ouvrir le guide.');
        }
    }

    function updateScopeHint() {
        const scope = ui.scope.value;
        if (scope === 'selection') {
            ui.scopeHint.textContent = state.selectionText
                ? `${state.selectionText.length.toLocaleString('fr-FR')} caractères sélectionnés.`
                : 'Aucune sélection n’a été capturée. Revenez au manuscrit, sélectionnez un passage, puis rouvrez l’assistant.';
        } else if (scope === 'chapter') {
            ui.scopeHint.textContent = 'Le texte complet du chapitre courant sera transmis à l’IA.';
        } else if (scope === 'synopsis') {
            ui.scopeHint.textContent = 'Le synopsis global (pitch, synopsis et notes de structure) sera utilisé.';
        } else {
            ui.scopeHint.textContent = 'Tous les chapitres seront regroupés dans la limite technique prévue pour une requête.';
        }
    }

    async function buildContext() {
        const scope = ui.scope.value;
        if (scope === 'selection') {
            if (!state.selectionText) throw new Error('Aucun texte sélectionné. Revenez au manuscrit, sélectionnez un passage, puis rouvrez l’assistant IA.');
            return {
                scope,
                title: `Sélection — ${state.selectionTitle || 'chapitre courant'}`,
                text: state.selectionText
            };
        }

        if (scope === 'chapter') {
            const title = ui.chapterTitle?.value?.trim() || 'Chapitre courant';
            const text = stripHtml(ui.chapterContent?.innerHTML || '');
            if (!text) throw new Error('Le chapitre courant est vide.');
            return { scope, title, text };
        }

        if (scope === 'synopsis') {
            const synopsis = await window.ecrivain.globalSynopsis.state() || {};
            const blocks = [
                synopsis.title ? `Titre : ${synopsis.title}` : '',
                synopsis.pitch ? `Pitch :\n${synopsis.pitch}` : '',
                synopsis.synopsis ? `Synopsis :\n${synopsis.synopsis}` : '',
                synopsis.structureNotes ? `Notes de structure :\n${synopsis.structureNotes}` : ''
            ].filter(Boolean);
            if (!blocks.length) throw new Error('Le synopsis global est vide.');
            return { scope, title: 'Synopsis global', text: blocks.join('\n\n') };
        }

        const project = await window.ecrivain.project.state();
        const chapters = Array.isArray(project?.chapters) ? project.chapters : [];
        if (!chapters.length) throw new Error('Le projet ne contient aucun chapitre.');
        const text = chapters.map((chapter) => {
            const depth = Number(chapter._depth || 0);
            const prefix = depth ? `${'  '.repeat(depth)}Sous-chapitre` : 'Chapitre';
            return `${prefix} — ${chapter.title || 'Sans titre'}\n${stripHtml(chapter.content || '')}`;
        }).join('\n\n-----\n\n');
        return { scope, title: project?.project?.title || 'Manuscrit', text };
    }

    async function run() {
        if (state.running) return;
        const model = ui.model.value.trim();
        if (!model) {
            setStatus('Modèle requis', 'error', 'Chargez la liste des modèles ou saisissez le nom d’un modèle avant de lancer l’analyse.');
            ui.model.focus();
            return;
        }
        try {
            state.running = true;
            ui.run.disabled = true;
            ui.run.textContent = 'Analyse en cours…';
            ui.result.textContent = '';
            ui.resultMeta.textContent = 'Préparation du contexte…';
            await saveSettings(false, false);
            const context = await buildContext();
            const task = ui.task.value;
            const instruction = ui.prompt.value.trim();
            ui.resultMeta.textContent = `${TASK_LABELS[task] || 'Assistant IA'} · ${context.title}`;
            const response = await window.ecrivain.ai.run({
                provider: ui.provider.value,
                model,
                task,
                instruction,
                context
            });
            ui.result.textContent = response?.text || '';
            const providerLabel = PROVIDERS[ui.provider.value]?.label || ui.provider.value;
            ui.resultMeta.textContent = `${TASK_LABELS[task] || 'Assistant IA'} · ${context.title} · ${providerLabel} · ${model}`;
            if (response?.truncated) {
                setStatus('Réponse reçue', 'ok', 'La réponse a été reçue, mais le contexte était trop long et a été tronqué pour cette requête.');
            } else {
                setStatus('Réponse reçue', 'ok', 'L’analyse est terminée. La réponse reste séparée du manuscrit.');
            }
        } catch (error) {
            ui.result.textContent = `Impossible d’obtenir une réponse.\n\n${error.message || 'La requête IA a échoué.'}`;
            ui.resultMeta.textContent = 'Échec de la requête';
            setStatus('Erreur IA', 'error', error.message || 'La requête IA a échoué.');
        } finally {
            state.running = false;
            ui.run.disabled = false;
            ui.run.textContent = 'Lancer l’analyse';
        }
    }

    async function copyResult() {
        const text = ui.result.textContent || '';
        if (!text.trim()) return;
        try {
            await navigator.clipboard.writeText(text);
            toast('Réponse copiée dans le presse-papiers.');
        } catch (_) {
            const range = document.createRange();
            range.selectNodeContents(ui.result);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            document.execCommand('copy');
            selection.removeAllRanges();
            toast('Réponse copiée.');
        }
    }

    async function open() {
        try {
            const project = await window.ecrivain.project.state();
            if (!project?.project) {
                toast('Ouvrez d’abord un projet.', true);
                return;
            }
            captureSelection();
            await loadSettings();
            hideOtherViews();
            ui.view.hidden = false;
            if (state.selectionText) ui.scope.value = 'selection';
            else ui.scope.value = 'chapter';
            updateScopeHint();
        } catch (error) {
            toast(error.message || 'Impossible d’ouvrir l’assistant IA.', true);
        }
    }

    ui.back?.addEventListener('click', backToManuscript);
    ui.provider?.addEventListener('change', renderProviderSettings);
    ui.scope?.addEventListener('change', updateScopeHint);
    ui.saveSettings?.addEventListener('click', () => saveSettings(true, true).catch((error) => setStatus('Erreur', 'error', error.message || 'Impossible d’enregistrer.')));
    ui.testConnection?.addEventListener('click', testConnection);
    ui.loadModels?.addEventListener('click', loadModels);
    ui.guide?.addEventListener('click', openGuide);
    ui.clearKey?.addEventListener('click', clearStoredKey);
    ui.run?.addEventListener('click', run);
    ui.copy?.addEventListener('click', copyResult);
    ui.clear?.addEventListener('click', () => {
        ui.result.textContent = '';
        ui.resultMeta.textContent = 'Aucune réponse pour l’instant.';
    });

    function closeForSwitch() { ui.view.hidden = true; }

    window.ecrivainAI = { open, closeForSwitch };
})();
