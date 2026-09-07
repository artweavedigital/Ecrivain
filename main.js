const { app, BrowserWindow, Menu, dialog, ipcMain, shell, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');

let mainWindow = null;
let currentProjectDir = null;

const PROJECT_FORMAT_ID = 'ecrivain-project';
const PROJECT_FORMAT_VERSION = 1;
const PROJECT_SCHEMA_VERSION = '1.4.0';
const APP_VERSION = '0.6.0-beta.1';
const MAX_RECENT_PROJECTS = 5;

// Identité de l'application et verrou d'instance unique.
// Un second lancement ramène simplement la fenêtre existante au premier plan.
app.setName('Écrivain');
const HAS_SINGLE_INSTANCE_LOCK = app.requestSingleInstanceLock();
if (!HAS_SINGLE_INSTANCE_LOCK) app.quit();
else {
    app.on('second-instance', () => {
        if (!mainWindow) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        if (!mainWindow.isVisible()) mainWindow.show();
        mainWindow.focus();
    });
}

// -----------------------------------------------------------------------------
// Diagnostic bêta : journal local, détection d'arrêt non propre et rapport
// exportable. Aucune donnée de manuscrit ni clé API n'est écrite dans le journal.
// -----------------------------------------------------------------------------
let diagnosticsReady = false;
let sessionMarkerFile = '';

function diagnosticDirectory() {
    try { return path.join(app.getPath('userData'), 'logs'); }
    catch (_) { return path.join(__dirname, 'logs'); }
}

function diagnosticLogFile() {
    return path.join(diagnosticDirectory(), 'ecrivain.log');
}

function diagnosticPreviousLogFile() {
    return path.join(diagnosticDirectory(), 'ecrivain-previous.log');
}

function normalizeDiagnosticDetails(details) {
    if (details == null) return '';
    try {
        if (details instanceof Error) {
            return JSON.stringify({ name: details.name, message: details.message, stack: details.stack || '' });
        }
        if (typeof details === 'string') return details.slice(0, 4000);
        return JSON.stringify(details, (_key, value) => {
            if (typeof value === 'string' && value.length > 4000) return `${value.slice(0, 4000)}…`;
            return value;
        });
    } catch (_) {
        return String(details).slice(0, 4000);
    }
}

function rotateDiagnosticLogSync() {
    try {
        const file = diagnosticLogFile();
        if (!fsSync.existsSync(file)) return;
        const size = fsSync.statSync(file).size;
        if (size < 1024 * 1024) return;
        const previous = diagnosticPreviousLogFile();
        try { if (fsSync.existsSync(previous)) fsSync.unlinkSync(previous); } catch (_) {}
        fsSync.renameSync(file, previous);
    } catch (_) {}
}

function writeDiagnostic(level, message, details = null) {
    try {
        fsSync.mkdirSync(diagnosticDirectory(), { recursive: true });
        rotateDiagnosticLogSync();
        const stamp = new Date().toISOString();
        const suffix = details == null ? '' : ` | ${normalizeDiagnosticDetails(details)}`;
        fsSync.appendFileSync(diagnosticLogFile(), `[${stamp}] [${String(level || 'INFO').toUpperCase()}] ${String(message || '')}${suffix}\n`, 'utf8');
    } catch (_) {}
}

function initializeDiagnostics() {
    try {
        fsSync.mkdirSync(diagnosticDirectory(), { recursive: true });
        sessionMarkerFile = path.join(diagnosticDirectory(), 'session-active.lock');
        if (fsSync.existsSync(sessionMarkerFile)) {
            writeDiagnostic('WARN', 'Le démarrage précédent ne semble pas s’être terminé normalement.');
        }
        fsSync.writeFileSync(sessionMarkerFile, `${process.pid}\n${new Date().toISOString()}\n`, 'utf8');
        diagnosticsReady = true;
        writeDiagnostic('INFO', `Démarrage d’Écrivain ${APP_VERSION}`, {
            platform: process.platform,
            arch: process.arch,
            electron: process.versions.electron,
            node: process.versions.node
        });
    } catch (_) {}
}

function closeDiagnosticSession() {
    try {
        if (sessionMarkerFile && fsSync.existsSync(sessionMarkerFile)) fsSync.unlinkSync(sessionMarkerFile);
        writeDiagnostic('INFO', 'Fermeture normale d’Écrivain.');
    } catch (_) {}
}

async function openDiagnosticFolder() {
    await fs.mkdir(diagnosticDirectory(), { recursive: true });
    const error = await shell.openPath(diagnosticDirectory());
    if (error) throw new Error(error);
    return true;
}

function diagnosticProjectSummarySync() {
    if (!currentProjectDir) return null;
    try {
        const projectFile = path.join(currentProjectDir, 'project.json');
        const project = fsSync.existsSync(projectFile) ? JSON.parse(fsSync.readFileSync(projectFile, 'utf8')) : {};
        const chapterDir = path.join(currentProjectDir, 'chapters');
        const chapterCount = fsSync.existsSync(chapterDir)
            ? fsSync.readdirSync(chapterDir, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith('.json')).length
            : 0;
        return {
            path: currentProjectDir,
            title: String(project.title || ''),
            format: project.format || '',
            formatVersion: project.formatVersion || '',
            schemaVersion: project.schemaVersion || '',
            appVersion: project.appVersion || '',
            chapterCount
        };
    } catch (error) {
        return { path: currentProjectDir, error: error.message };
    }
}

async function createDiagnosticReport() {
    const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Enregistrer le rapport de diagnostic',
        defaultPath: `Ecrivain-diagnostic-${new Date().toISOString().slice(0, 10)}.zip`,
        filters: [{ name: 'Archive ZIP', extensions: ['zip'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };

    const appInfo = {
        app: 'Écrivain',
        version: APP_VERSION,
        generatedAt: new Date().toISOString(),
        platform: process.platform,
        arch: process.arch,
        electron: process.versions.electron || '',
        chromium: process.versions.chrome || '',
        node: process.versions.node || '',
        project: diagnosticProjectSummarySync()
    };
    const entries = [
        { name: 'rapport.json', data: `${JSON.stringify(appInfo, null, 2)}\n` },
        { name: 'LISEZ-MOI.txt', data: 'Rapport technique Écrivain. Il ne contient pas le texte du manuscrit ni les clés API.\n' }
    ];
    for (const [name, file] of [
        ['ecrivain.log', diagnosticLogFile()],
        ['ecrivain-previous.log', diagnosticPreviousLogFile()]
    ]) {
        if (fsSync.existsSync(file)) entries.push({ name, data: await fs.readFile(file) });
    }
    if (currentProjectDir) {
        const validation = path.join(currentProjectDir, 'recovery', 'last-validation.json');
        if (fsSync.existsSync(validation)) entries.push({ name: 'last-validation.json', data: await fs.readFile(validation) });
    }
    await fs.writeFile(result.filePath, makeZip(entries));
    writeDiagnostic('INFO', 'Rapport de diagnostic créé.', { file: result.filePath });
    return { canceled: false, path: result.filePath };
}


const AI_PROVIDER_DEFAULTS = {
    ollama: {
        baseUrl: 'http://127.0.0.1:11434',
        model: '',
        needsKey: false
    },
    lmstudio: {
        baseUrl: 'http://127.0.0.1:1234/v1',
        model: '',
        needsKey: false
    },
    openai: {
        baseUrl: 'https://api.openai.com/v1',
        model: '',
        needsKey: true
    },
    anthropic: {
        baseUrl: 'https://api.anthropic.com/v1',
        model: '',
        needsKey: true
    },
    mistral: {
        baseUrl: 'https://api.mistral.ai/v1',
        model: '',
        needsKey: true
    }

};

const AI_PROVIDER_GUIDES = {
    ollama: 'https://ollama.com/download/windows',
    lmstudio: 'https://lmstudio.ai/',
    openai: 'https://platform.openai.com/docs/quickstart',
    anthropic: 'https://docs.anthropic.com/en/docs/get-started',
    mistral: 'https://docs.mistral.ai/getting-started/quickstart/'
};

function aiProviderLabel(provider) {
    return ({
        ollama: 'Ollama',
        lmstudio: 'LM Studio',
        openai: 'OpenAI',
        anthropic: 'Anthropic',
        mistral: 'Mistral'
    })[provider] || 'le service IA';
}

function aiFriendlyNetworkError(provider, error) {
    const label = aiProviderLabel(provider);
    const local = provider === 'ollama' || provider === 'lmstudio';
    const code = error?.cause?.code || error?.code || '';

    if (local && ['ECONNREFUSED', 'ECONNRESET'].includes(code)) {
        return new Error(provider === 'ollama'
            ? 'Ollama ne répond pas. Vérifiez qu’Ollama est installé et lancé, puis réessayez.'
            : 'LM Studio ne répond pas. Ouvrez LM Studio, démarrez le serveur local dans l’onglet Developer, puis réessayez.');
    }
    if (code === 'ENOTFOUND') {
        return new Error(local
            ? 'L’adresse du service local est incorrecte. Utilisez les réglages par défaut sauf si vous avez changé le port.'
            : `Impossible de trouver ${label}. Vérifiez votre connexion Internet et l’adresse du service.`);
    }
    if (['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(code)) {
        return new Error(local
            ? `${label} ne répond pas assez vite. Vérifiez qu’il est lancé.`
            : `${label} ne répond pas. Vérifiez votre connexion Internet puis réessayez.`);
    }
    if (error instanceof TypeError && /fetch failed/i.test(String(error.message || ''))) {
        return new Error(local
            ? `${label} n’est pas joignable. Vérifiez que l’application est installée, lancée et que son serveur local est actif.`
            : `Impossible de joindre ${label}. Vérifiez votre connexion Internet.`);
    }
    return error;
}

function aiHttpError(provider, response, data) {
    const label = aiProviderLabel(provider);
    const status = Number(response.status || 0);
    const rawMessage = data?.error?.message || data?.message || data?.error || data?.raw || response.statusText || '';
    if (status === 401) return new Error(`Clé API refusée par ${label}. Vérifiez la clé puis recommencez.`);
    if (status === 403) return new Error(`Accès refusé par ${label}. Vérifiez la clé, les droits du compte et l’accès au modèle.`);
    if (status === 402) return new Error(`${label} indique que le compte ne dispose pas des crédits nécessaires.`);
    if (status === 429) return new Error(`${label} signale une limite ou un quota atteint. Attendez un moment ou vérifiez le quota du compte.`);
    if (status === 404) return new Error(provider === 'ollama' || provider === 'lmstudio'
        ? `Le serveur ${label} répond, mais l’adresse API n’est pas correcte. Revenez aux réglages par défaut.`
        : `Point d’accès introuvable chez ${label}. Vérifiez l’adresse du service.`);
    if (status >= 500) return new Error(`${label} rencontre actuellement une erreur serveur (${status}). Réessayez plus tard.`);
    const suffix = rawMessage ? ` — ${String(rawMessage).slice(0, 280)}` : '';
    return new Error(`${label} a refusé la requête (${status || 'erreur'})${suffix}`);
}

function aiSettingsFile() {
    return path.join(app.getPath('userData'), 'ai-settings.json');
}

function normalizeAiProvider(value) {
    const provider = String(value || '').trim().toLowerCase();
    return Object.hasOwn(AI_PROVIDER_DEFAULTS, provider) ? provider : 'ollama';
}

function normalizeAiBaseUrl(provider, value) {
    const fallback = AI_PROVIDER_DEFAULTS[provider]?.baseUrl || '';
    const input = String(value || fallback).trim().replace(/\/+$/g, '');
    let parsed;
    try {
        parsed = new URL(input);
    } catch (_) {
        throw new Error('Adresse du service IA invalide.');
    }

    if (provider === 'ollama' || provider === 'lmstudio') {
        const host = parsed.hostname.toLowerCase();
        if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
            throw new Error('Pour une IA locale, Écrivain n’autorise que localhost ou 127.0.0.1.');
        }
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new Error('Protocole IA local invalide.');
        }
    } else if (parsed.protocol !== 'https:') {
        throw new Error('Les fournisseurs IA distants doivent utiliser HTTPS.');
    }
    return input;
}

async function loadAiSettingsRaw() {
    const defaults = {
        provider: 'ollama',
        providers: Object.fromEntries(Object.entries(AI_PROVIDER_DEFAULTS).map(([key, value]) => [key, { ...value }]))
    };
    try {
        const file = aiSettingsFile();
        if (!fsSync.existsSync(file)) return defaults;
        const data = await readJson(file);
        const providers = { ...defaults.providers };
        for (const key of Object.keys(providers)) {
            const saved = data?.providers?.[key] || {};
            providers[key] = {
                ...providers[key],
                baseUrl: String(saved.baseUrl || providers[key].baseUrl),
                model: String(saved.model || ''),
                encryptedKey: typeof saved.encryptedKey === 'string' ? saved.encryptedKey : ''
            };
        }
        return {
            provider: normalizeAiProvider(data?.provider),
            providers
        };
    } catch (_) {
        return defaults;
    }
}

async function saveAiSettingsRaw(data) {
    const file = aiSettingsFile();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await writeJson(file, data);
}

async function aiSecureStorageAvailable() {
    try {
        if (typeof safeStorage.isAsyncEncryptionAvailable === 'function') {
            return await safeStorage.isAsyncEncryptionAvailable();
        }
        return safeStorage.isEncryptionAvailable();
    } catch (_) {
        return false;
    }
}

async function encryptAiSecret(value) {
    const text = String(value || '');
    if (!text) return '';
    if (!(await aiSecureStorageAvailable())) {
        throw new Error('Le stockage sécurisé Windows n’est pas disponible. La clé API n’a pas été enregistrée.');
    }
    if (typeof safeStorage.encryptStringAsync === 'function') {
        const encrypted = await safeStorage.encryptStringAsync(text);
        return Buffer.from(encrypted).toString('base64');
    }
    return safeStorage.encryptString(text).toString('base64');
}

async function decryptAiSecret(encoded) {
    if (!encoded) return '';
    try {
        const buffer = Buffer.from(encoded, 'base64');
        if (typeof safeStorage.decryptStringAsync === 'function') {
            const decrypted = await safeStorage.decryptStringAsync(buffer);
            return String(decrypted?.result || '');
        }
        return safeStorage.decryptString(buffer);
    } catch (_) {
        throw new Error('Impossible de déchiffrer la clé API enregistrée. Vous pouvez la saisir de nouveau.');
    }
}

async function publicAiSettings() {
    const data = await loadAiSettingsRaw();
    const providers = {};
    for (const [key, value] of Object.entries(data.providers || {})) {
        providers[key] = {
            baseUrl: value.baseUrl || AI_PROVIDER_DEFAULTS[key].baseUrl,
            model: value.model || '',
            hasKey: Boolean(value.encryptedKey)
        };
    }
    return {
        provider: normalizeAiProvider(data.provider),
        providers,
        secureStorage: await aiSecureStorageAvailable()
    };
}

async function updateAiSettings(payload = {}) {
    const data = await loadAiSettingsRaw();
    const provider = normalizeAiProvider(payload.provider || data.provider);
    const current = data.providers[provider] || { ...AI_PROVIDER_DEFAULTS[provider] };
    current.baseUrl = normalizeAiBaseUrl(provider, payload.baseUrl || current.baseUrl);
    current.model = String(payload.model || '').trim();
    if (payload.clearKey === true) {
        current.encryptedKey = '';
    } else if (String(payload.apiKey || '').trim()) {
        if (!AI_PROVIDER_DEFAULTS[provider].needsKey) {
            current.encryptedKey = '';
        } else {
            current.encryptedKey = await encryptAiSecret(String(payload.apiKey).trim());
        }
    }
    data.provider = provider;
    data.providers[provider] = current;
    await saveAiSettingsRaw(data);
    return publicAiSettings();
}

function aiEndpoint(baseUrl, suffix) {
    return `${String(baseUrl || '').replace(/\/+$/g, '')}/${String(suffix || '').replace(/^\/+/, '')}`;
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 180000, providerName = '') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        const raw = await response.text();
        let data = null;
        if (raw) {
            try { data = JSON.parse(raw); }
            catch (_) { data = { raw }; }
        }
        if (!response.ok) throw aiHttpError(providerName, response, data || {});
        return data || {};
    } catch (error) {
        if (error?.name === 'AbortError') {
            throw new Error(providerName === 'ollama' || providerName === 'lmstudio'
                ? `${aiProviderLabel(providerName)} ne répond pas dans le délai prévu. Vérifiez qu’il est bien lancé.`
                : `${aiProviderLabel(providerName)} ne répond pas dans le délai prévu. Vérifiez votre connexion Internet.`);
        }
        throw aiFriendlyNetworkError(providerName, error);
    } finally {
        clearTimeout(timer);
    }
}

async function aiProviderRuntime(providerName) {
    const provider = normalizeAiProvider(providerName);
    const data = await loadAiSettingsRaw();
    const saved = data.providers[provider] || { ...AI_PROVIDER_DEFAULTS[provider] };
    const baseUrl = normalizeAiBaseUrl(provider, saved.baseUrl || AI_PROVIDER_DEFAULTS[provider].baseUrl);
    const apiKey = AI_PROVIDER_DEFAULTS[provider].needsKey ? await decryptAiSecret(saved.encryptedKey || '') : '';
    if (AI_PROVIDER_DEFAULTS[provider].needsKey && !apiKey) {
        throw new Error('Aucune clé API n’est enregistrée pour ce fournisseur.');
    }
    return {
        provider,
        baseUrl,
        model: String(saved.model || '').trim(),
        apiKey
    };
}

async function listAiModels(providerName) {
    const runtime = await aiProviderRuntime(providerName);
    let data;
    if (runtime.provider === 'ollama') {
        data = await fetchJsonWithTimeout(aiEndpoint(runtime.baseUrl, 'api/tags'), {}, 60000, runtime.provider);
        const models = Array.isArray(data?.models) ? data.models.map((item) => String(item?.name || item?.model || '')).filter(Boolean) : [];
        return { provider: runtime.provider, models: [...new Set(models)].sort((a, b) => a.localeCompare(b)) };
    }

    const headers = { Accept: 'application/json' };
    if (runtime.provider === 'anthropic') {
        headers['x-api-key'] = runtime.apiKey;
        headers['anthropic-version'] = '2023-06-01';
    } else if (runtime.provider !== 'lmstudio') {
        headers.Authorization = `Bearer ${runtime.apiKey}`;
    }

    data = await fetchJsonWithTimeout(aiEndpoint(runtime.baseUrl, 'models'), { method: 'GET', headers }, 60000, runtime.provider);
    const list = Array.isArray(data?.data) ? data.data : (Array.isArray(data?.models) ? data.models : []);
    const models = list.map((item) => String(item?.id || item?.name || item?.model || '')).filter(Boolean);
    return { provider: runtime.provider, models: [...new Set(models)].sort((a, b) => a.localeCompare(b)) };
}

async function testAiConnection(providerName) {
    const result = await listAiModels(providerName);
    const count = Array.isArray(result?.models) ? result.models.length : 0;
    const provider = normalizeAiProvider(providerName);
    let message;
    if (provider === 'ollama') {
        message = count
            ? `Ollama répond correctement. ${count} modèle${count > 1 ? 's sont' : ' est'} installé${count > 1 ? 's' : ''}.`
            : 'Ollama répond correctement, mais aucun modèle n’est installé. Installez un modèle dans Ollama puis rechargez la liste.';
    } else if (provider === 'lmstudio') {
        message = count
            ? `Le serveur LM Studio répond. ${count} modèle${count > 1 ? 's sont' : ' est'} visible${count > 1 ? 's' : ''}.`
            : 'Le serveur LM Studio répond, mais aucun modèle n’est visible. Téléchargez/chargez un modèle dans LM Studio.';
    } else {
        message = count
            ? `${aiProviderLabel(provider)} accepte la clé. ${count} modèle${count > 1 ? 's sont' : ' est'} disponible${count > 1 ? 's' : ''}.`
            : `${aiProviderLabel(provider)} accepte la connexion, mais aucun modèle n’a été retourné.`;
    }
    return { provider, modelCount: count, message };
}

async function openAiProviderGuide(providerName) {
    const provider = normalizeAiProvider(providerName);
    const url = AI_PROVIDER_GUIDES[provider];
    if (!url) throw new Error('Aucun guide n’est défini pour ce fournisseur.');
    await shell.openExternal(url);
    return true;
}


function cleanAiContextText(value, maxChars = 180000) {
    const text = String(value || '').replace(/\u0000/g, '').trim();
    if (text.length <= maxChars) return { text, truncated: false };
    const keep = Math.max(1000, maxChars - 250);
    return {
        text: `${text.slice(0, keep)}\n\n[Contexte tronqué par Écrivain : le manuscrit dépasse la taille prévue pour une seule requête.]`,
        truncated: true
    };
}

function aiTaskInstruction(task, extraInstruction) {
    const tasks = {
        analyse: 'Analyse ce texte comme un éditeur littéraire professionnel. Signale les problèmes de fluidité, lourdeurs, répétitions, rythme, clarté et cohérence. Ne réécris pas tout le texte : formule des observations précises et cite seulement de courts passages quand c’est utile.',
        repetitions: 'Repère les répétitions lexicales, les formulations redondantes, les tics de style, les lourdeurs et les mots trop proches. Classe les remarques par importance et propose des pistes brèves sans dénaturer la voix de l’auteur.',
        coherence: 'Cherche les incohérences internes : chronologie, noms, genres, lieux, actions, informations connues par les personnages, continuité matérielle et contradictions. Distingue les incohérences certaines des simples points à vérifier.',
        resume: 'Résume fidèlement le texte fourni. Conserve les faits, personnages, lieux et relations importantes sans inventer d’éléments absents du texte.',
        reformulation: 'Propose une reformulation littéraire fluide du passage fourni en conservant strictement le sens, les faits, la chronologie et la voix générale. Ne supprime aucune information utile et n’invente rien.',
        libre: 'Réponds à la demande de l’auteur en t’appuyant uniquement sur le contexte fourni, sauf si la demande autorise explicitement une proposition créative.'
    };
    const extra = String(extraInstruction || '').trim();
    return extra ? `${tasks[task] || tasks.libre}\n\nConsigne complémentaire de l’auteur : ${extra}` : (tasks[task] || tasks.libre);
}

function aiSystemPrompt() {
    return [
        'Tu assistes un écrivain francophone dans le logiciel Écrivain.',
        'Travaille en français.',
        'Respecte les règles typographiques françaises, notamment les tirets cadratins pour les dialogues.',
        'Ne transforme jamais une hypothèse en certitude et n’invente pas de faits qui ne figurent pas dans le contexte.',
        'Préserve les noms propres, la chronologie, le genre des personnages et les détails matériels.',
        'Réponds de façon structurée, précise et directement exploitable par un auteur.'
    ].join(' ');
}

async function runAiRequest(payload = {}) {
    const runtime = await aiProviderRuntime(payload.provider);
    const requestedModel = String(payload.model || runtime.model || '').trim();
    if (!requestedModel) throw new Error('Aucun modèle IA n’est sélectionné.');

    const context = cleanAiContextText(payload?.context?.text || '');
    if (!context.text) throw new Error('Le contexte envoyé à l’IA est vide.');

    const userPrompt = [
        aiTaskInstruction(String(payload.task || 'libre'), payload.instruction),
        '',
        `Contexte : ${String(payload?.context?.title || 'texte fourni')}`,
        '',
        context.text
    ].join('\n');

    const messages = [
        { role: 'system', content: aiSystemPrompt() },
        { role: 'user', content: userPrompt }
    ];

    if (runtime.provider === 'ollama') {
        const data = await fetchJsonWithTimeout(aiEndpoint(runtime.baseUrl, 'api/chat'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: requestedModel, messages, stream: false })
        }, 180000, runtime.provider);
        const text = String(data?.message?.content || data?.response || '').trim();
        if (!text) throw new Error('Ollama a répondu sans texte exploitable.');
        return { text, truncated: context.truncated };
    }

    if (runtime.provider === 'anthropic') {
        const data = await fetchJsonWithTimeout(aiEndpoint(runtime.baseUrl, 'messages'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': runtime.apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: requestedModel,
                max_tokens: 4096,
                system: aiSystemPrompt(),
                messages: [{ role: 'user', content: userPrompt }]
            })
        }, 180000, runtime.provider);
        const text = Array.isArray(data?.content)
            ? data.content.filter((item) => item?.type === 'text').map((item) => item.text || '').join('\n').trim()
            : '';
        if (!text) throw new Error('Anthropic a répondu sans texte exploitable.');
        return { text, truncated: context.truncated };
    }

    if (runtime.provider === 'openai') {
        const data = await fetchJsonWithTimeout(aiEndpoint(runtime.baseUrl, 'responses'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${runtime.apiKey}`
            },
            body: JSON.stringify({
                model: requestedModel,
                instructions: aiSystemPrompt(),
                input: userPrompt,
                store: false
            })
        }, 180000, runtime.provider);
        const outputText = String(data?.output_text || '').trim();
        const parsedText = Array.isArray(data?.output)
            ? data.output.flatMap((item) => Array.isArray(item?.content) ? item.content : [])
                .filter((item) => item?.type === 'output_text')
                .map((item) => String(item?.text || ''))
                .join('\n')
                .trim()
            : '';
        const text = outputText || parsedText;
        if (!text) throw new Error('OpenAI a répondu sans texte exploitable.');
        return { text, truncated: context.truncated };
    }

    const headers = { 'Content-Type': 'application/json' };
    if (runtime.provider !== 'lmstudio') headers.Authorization = `Bearer ${runtime.apiKey}`;
    const data = await fetchJsonWithTimeout(aiEndpoint(runtime.baseUrl, 'chat/completions'), {
        method: 'POST',
        headers,
        body: JSON.stringify({
            model: requestedModel,
            messages
        })
    }, 180000, runtime.provider);
    const text = String(data?.choices?.[0]?.message?.content || '').trim();
    if (!text) throw new Error(`${aiProviderLabel(runtime.provider)} a répondu sans texte exploitable.`);
    return { text, truncated: context.truncated };
}

const DEFAULT_PREFERENCES = Object.freeze({
    startupBehavior: 'welcome',
    defaultProjectsDir: '',
    defaultAuthor: '',
    recentProjectsLimit: 5,
    autosaveDelayMs: 1800,
    uiZoom: 1,
    newProjectFont: 'Garamond',
    newProjectFontSizePt: 11,
    newProjectLineSpacingPt: 13,
    newProjectPageWidthCm: 12,
    newProjectPageHeightCm: 19,
    newProjectMarginMm: 15,
    newProjectParagraphIndentMm: 5
});

function preferencesFile() {
    return path.join(app.getPath('userData'), 'preferences.json');
}

function sanitizePreferences(input = {}) {
    const startupBehavior = input.startupBehavior === 'last-project' ? 'last-project' : 'welcome';
    const recentProjectsLimit = [3, 5].includes(Number(input.recentProjectsLimit)) ? Number(input.recentProjectsLimit) : 5;
    const autosaveDelayMs = [1000, 1800, 3000, 5000, 10000].includes(Number(input.autosaveDelayMs)) ? Number(input.autosaveDelayMs) : 1800;
    const uiZoomRaw = Number(input.uiZoom);
    const uiZoomClamped = Number.isFinite(uiZoomRaw) ? Math.min(1.5, Math.max(0.8, uiZoomRaw)) : 1;
    const uiZoom = Math.round(uiZoomClamped * 20) / 20;
    const num = (value, fallback, min, max) => {
        const n = Number(value);
        return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
    };
    return {
        startupBehavior,
        defaultProjectsDir: String(input.defaultProjectsDir || '').trim(),
        defaultAuthor: String(input.defaultAuthor || '').trim(),
        recentProjectsLimit,
        autosaveDelayMs,
        uiZoom,
        newProjectFont: String(input.newProjectFont || 'Garamond').trim() || 'Garamond',
        newProjectFontSizePt: num(input.newProjectFontSizePt, 11, 7, 30),
        newProjectLineSpacingPt: num(input.newProjectLineSpacingPt, 13, 8, 60),
        newProjectPageWidthCm: num(input.newProjectPageWidthCm, 12, 8, 40),
        newProjectPageHeightCm: num(input.newProjectPageHeightCm, 19, 8, 50),
        newProjectMarginMm: num(input.newProjectMarginMm, 15, 0, 50),
        newProjectParagraphIndentMm: num(input.newProjectParagraphIndentMm, 5, 0, 30)
    };
}

function loadPreferencesSync() {
    try {
        const file = preferencesFile();
        if (!fsSync.existsSync(file)) return { ...DEFAULT_PREFERENCES };
        const data = JSON.parse(fsSync.readFileSync(file, 'utf8'));
        return sanitizePreferences({ ...DEFAULT_PREFERENCES, ...(data || {}) });
    } catch (_) {
        return { ...DEFAULT_PREFERENCES };
    }
}

async function savePreferences(payload = {}) {
    const current = loadPreferencesSync();
    const prefs = sanitizePreferences({ ...current, ...(payload || {}) });
    await fs.mkdir(path.dirname(preferencesFile()), { recursive: true });
    await fs.writeFile(preferencesFile(), `${JSON.stringify(prefs, null, 2)}\n`, 'utf8');

    // Nettoyer la liste si l'utilisateur réduit le nombre de projets récents.
    saveRecentProjectsSync(loadRecentProjectsSync().slice(0, prefs.recentProjectsLimit));
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.setZoomFactor(prefs.uiZoom);
        emitWindowState();
    }
    if (app.isReady()) buildMenu();
    return preferencesState();
}

function preferencesState() {
    const preferences = loadPreferencesSync();
    const recentProjects = loadRecentProjectsSync();
    return {
        preferences,
        lastProject: recentProjects[0] || '',
        recentProjects,
        userDataDir: app.getPath('userData'),
        pluginsDir: pluginsRootDir()
    };
}

async function pickDefaultProjectsDirectory() {
    const prefs = loadPreferencesSync();
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Choisir le dossier par défaut des projets',
        defaultPath: prefs.defaultProjectsDir || undefined,
        properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
    return { canceled: false, path: result.filePaths[0] };
}

async function openApplicationDataFolder() {
    const error = await shell.openPath(app.getPath('userData'));
    if (error) throw new Error(error);
    return true;
}

async function applicationInfo() {
    let project = null;
    if (currentProjectDir && fsSync.existsSync(path.join(currentProjectDir, 'project.json'))) {
        try { project = await readJson(path.join(currentProjectDir, 'project.json')); } catch (_) {}
    }
    return {
        name: 'Écrivain',
        version: APP_VERSION,
        electron: process.versions.electron || '',
        chromium: process.versions.chrome || '',
        node: process.versions.node || '',
        platform: process.platform,
        arch: process.arch,
        projectFormat: `${PROJECT_FORMAT_ID} v${PROJECT_FORMAT_VERSION}`,
        schemaVersion: PROJECT_SCHEMA_VERSION,
        userDataDir: app.getPath('userData'),
        logDir: diagnosticDirectory(),
        pluginsDir: pluginsRootDir(),
        currentProjectDir: currentProjectDir || '',
        currentProject: project
    };
}

function recentProjectsFile() {
    return path.join(app.getPath('userData'), 'recent-projects.json');
}

function loadRecentProjectsSync() {
    try {
        const file = recentProjectsFile();
        if (!fsSync.existsSync(file)) return [];
        const raw = fsSync.readFileSync(file, 'utf8');
        const data = JSON.parse(raw);
        const items = Array.isArray(data) ? data : [];
        const unique = [];
        const seen = new Set();
        for (const value of items) {
            if (typeof value !== 'string' || !value.trim()) continue;
            const dir = path.resolve(value);
            const key = process.platform === 'win32' ? dir.toLowerCase() : dir;
            if (seen.has(key)) continue;
            if (!fsSync.existsSync(path.join(dir, 'project.json'))) continue;
            seen.add(key);
            unique.push(dir);
            if (unique.length >= Math.min(MAX_RECENT_PROJECTS, loadPreferencesSync().recentProjectsLimit)) break;
        }
        return unique;
    } catch (_) {
        return [];
    }
}

function saveRecentProjectsSync(items) {
    try {
        const file = recentProjectsFile();
        fsSync.mkdirSync(path.dirname(file), { recursive: true });
        fsSync.writeFileSync(file, `${JSON.stringify(items.slice(0, Math.min(MAX_RECENT_PROJECTS, loadPreferencesSync().recentProjectsLimit)), null, 2)}\n`, 'utf8');
    } catch (_) {
        // L'historique des projets récents ne doit jamais bloquer l'application.
    }
}

function recentProjectTitle(projectDir) {
    try {
        const projectFile = path.join(projectDir, 'project.json');
        const data = JSON.parse(fsSync.readFileSync(projectFile, 'utf8'));
        return String(data?.title || path.basename(projectDir)).trim() || path.basename(projectDir);
    } catch (_) {
        return path.basename(projectDir);
    }
}

function rememberRecentProject(projectDir) {
    if (!projectDir) return;
    const dir = path.resolve(projectDir);
    const key = process.platform === 'win32' ? dir.toLowerCase() : dir;
    const rest = loadRecentProjectsSync().filter((item) => {
        const itemKey = process.platform === 'win32' ? item.toLowerCase() : item;
        return itemKey !== key;
    });
    saveRecentProjectsSync([dir, ...rest]);
    if (app.isReady()) buildMenu();
}

function forgetRecentProject(projectDir) {
    if (!projectDir) return;
    const dir = path.resolve(projectDir);
    const key = process.platform === 'win32' ? dir.toLowerCase() : dir;
    saveRecentProjectsSync(loadRecentProjectsSync().filter((item) => {
        const itemKey = process.platform === 'win32' ? item.toLowerCase() : item;
        return itemKey !== key;
    }));
    if (app.isReady()) buildMenu();
}

function nowString() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function safeFolderName(value) {
    const cleaned = String(value || 'Nouveau projet')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
        .replace(/\.+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned || 'Nouveau projet';
}

async function readJson(filePath) {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
}

async function writeJson(filePath, data) {
    const tmp = `${filePath}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await fs.rename(tmp, filePath);
}

async function ensureProjectFolders(projectDir) {
    const dirs = [
        'chapters',
        path.join('chapters', 'autosave'),
        'notes',
        'assets',
        path.join('assets', 'notes'),
        path.join('assets', 'covers'),
        'exports',
        'styles',
        path.join('styles', 'pdf'),
        path.join('styles', 'epub'),
        'board',
        path.join('board', 'cards'),
        path.join('board', 'timeline'),
        path.join('board', 'timeline', 'events'),
        'stats',
        'backups',
        'history',
        'recovery',
        'extensions'
    ];

    await fs.mkdir(projectDir, { recursive: true });
    for (const dir of dirs) {
        await fs.mkdir(path.join(projectDir, dir), { recursive: true });
    }
}


function recoveryTimestamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function preserveForRecovery(projectDir, filePath, label = 'original') {
    const relative = path.relative(projectDir, filePath);
    const root = path.join(projectDir, 'recovery', recoveryTimestamp());
    const target = path.join(root, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    if (fsSync.existsSync(filePath)) await fs.copyFile(filePath, target);
    const noteFile = path.join(root, 'RECUPERATION.txt');
    const line = `${nowString()} — ${label} — ${relative}\n`;
    await fs.appendFile(noteFile, line, 'utf8').catch(() => {});
    return target;
}

async function readJsonResult(filePath) {
    try {
        return { ok: true, data: await readJson(filePath), error: null };
    } catch (error) {
        return { ok: false, data: null, error };
    }
}

async function backupDirectoriesNewestFirst(projectDir) {
    const root = path.join(projectDir, 'backups');
    if (!fsSync.existsSync(root)) return [];
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('backup-'))
        .map((entry) => path.join(root, entry.name))
        .sort((a, b) => path.basename(b).localeCompare(path.basename(a)));
}

async function findValidJsonInBackups(projectDir, relativePath) {
    const dirs = await backupDirectoriesNewestFirst(projectDir);
    for (const dir of dirs) {
        const candidate = path.join(dir, relativePath);
        if (!fsSync.existsSync(candidate)) continue;
        const result = await readJsonResult(candidate);
        if (result.ok) return { data: result.data, source: candidate };
    }
    return null;
}

async function findValidChapterRecovery(projectDir, chapterId) {
    const historyDir = path.join(projectDir, 'history', chapterId);
    if (fsSync.existsSync(historyDir)) {
        const files = (await fs.readdir(historyDir, { withFileTypes: true }))
            .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
            .map((entry) => entry.name)
            .sort((a, b) => b.localeCompare(a));
        for (const fileName of files) {
            const candidate = path.join(historyDir, fileName);
            const result = await readJsonResult(candidate);
            if (!result.ok || !result.data || typeof result.data !== 'object') continue;
            const data = { ...result.data };
            delete data._history;
            return { data, source: candidate, kind: 'historique' };
        }
    }

    const autosaveDir = path.join(projectDir, 'chapters', 'autosave');
    if (fsSync.existsSync(autosaveDir)) {
        const files = (await fs.readdir(autosaveDir, { withFileTypes: true }))
            .filter((entry) => entry.isFile() && entry.name.startsWith(`${chapterId}-`) && entry.name.toLowerCase().endsWith('.json'))
            .map((entry) => entry.name)
            .sort((a, b) => b.localeCompare(a));
        for (const fileName of files) {
            const candidate = path.join(autosaveDir, fileName);
            const result = await readJsonResult(candidate);
            if (result.ok && result.data && typeof result.data === 'object') {
                return { data: result.data, source: candidate, kind: 'autosauvegarde' };
            }
        }
    }

    const backup = await findValidJsonInBackups(projectDir, path.join('chapters', `${chapterId}.json`));
    if (backup) return { ...backup, kind: 'sauvegarde projet' };
    return null;
}

function normalizeProjectIdentity(project, projectDir) {
    if (!project || typeof project !== 'object' || Array.isArray(project)) {
        throw new Error('Le fichier project.json ne contient pas un objet valide.');
    }

    const currentFormat = String(project.format || '').trim();
    if (currentFormat && currentFormat !== PROJECT_FORMAT_ID) {
        throw new Error(`Format de projet non reconnu : ${currentFormat}.`);
    }

    const rawVersion = project.formatVersion;
    const version = rawVersion === undefined || rawVersion === null || rawVersion === '' ? 0 : Number(rawVersion);
    if (!Number.isFinite(version) || version < 0) {
        throw new Error('Version de format de projet invalide.');
    }
    if (version > PROJECT_FORMAT_VERSION) {
        throw new Error(`Ce projet utilise le format ${version}, plus récent que cette version d’Écrivain (format ${PROJECT_FORMAT_VERSION}).`);
    }

    const next = { ...project };
    let changed = false;
    const setIfDifferent = (key, value) => {
        if (next[key] !== value) {
            next[key] = value;
            changed = true;
        }
    };

    setIfDifferent('format', PROJECT_FORMAT_ID);
    setIfDifferent('formatVersion', PROJECT_FORMAT_VERSION);
    setIfDifferent('schemaVersion', PROJECT_SCHEMA_VERSION);
    setIfDifferent('appVersion', APP_VERSION);
    // Ancienne clé conservée dans les projets existants pour ne rien casser.
    setIfDifferent('moduleVersion', `ecrivain-${APP_VERSION}`);

    if (!String(next.title || '').trim()) {
        next.title = path.basename(projectDir) || 'Projet Écrivain';
        changed = true;
    }
    if (!String(next.language || '').trim()) {
        next.language = 'fr';
        changed = true;
    }
    if (!next.createdAt) {
        next.createdAt = nowString();
        changed = true;
    }
    if (changed) next.updatedAt = nowString();
    return { project: next, changed };
}

async function validateAuxiliaryJson(projectDir, relativePath, report) {
    const file = path.join(projectDir, relativePath);
    if (!fsSync.existsSync(file)) return;
    const result = await readJsonResult(file);
    if (result.ok) return;

    const preserved = await preserveForRecovery(projectDir, file, 'JSON illisible');
    report.preserved.push(path.relative(projectDir, preserved));
    const backup = await findValidJsonInBackups(projectDir, relativePath);
    if (backup) {
        await writeJson(file, backup.data);
        report.repaired.push(`${relativePath} restauré depuis une sauvegarde.`);
    } else {
        report.warnings.push(`${relativePath} est illisible et aucune copie valide n’a été trouvée.`);
    }
}

async function validateAndRepairProject(projectDir) {
    const report = {
        checkedAt: new Date().toISOString(),
        format: PROJECT_FORMAT_ID,
        formatVersion: PROJECT_FORMAT_VERSION,
        repaired: [],
        warnings: [],
        preserved: []
    };

    await fs.mkdir(projectDir, { recursive: true });
    await fs.mkdir(path.join(projectDir, 'recovery'), { recursive: true });

    const projectFile = path.join(projectDir, 'project.json');
    let projectResult = fsSync.existsSync(projectFile) ? await readJsonResult(projectFile) : { ok: false, error: new Error('project.json absent') };

    if (!projectResult.ok) {
        if (fsSync.existsSync(projectFile)) {
            const preserved = await preserveForRecovery(projectDir, projectFile, 'project.json illisible');
            report.preserved.push(path.relative(projectDir, preserved));
        }
        const backup = await findValidJsonInBackups(projectDir, 'project.json');
        if (!backup) {
            throw new Error('Impossible d’ouvrir le projet : project.json est absent ou illisible et aucune sauvegarde valide n’est disponible. Le fichier original, s’il existait, a été conservé dans recovery.');
        }
        await writeJson(projectFile, backup.data);
        projectResult = { ok: true, data: backup.data };
        report.repaired.push('project.json restauré depuis une sauvegarde du projet.');
    }

    const normalized = normalizeProjectIdentity(projectResult.data, projectDir);
    if (normalized.changed) {
        await writeJson(projectFile, normalized.project);
        report.repaired.push(`Projet migré vers le format Écrivain ${PROJECT_FORMAT_VERSION}.`);
    }
    const project = normalized.project;

    await ensureProjectFolders(projectDir);

    const synopsisFile = path.join(projectDir, 'synopsis.json');
    if (!fsSync.existsSync(synopsisFile)) {
        await writeJson(synopsisFile, defaultGlobalSynopsis(project));
        report.repaired.push('Synopsis global manquant recréé.');
    } else {
        const synopsisResult = await readJsonResult(synopsisFile);
        if (!synopsisResult.ok) {
            const preserved = await preserveForRecovery(projectDir, synopsisFile, 'synopsis.json illisible');
            report.preserved.push(path.relative(projectDir, preserved));
            const backup = await findValidJsonInBackups(projectDir, 'synopsis.json');
            if (backup) {
                await writeJson(synopsisFile, backup.data);
                report.repaired.push('Synopsis global restauré depuis une sauvegarde.');
            } else {
                await writeJson(synopsisFile, defaultGlobalSynopsis(project));
                report.repaired.push('Synopsis global illisible remplacé par un synopsis vierge. L’original a été conservé dans recovery.');
            }
        }
    }

    const mindmapFile = path.join(projectDir, 'mindmap.json');
    if (!fsSync.existsSync(mindmapFile)) {
        await writeJson(mindmapFile, { nodes: [], edges: [], updatedAt: nowString() });
        report.repaired.push('Carte mentale manquante recréée.');
    } else {
        const mindmapResult = await readJsonResult(mindmapFile);
        if (!mindmapResult.ok) {
            const preserved = await preserveForRecovery(projectDir, mindmapFile, 'mindmap.json illisible');
            report.preserved.push(path.relative(projectDir, preserved));
            const backup = await findValidJsonInBackups(projectDir, 'mindmap.json');
            if (backup) {
                await writeJson(mindmapFile, backup.data);
                report.repaired.push('Carte mentale restaurée depuis une sauvegarde.');
            } else {
                await writeJson(mindmapFile, { nodes: [], edges: [], updatedAt: nowString() });
                report.repaired.push('Carte mentale illisible réinitialisée. L’original a été conservé dans recovery.');
            }
        }
    }

    const chapterDir = path.join(projectDir, 'chapters');
    const chapterEntries = await fs.readdir(chapterDir, { withFileTypes: true });
    for (const entry of chapterEntries) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) continue;
        const file = path.join(chapterDir, entry.name);
        const result = await readJsonResult(file);
        if (result.ok) {
            const chapter = result.data;
            if (!chapter || typeof chapter !== 'object' || Array.isArray(chapter)) {
                report.warnings.push(`chapters/${entry.name} ne contient pas un chapitre valide.`);
                continue;
            }
            const stem = path.basename(entry.name, '.json');
            let changed = false;
            const normalizedChapter = { ...chapter };
            if (!normalizedChapter.id) { normalizedChapter.id = stem; changed = true; }
            if (normalizedChapter.title === undefined) { normalizedChapter.title = 'Sans titre'; changed = true; }
            if (normalizedChapter.parent === undefined) { normalizedChapter.parent = null; changed = true; }
            if (!Number.isFinite(Number(normalizedChapter.position))) { normalizedChapter.position = 1; changed = true; }
            if (!normalizedChapter.status) { normalizedChapter.status = 'draft'; changed = true; }
            if (normalizedChapter.content === undefined) { normalizedChapter.content = '<p></p>'; changed = true; }
            if (!normalizedChapter.createdAt) { normalizedChapter.createdAt = nowString(); changed = true; }
            if (!normalizedChapter.updatedAt) { normalizedChapter.updatedAt = normalizedChapter.createdAt; changed = true; }
            if (changed) {
                await writeJson(file, normalizedChapter);
                report.repaired.push(`chapters/${entry.name} complété avec les champs manquants.`);
            }
            if (String(normalizedChapter.id) !== stem) {
                report.warnings.push(`chapters/${entry.name} : l’identifiant interne (${normalizedChapter.id}) diffère du nom de fichier. Aucun renommage automatique n’a été effectué.`);
            }
            continue;
        }

        const preserved = await preserveForRecovery(projectDir, file, 'chapitre JSON illisible');
        report.preserved.push(path.relative(projectDir, preserved));
        const chapterId = path.basename(entry.name, '.json');
        const recovered = await findValidChapterRecovery(projectDir, chapterId);
        if (recovered) {
            const data = { ...recovered.data, id: recovered.data?.id || chapterId, updatedAt: nowString() };
            delete data._history;
            await writeJson(file, data);
            report.repaired.push(`chapters/${entry.name} restauré depuis ${recovered.kind}.`);
        } else {
            report.warnings.push(`chapters/${entry.name} est illisible. Aucune version récupérable n’a été trouvée ; l’original a été conservé dans recovery.`);
        }
    }

    // Contrôle des autres données JSON du projet. Si une sauvegarde complète
    // possède une copie valide, elle est restaurée automatiquement.
    await validateAuxiliaryJson(projectDir, path.join('board', 'timeline', 'characters.json'), report);
    const roots = ['notes', path.join('board', 'cards'), path.join('board', 'timeline', 'events'), 'stats'];
    for (const rootRel of roots) {
        const root = path.join(projectDir, rootRel);
        if (!fsSync.existsSync(root)) continue;
        const walk = async (dir) => {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) await walk(full);
                else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
                    const rel = path.relative(projectDir, full);
                    await validateAuxiliaryJson(projectDir, rel, report);
                }
            }
        };
        await walk(root);
    }

    const reportFile = path.join(projectDir, 'recovery', 'last-validation.json');
    await writeJson(reportFile, report);
    report.reportFile = reportFile;
    return report;
}

function validationReportDetail(report) {
    const lines = [
        `Format : ${report.format} v${report.formatVersion}`,
        `Réparations : ${report.repaired.length}`,
        `Avertissements : ${report.warnings.length}`
    ];
    if (report.repaired.length) {
        lines.push('', 'Réparations effectuées :');
        for (const item of report.repaired.slice(0, 10)) lines.push(`• ${item}`);
        if (report.repaired.length > 10) lines.push(`• … ${report.repaired.length - 10} autre(s)`);
    }
    if (report.warnings.length) {
        lines.push('', 'À vérifier :');
        for (const item of report.warnings.slice(0, 8)) lines.push(`• ${item}`);
        if (report.warnings.length > 8) lines.push(`• … ${report.warnings.length - 8} autre(s)`);
    }
    lines.push('', `Rapport : ${report.reportFile}`);
    return lines.join('\n');
}

async function showValidationReport(report, always = false) {
    if (!always && !report.repaired.length && !report.warnings.length) return;
    await dialog.showMessageBox(mainWindow, {
        type: report.warnings.length ? 'warning' : 'info',
        title: 'Vérification du projet',
        message: report.warnings.length
            ? 'Le projet a été ouvert, mais certains éléments demandent votre attention.'
            : (report.repaired.length ? 'Écrivain a vérifié et réparé le projet.' : 'Le projet est sain.'),
        detail: validationReportDetail(report),
        buttons: ['OK'],
        defaultId: 0,
        noLink: true
    });
}

function startBackgroundProjectValidation(projectDir) {
    // La vérification automatique est silencieuse : elle ne bloque pas l’ouverture
    // d’un projet sain et n’affiche une boîte de dialogue qu’en présence d’un
    // problème qui demande réellement l’attention de l’utilisateur.
    setTimeout(async () => {
        if (!projectDir || currentProjectDir !== projectDir) return;
        try {
            const report = await validateAndRepairProject(projectDir);
            if (currentProjectDir !== projectDir) return;

            // Si une réparation automatique a modifié des fichiers du projet,
            // renvoyer l’état rafraîchi à l’interface sans interrompre l’utilisateur.
            if (report.repaired.length && mainWindow && !mainWindow.isDestroyed()) {
                const refreshedState = await loadCurrentProject();
                mainWindow.webContents.send('project:background-validation', {
                    report,
                    state: refreshedState
                });
            }

            // Une réparation réussie reste silencieuse. Seuls les avertissements
            // non résolus déclenchent une fenêtre d’information.
            if (report.warnings.length) {
                await showValidationReport(report, false);
            }
        } catch (error) {
            if (currentProjectDir !== projectDir || !mainWindow || mainWindow.isDestroyed()) return;
            await dialog.showMessageBox(mainWindow, {
                type: 'warning',
                title: 'Vérification du projet',
                message: 'Écrivain n’a pas pu terminer la vérification automatique du projet.',
                detail: String(error?.message || error || 'Erreur inconnue'),
                buttons: ['OK'],
                defaultId: 0,
                noLink: true
            });
        }
    }, 250);
}

async function openProjectDirectory(dir) {
    currentProjectDir = path.resolve(dir);
    const projectDir = currentProjectDir;
    try {
        // Ouvrir d’abord le projet sans interrompre l’utilisateur. La vérification
        // complète se poursuit ensuite en tâche de fond.
        let state;
        try {
            state = await loadCurrentProject();
            if (!state) throw new Error('Projet incomplet ou illisible.');
        } catch (_initialError) {
            // Si l’ouverture immédiate est impossible, une réparation synchrone
            // est nécessaire pour rendre le projet à nouveau lisible.
            const report = await validateAndRepairProject(projectDir);
            if (report.warnings.length) await showValidationReport(report, false);
            state = await loadCurrentProject();
            if (!state) throw new Error('Impossible d’ouvrir le projet après la tentative de récupération.');
            rememberRecentProject(projectDir);
            return { state, report };
        }

        rememberRecentProject(projectDir);
        startBackgroundProjectValidation(projectDir);
        return { state, report: null };
    } catch (error) {
        if (currentProjectDir === projectDir) currentProjectDir = null;
        throw error;
    }
}

async function verifyCurrentProject() {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const report = await validateAndRepairProject(currentProjectDir);
    await showValidationReport(report, true);
    return { report, state: await loadCurrentProject() };
}

async function listChapters(projectDir) {
    const chapterDir = path.join(projectDir, 'chapters');
    await fs.mkdir(chapterDir, { recursive: true });
    const entries = await fs.readdir(chapterDir, { withFileTypes: true });
    const chapters = [];

    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) continue;
        try {
            const chapter = await readJson(path.join(chapterDir, entry.name));
            if (chapter && chapter.id) chapters.push(chapter);
        } catch (_) {
            // Un fichier illisible ne bloque pas l'ouverture du projet.
        }
    }

    chapters.sort((a, b) => {
        const pa = Number(a.position || 0);
        const pb = Number(b.position || 0);
        if (pa !== pb) return pa - pb;
        return String(a.title || '').localeCompare(String(b.title || ''), 'fr');
    });

    return chapters;
}

function flattenTree(chapters) {
    const byParent = new Map();
    for (const chapter of chapters) {
        const parent = chapter.parent || '__root__';
        if (!byParent.has(parent)) byParent.set(parent, []);
        byParent.get(parent).push(chapter);
    }

    for (const items of byParent.values()) {
        items.sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
    }

    const result = [];
    const seen = new Set();

    function walk(parent, depth) {
        const items = byParent.get(parent) || [];
        for (const chapter of items) {
            if (seen.has(chapter.id)) continue;
            seen.add(chapter.id);
            result.push({ ...chapter, _depth: depth });
            walk(chapter.id, depth + 1);
        }
    }

    walk('__root__', 0);

    // Récupère aussi d'éventuels chapitres orphelins.
    for (const chapter of chapters) {
        if (!seen.has(chapter.id)) result.push({ ...chapter, _depth: 0 });
    }

    return result;
}

async function loadCurrentProject() {
    if (!currentProjectDir) return null;
    const projectFile = path.join(currentProjectDir, 'project.json');
    if (!fsSync.existsSync(projectFile)) return null;

    const project = await readJson(projectFile);
    const chapters = flattenTree(await listChapters(currentProjectDir));
    return { projectDir: currentProjectDir, project, chapters };
}


function numericSetting(value, fallback, min, max) {
    const parsed = Number(String(value ?? '').replace(',', '.'));
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

async function updateProjectLayout(settings = {}) {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const projectFile = path.join(currentProjectDir, 'project.json');
    const project = await readJson(projectFile);

    // Les dimensions éditoriales sont stockées en unités physiques : cm et mm.
    // L'alignement du texte courant est volontairement fixé à « justifié ».
    project.textAlignment = 'justify';
    project.pageWidthCm = numericSetting(settings.pageWidthCm, Number(project.pageWidthCm || 12), 5, 50);
    project.pageHeightCm = numericSetting(settings.pageHeightCm, Number(project.pageHeightCm || 19), 5, 70);
    project.marginTopMm = numericSetting(settings.marginTopMm, Number(project.marginTopMm || 15), 0, 100);
    project.marginBottomMm = numericSetting(settings.marginBottomMm, Number(project.marginBottomMm || 15), 0, 100);
    project.marginLeftMm = numericSetting(settings.marginLeftMm, Number(project.marginLeftMm || 15), 0, 100);
    project.marginRightMm = numericSetting(settings.marginRightMm, Number(project.marginRightMm || 15), 0, 100);
    project.paragraphIndentMm = numericSetting(settings.paragraphIndentMm, Number(project.paragraphIndentMm ?? 5), 0, 30);
    project.paragraphSpacingBeforeMm = numericSetting(settings.paragraphSpacingBeforeMm, Number(project.paragraphSpacingBeforeMm || 0), 0, 30);
    project.paragraphSpacingAfterMm = numericSetting(settings.paragraphSpacingAfterMm, Number(project.paragraphSpacingAfterMm || 0), 0, 30);
    if (typeof settings.chapterPageBreak === 'boolean') project.chapterPageBreak = settings.chapterPageBreak;
    else if (project.chapterPageBreak === undefined) project.chapterPageBreak = true;

    // Typographie commune à tous les exports. On garde aussi les anciennes
    // clés pdfFont/pdfFontSize pour compatibilité avec les projets existants.
    project.exportFont = String(settings.exportFont ?? project.exportFont ?? 'Garamond').trim() || 'Garamond';
    project.exportFontSizePt = numericSetting(settings.exportFontSizePt, Number(project.exportFontSizePt || 11), 7, 30);
    project.lineSpacingPt = numericSetting(settings.lineSpacingPt, Number(project.lineSpacingPt || 13), 8, 60);
    project.pdfFont = project.exportFont;
    project.pdfFontSize = project.exportFontSizePt;
    // Ancienne clé conservée pour compatibilité avec les premiers prototypes.
    project.pdfLineHeight = project.lineSpacingPt / project.exportFontSizePt;

    // Compatibilité avec les anciennes clés du module / des premiers prototypes.
    project.paragraphIndentCm = project.paragraphIndentMm / 10;
    project.paragraphSpacingCm = project.paragraphSpacingAfterMm / 10;
    project.updatedAt = nowString();
    project.format = PROJECT_FORMAT_ID;
    project.formatVersion = PROJECT_FORMAT_VERSION;
    project.schemaVersion = PROJECT_SCHEMA_VERSION;
    project.appVersion = APP_VERSION;
    project.moduleVersion = `ecrivain-${APP_VERSION}`;

    await writeJson(projectFile, project);
    return project;
}

async function updateProjectInfo(metadata = {}) {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const file = path.join(currentProjectDir, 'project.json');
    const project = await readJson(file);
    project.title = String(metadata.title ?? project.title ?? '').trim() || 'Projet';
    project.subtitle = String(metadata.subtitle ?? project.subtitle ?? '').trim();
    project.author = String(metadata.author ?? project.author ?? '').trim();
    project.description = String(metadata.description ?? project.description ?? '').trim();
    project.language = String(metadata.language ?? project.language ?? 'fr').trim() || 'fr';
    project.updatedAt = nowString();
    project.appVersion = APP_VERSION;
    await writeJson(file, project);
    rememberRecentProject(currentProjectDir);
    return loadCurrentProject();
}

async function openCurrentProjectFolder() {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const error = await shell.openPath(currentProjectDir);
    if (error) throw new Error(error);
    return true;
}

async function createProject(parentDir, metadata) {
    const prefs = loadPreferencesSync();
    const title = String(metadata?.title || 'Nouveau projet').trim() || 'Nouveau projet';
    const author = String(metadata?.author ?? prefs.defaultAuthor ?? '').trim();
    const folder = safeFolderName(title);
    let projectDir = path.join(parentDir, folder);
    let suffix = 2;

    while (fsSync.existsSync(projectDir)) {
        projectDir = path.join(parentDir, `${folder} ${suffix}`);
        suffix += 1;
    }

    await ensureProjectFolders(projectDir);
    const stamp = nowString();
    const project = {
        id: safeFolderName(title).toLowerCase().replace(/\s+/g, '-'),
        title,
        subtitle: '',
        author,
        language: 'fr',
        description: '',
        cover: '',
        createdAt: stamp,
        updatedAt: stamp,
        format: PROJECT_FORMAT_ID,
        formatVersion: PROJECT_FORMAT_VERSION,
        schemaVersion: PROJECT_SCHEMA_VERSION,
        appVersion: APP_VERSION,
        moduleVersion: `ecrivain-${APP_VERSION}`,
        autosaveMinutes: 3,
        typographyProfile: 'fr-classique',
        pageFormat: '12x19',
        pdfCss: 'roman-classique.css',
        epubCss: 'epub-classique.css',
        exportOrder: 'tree',
        chapterTitleBehavior: 'h1',
        frontPage: true,
        numbering: true,
        exportFont: prefs.newProjectFont,
        exportFontSizePt: prefs.newProjectFontSizePt,
        pdfFont: prefs.newProjectFont,
        pdfFontSize: prefs.newProjectFontSizePt,
        lineSpacingPt: prefs.newProjectLineSpacingPt,
        pdfLineHeight: prefs.newProjectLineSpacingPt / prefs.newProjectFontSizePt,
        paragraphIndentCm: prefs.newProjectParagraphIndentMm / 10,
        paragraphSpacingCm: 0,
        textAlignment: 'justify',
        paragraphIndentMm: prefs.newProjectParagraphIndentMm,
        paragraphSpacingBeforeMm: 0,
        paragraphSpacingAfterMm: 0,
        chapterPageBreak: true,
        pageWidthCm: prefs.newProjectPageWidthCm,
        pageHeightCm: prefs.newProjectPageHeightCm,
        marginTopMm: prefs.newProjectMarginMm,
        marginBottomMm: prefs.newProjectMarginMm,
        marginLeftMm: prefs.newProjectMarginMm,
        marginRightMm: prefs.newProjectMarginMm,
        editorComfortFontSize: 16,
        editorComfortWidth: 820,
        editorComfortTheme: 'ivoire'
    };

    await writeJson(path.join(projectDir, 'project.json'), project);
    await writeJson(path.join(projectDir, 'synopsis.json'), defaultGlobalSynopsis(project));
    await writeJson(path.join(projectDir, 'mindmap.json'), { nodes: [], edges: [], updatedAt: stamp });
    currentProjectDir = projectDir;
    rememberRecentProject(projectDir);
    return loadCurrentProject();
}

async function nextChapterPosition(projectDir, parent = null) {
    const chapters = await listChapters(projectDir);
    const siblings = chapters.filter((ch) => (ch.parent || null) === (parent || null));
    return siblings.reduce((max, ch) => Math.max(max, Number(ch.position || 0)), 0) + 1;
}

function newChapterId() {
    const stamp = Date.now().toString(36);
    const rnd = Math.random().toString(36).slice(2, 7);
    return `ch-${stamp}-${rnd}`;
}

async function createChapter(title = 'Nouveau chapitre', parent = null) {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const id = newChapterId();
    const stamp = nowString();
    const chapter = {
        id,
        title: String(title || 'Nouveau chapitre').trim() || 'Nouveau chapitre',
        parent: parent || null,
        position: await nextChapterPosition(currentProjectDir, parent || null),
        status: 'draft',
        content: '<p></p>',
        wordCount: 0,
        createdAt: stamp,
        updatedAt: stamp
    };
    await writeJson(path.join(currentProjectDir, 'chapters', `${id}.json`), chapter);
    return chapter;
}

async function saveChapter(chapter, options = {}) {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    if (!chapter || !chapter.id) throw new Error('Chapitre invalide.');
    const existingPath = path.join(currentProjectDir, 'chapters', `${chapter.id}.json`);
    let existing = {};
    if (fsSync.existsSync(existingPath)) {
        try { existing = await readJson(existingPath); } catch (_) {}
    }

    // Historique éditorial : une version est conservée avant la réécriture.
    // Les sauvegardes manuelles créent toujours un jalon ; les autosauvegardes
    // créent au maximum un jalon toutes les dix minutes afin d'éviter des
    // centaines de versions quasi identiques.
    if (Object.keys(existing).length) {
        if (!options?.skipHistory) {
            try {
                await maybeCreateChapterHistory(existing, options?.mode === 'manual' ? 'manual' : 'autosave');
            } catch (_) {}
        }

        // Filet de sécurité court terme : les 20 derniers états techniques
        // restent disponibles dans chapters/autosave.
        try {
            const autosaveDir = path.join(currentProjectDir, 'chapters', 'autosave');
            await fs.mkdir(autosaveDir, { recursive: true });
            const changed = chapterComparable(existing) !== chapterComparable(chapter);
            if (changed) {
                const backupName = `${chapter.id}-${Date.now()}.json`;
                await writeJson(path.join(autosaveDir, backupName), existing);
                await trimChapterAutosaves(chapter.id, 20);
            }
        } catch (_) {}
    }

    const html = String(chapter.content || '<p></p>');
    const plain = html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    const wordCount = plain ? plain.split(' ').filter(Boolean).length : 0;

    const merged = {
        ...existing,
        ...chapter,
        parent: chapter.parent || null,
        position: Number(chapter.position || existing.position || 1),
        status: chapter.status || 'draft',
        content: html,
        wordCount,
        createdAt: existing.createdAt || chapter.createdAt || nowString(),
        updatedAt: nowString()
    };

    await writeJson(existingPath, merged);

    // Statistiques d’écriture : on enregistre uniquement les mots réellement
    // ajoutés depuis la sauvegarde précédente. Une baisse de mots n'est pas
    // retranchée de l'historique quotidien, comme dans le module Zwii.
    if (!options?.skipStats) {
        try {
            await recordWritingStats(merged, Number(existing.wordCount || 0));
        } catch (_) {
            // Une erreur de statistiques ne doit jamais empêcher la sauvegarde.
        }
    }

    return merged;
}

async function duplicateChapter(chapterId) {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const sourcePath = path.join(currentProjectDir, 'chapters', `${chapterId}.json`);
    const source = await readJson(sourcePath);
    const duplicate = await createChapter(`${source.title || 'Chapitre'} — Copie`, source.parent || null);
    duplicate.status = source.status || 'draft';
    duplicate.content = source.content || '<p></p>';
    duplicate.wordCount = Number(source.wordCount || 0);
    return saveChapter(duplicate);
}

async function collectDescendants(chapters, chapterId) {
    const ids = new Set([chapterId]);
    let changed = true;
    while (changed) {
        changed = false;
        for (const chapter of chapters) {
            if (chapter.parent && ids.has(chapter.parent) && !ids.has(chapter.id)) {
                ids.add(chapter.id);
                changed = true;
            }
        }
    }
    return [...ids];
}

async function deleteChapter(chapterId) {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const chapters = await listChapters(currentProjectDir);
    const ids = await collectDescendants(chapters, chapterId);

    // On mémorise les notes liées AVANT de supprimer les chapitres, sinon leur
    // lien serait normalisé en « livre entier » lors d'une lecture ultérieure.
    let linkedNoteIds = [];
    try {
        const notes = await listNotes();
        linkedNoteIds = notes.filter((note) => note.chapterId && ids.includes(note.chapterId)).map((note) => note.id);
    } catch (_) {}

    for (const id of ids) {
        const file = path.join(currentProjectDir, 'chapters', `${id}.json`);
        await fs.rm(file, { force: true });
    }

    // Comme dans le module Zwii, les notes explicitement liées à un chapitre
    // supprimé (ou à l'un de ses sous-chapitres) sont supprimées avec lui.
    // Les notes globales du livre ne sont jamais touchées.
    for (const noteId of linkedNoteIds) {
        try { await deleteNote(noteId); } catch (_) {}
    }
    return ids;
}

async function reorderChapters(orderedIds) {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const chapters = await listChapters(currentProjectDir);
    const map = new Map(chapters.map((ch) => [ch.id, ch]));
    const byParent = new Map();

    for (const id of orderedIds) {
        const ch = map.get(id);
        if (!ch) continue;
        const parent = ch.parent || '__root__';
        if (!byParent.has(parent)) byParent.set(parent, []);
        byParent.get(parent).push(ch);
    }

    for (const ch of chapters) {
        const parent = ch.parent || '__root__';
        if (!byParent.has(parent)) byParent.set(parent, []);
        if (!byParent.get(parent).some((item) => item.id === ch.id)) byParent.get(parent).push(ch);
    }

    for (const siblings of byParent.values()) {
        for (let i = 0; i < siblings.length; i += 1) {
            const ch = siblings[i];
            ch.position = i + 1;
            ch.updatedAt = nowString();
            await writeJson(path.join(currentProjectDir, 'chapters', `${ch.id}.json`), ch);
        }
    }

    return flattenTree(await listChapters(currentProjectDir));
}

async function changeChapterLevel(chapterId, direction) {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const chapters = await listChapters(currentProjectDir);
    const map = new Map(chapters.map((chapter) => [chapter.id, chapter]));
    const chapter = map.get(chapterId);
    if (!chapter) throw new Error('Chapitre introuvable.');

    const oldParent = chapter.parent || null;

    async function reindex(parentId) {
        const all = await listChapters(currentProjectDir);
        const siblings = all
            .filter((item) => (item.parent || null) === (parentId || null))
            .sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
        for (let index = 0; index < siblings.length; index += 1) {
            const item = { ...siblings[index], position: index + 1 };
            await writeJson(path.join(currentProjectDir, 'chapters', `${item.id}.json`), item);
        }
    }

    if (direction === 'right') {
        const siblings = chapters
            .filter((item) => (item.parent || null) === oldParent)
            .sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
        const index = siblings.findIndex((item) => item.id === chapterId);
        if (index <= 0) {
            throw new Error('Ce chapitre doit avoir un chapitre précédent au même niveau pour devenir son sous-chapitre.');
        }
        const newParent = siblings[index - 1];
        chapter.parent = newParent.id;
        chapter.position = await nextChapterPosition(currentProjectDir, newParent.id);
        chapter.updatedAt = nowString();
        await writeJson(path.join(currentProjectDir, 'chapters', `${chapter.id}.json`), chapter);
        await reindex(oldParent);
        await reindex(newParent.id);
        return flattenTree(await listChapters(currentProjectDir));
    }

    if (direction === 'left') {
        if (!oldParent || !map.has(oldParent)) {
            throw new Error('Ce chapitre est déjà un chapitre principal.');
        }
        const parent = map.get(oldParent);
        const newParent = parent.parent || null;
        const targetPosition = Number(parent.position || 0) + 1;

        // Libère la position juste après le parent au niveau supérieur.
        const upperSiblings = chapters
            .filter((item) => (item.parent || null) === newParent && item.id !== chapter.id)
            .sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
        for (const item of upperSiblings) {
            if (Number(item.position || 0) >= targetPosition) {
                item.position = Number(item.position || 0) + 1;
                await writeJson(path.join(currentProjectDir, 'chapters', `${item.id}.json`), item);
            }
        }

        chapter.parent = newParent;
        chapter.position = targetPosition;
        chapter.updatedAt = nowString();
        await writeJson(path.join(currentProjectDir, 'chapters', `${chapter.id}.json`), chapter);
        await reindex(oldParent);
        await reindex(newParent);
        return flattenTree(await listChapters(currentProjectDir));
    }

    throw new Error('Direction de hiérarchie inconnue.');
}

function decodeHtmlEntities(text) {
    return String(text || '')
        .replace(/&nbsp;/gi, '\u00A0')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&apos;/gi, "'");
}

function applyFrenchTypography(text) {
    let value = String(text || '');

    // Profil « fr-classique » utilisé par les exports. Le traitement reste
    // volontairement conservateur : il corrige les espaces typographiques
    // sans réécrire les dialogues ni transformer automatiquement les guillemets.
    value = value
        // Apostrophe typographique entre deux lettres : l'homme -> l’homme.
        .replace(/([A-Za-zÀ-ÖØ-öø-ÿŒœ])'([A-Za-zÀ-ÖØ-öø-ÿŒœ])/g, '$1’$2')
        // Points de suspension.
        .replace(/\.\.\.(?!\.)/g, '…')
        // Pas d'espace avant virgule ou point.
        .replace(/[ \t\u00A0\u202F]+([,.])/g, '$1')
        // Espace fine insécable avant ; ? !
        .replace(/[ \t\u00A0\u202F]*([;?!])/g, '\u202F$1')
        // Espace insécable avant deux-points, sauf protocoles/chemins du type ://.
        .replace(/([^\s:])?[ \t\u00A0\u202F]*:(?!\/)/g, (_m, before = '') => `${before}\u00A0:`)
        // Espaces insécables à l'intérieur des guillemets français.
        .replace(/«[ \t\u00A0\u202F]*/g, '«\u202F')
        .replace(/[ \t\u00A0\u202F]*»/g, '\u202F»');

    return value;
}

function markdownRuns(runs) {
    return (runs || []).map((run) => {
        let text = String(run.text || '')
            // Seuls les <br> explicites, représentés par \n dans un run,
            // deviennent des sauts de ligne Markdown.
            .replace(/\n/g, '  \n');
        if (run.underline) text = `<u>${text}</u>`;
        if (run.superscript) text = `<sup>${text}</sup>`;
        if (run.italic) text = `*${text}*`;
        if (run.bold) text = `**${text}**`;
        return text;
    }).join('');
}

function htmlToMarkdown(html) {
    const blocks = htmlToBlocks(html);
    const lines = [];
    let listType = null;
    let orderedIndex = 0;

    for (const block of blocks) {
        const text = markdownRuns(block.runs).trimEnd();

        if (block.type === 'list-item') {
            if (block.listType !== listType) orderedIndex = 0;
            listType = block.listType;
            if (block.listType === 'ol') {
                orderedIndex += 1;
                lines.push(`${orderedIndex}. ${text}`);
            } else {
                lines.push(`- ${text}`);
            }
            continue;
        }

        if (listType) {
            lines.push('');
            listType = null;
            orderedIndex = 0;
        }

        if (block.type === 'heading1') lines.push(`## ${text}`, '');
        else if (block.type === 'heading2') lines.push(`### ${text}`, '');
        else if (block.type === 'heading3') lines.push(`#### ${text}`, '');
        else if (block.type === 'quote') {
            lines.push(...text.split('\n').map((line) => `> ${line}`), '');
        } else {
            lines.push(text, '');
        }
    }

    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function exportMarkdown() {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const state = await loadCurrentProject();
    const project = state.project;
    const chapters = state.chapters;
    const lines = [];
    lines.push(`# ${project.title || 'Projet'}`);
    if (project.subtitle) lines.push(`\n*${project.subtitle}*`);
    if (project.author) lines.push(`\n**${project.author}**`);
    lines.push('');

    let chapterNo = 0;
    for (const chapter of chapters) {
        if ((chapter._depth || 0) === 0) chapterNo += 1;
        const level = Math.min(6, 2 + Number(chapter._depth || 0));
        const prefix = '#'.repeat(level);
        lines.push(`${prefix} ${chapter.title || 'Sans titre'}`);
        lines.push('');
        lines.push(htmlToMarkdown(chapter.content || ''));
        lines.push('');
    }

    const defaultName = `${safeFolderName(project.title || 'export')}.md`;
    const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Exporter en Markdown',
        defaultPath: path.join(currentProjectDir, 'exports', defaultName),
        filters: [{ name: 'Markdown', extensions: ['md'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    await fs.writeFile(result.filePath, `${lines.join('\n')}\n`, 'utf8');
    return { canceled: false, filePath: result.filePath };
}


function xmlEscape(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function htmlEscape(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function normalizeExportText(value) {
    // Les retours à la ligne présents dans le HTML source (indentation, formatage
    // interne de contenteditable, copier-coller) ne sont PAS des sauts de ligne
    // du manuscrit. Comme dans un navigateur, on réduit ces espaces blancs à un
    // simple espace. Seule une balise <br> créera ensuite un saut de ligne réel.
    const decoded = decodeHtmlEntities(String(value || ''))
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t\n\f\v]+/g, ' ');
    return applyFrenchTypography(decoded);
}

function htmlToBlocks(html) {
    const input = String(html || '<p></p>')
        .replace(/\r\n?/g, '\n')
        .replace(/<br\s*\/?>/gi, '<br>');
    const tokens = input.match(/<[^>]+>|[^<]+/g) || [];
    const blocks = [];
    let current = null;
    let listType = null;
    const styles = { bold: 0, italic: 0, underline: 0, superscript: 0 };

    function newBlock(type = 'paragraph') {
        if (current && current.runs.length) flush();
        current = { type, runs: [], listType: type === 'list-item' ? (listType || 'ul') : null };
    }

    function addText(text) {
        if (!current) current = { type: 'paragraph', runs: [], listType: null };
        let clean = normalizeExportText(text);
        if (!clean) return;

        // En HTML, les blancs ordinaires en début d'un élément de bloc ne sont
        // pas affichés. Les supprimer évite qu'une indentation du code source
        // devienne un espace parasite au début d'un paragraphe exporté.
        if (current.runs.length === 0) clean = clean.replace(/^ +/, '');
        if (!clean) return;

        const style = { bold: styles.bold > 0, italic: styles.italic > 0, underline: styles.underline > 0, superscript: styles.superscript > 0 };
        const last = current.runs[current.runs.length - 1];

        // Reproduit la fusion des espaces du navigateur à la frontière de deux
        // nœuds texte/éléments inline. Cela évite les doubles espaces quand une
        // phrase contient du gras ou de l'italique.
        if (last && / $/.test(last.text) && /^ /.test(clean)) clean = clean.replace(/^ +/, '');
        if (!clean) return;

        if (last && last.bold === style.bold && last.italic === style.italic && last.underline === style.underline && last.superscript === style.superscript) {
            last.text += clean;
        } else {
            current.runs.push({ text: clean, ...style });
        }
    }

    function addBreak() {
        if (!current) current = { type: 'paragraph', runs: [], listType: null };
        current.runs.push({ text: '\n', bold: false, italic: false, underline: false, superscript: false });
    }

    function flush(force = false) {
        if (!current) return;

        // Les espaces ordinaires de fin d'un bloc sont également ignorés par
        // le rendu HTML. On ne touche pas aux espaces insécables typographiques.
        for (let i = current.runs.length - 1; i >= 0; i -= 1) {
            const run = current.runs[i];
            if (run.text === '\n') break; // <br> explicite : on le conserve.
            run.text = run.text.replace(/ +$/, '');
            if (run.text.length > 0) break;
            current.runs.splice(i, 1);
        }

        const meaningful = current.runs.some((run) => run.text.replace(/[\s\u00A0\u202F]/g, '').length > 0);
        if (meaningful || force) blocks.push(current);
        current = null;
    }

    for (const token of tokens) {
        if (!token.startsWith('<')) {
            addText(token);
            continue;
        }
        const tag = token.toLowerCase();
        const closing = /^<\s*\//.test(tag);
        const nameMatch = tag.match(/^<\s*\/?\s*([a-z0-9]+)/);
        const name = nameMatch ? nameMatch[1] : '';

        if (!closing && ['p', 'div', 'h1', 'h2', 'h3', 'blockquote', 'li'].includes(name)) {
            const typeMap = { p: 'paragraph', div: 'paragraph', h1: 'heading1', h2: 'heading2', h3: 'heading3', blockquote: 'quote', li: 'list-item' };
            newBlock(typeMap[name]);
            continue;
        }
        if (closing && ['p', 'div', 'h1', 'h2', 'h3', 'blockquote', 'li'].includes(name)) {
            flush();
            continue;
        }
        if (!closing && name === 'ul') { listType = 'ul'; continue; }
        if (!closing && name === 'ol') { listType = 'ol'; continue; }
        if (closing && (name === 'ul' || name === 'ol')) { listType = null; continue; }
        if (!closing && name === 'br') { addBreak(); continue; }

        if (['strong', 'b'].includes(name)) styles.bold += closing ? -1 : 1;
        if (['em', 'i'].includes(name)) styles.italic += closing ? -1 : 1;
        if (name === 'u') styles.underline += closing ? -1 : 1;
        if (name === 'sup') styles.superscript += closing ? -1 : 1;
        styles.bold = Math.max(0, styles.bold);
        styles.italic = Math.max(0, styles.italic);
        styles.underline = Math.max(0, styles.underline);
        styles.superscript = Math.max(0, styles.superscript);
    }
    flush();
    return blocks.length ? blocks : [{ type: 'paragraph', runs: [] }];
}

function plainTextFromRuns(runs) {
    return (runs || []).map((run) => run.text).join('');
}

function renderRunsHtml(runs) {
    return (runs || []).map((run) => {
        const pieces = String(run.text || '').split('\n');
        let text = pieces.map(htmlEscape).join('<br>');
        if (run.underline) text = `<u>${text}</u>`;
        if (run.superscript) text = `<sup>${text}</sup>`;
        if (run.italic) text = `<em>${text}</em>`;
        if (run.bold) text = `<strong>${text}</strong>`;
        return text;
    }).join('');
}

function renderBlocksHtml(blocks) {
    const out = [];
    let openList = null;
    let orderedIndex = 0;
    function closeList() {
        if (openList) out.push(`</${openList}>`);
        openList = null;
        orderedIndex = 0;
    }
    for (const block of blocks) {
        if (block.type === 'list-item') {
            const wanted = block.listType === 'ol' ? 'ol' : 'ul';
            if (openList !== wanted) {
                closeList();
                out.push(`<${wanted}>`);
                openList = wanted;
            }
            orderedIndex += 1;
            out.push(`<li>${renderRunsHtml(block.runs)}</li>`);
            continue;
        }
        closeList();
        const body = renderRunsHtml(block.runs);
        if (block.type === 'heading1') out.push(`<h2>${body}</h2>`);
        else if (block.type === 'heading2') out.push(`<h3>${body}</h3>`);
        else if (block.type === 'heading3') out.push(`<h4>${body}</h4>`);
        else if (block.type === 'quote') out.push(`<blockquote><p>${body}</p></blockquote>`);
        else out.push(`<p>${body || '&nbsp;'}</p>`);
    }
    closeList();
    return out.join('\n');
}

function chapterExportTitle(project, chapter, chapterNo) {
    // Les titres de chapitres sont exportés tels qu'ils ont été saisis.
    // La numérotation de l'interface ne doit pas ajouter un chiffre devant le titre.
    return normalizeExportText(chapter.title || 'Sans titre');
}

function projectExportSettings(project) {
    return {
        widthCm: numericSetting(project.pageWidthCm, 12, 5, 50),
        heightCm: numericSetting(project.pageHeightCm, 19, 5, 70),
        topMm: numericSetting(project.marginTopMm, 15, 0, 100),
        bottomMm: numericSetting(project.marginBottomMm, 15, 0, 100),
        leftMm: numericSetting(project.marginLeftMm, 15, 0, 100),
        rightMm: numericSetting(project.marginRightMm, 15, 0, 100),
        indentMm: numericSetting(project.paragraphIndentMm, 5, 0, 30),
        beforeMm: numericSetting(project.paragraphSpacingBeforeMm, 0, 0, 30),
        afterMm: numericSetting(project.paragraphSpacingAfterMm, 0, 0, 30),
        font: String(project.exportFont || 'Garamond').trim() || 'Garamond',
        fontSizePt: numericSetting(project.exportFontSizePt, 11, 7, 30),
        lineSpacingPt: numericSetting(project.lineSpacingPt, 13, 8, 60),
        chapterPageBreak: project.chapterPageBreak !== false
    };
}

function cmToTwips(cm) { return Math.round(Number(cm) * 566.9291339); }
function mmToTwips(mm) { return Math.round(Number(mm) * 56.69291339); }
function mmToCm(mm) { return Number(mm) / 10; }

const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(buffer) {
    let crc = 0xFFFFFFFF;
    for (const byte of buffer) crc = CRC32_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    const time = ((date.getHours() & 0x1F) << 11) | ((date.getMinutes() & 0x3F) << 5) | ((Math.floor(date.getSeconds() / 2)) & 0x1F);
    const day = ((year - 1980) << 9) | (((date.getMonth() + 1) & 0x0F) << 5) | (date.getDate() & 0x1F);
    return { time, day };
}

function makeZip(entries) {
    const locals = [];
    const centrals = [];
    let offset = 0;
    const stamp = dosDateTime();
    for (const entry of entries) {
        const name = Buffer.from(String(entry.name).replace(/\\/g, '/'), 'utf8');
        const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8');
        const crc = crc32(data);
        const flags = 0x0800;
        const method = 0; // Stockage sans compression : simple, robuste et valide pour DOCX/ODT/EPUB.
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(flags, 6);
        local.writeUInt16LE(method, 8);
        local.writeUInt16LE(stamp.time, 10);
        local.writeUInt16LE(stamp.day, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(name.length, 26);
        local.writeUInt16LE(0, 28);
        locals.push(local, name, data);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(flags, 8);
        central.writeUInt16LE(method, 10);
        central.writeUInt16LE(stamp.time, 12);
        central.writeUInt16LE(stamp.day, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(data.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt16LE(0, 30);
        central.writeUInt16LE(0, 32);
        central.writeUInt16LE(0, 34);
        central.writeUInt16LE(0, 36);
        central.writeUInt32LE(0, 38);
        central.writeUInt32LE(offset, 42);
        centrals.push(central, name);
        offset += local.length + name.length + data.length;
    }
    const centralBuffer = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralBuffer.length, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20);
    return Buffer.concat([...locals, centralBuffer, end]);
}

function docxRunXml(run, settings) {
    const props = [
        `<w:rFonts w:ascii="${xmlEscape(settings.font)}" w:hAnsi="${xmlEscape(settings.font)}" w:cs="${xmlEscape(settings.font)}"/>`,
        `<w:sz w:val="${Math.round(settings.fontSizePt * 2)}"/>`,
        `<w:szCs w:val="${Math.round(settings.fontSizePt * 2)}"/>`,
        '<w:lang w:val="fr-FR"/>'
    ];
    if (run.bold) props.push('<w:b/>');
    if (run.italic) props.push('<w:i/>');
    if (run.underline) props.push('<w:u w:val="single"/>');
    if (run.superscript) props.push('<w:vertAlign w:val="superscript"/>');
    const rPr = `<w:rPr>${props.join('')}</w:rPr>`;
    return String(run.text || '').split('\n').map((part, index) => {
        const br = index > 0 ? '<w:br/>' : '';
        return `<w:r>${rPr}${br}<w:t xml:space="preserve">${xmlEscape(part)}</w:t></w:r>`;
    }).join('');
}

function docxParagraphXml(block, settings, options = {}) {
    let style = 'Normal';
    if (block.type === 'heading1') style = 'Heading2';
    if (block.type === 'heading2') style = 'Heading3';
    if (block.type === 'heading3') style = 'Heading4';
    if (block.type === 'quote') style = 'Quote';
    if (block.type === 'list-item') style = 'ListParagraph';
    if (options.chapterTitle) style = 'Heading1';

    const pPr = [`<w:pStyle w:val="${style}"/>`];
    if (options.pageBreakBefore) pPr.push('<w:pageBreakBefore/>');

    // Les propriétés essentielles sont écrites directement sur les paragraphes
    // du corps, en plus du style Normal. Word et LibreOffice ne peuvent donc
    // pas les remplacer par leurs propres styles par défaut.
    if (style === 'Normal') {
        pPr.push('<w:jc w:val="both"/>');
        pPr.push(`<w:ind w:firstLine="${mmToTwips(settings.indentMm)}"/>`);
        pPr.push(`<w:spacing w:before="${mmToTwips(settings.beforeMm)}" w:after="${mmToTwips(settings.afterMm)}" w:line="${Math.round(settings.lineSpacingPt * 20)}" w:lineRule="exact"/>`);
    } else if (style === 'Quote') {
        pPr.push('<w:jc w:val="both"/>');
        pPr.push(`<w:ind w:left="${mmToTwips(settings.indentMm)}" w:right="${mmToTwips(settings.indentMm)}" w:firstLine="0"/>`);
        pPr.push(`<w:spacing w:before="${mmToTwips(settings.beforeMm)}" w:after="${mmToTwips(settings.afterMm)}" w:line="${Math.round(settings.lineSpacingPt * 20)}" w:lineRule="exact"/>`);
    } else if (style === 'ListParagraph') {
        pPr.push('<w:jc w:val="both"/>');
        pPr.push(`<w:ind w:left="${mmToTwips(settings.indentMm)}" w:firstLine="0"/>`);
        pPr.push(`<w:spacing w:before="${mmToTwips(settings.beforeMm)}" w:after="${mmToTwips(settings.afterMm)}" w:line="${Math.round(settings.lineSpacingPt * 20)}" w:lineRule="exact"/>`);
    }

    const prefix = block.type === 'list-item' ? (block.listType === 'ol' ? `${options.listIndex || 1}. ` : '• ') : '';
    const prefixRun = prefix ? docxRunXml({ text: prefix }, settings) : '';
    const runs = prefixRun + (block.runs || []).map((run) => docxRunXml(run, settings)).join('');
    return `<w:p><w:pPr>${pPr.join('')}</w:pPr>${runs || docxRunXml({ text: '' }, settings)}</w:p>`;
}

function buildDocx(project, chapters) {
    const s = projectExportSettings(project);
    const pageW = cmToTwips(s.widthCm);
    const pageH = cmToTwips(s.heightCm);
    const marginTop = mmToTwips(s.topMm);
    const marginBottom = mmToTwips(s.bottomMm);
    const marginLeft = mmToTwips(s.leftMm);
    const marginRight = mmToTwips(s.rightMm);
    const indent = mmToTwips(s.indentMm);
    const before = mmToTwips(s.beforeMm);
    const after = mmToTwips(s.afterMm);
    const fontSize = Math.round(s.fontSizePt * 2);
    const line = Math.round(s.lineSpacingPt * 20);
    const font = xmlEscape(s.font);

    const body = [];
    if (project.frontPage !== false) {
        body.push(`<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>${docxRunXml({ text: normalizeExportText(project.title || 'Projet'), bold: true }, { ...s, fontSizePt: 18 })}</w:p>`);
        if (project.subtitle) body.push(`<w:p><w:pPr><w:pStyle w:val="Subtitle"/></w:pPr>${docxRunXml({ text: normalizeExportText(project.subtitle), italic: true }, { ...s, fontSizePt: 13 })}</w:p>`);
        if (project.author) body.push(`<w:p><w:pPr><w:pStyle w:val="Author"/></w:pPr>${docxRunXml({ text: normalizeExportText(project.author) }, s)}</w:p>`);
    }
    let rootNo = 0;
    for (let chapterIndex = 0; chapterIndex < chapters.length; chapterIndex += 1) {
        const chapter = chapters[chapterIndex];
        const root = Number(chapter._depth || 0) === 0;
        if (root) rootNo += 1;
        const title = chapterExportTitle(project, chapter, rootNo);
        const pageBreakBefore = s.chapterPageBreak && (chapterIndex > 0 || project.frontPage !== false);
        body.push(docxParagraphXml({ type: 'heading1', runs: [{ text: title, bold: true }] }, s, { chapterTitle: true, pageBreakBefore }));
        let listIndex = 0;
        for (const block of htmlToBlocks(chapter.content || '')) {
            if (block.type === 'list-item' && block.listType === 'ol') listIndex += 1;
            else if (block.type !== 'list-item') listIndex = 0;
            body.push(docxParagraphXml(block, s, { listIndex }));
        }
    }
    body.push(`<w:sectPr><w:pgSz w:w="${pageW}" w:h="${pageH}"/><w:pgMar w:top="${marginTop}" w:right="${marginRight}" w:bottom="${marginBottom}" w:left="${marginLeft}" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`);

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}</w:body></w:document>`;
    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults>
<w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/><w:sz w:val="${fontSize}"/><w:szCs w:val="${fontSize}"/><w:lang w:val="fr-FR"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:jc w:val="both"/><w:ind w:firstLine="${indent}"/><w:spacing w:before="${before}" w:after="${after}" w:line="${line}" w:lineRule="exact"/></w:pPr></w:pPrDefault>
</w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:jc w:val="both"/><w:ind w:firstLine="${indent}"/><w:spacing w:before="${before}" w:after="${after}" w:line="${line}" w:lineRule="exact"/></w:pPr><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/><w:sz w:val="${fontSize}"/><w:szCs w:val="${fontSize}"/><w:lang w:val="fr-FR"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Titre"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:ind w:firstLine="0"/><w:spacing w:before="0" w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Sous-titre"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:ind w:firstLine="0"/></w:pPr><w:rPr><w:i/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Author"><w:name w:val="Auteur"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:ind w:firstLine="0"/><w:spacing w:before="240" w:after="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Titre 1"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:ind w:firstLine="0"/><w:spacing w:before="0" w:after="240"/><w:keepNext/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="Titre 2"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="left"/><w:ind w:firstLine="0"/><w:spacing w:before="180" w:after="120"/><w:keepNext/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="Titre 3"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="left"/><w:ind w:firstLine="0"/><w:keepNext/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="Titre 4"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="left"/><w:ind w:firstLine="0"/><w:keepNext/></w:pPr><w:rPr><w:b/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Citation"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="both"/><w:ind w:left="${indent}" w:right="${indent}" w:firstLine="0"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="Liste"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="both"/><w:ind w:left="${indent}" w:firstLine="0"/></w:pPr></w:style>
</w:styles>`;
    const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(project.title || '')}</dc:title><dc:creator>${xmlEscape(project.author || '')}</dc:creator><dc:language>fr-FR</dc:language><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created></cp:coreProperties>`;
    return makeZip([
        { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
        { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
        { name: 'word/document.xml', data: documentXml },
        { name: 'word/styles.xml', data: stylesXml },
        // Ce lien manquait dans la version précédente : sans lui Word/LibreOffice
        // pouvaient ignorer styles.xml et utiliser leur propre Normal.
        { name: 'word/_rels/document.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
        { name: 'docProps/core.xml', data: coreXml }
    ]);
}

function odtSpanStyle(run) {
    const key = `${run.bold ? 'B' : ''}${run.italic ? 'I' : ''}${run.underline ? 'U' : ''}${run.superscript ? 'S' : ''}`;
    return key ? `T_${key}` : '';
}

function odtRunsXml(runs) {
    return (runs || []).map((run) => {
        const parts = String(run.text || '').split('\n');
        const content = parts.map((part, i) => `${i ? '<text:line-break/>' : ''}${xmlEscape(part)}`).join('');
        const style = odtSpanStyle(run);
        return style ? `<text:span text:style-name="${style}">${content}</text:span>` : content;
    }).join('');
}

function buildOdt(project, chapters) {
    const s = projectExportSettings(project);
    const fontFamily = String(s.font || 'Garamond').replace(/["']/g, '').trim() || 'Garamond';
    const fontFaceName = 'ManuscriptFont';
    const body = [];
    if (project.frontPage !== false) {
        body.push(`<text:p text:style-name="Title">${xmlEscape(normalizeExportText(project.title || 'Projet'))}</text:p>`);
        if (project.subtitle) body.push(`<text:p text:style-name="Subtitle">${xmlEscape(normalizeExportText(project.subtitle))}</text:p>`);
        if (project.author) body.push(`<text:p text:style-name="Author">${xmlEscape(normalizeExportText(project.author))}</text:p>`);
    }
    let rootNo = 0;
    for (const chapter of chapters) {
        const root = Number(chapter._depth || 0) === 0;
        if (root) rootNo += 1;
        const title = chapterExportTitle(project, chapter, rootNo);
        const chapterTitleStyle = root ? 'ChapterTitle' : 'SubchapterTitle';
        body.push(`<text:h text:style-name="${chapterTitleStyle}" text:outline-level="${Math.min(6, Number(chapter._depth || 0) + 1)}">${xmlEscape(title)}</text:h>`);
        let listCounter = 0;
        for (const block of htmlToBlocks(chapter.content || '')) {
            if (block.type === 'list-item') {
                listCounter += 1;
                const prefix = block.listType === 'ol' ? `${listCounter}. ` : '• ';
                body.push(`<text:p text:style-name="List">${xmlEscape(prefix)}${odtRunsXml(block.runs)}</text:p>`);
            } else {
                listCounter = 0;
                const style = block.type === 'quote' ? 'Quote' : block.type === 'heading1' ? 'Heading2' : block.type === 'heading2' ? 'Heading3' : block.type === 'heading3' ? 'Heading4' : 'Body';
                const tag = block.type.startsWith('heading') ? 'text:h' : 'text:p';
                const level = block.type === 'heading1' ? 2 : block.type === 'heading2' ? 3 : 4;
                const outline = tag === 'text:h' ? ` text:outline-level="${level}"` : '';
                body.push(`<${tag} text:style-name="${style}"${outline}>${odtRunsXml(block.runs)}</${tag}>`);
            }
        }
    }
    const textStyles = ['B','I','U','S','BI','BU','BS','IU','IS','US','BIU','BIS','BUS','IUS','BIUS'].map((key) => {
        const bold = key.includes('B') ? ' fo:font-weight="bold"' : '';
        const italic = key.includes('I') ? ' fo:font-style="italic"' : '';
        const underline = key.includes('U') ? ' style:text-underline-style="solid" style:text-underline-width="auto"' : '';
        const superscript = key.includes('S') ? ' style:text-position="super 58%"' : '';
        return `<style:style style:name="T_${key}" style:family="text"><style:text-properties style:font-name="${fontFaceName}" fo:font-family="${xmlEscape(fontFamily)}" fo:font-size="${s.fontSizePt}pt"${bold}${italic}${underline}${superscript}/></style:style>`;
    }).join('');
    const contentXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.3"><office:font-face-decls><style:font-face style:name="${fontFaceName}" svg:font-family="'${xmlEscape(fontFamily)}'" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"/></office:font-face-decls><office:automatic-styles>${textStyles}</office:automatic-styles><office:body><office:text>${body.join('')}</office:text></office:body></office:document-content>`;
    const bodyParagraph = `<style:paragraph-properties fo:text-align="justify" fo:text-indent="${mmToCm(s.indentMm)}cm" fo:margin-top="${mmToCm(s.beforeMm)}cm" fo:margin-bottom="${mmToCm(s.afterMm)}cm" fo:line-height="${s.lineSpacingPt}pt"/>`;
    const bodyText = `<style:text-properties style:font-name="${fontFaceName}" fo:font-family="${xmlEscape(fontFamily)}" fo:font-size="${s.fontSizePt}pt"/>`;
    const stylesXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" office:version="1.3">
<office:font-face-decls><style:font-face style:name="${fontFaceName}" svg:font-family="'${xmlEscape(fontFamily)}'"/></office:font-face-decls>
<office:styles>
<style:default-style style:family="paragraph">${bodyParagraph}${bodyText}</style:default-style>
<style:style style:name="Body" style:family="paragraph">${bodyParagraph}${bodyText}</style:style>
<style:style style:name="Title" style:family="paragraph"><style:paragraph-properties fo:text-align="center" fo:text-indent="0cm" fo:margin-bottom="0.5cm"/><style:text-properties style:font-name="${fontFaceName}" fo:font-family="${xmlEscape(fontFamily)}" fo:font-size="18pt" fo:font-weight="bold"/></style:style>
<style:style style:name="Subtitle" style:family="paragraph"><style:paragraph-properties fo:text-align="center" fo:text-indent="0cm"/><style:text-properties style:font-name="${fontFaceName}" fo:font-family="${xmlEscape(fontFamily)}" fo:font-size="13pt" fo:font-style="italic"/></style:style>
<style:style style:name="Author" style:family="paragraph"><style:paragraph-properties fo:text-align="center" fo:text-indent="0cm" fo:margin-top="0.5cm"/><style:text-properties style:font-name="${fontFaceName}" fo:font-family="${xmlEscape(fontFamily)}" fo:font-size="${s.fontSizePt}pt"/></style:style>
<style:style style:name="ChapterTitle" style:family="paragraph"><style:paragraph-properties${s.chapterPageBreak ? ' fo:break-before="page"' : ''} fo:text-align="center" fo:text-indent="0cm" fo:margin-bottom="0.5cm"/><style:text-properties style:font-name="${fontFaceName}" fo:font-family="${xmlEscape(fontFamily)}" fo:font-size="15pt" fo:font-weight="bold"/></style:style>
<style:style style:name="SubchapterTitle" style:family="paragraph"><style:paragraph-properties${s.chapterPageBreak ? ' fo:break-before="page"' : ''} fo:text-align="left" fo:text-indent="0cm" fo:margin-top="0.4cm" fo:margin-bottom="0.2cm"/><style:text-properties style:font-name="${fontFaceName}" fo:font-family="${xmlEscape(fontFamily)}" fo:font-size="13pt" fo:font-weight="bold"/></style:style>
<style:style style:name="Heading2" style:family="paragraph"><style:paragraph-properties fo:text-align="left" fo:text-indent="0cm" fo:margin-top="0.4cm" fo:margin-bottom="0.2cm"/><style:text-properties style:font-name="${fontFaceName}" fo:font-family="${xmlEscape(fontFamily)}" fo:font-size="13pt" fo:font-weight="bold"/></style:style>
<style:style style:name="Heading3" style:family="paragraph"><style:paragraph-properties fo:text-align="left" fo:text-indent="0cm"/><style:text-properties style:font-name="${fontFaceName}" fo:font-family="${xmlEscape(fontFamily)}" fo:font-size="${s.fontSizePt}pt" fo:font-weight="bold"/></style:style>
<style:style style:name="Heading4" style:family="paragraph"><style:paragraph-properties fo:text-align="left" fo:text-indent="0cm"/><style:text-properties style:font-name="${fontFaceName}" fo:font-family="${xmlEscape(fontFamily)}" fo:font-size="${s.fontSizePt}pt" fo:font-weight="bold"/></style:style>
<style:style style:name="Quote" style:family="paragraph"><style:paragraph-properties fo:text-align="justify" fo:margin-left="0.5cm" fo:margin-right="0.5cm" fo:text-indent="0cm" fo:margin-top="${mmToCm(s.beforeMm)}cm" fo:margin-bottom="${mmToCm(s.afterMm)}cm"/><style:text-properties style:font-name="${fontFaceName}" fo:font-family="${xmlEscape(fontFamily)}" fo:font-size="${s.fontSizePt}pt" fo:font-style="italic"/></style:style>
<style:style style:name="List" style:family="paragraph"><style:paragraph-properties fo:text-align="justify" fo:margin-left="0.5cm" fo:text-indent="0cm" fo:margin-top="${mmToCm(s.beforeMm)}cm" fo:margin-bottom="${mmToCm(s.afterMm)}cm"/><style:text-properties style:font-name="${fontFaceName}" fo:font-family="${xmlEscape(fontFamily)}" fo:font-size="${s.fontSizePt}pt"/></style:style>
</office:styles><office:automatic-styles><style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="${s.widthCm}cm" fo:page-height="${s.heightCm}cm" fo:margin-top="${mmToCm(s.topMm)}cm" fo:margin-bottom="${mmToCm(s.bottomMm)}cm" fo:margin-left="${mmToCm(s.leftMm)}cm" fo:margin-right="${mmToCm(s.rightMm)}cm" style:print-orientation="portrait"/></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1"/></office:master-styles></office:document-styles>`;
    const manifest = `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/></manifest:manifest>`;
    const meta = `<?xml version="1.0" encoding="UTF-8"?><office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" office:version="1.3"><office:meta><dc:title>${xmlEscape(project.title || '')}</dc:title><dc:creator>${xmlEscape(project.author || '')}</dc:creator><dc:language>fr-FR</dc:language><meta:creation-date>${new Date().toISOString()}</meta:creation-date></office:meta></office:document-meta>`;
    return makeZip([
        { name: 'mimetype', data: 'application/vnd.oasis.opendocument.text' },
        { name: 'META-INF/manifest.xml', data: manifest },
        { name: 'content.xml', data: contentXml },
        { name: 'styles.xml', data: stylesXml },
        { name: 'meta.xml', data: meta }
    ]);
}

function epubCss(project) {
    const s = projectExportSettings(project);
    return `@charset "UTF-8";
@page { margin: ${s.topMm}mm ${s.rightMm}mm ${s.bottomMm}mm ${s.leftMm}mm; }
html { -webkit-hyphens: auto; hyphens: auto; }
body { font-family: serif; font-size: 1em; line-height: ${(s.lineSpacingPt / s.fontSizePt).toFixed(3)}; text-align: justify; }
p { margin-top: ${s.beforeMm}mm; margin-bottom: ${s.afterMm}mm; text-indent: ${s.indentMm}mm; text-align: justify; }
h1,h2,h3,h4 { text-align: left; text-indent: 0; page-break-after: avoid; break-after: avoid; }
.chapter.root-chapter > h1 { text-align: center; }
h1 { font-size: 1.6em; margin: 0 0 1em 0; }
h2 { font-size: 1.35em; }
h3 { font-size: 1.2em; }
blockquote { margin: 0.5em 1.5em; font-style: italic; }
blockquote p, li { text-indent: 0; }
ul,ol { margin-top: 0; margin-bottom: 0; }
.title-page { text-align: center; margin-top: 30%; }
.title-page p { text-align: center; text-indent: 0; }
${s.chapterPageBreak ? 'section.chapter { break-before: page; page-break-before: always; }' : ''}
`;
}

function xhtmlDocument(title, body, lang = 'fr') {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${lang}" lang="${lang}"><head><meta charset="UTF-8"/><title>${xmlEscape(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body>${body}</body></html>`;
}

function buildEpub(project, chapters) {
    const entries = [{ name: 'mimetype', data: 'application/epub+zip' }];
    entries.push({ name: 'META-INF/container.xml', data: `<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>` });
    entries.push({ name: 'OEBPS/style.css', data: epubCss(project) });
    const manifest = [`<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`, `<item id="css" href="style.css" media-type="text/css"/>`];
    const spine = [];
    const navItems = [];
    if (project.frontPage !== false) {
        const titleBody = `<section class="title-page"><h1>${htmlEscape(normalizeExportText(project.title || 'Projet'))}</h1>${project.subtitle ? `<p><em>${htmlEscape(normalizeExportText(project.subtitle))}</em></p>` : ''}${project.author ? `<p>${htmlEscape(normalizeExportText(project.author))}</p>` : ''}</section>`;
        entries.push({ name: 'OEBPS/title.xhtml', data: xhtmlDocument(project.title || 'Projet', titleBody) });
        manifest.push(`<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>`);
        spine.push('<itemref idref="title"/>');
    }
    let rootNo = 0;
    chapters.forEach((chapter, index) => {
        const root = Number(chapter._depth || 0) === 0;
        if (root) rootNo += 1;
        const title = chapterExportTitle(project, chapter, rootNo);
        const file = `chapter-${String(index + 1).padStart(3, '0')}.xhtml`;
        const id = `ch${index + 1}`;
        const level = Math.min(4, Number(chapter._depth || 0) + 1);
        const body = `<section class="chapter ${root ? 'root-chapter' : 'subchapter'}"><h${level}>${htmlEscape(title)}</h${level}>${renderBlocksHtml(htmlToBlocks(chapter.content || ''))}</section>`;
        entries.push({ name: `OEBPS/${file}`, data: xhtmlDocument(title, body) });
        manifest.push(`<item id="${id}" href="${file}" media-type="application/xhtml+xml"/>`);
        spine.push(`<itemref idref="${id}"/>`);
        navItems.push(`<li><a href="${file}">${htmlEscape(title)}</a></li>`);
    });
    const nav = xhtmlDocument('Sommaire', `<nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><h1>Sommaire</h1><ol>${navItems.join('')}</ol></nav>`);
    entries.push({ name: 'OEBPS/nav.xhtml', data: nav });
    const identifier = `urn:ecrivain:${xmlEscape(project.id || safeFolderName(project.title || 'projet').toLowerCase())}:${Date.now()}`;
    const opf = `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">${identifier}</dc:identifier><dc:title>${xmlEscape(project.title || 'Projet')}</dc:title><dc:language>fr</dc:language>${project.author ? `<dc:creator>${xmlEscape(project.author)}</dc:creator>` : ''}<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}</meta></metadata><manifest>${manifest.join('')}</manifest><spine>${spine.join('')}</spine></package>`;
    entries.push({ name: 'OEBPS/content.opf', data: opf });
    return makeZip(entries);
}

function buildPrintHtml(project, chapters) {
    const s = projectExportSettings(project);
    const sections = [];
    if (project.frontPage !== false) {
        sections.push(`<section class="title-page"><h1>${htmlEscape(normalizeExportText(project.title || 'Projet'))}</h1>${project.subtitle ? `<p class="subtitle">${htmlEscape(normalizeExportText(project.subtitle))}</p>` : ''}${project.author ? `<p class="author">${htmlEscape(normalizeExportText(project.author))}</p>` : ''}</section>`);
    }
    let rootNo = 0;
    for (let chapterIndex = 0; chapterIndex < chapters.length; chapterIndex += 1) {
        const chapter = chapters[chapterIndex];
        const root = Number(chapter._depth || 0) === 0;
        if (root) rootNo += 1;
        const title = chapterExportTitle(project, chapter, rootNo);
        const level = Math.min(4, Number(chapter._depth || 0) + 1);
        sections.push(`<section class="chapter ${root ? 'root-chapter' : 'subchapter'} ${chapterIndex === 0 ? 'first-chapter' : ''}"><h${level}>${htmlEscape(title)}</h${level}>${renderBlocksHtml(htmlToBlocks(chapter.content || ''))}</section>`);
    }
    return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><style>
@page { size: ${s.widthCm}cm ${s.heightCm}cm; margin: ${s.topMm}mm ${s.rightMm}mm ${s.bottomMm}mm ${s.leftMm}mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: "${String(s.font).replace(/"/g, '')}", Garamond, Georgia, serif; font-size: ${s.fontSizePt}pt; line-height: ${s.lineSpacingPt}pt; color: #000; }
p { text-align: justify; text-indent: ${s.indentMm}mm; margin-top: ${s.beforeMm}mm; margin-bottom: ${s.afterMm}mm; orphans: 2; widows: 2; }
h1,h2,h3,h4 { text-align: left; text-indent: 0; break-after: avoid; page-break-after: avoid; }
.chapter.root-chapter > h1 { text-align: center; }
${s.chapterPageBreak ? `.chapter:not(.first-chapter) { break-before: page; page-break-before: always; }
${project.frontPage !== false ? '.chapter.first-chapter { break-before: page; page-break-before: always; }' : ''}` : ''}
.title-page { min-height: ${Math.max(1, s.heightCm - (s.topMm + s.bottomMm) / 10)}cm; display: flex; flex-direction: column; justify-content: center; text-align: center; break-after: page; page-break-after: always; }
.title-page h1 { font-size: 20pt; text-align: center; margin: 0 0 8mm 0; }
.title-page p { text-align: center; text-indent: 0; }
.subtitle { font-style: italic; }
blockquote { margin: 4mm 8mm; font-style: italic; }
blockquote p, li { text-indent: 0; }
ul,ol { margin-top: 0; margin-bottom: 0; }
</style></head><body>${sections.join('\n')}</body></html>`;
}

async function saveExportBuffer(kind, extension, title, buffer) {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const state = await loadCurrentProject();
    const defaultName = `${safeFolderName(state.project.title || 'export')}.${extension}`;
    const result = await dialog.showSaveDialog(mainWindow, {
        title,
        defaultPath: path.join(currentProjectDir, 'exports', defaultName),
        filters: [{ name: extension.toUpperCase(), extensions: [extension] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    await fs.writeFile(result.filePath, buffer);
    return { canceled: false, filePath: result.filePath };
}

async function exportDocx() {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const state = await loadCurrentProject();
    return saveExportBuffer('docx', 'docx', 'Exporter au format Word', buildDocx(state.project, state.chapters));
}

async function exportOdt() {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const state = await loadCurrentProject();
    return saveExportBuffer('odt', 'odt', 'Exporter au format OpenDocument', buildOdt(state.project, state.chapters));
}

async function exportEpub() {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const state = await loadCurrentProject();
    return saveExportBuffer('epub', 'epub', 'Exporter au format EPUB', buildEpub(state.project, state.chapters));
}

async function exportPdf() {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const state = await loadCurrentProject();
    const project = state.project;
    const s = projectExportSettings(project);
    const defaultName = `${safeFolderName(project.title || 'export')}.pdf`;
    const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Exporter au format PDF',
        defaultPath: path.join(currentProjectDir, 'exports', defaultName),
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };

    const tempFile = path.join(app.getPath('temp'), `ecrivain-export-${process.pid}-${Date.now()}.html`);
    const pdfWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } });
    try {
        await fs.writeFile(tempFile, buildPrintHtml(project, state.chapters), 'utf8');
        await pdfWindow.loadFile(tempFile);
        try { await pdfWindow.webContents.executeJavaScript('document.fonts ? document.fonts.ready.then(() => true) : true'); } catch (_) {}
        const pdf = await pdfWindow.webContents.printToPDF({
            printBackground: true,
            preferCSSPageSize: true,
            pageSize: { width: Math.round(s.widthCm * 10000), height: Math.round(s.heightCm * 10000) }
        });
        await fs.writeFile(result.filePath, pdf);
        return { canceled: false, filePath: result.filePath };
    } finally {
        if (!pdfWindow.isDestroyed()) pdfWindow.destroy();
        await fs.rm(tempFile, { force: true }).catch(() => {});
    }
}


const SYNOPSIS_TYPES = {
    scene: 'Scène',
    personnage: 'Personnage',
    lieu: 'Lieu',
    idee: 'Idée',
    documentation: 'Documentation'
};
const SYNOPSIS_STATUSES = {
    'a-ecrire': 'À écrire',
    'en-cours': 'En cours',
    integre: 'Intégré',
    coupe: 'Coupé'
};
const SYNOPSIS_COLORS = {
    ivoire: 'Ivoire',
    sable: 'Sable',
    rose: 'Rose poudré',
    bleu: 'Bleu grisé',
    vert: 'Vert sauge',
    ardoise: 'Ardoise'
};


function defaultGlobalSynopsis(project = {}) {
    const stamp = nowString();
    return {
        version: 1,
        title: String(project?.title || '').trim(),
        pitch: '',
        synopsis: '',
        structureNotes: '',
        createdAt: stamp,
        updatedAt: stamp
    };
}

function normalizeGlobalSynopsis(data = {}, project = {}) {
    const fallback = defaultGlobalSynopsis(project);
    const text = (value) => String(value ?? '').replace(/\r\n?/g, '\n');
    return {
        version: 1,
        title: text(data.title || fallback.title).trim(),
        pitch: text(data.pitch),
        synopsis: text(data.synopsis),
        structureNotes: text(data.structureNotes),
        createdAt: String(data.createdAt || fallback.createdAt),
        updatedAt: String(data.updatedAt || fallback.updatedAt)
    };
}

async function globalSynopsisState() {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const project = await readJson(path.join(currentProjectDir, 'project.json'));
    const file = path.join(currentProjectDir, 'synopsis.json');
    if (!fsSync.existsSync(file)) {
        const fresh = defaultGlobalSynopsis(project);
        await writeJson(file, fresh);
        return fresh;
    }
    try {
        const raw = await readJson(file);
        return normalizeGlobalSynopsis(raw, project);
    } catch (error) {
        throw new Error(`Le synopsis global est illisible : ${error.message}`);
    }
}

async function saveGlobalSynopsis(data = {}) {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const project = await readJson(path.join(currentProjectDir, 'project.json'));
    const file = path.join(currentProjectDir, 'synopsis.json');
    let previous = {};
    if (fsSync.existsSync(file)) {
        try { previous = await readJson(file); } catch (_) {}
    }
    const normalized = normalizeGlobalSynopsis({
        ...previous,
        ...data,
        createdAt: previous.createdAt || data.createdAt || nowString(),
        updatedAt: nowString()
    }, project);
    await writeJson(file, normalized);
    return normalized;
}

function normalizeSynopsisValue(value) {
    return String(value ?? '').replace(/\r\n?/g, '\n').trim();
}

function normalizeSynopsisCard(card = {}) {
    const type = Object.hasOwn(SYNOPSIS_TYPES, card.type) ? card.type : 'scene';
    const status = Object.hasOwn(SYNOPSIS_STATUSES, card.status) ? card.status : 'a-ecrire';
    const color = Object.hasOwn(SYNOPSIS_COLORS, card.color) ? card.color : 'ivoire';
    return {
        id: String(card.id || ''),
        title: normalizeSynopsisValue(card.title) || 'Nouvelle fiche',
        summary: normalizeSynopsisValue(card.summary),
        ideas: normalizeSynopsisValue(card.ideas),
        notes: normalizeSynopsisValue(card.notes),
        role: normalizeSynopsisValue(card.role),
        traits: normalizeSynopsisValue(card.traits),
        objective: normalizeSynopsisValue(card.objective),
        links: normalizeSynopsisValue(card.links),
        ambiance: normalizeSynopsisValue(card.ambiance),
        characters: normalizeSynopsisValue(card.characters),
        tension: normalizeSynopsisValue(card.tension),
        type,
        status,
        chapterId: String(card.chapterId || ''),
        color,
        position: Math.max(1, Number(card.position || 1)),
        createdAt: String(card.createdAt || nowString()),
        updatedAt: String(card.updatedAt || nowString())
    };
}

function newSynopsisCardId() {
    const stamp = Date.now().toString(36);
    const rnd = Math.random().toString(36).slice(2, 8);
    return `sc-${stamp}-${rnd}`;
}

async function listSynopsisCards() {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const dir = path.join(currentProjectDir, 'board', 'cards');
    await fs.mkdir(dir, { recursive: true });
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const cards = [];
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) continue;
        try {
            const raw = await readJson(path.join(dir, entry.name));
            if (!raw || !raw.id) continue;
            cards.push(normalizeSynopsisCard(raw));
        } catch (_) {
            // Une fiche illisible n'empêche pas l'ouverture du synoptique.
        }
    }
    cards.sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
    return cards;
}

async function synopsisState() {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    return {
        cards: await listSynopsisCards(),
        types: SYNOPSIS_TYPES,
        statuses: SYNOPSIS_STATUSES,
        colors: SYNOPSIS_COLORS
    };
}

async function saveSynopsisCard(data = {}) {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const dir = path.join(currentProjectDir, 'board', 'cards');
    await fs.mkdir(dir, { recursive: true });
    const cards = await listSynopsisCards();
    const requestedId = String(data.id || '');
    const existing = requestedId ? cards.find((card) => card.id === requestedId) : null;
    const stamp = nowString();
    const card = normalizeSynopsisCard({
        ...(existing || {}),
        ...data,
        id: existing?.id || newSynopsisCardId(),
        position: existing?.position || (cards.reduce((max, item) => Math.max(max, Number(item.position || 0)), 0) + 1),
        createdAt: existing?.createdAt || stamp,
        updatedAt: stamp
    });

    // Une liaison de chapitre obsolète est simplement retirée.
    if (card.chapterId) {
        const chapters = await listChapters(currentProjectDir);
        if (!chapters.some((chapter) => chapter.id === card.chapterId)) card.chapterId = '';
    }

    await writeJson(path.join(dir, `${card.id}.json`), card);
    return card;
}

async function deleteSynopsisCard(cardId) {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const id = String(cardId || '');
    if (!/^sc-[a-z0-9-]+$/i.test(id)) throw new Error('Identifiant de fiche invalide.');
    await fs.rm(path.join(currentProjectDir, 'board', 'cards', `${id}.json`), { force: true });
    const cards = await listSynopsisCards();
    let position = 1;
    for (const card of cards) {
        card.position = position++;
        card.updatedAt = nowString();
        await writeJson(path.join(currentProjectDir, 'board', 'cards', `${card.id}.json`), card);
    }
    return listSynopsisCards();
}

async function reorderSynopsisCards(ids = []) {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const cards = await listSynopsisCards();
    const map = new Map(cards.map((card) => [card.id, card]));
    const ordered = [];
    for (const id of ids) {
        if (map.has(id)) {
            ordered.push(map.get(id));
            map.delete(id);
        }
    }
    for (const card of cards) if (map.has(card.id)) ordered.push(card);
    let position = 1;
    for (const card of ordered) {
        card.position = position++;
        card.updatedAt = nowString();
        await writeJson(path.join(currentProjectDir, 'board', 'cards', `${card.id}.json`), card);
    }
    return listSynopsisCards();
}


const NOTE_CATEGORIES = {
    idee: 'Idée',
    documentation: 'Documentation',
    rappel: 'Rappel',
    'scene-coupee': 'Scène coupée',
    image: 'Image',
    pdf: 'PDF',
    libre: 'Libre'
};

// Couleurs reprises du module Zwii / mindmap.
const NOTE_COLORS = {
    none: { label: 'Aucune', bg: '#ffffff', border: '#d8d2ca', text: '#3d3833' },
    personnage: { label: 'Personnage', bg: '#dbeafe', border: '#3b82f6', text: '#1e3a5f' },
    lieu: { label: 'Lieu', bg: '#dcfce7', border: '#22c55e', text: '#14532d' },
    intrigue: { label: 'Intrigue / Arc', bg: '#f3e8ff', border: '#a855f7', text: '#581c87' },
    chapitre: { label: 'Chapitre', bg: '#fef3c7', border: '#f59e0b', text: '#78350f' },
    idee: { label: 'Idée', bg: '#fce7f3', border: '#ec4899', text: '#831843' },
    objet: { label: 'Objet', bg: '#e2e8f0', border: '#64748b', text: '#1e293b' }
};

const NOTE_ALLOWED_EXTENSIONS = new Set(['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'txt', 'md', 'doc', 'docx', 'odt', 'rtf', 'zip']);

function newNoteId() {
    const stamp = Date.now().toString(36);
    const rnd = Math.random().toString(36).slice(2, 8);
    return `nt-${stamp}-${rnd}`;
}

function normalizeNoteId(value) {
    const id = String(value || '').trim();
    return /^nt-[a-z0-9-]+$/i.test(id) ? id : '';
}

function normalizeNote(note = {}) {
    const type = note.type === 'file' ? 'file' : 'text';
    const category = Object.hasOwn(NOTE_CATEGORIES, note.category) ? note.category : 'libre';
    const color = Object.hasOwn(NOTE_COLORS, note.color) ? note.color : 'none';
    return {
        id: String(note.id || ''),
        chapterId: String(note.chapterId || ''),
        title: String(note.title || (type === 'file' ? 'Fichier' : 'Note')).trim() || (type === 'file' ? 'Fichier' : 'Note'),
        category,
        color,
        type,
        format: type === 'text' ? 'html' : undefined,
        content: type === 'text' ? String(note.content || '<p></p>') : undefined,
        path: type === 'file' ? String(note.path || '') : undefined,
        mime: type === 'file' ? String(note.mime || 'application/octet-stream') : undefined,
        size: type === 'file' ? Number(note.size || 0) : undefined,
        originalName: type === 'file' ? String(note.originalName || 'Document') : undefined,
        export: false,
        createdAt: String(note.createdAt || nowString()),
        updatedAt: String(note.updatedAt || note.createdAt || nowString())
    };
}

async function validateNoteChapterId(chapterId) {
    const id = String(chapterId || '');
    if (!id) return '';
    const chapters = await listChapters(currentProjectDir);
    return chapters.some((chapter) => chapter.id === id) ? id : '';
}

async function listNotes() {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const dir = path.join(currentProjectDir, 'notes');
    await fs.mkdir(dir, { recursive: true });
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const notes = [];
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) continue;
        try {
            const raw = await readJson(path.join(dir, entry.name));
            if (!raw || !raw.id) continue;
            const note = normalizeNote(raw);
            const id = normalizeNoteId(note.id);
            if (!id) continue;
            note.id = id;
            note.chapterId = await validateNoteChapterId(note.chapterId);
            notes.push(note);
        } catch (_) {
            // Une note illisible ne doit pas bloquer le projet.
        }
    }
    notes.sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
    return notes;
}

async function notesState() {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    return {
        notes: await listNotes(),
        categories: NOTE_CATEGORIES,
        colors: NOTE_COLORS
    };
}

async function getNote(noteId) {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const id = normalizeNoteId(noteId);
    if (!id) throw new Error('Identifiant de note invalide.');
    const file = path.join(currentProjectDir, 'notes', `${id}.json`);
    if (!fsSync.existsSync(file)) throw new Error('Note introuvable.');
    const note = normalizeNote(await readJson(file));
    note.id = id;
    note.chapterId = await validateNoteChapterId(note.chapterId);
    return note;
}

async function saveTextNote(data = {}) {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const requestedId = normalizeNoteId(data.id);
    let existing = null;
    if (requestedId) {
        existing = await getNote(requestedId);
        if (existing.type !== 'text') throw new Error('Cette note n’est pas une note texte.');
    }
    const stamp = nowString();
    const note = normalizeNote({
        ...(existing || {}),
        ...data,
        id: existing?.id || newNoteId(),
        type: 'text',
        format: 'html',
        chapterId: await validateNoteChapterId(data.chapterId),
        title: String(data.title || '').trim() || 'Note',
        content: String(data.content || '<p></p>'),
        createdAt: existing?.createdAt || stamp,
        updatedAt: stamp,
        export: false
    });
    await writeJson(path.join(currentProjectDir, 'notes', `${note.id}.json`), note);
    return note;
}

function attachmentExtension(filePath) {
    return path.extname(String(filePath || '')).slice(1).toLowerCase();
}

function safeAttachmentBase(name) {
    const ext = path.extname(name);
    const base = path.basename(name, ext);
    const clean = base
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9._ -]+/g, '-')
        .replace(/\s+/g, ' ')
        .trim() || 'document';
    return `${clean}${ext.toLowerCase()}`;
}

async function pickNoteAttachment() {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Choisir un fichier pour la note',
        properties: ['openFile'],
        filters: [
            { name: 'Documents et images', extensions: Array.from(NOTE_ALLOWED_EXTENSIONS) },
            { name: 'Tous les fichiers', extensions: ['*'] }
        ]
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const sourcePath = result.filePaths[0];
    const ext = attachmentExtension(sourcePath);
    if (!NOTE_ALLOWED_EXTENSIONS.has(ext)) throw new Error('Ce type de fichier n’est pas autorisé dans les notes.');
    const stat = await fs.stat(sourcePath);
    return {
        canceled: false,
        sourcePath,
        originalName: path.basename(sourcePath),
        size: stat.size
    };
}

async function copyNoteAttachment(sourcePath, noteId) {
    const ext = attachmentExtension(sourcePath);
    if (!NOTE_ALLOWED_EXTENSIONS.has(ext)) throw new Error('Ce type de fichier n’est pas autorisé dans les notes.');
    if (!fsSync.existsSync(sourcePath)) throw new Error('Le fichier choisi est introuvable.');
    const originalName = path.basename(sourcePath);
    const safeName = safeAttachmentBase(originalName);
    const storedName = `${noteId}__${safeName}`;
    const targetDir = path.join(currentProjectDir, 'assets', 'notes');
    await fs.mkdir(targetDir, { recursive: true });
    const target = path.join(targetDir, storedName);
    await fs.copyFile(sourcePath, target);
    const stat = await fs.stat(target);
    return {
        path: path.posix.join('assets', 'notes', storedName),
        originalName,
        size: stat.size,
        mime: 'application/octet-stream'
    };
}

async function saveFileNote(data = {}) {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const requestedId = normalizeNoteId(data.id);
    let existing = null;
    if (requestedId) {
        existing = await getNote(requestedId);
        if (existing.type !== 'file') throw new Error('Cette note n’est pas une note fichier.');
    }
    const noteId = existing?.id || newNoteId();
    const stamp = nowString();
    let attachment = existing ? {
        path: existing.path,
        mime: existing.mime,
        size: existing.size,
        originalName: existing.originalName
    } : null;
    let oldAbsolute = '';

    const sourcePath = String(data.sourcePath || '');
    if (sourcePath) {
        if (existing?.path) oldAbsolute = path.join(currentProjectDir, ...String(existing.path).split('/'));
        attachment = await copyNoteAttachment(sourcePath, noteId);
    }
    if (!attachment || !attachment.path) throw new Error('Choisissez un fichier pour cette note.');

    const note = normalizeNote({
        ...(existing || {}),
        ...data,
        ...attachment,
        id: noteId,
        type: 'file',
        chapterId: await validateNoteChapterId(data.chapterId),
        title: String(data.title || '').trim() || attachment.originalName || 'Fichier',
        createdAt: existing?.createdAt || stamp,
        updatedAt: stamp,
        export: false
    });
    await writeJson(path.join(currentProjectDir, 'notes', `${note.id}.json`), note);

    if (oldAbsolute && fsSync.existsSync(oldAbsolute)) {
        const newAbsolute = path.join(currentProjectDir, ...String(note.path).split('/'));
        if (path.resolve(oldAbsolute) !== path.resolve(newAbsolute)) {
            await fs.rm(oldAbsolute, { force: true }).catch(() => {});
        }
    }
    return note;
}

async function deleteNote(noteId) {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const note = await getNote(noteId);
    if (note.type === 'file' && note.path) {
        const asset = path.join(currentProjectDir, ...String(note.path).split('/'));
        await fs.rm(asset, { force: true }).catch(() => {});
    }
    await fs.rm(path.join(currentProjectDir, 'notes', `${note.id}.json`), { force: true });
    return listNotes();
}

async function openNoteAttachment(noteId) {
    const note = await getNote(noteId);
    if (note.type !== 'file' || !note.path) throw new Error('Cette note ne contient pas de fichier.');
    const asset = path.join(currentProjectDir, ...String(note.path).split('/'));
    if (!fsSync.existsSync(asset)) throw new Error('Le fichier joint est introuvable.');
    const error = await shell.openPath(asset);
    if (error) throw new Error(error);
    return true;
}

async function openNotesAttachmentsFolder() {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const dir = path.join(currentProjectDir, 'assets', 'notes');
    await fs.mkdir(dir, { recursive: true });
    const error = await shell.openPath(dir);
    if (error) throw new Error(error);
    return true;
}

async function openCnrtl(mode, word) {
    const value = String(word || '').trim().replace(/^\W+|\W+$/gu, '');
    if (!value) throw new Error('Sélectionnez d’abord un mot dans la note.');
    const section = mode === 'synonymie' ? 'synonymie' : 'definition';
    await shell.openExternal(`https://www.cnrtl.fr/${section}/${encodeURIComponent(value)}`);
    return true;
}



// -----------------------------------------------------------------------------
// Chronologie narrative
// Reprend les fonctions utiles du module Zwii : événements datés, personnages,
// lieux, chapitre lié, résumé, couloirs narratifs et palette de personnages.
// Les données restent séparées du manuscrit dans board/timeline/.
// -----------------------------------------------------------------------------

function newTimelineId() {
    return `tl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeTimelineDate(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
    const [y, m, d] = text.split('-').map(Number);
    const check = new Date(Date.UTC(y, m - 1, d));
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return '';
    return text;
}

function normalizeTimelineTime(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const match = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (!match) return '';
    const h = Number(match[1]);
    const m = Number(match[2]);
    if (h < 0 || h > 23 || m < 0 || m > 59) return '';
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function timelineCharactersList(event) {
    const values = [];
    const primary = String(event?.primaryCharacter || '').trim();
    if (primary) values.push(primary);
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

function timelineColorFromName(name) {
    const colors = ['#7C3AED', '#0F766E', '#B45309', '#BE123C', '#1D4ED8', '#047857', '#9F1239', '#7C2D12', '#4338CA', '#A16207'];
    const text = String(name || '').trim().toLocaleLowerCase('fr');
    if (!text) return '#94A3B8';
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    return colors[Math.abs(hash) % colors.length];
}

function normalizeHexColor(value, fallback = '#64748B') {
    let color = String(value || '').trim();
    if (!color) return fallback;
    if (!color.startsWith('#')) color = `#${color}`;
    if (/^#[0-9a-f]{6}$/i.test(color)) return color.toUpperCase();
    if (/^#[0-9a-f]{3}$/i.test(color)) {
        return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`.toUpperCase();
    }
    return fallback;
}

async function validateTimelineChapterId(chapterId) {
    const id = String(chapterId || '').trim();
    if (!id) return '';
    const chapters = await listChapters(currentProjectDir);
    return chapters.some((chapter) => chapter.id === id) ? id : '';
}

function normalizeTimelineEventBase(data = {}, existing = {}) {
    let startDate = normalizeTimelineDate(data.startDate ?? existing.startDate);
    let endDate = normalizeTimelineDate(data.endDate ?? existing.endDate);
    const startTime = normalizeTimelineTime(data.startTime ?? existing.startTime);
    const endTime = normalizeTimelineTime(data.endTime ?? existing.endTime);
    if (!endDate && startDate) endDate = startDate;
    if (!startDate && endDate) startDate = endDate;
    return {
        id: String(existing.id || data.id || newTimelineId()).trim(),
        title: String(data.title ?? existing.title ?? 'Événement').trim() || 'Événement',
        type: String(data.type ?? existing.type ?? 'personnage').trim() || 'personnage',
        color: String(data.color ?? existing.color ?? 'bleu').trim() || 'bleu',
        startDate,
        startTime,
        endDate,
        endTime,
        lane: String(data.lane ?? existing.lane ?? 'Récit principal').trim() || 'Récit principal',
        primaryCharacter: String(data.primaryCharacter ?? existing.primaryCharacter ?? '').trim(),
        characters: String(data.characters ?? existing.characters ?? '').trim(),
        location: String(data.location ?? existing.location ?? '').trim(),
        summary: String(data.summary ?? existing.summary ?? '').trim(),
        chapterId: String(data.chapterId ?? existing.chapterId ?? '').trim(),
        createdAt: String(existing.createdAt || data.createdAt || nowString()),
        updatedAt: nowString()
    };
}

async function listTimelineEvents() {
    if (!currentProjectDir) return [];
    const dir = path.join(currentProjectDir, 'board', 'timeline', 'events');
    await fs.mkdir(dir, { recursive: true });
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const events = [];
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) continue;
        try {
            const raw = await readJson(path.join(dir, entry.name));
            if (!raw?.id) continue;
            const event = normalizeTimelineEventBase(raw, raw);
            event.updatedAt = String(raw.updatedAt || event.updatedAt);
            event.createdAt = String(raw.createdAt || event.createdAt);
            events.push(event);
        } catch (_) {
            // Un événement illisible ne bloque pas la chronologie.
        }
    }
    events.sort((a, b) => {
        const ak = `${a.startDate || '9999-12-31'} ${a.startTime || '12:00'} ${a.title || ''}`;
        const bk = `${b.startDate || '9999-12-31'} ${b.startTime || '12:00'} ${b.title || ''}`;
        return ak.localeCompare(bk, 'fr', { numeric: true });
    });
    return events;
}

async function timelinePalette() {
    if (!currentProjectDir) return {};
    const paletteFile = path.join(currentProjectDir, 'board', 'timeline', 'characters.json');
    let stored = {};
    if (fsSync.existsSync(paletteFile)) {
        try {
            const raw = await readJson(paletteFile);
            if (raw && typeof raw === 'object' && !Array.isArray(raw)) stored = raw;
        } catch (_) {}
    }
    const events = await listTimelineEvents();
    for (const event of events) {
        for (const name of timelineCharactersList(event)) {
            if (!stored[name]) stored[name] = timelineColorFromName(name);
        }
    }
    const sorted = {};
    for (const name of Object.keys(stored).sort((a, b) => a.localeCompare(b, 'fr'))) {
        if (!name.startsWith('__')) sorted[name] = normalizeHexColor(stored[name], timelineColorFromName(name));
    }
    return sorted;
}

async function saveTimelinePalette(entries = {}) {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const result = {};
    const source = Array.isArray(entries)
        ? Object.fromEntries(entries.map((entry) => [entry?.name, entry?.color]))
        : entries;
    for (const [rawName, rawColor] of Object.entries(source || {})) {
        const name = String(rawName || '').trim();
        if (!name) continue;
        result[name] = normalizeHexColor(rawColor, timelineColorFromName(name));
    }
    const file = path.join(currentProjectDir, 'board', 'timeline', 'characters.json');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await writeJson(file, result);
    return timelinePalette();
}

async function timelineState() {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const events = await listTimelineEvents();
    const chapters = flattenTree(await listChapters(currentProjectDir)).map((chapter) => ({
        id: chapter.id,
        title: chapter.title || 'Chapitre',
        depth: Number(chapter._depth || 0),
        wordCount: Number(chapter.wordCount || 0)
    }));
    const lanes = new Set(['Récit principal', 'Intrigue secondaire']);
    for (const event of events) lanes.add(String(event.lane || 'Récit principal').trim() || 'Récit principal');
    return {
        events,
        chapters,
        palette: await timelinePalette(),
        lanes: Array.from(lanes).sort((a, b) => a.localeCompare(b, 'fr')),
        types: {
            personnage: 'Personnage',
            lieu: 'Lieu',
            intrigue: 'Intrigue / Arc',
            chapitre: 'Chapitre',
            idee: 'Idée',
            objet: 'Objet'
        }
    };
}

async function saveTimelineEvent(data = {}) {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const requestedId = String(data.id || '').trim();
    let existing = {};
    if (requestedId) {
        const file = path.join(currentProjectDir, 'board', 'timeline', 'events', `${path.basename(requestedId)}.json`);
        if (fsSync.existsSync(file)) {
            try { existing = await readJson(file); } catch (_) {}
        }
    }
    const event = normalizeTimelineEventBase(data, existing);
    event.chapterId = await validateTimelineChapterId(event.chapterId);
    if (event.endDate && event.startDate) {
        const startKey = `${event.startDate}T${event.startTime || '00:00'}`;
        const endKey = `${event.endDate}T${event.endTime || '23:59'}`;
        if (endKey < startKey) {
            event.endDate = event.startDate;
            event.endTime = event.startTime;
        }
    }
    const dir = path.join(currentProjectDir, 'board', 'timeline', 'events');
    await fs.mkdir(dir, { recursive: true });
    await writeJson(path.join(dir, `${path.basename(event.id)}.json`), event);
    return event;
}

async function deleteTimelineEvent(eventId) {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const id = path.basename(String(eventId || '').trim());
    if (!id) return listTimelineEvents();
    await fs.rm(path.join(currentProjectDir, 'board', 'timeline', 'events', `${id}.json`), { force: true });
    return listTimelineEvents();
}

async function moveTimelineEvent(data = {}) {
    const id = String(data.id || '').trim();
    if (!id) throw new Error('Événement invalide.');
    return saveTimelineEvent(data);
}


function statsDateKey(date = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function readJsonOrEmpty(filePath) {
    if (!fsSync.existsSync(filePath)) return {};
    try {
        const value = await readJson(filePath);
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (_) {
        return {};
    }
}

function statisticsPaths() {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const dir = path.join(currentProjectDir, 'stats');
    return {
        dir,
        daily: path.join(dir, 'daily-words.json'),
        snapshots: path.join(dir, 'chapter-snapshots.json')
    };
}

async function recordWritingStats(chapter, fallbackPreviousWords = 0) {
    if (!currentProjectDir || !chapter?.id) return;
    const paths = statisticsPaths();
    await fs.mkdir(paths.dir, { recursive: true });

    const snapshots = await readJsonOrEmpty(paths.snapshots);
    const currentWords = Math.max(0, Number(chapter.wordCount || 0));
    const hasSnapshot = Object.prototype.hasOwnProperty.call(snapshots, chapter.id);
    const previousWords = hasSnapshot
        ? Math.max(0, Number(snapshots[chapter.id] || 0))
        : Math.max(0, Number(fallbackPreviousWords || 0));
    const delta = currentWords - previousWords;

    snapshots[chapter.id] = currentWords;
    await writeJson(paths.snapshots, snapshots);

    if (delta > 0) {
        const daily = await readJsonOrEmpty(paths.daily);
        const today = statsDateKey();
        daily[today] = Math.max(0, Number(daily[today] || 0)) + delta;
        await writeJson(paths.daily, daily);
    }
}

async function ensureStatisticsSnapshots(chapters) {
    const paths = statisticsPaths();
    await fs.mkdir(paths.dir, { recursive: true });
    const snapshots = await readJsonOrEmpty(paths.snapshots);
    let changed = false;
    const validIds = new Set();

    for (const chapter of chapters) {
        if (!chapter?.id) continue;
        validIds.add(chapter.id);
        if (!Object.prototype.hasOwnProperty.call(snapshots, chapter.id)) {
            snapshots[chapter.id] = Math.max(0, Number(chapter.wordCount || 0));
            changed = true;
        }
    }

    // Nettoie les instantanés de chapitres supprimés sans toucher à l'historique quotidien.
    for (const id of Object.keys(snapshots)) {
        if (!validIds.has(id)) {
            delete snapshots[id];
            changed = true;
        }
    }

    if (changed || !fsSync.existsSync(paths.snapshots)) {
        await writeJson(paths.snapshots, snapshots);
    }
}

async function statisticsState() {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const state = await loadCurrentProject();
    const chapters = Array.isArray(state?.chapters) ? state.chapters : [];
    await ensureStatisticsSnapshots(chapters);

    let totalWords = 0;
    let exportWords = 0;
    let excludedChapters = 0;
    const statusCounts = {};
    const chapterStats = [];

    for (const chapter of chapters) {
        const words = Math.max(0, Number(chapter.wordCount || 0));
        totalWords += words;
        const excluded = Boolean(chapter.excludeFromExport);
        if (excluded) excludedChapters += 1;
        else exportWords += words;

        const status = String(chapter.status || 'draft');
        statusCounts[status] = Number(statusCounts[status] || 0) + 1;
        chapterStats.push({
            id: chapter.id,
            title: String(chapter.title || 'Sans titre'),
            depth: Number(chapter._depth || 0),
            status,
            excluded,
            words
        });
    }

    const paths = statisticsPaths();
    const daily = await readJsonOrEmpty(paths.daily);
    const dailySeries = [];
    let weekWords = 0;
    for (let offset = 6; offset >= 0; offset -= 1) {
        const date = new Date();
        date.setHours(12, 0, 0, 0);
        date.setDate(date.getDate() - offset);
        const key = statsDateKey(date);
        const words = Math.max(0, Number(daily[key] || 0));
        dailySeries.push({ date: key, words });
        weekWords += words;
    }

    const today = statsDateKey();
    return {
        chapters: chapters.length,
        excludedChapters,
        totalWords,
        exportWords,
        todayWords: Math.max(0, Number(daily[today] || 0)),
        weekWords,
        dailySeries,
        statusCounts,
        averageWordsPerChapter: chapters.length ? Math.floor(totalWords / chapters.length) : 0,
        chapterStats
    };
}



// -----------------------------------------------------------------------------
// Carte mentale
// -----------------------------------------------------------------------------
// Compatible avec le format mindmap.json du module Zwii : nodes + edges.
// Les coordonnées sont enregistrées avec le projet afin que l'organisation
// réalisée à la souris reste exactement la même à la prochaine ouverture.

const MINDMAP_TYPES = {
    personnage: 'Personnage',
    lieu: 'Lieu',
    intrigue: 'Intrigue / Arc',
    chapitre: 'Chapitre',
    idee: 'Idée',
    objet: 'Objet'
};

const MINDMAP_COLORS = {
    personnage: { bg: '#dbeafe', border: '#3b82f6', text: '#1e3a5f' },
    lieu: { bg: '#dcfce7', border: '#22c55e', text: '#14532d' },
    intrigue: { bg: '#f3e8ff', border: '#a855f7', text: '#581c87' },
    chapitre: { bg: '#fef3c7', border: '#f59e0b', text: '#78350f' },
    idee: { bg: '#fce7f3', border: '#ec4899', text: '#831843' },
    objet: { bg: '#e2e8f0', border: '#64748b', text: '#1e293b' }
};

function normalizeMindmapId(value, prefix) {
    const clean = String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
    if (clean) return clean;
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function sanitizeMindmapGraph(raw = {}) {
    const nodes = [];
    const nodeIds = new Set();
    const inputNodes = Array.isArray(raw.nodes) ? raw.nodes : [];

    for (const item of inputNodes) {
        if (!item || typeof item !== 'object') continue;
        const id = normalizeMindmapId(item.id, 'mn');
        if (nodeIds.has(id)) continue;
        nodeIds.add(id);
        const requestedType = String(item.type || 'idee');
        nodes.push({
            id,
            label: String(item.label || '').trim().slice(0, 120) || 'Élément',
            type: Object.prototype.hasOwnProperty.call(MINDMAP_TYPES, requestedType) ? requestedType : 'idee',
            note: String(item.note || '').trim().slice(0, 4000),
            chapterId: String(item.chapterId || '').trim().slice(0, 120),
            x: Number.isFinite(Number(item.x)) ? Number(item.x) : 0,
            y: Number.isFinite(Number(item.y)) ? Number(item.y) : 0,
            createdAt: String(item.createdAt || nowString())
        });
    }

    const edges = [];
    const edgeIds = new Set();
    const pairs = new Set();
    const inputEdges = Array.isArray(raw.edges) ? raw.edges : [];
    for (const item of inputEdges) {
        if (!item || typeof item !== 'object') continue;
        const source = String(item.source || '').trim();
        const target = String(item.target || '').trim();
        if (!nodeIds.has(source) || !nodeIds.has(target) || source === target) continue;
        const pair = `${source}\u0000${target}`;
        if (pairs.has(pair)) continue;
        pairs.add(pair);
        const id = normalizeMindmapId(item.id, 'me');
        if (edgeIds.has(id)) continue;
        edgeIds.add(id);
        edges.push({
            id,
            source,
            target,
            type: 'lien',
            label: String(item.label || '').trim().slice(0, 180)
        });
    }

    return { nodes, edges };
}

async function mindmapState() {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const file = path.join(currentProjectDir, 'mindmap.json');
    let graph = { nodes: [], edges: [] };
    if (fsSync.existsSync(file)) {
        try {
            graph = sanitizeMindmapGraph(await readJson(file));
        } catch (_) {
            graph = { nodes: [], edges: [] };
        }
    }
    return {
        ...graph,
        types: MINDMAP_TYPES,
        colors: MINDMAP_COLORS,
        chapters: flattenTree(await listChapters(currentProjectDir)).map((chapter) => ({
            id: chapter.id,
            title: chapter.title || 'Sans titre',
            _depth: Number(chapter._depth || 0)
        }))
    };
}

async function saveMindmapGraph(raw = {}) {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const graph = sanitizeMindmapGraph(raw);
    const payload = { ...graph, updatedAt: nowString() };
    await writeJson(path.join(currentProjectDir, 'mindmap.json'), payload);
    return graph;
}

async function exportMindmapPng(dataUrl) {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const match = String(dataUrl || '').match(/^data:image\/png;base64,(.+)$/);
    if (!match) throw new Error('Image PNG invalide.');
    const project = await readJson(path.join(currentProjectDir, 'project.json'));
    const defaultName = `${safeFolderName(project?.title || 'carte-mentale')}-carte-mentale.png`;
    const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Exporter la carte mentale en PNG',
        defaultPath: path.join(currentProjectDir, 'exports', defaultName),
        filters: [{ name: 'Image PNG', extensions: ['png'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    await fs.writeFile(result.filePath, Buffer.from(match[1], 'base64'));
    return { canceled: false, filePath: result.filePath };
}


// =========================================================
// SAUVEGARDES DU PROJET ET HISTORIQUE DES CHAPITRES
// =========================================================

const MAX_PROJECT_BACKUPS = 5;
const HISTORY_AUTOSAVE_INTERVAL_MS = 10 * 60 * 1000;

function compactTimestamp(date = new Date()) {
    const pad = (n, width = 2) => String(n).padStart(width, '0');
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}`;
}

function chapterComparable(chapter = {}) {
    return JSON.stringify({
        title: String(chapter.title || ''),
        status: String(chapter.status || ''),
        content: String(chapter.content || ''),
        parent: chapter.parent || null,
        position: Number(chapter.position || 0)
    });
}

async function trimChapterAutosaves(chapterId, maxFiles = 20) {
    if (!currentProjectDir) return;
    const dir = path.join(currentProjectDir, 'chapters', 'autosave');
    if (!fsSync.existsSync(dir)) return;
    const entries = (await fs.readdir(dir, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.startsWith(`${chapterId}-`) && entry.name.endsWith('.json'))
        .map((entry) => entry.name)
        .sort()
        .reverse();
    for (const name of entries.slice(maxFiles)) {
        await fs.rm(path.join(dir, name), { force: true });
    }
}

async function listChapterHistoryFiles(chapterId) {
    if (!currentProjectDir) return [];
    const dir = path.join(currentProjectDir, 'history', chapterId);
    if (!fsSync.existsSync(dir)) return [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
        .map((entry) => entry.name)
        .sort()
        .reverse();
}

async function createChapterHistorySnapshot(chapter, source = 'manual') {
    if (!currentProjectDir || !chapter?.id) return null;
    const dir = path.join(currentProjectDir, 'history', chapter.id);
    await fs.mkdir(dir, { recursive: true });

    const existingFiles = await listChapterHistoryFiles(chapter.id);
    if (existingFiles[0]) {
        try {
            const latest = await readJson(path.join(dir, existingFiles[0]));
            if (chapterComparable(latest) === chapterComparable(chapter)) return null;
        } catch (_) {}
    }

    const savedAt = new Date().toISOString();
    const fileName = `${compactTimestamp()}-${source}.json`;
    const payload = {
        ...chapter,
        _history: {
            savedAt,
            source
        }
    };
    await writeJson(path.join(dir, fileName), payload);
    return fileName;
}

async function maybeCreateChapterHistory(existing, source = 'autosave') {
    if (!currentProjectDir || !existing?.id) return null;
    const files = await listChapterHistoryFiles(existing.id);
    if (source === 'autosave' && files[0]) {
        try {
            const latest = await readJson(path.join(currentProjectDir, 'history', existing.id, files[0]));
            const lastAt = Date.parse(latest?._history?.savedAt || '');
            if (Number.isFinite(lastAt) && (Date.now() - lastAt) < HISTORY_AUTOSAVE_INTERVAL_MS) return null;
        } catch (_) {}
    }
    return createChapterHistorySnapshot(existing, source);
}

function safeVersionFileName(value) {
    const base = path.basename(String(value || ''));
    if (!base || !base.toLowerCase().endsWith('.json')) throw new Error('Version invalide.');
    return base;
}

async function chapterHistoryState(chapterId) {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const chapterFile = path.join(currentProjectDir, 'chapters', `${chapterId}.json`);
    if (!fsSync.existsSync(chapterFile)) throw new Error('Chapitre introuvable.');
    const current = await readJson(chapterFile);
    const files = await listChapterHistoryFiles(chapterId);
    const versions = [];

    for (const fileName of files) {
        try {
            const item = await readJson(path.join(currentProjectDir, 'history', chapterId, fileName));
            versions.push({
                id: fileName,
                savedAt: item?._history?.savedAt || item.updatedAt || '',
                source: item?._history?.source || 'history',
                title: item.title || current.title || 'Sans titre',
                wordCount: Number(item.wordCount || 0),
                updatedAt: item.updatedAt || ''
            });
        } catch (_) {}
    }

    return {
        chapter: {
            id: current.id,
            title: current.title || 'Sans titre'
        },
        current: {
            id: 'current',
            savedAt: new Date().toISOString(),
            source: 'current',
            title: current.title || 'Sans titre',
            wordCount: Number(current.wordCount || 0),
            updatedAt: current.updatedAt || ''
        },
        versions
    };
}

async function getChapterHistoryVersion(chapterId, versionId) {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    if (versionId === 'current') {
        return readJson(path.join(currentProjectDir, 'chapters', `${chapterId}.json`));
    }
    const safeName = safeVersionFileName(versionId);
    const file = path.join(currentProjectDir, 'history', chapterId, safeName);
    if (!fsSync.existsSync(file)) throw new Error('Cette version n’existe plus.');
    const version = await readJson(file);
    delete version._history;
    return version;
}

async function restoreChapterHistoryVersion(chapterId, versionId) {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const currentFile = path.join(currentProjectDir, 'chapters', `${chapterId}.json`);
    if (!fsSync.existsSync(currentFile)) throw new Error('Chapitre introuvable.');
    const current = await readJson(currentFile);
    const historical = await getChapterHistoryVersion(chapterId, versionId);

    // La version actuelle est d'abord conservée : une restauration n'est donc
    // jamais irréversible.
    await createChapterHistorySnapshot(current, 'avant-restauration');

    const restored = {
        ...current,
        ...historical,
        id: current.id,
        createdAt: current.createdAt || historical.createdAt || nowString(),
        updatedAt: nowString()
    };
    delete restored._history;
    await writeJson(currentFile, restored);
    return restored;
}

async function folderSizeBytes(dir) {
    if (!fsSync.existsSync(dir)) return 0;
    let total = 0;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) total += await folderSizeBytes(full);
        else if (entry.isFile()) {
            try { total += (await fs.stat(full)).size; } catch (_) {}
        }
    }
    return total;
}

async function copyDirectoryExcept(source, target, excludedNames = new Set()) {
    await fs.mkdir(target, { recursive: true });
    const entries = await fs.readdir(source, { withFileTypes: true });
    for (const entry of entries) {
        if (excludedNames.has(entry.name)) continue;
        const src = path.join(source, entry.name);
        const dst = path.join(target, entry.name);
        if (entry.isDirectory()) await fs.cp(src, dst, { recursive: true, force: true });
        else if (entry.isFile()) await fs.copyFile(src, dst);
    }
}

async function copyProjectToSnapshot(snapshotDir) {
    const entries = await fs.readdir(currentProjectDir, { withFileTypes: true });
    await fs.mkdir(snapshotDir, { recursive: true });
    for (const entry of entries) {
        if (entry.name === 'backups' || entry.name === 'history') continue;
        const src = path.join(currentProjectDir, entry.name);
        const dst = path.join(snapshotDir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'chapters') await copyDirectoryExcept(src, dst, new Set(['autosave']));
            else await fs.cp(src, dst, { recursive: true, force: true });
        } else if (entry.isFile()) {
            await fs.copyFile(src, dst);
        }
    }
}

async function listProjectBackups() {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const root = path.join(currentProjectDir, 'backups');
    await fs.mkdir(root, { recursive: true });
    const entries = await fs.readdir(root, { withFileTypes: true });
    const items = [];
    for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.startsWith('backup-')) continue;
        const dir = path.join(root, entry.name);
        let meta = {};
        try { meta = await readJson(path.join(dir, 'backup.json')); } catch (_) {}
        items.push({
            id: entry.name,
            createdAt: meta.createdAt || '',
            reason: meta.reason || 'Sauvegarde',
            sizeBytes: Number(meta.sizeBytes || await folderSizeBytes(dir))
        });
    }
    items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || b.id.localeCompare(a.id));
    return items;
}

async function pruneProjectBackups(protectedIds = []) {
    const protectedSet = new Set(protectedIds || []);
    const items = await listProjectBackups();
    const keep = new Set();

    // Une sauvegarde explicitement protégée (par exemple celle que l'on est
    // sur le point de restaurer) ne peut pas être supprimée pendant la rotation.
    for (const item of items) {
        if (protectedSet.has(item.id)) keep.add(item.id);
    }
    for (const item of items) {
        if (keep.size >= MAX_PROJECT_BACKUPS) break;
        keep.add(item.id);
    }
    for (const item of items) {
        if (!keep.has(item.id)) {
            await fs.rm(path.join(currentProjectDir, 'backups', item.id), { recursive: true, force: true });
        }
    }
}

async function createProjectBackup(reason = 'Sauvegarde manuelle', protectedIds = []) {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const root = path.join(currentProjectDir, 'backups');
    await fs.mkdir(root, { recursive: true });
    const id = `backup-${compactTimestamp()}`;
    const dir = path.join(root, id);
    await fs.mkdir(dir, { recursive: true });
    await copyProjectToSnapshot(dir);
    const sizeBytes = await folderSizeBytes(dir);
    await writeJson(path.join(dir, 'backup.json'), {
        id,
        createdAt: new Date().toISOString(),
        reason,
        sizeBytes,
        format: 'ecrivain-project-backup',
        version: 1
    });
    await pruneProjectBackups([id, ...(protectedIds || [])]);
    return { id, createdAt: new Date().toISOString(), reason, sizeBytes };
}

async function projectBackupsState() {
    return {
        maxBackups: MAX_PROJECT_BACKUPS,
        backups: await listProjectBackups(),
        projectDir: currentProjectDir
    };
}

async function restoreProjectBackup(backupId) {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const safeId = path.basename(String(backupId || ''));
    const source = path.join(currentProjectDir, 'backups', safeId);
    if (!fsSync.existsSync(source)) throw new Error('Sauvegarde introuvable.');

    const confirm = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Restaurer la sauvegarde',
        message: 'Restaurer cette sauvegarde du projet ?',
        detail: 'Écrivain créera d’abord une sauvegarde de l’état actuel. La restauration remplacera les données du projet par celles de la sauvegarde sélectionnée.',
        buttons: ['Annuler', 'Restaurer'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
    });
    if (confirm.response !== 1) return { canceled: true };

    await createProjectBackup('Avant restauration', [safeId]);

    const entries = await fs.readdir(currentProjectDir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.name === 'backups' || entry.name === 'history') continue;
        await fs.rm(path.join(currentProjectDir, entry.name), { recursive: true, force: true });
    }

    const snapshotEntries = await fs.readdir(source, { withFileTypes: true });
    for (const entry of snapshotEntries) {
        if (entry.name === 'backup.json') continue;
        const src = path.join(source, entry.name);
        const dst = path.join(currentProjectDir, entry.name);
        if (entry.isDirectory()) await fs.cp(src, dst, { recursive: true, force: true });
        else if (entry.isFile()) await fs.copyFile(src, dst);
    }

    await ensureProjectFolders(currentProjectDir);
    await pruneProjectBackups();
    return { canceled: false, ...(await loadCurrentProject()) };
}

async function openProjectBackupsFolder() {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const dir = path.join(currentProjectDir, 'backups');
    await fs.mkdir(dir, { recursive: true });
    const result = await shell.openPath(dir);
    if (result) throw new Error(result);
    return true;
}


function isSearchWordChar(char) {
    return Boolean(char) && /[\p{L}\p{N}_]/u.test(char);
}

function findSearchPositions(text, query, options = {}) {
    const source = String(text ?? '');
    const needle = String(query ?? '').trim();
    if (!needle) return [];

    const caseSensitive = Boolean(options.caseSensitive);
    const wholeWord = Boolean(options.wholeWord);
    const escapedParts = needle.split(/\s+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = escapedParts.join('[\\s\\u00A0\\u202F]+');
    const regex = new RegExp(pattern, caseSensitive ? 'gu' : 'giu');
    const positions = [];
    let match;

    while ((match = regex.exec(source)) !== null) {
        const index = match.index;
        const end = index + match[0].length;
        const validBoundary = !wholeWord || (!isSearchWordChar(source[index - 1]) && !isSearchWordChar(source[end]));
        if (validBoundary) positions.push({ start: index, end });
        if (match[0].length === 0) regex.lastIndex += 1;
    }
    return positions;
}

function htmlSearchTextTokens(html) {
    return String(html || '').split(/(<[^>]+>)/g);
}

function chapterSearchDetails(chapter, query, options = {}) {
    const snippets = [];
    let count = 0;
    for (const token of htmlSearchTextTokens(chapter?.content || '')) {
        if (!token || token.startsWith('<')) continue;
        const positions = findSearchPositions(token, query, options);
        count += positions.length;
        if (snippets.length < 3 && positions.length) {
            const clean = decodeHtmlEntities(token).replace(/\s+/g, ' ').trim();
            const cleanPositions = findSearchPositions(clean, query, options);
            for (const pos of cleanPositions) {
                if (snippets.length >= 3) break;
                const start = Math.max(0, pos.start - 65);
                const end = Math.min(clean.length, pos.end + 85);
                snippets.push(`${start > 0 ? '…' : ''}${clean.slice(start, end)}${end < clean.length ? '…' : ''}`);
            }
        }
    }
    return { count, snippets };
}

async function searchProjectChapters(query, options = {}) {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const needle = String(query || '').trim();
    if (!needle) throw new Error('Saisissez un mot ou une expression à rechercher.');

    const chapters = flattenTree(await listChapters(currentProjectDir));
    const results = [];
    let totalOccurrences = 0;

    for (const chapter of chapters) {
        const detail = chapterSearchDetails(chapter, needle, options);
        if (!detail.count) continue;
        totalOccurrences += detail.count;
        results.push({
            id: chapter.id,
            title: chapter.title || 'Sans titre',
            position: Number(chapter.position || 0),
            depth: Number(chapter._depth || 0),
            count: detail.count,
            snippets: detail.snippets
        });
    }

    return {
        query: needle,
        totalOccurrences,
        chapterCount: results.length,
        results
    };
}

function replaceSearchTextToken(text, query, replacement, options = {}) {
    const source = String(text ?? '');
    const positions = findSearchPositions(source, query, options);
    if (!positions.length) return { text: source, count: 0 };
    let value = source;
    for (let i = positions.length - 1; i >= 0; i -= 1) {
        const pos = positions[i];
        value = value.slice(0, pos.start) + replacement + value.slice(pos.end);
    }
    return { text: value, count: positions.length };
}

function replaceInChapterHtml(html, query, replacement, options = {}) {
    const tokens = htmlSearchTextTokens(html);
    let total = 0;
    for (let i = 0; i < tokens.length; i += 1) {
        const token = tokens[i];
        if (!token || token.startsWith('<')) continue;
        const replaced = replaceSearchTextToken(token, query, replacement, options);
        tokens[i] = replaced.text;
        total += replaced.count;
    }
    return { html: tokens.join(''), count: total };
}

async function replaceAcrossProject(query, replacement, options = {}) {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const needle = String(query || '').trim();
    if (!needle) throw new Error('Saisissez un mot ou une expression à remplacer.');
    const replacementText = String(replacement ?? '');

    const preview = await searchProjectChapters(needle, options);
    if (!preview.totalOccurrences) {
        return { replacements: 0, chapterCount: 0, backupId: null };
    }

    // Protection forte avant une opération globale : une copie complète du
    // projet est créée avant de toucher au premier chapitre.
    const backup = await createProjectBackup(`Avant remplacement global : ${needle}`);
    const chapters = await listChapters(currentProjectDir);
    let replacements = 0;
    let chapterCount = 0;

    for (const chapter of chapters) {
        const replaced = replaceInChapterHtml(chapter.content || '', needle, replacementText, options);
        if (!replaced.count) continue;

        // Jalon éditorial explicitement identifiable dans l'historique.
        await createChapterHistorySnapshot(chapter, 'remplacement-global');
        await saveChapter({ ...chapter, content: replaced.html }, {
            mode: 'manual',
            skipHistory: true,
            skipStats: true
        });
        replacements += replaced.count;
        chapterCount += 1;
    }

    return {
        replacements,
        chapterCount,
        backupId: backup?.id || null
    };
}


// -----------------------------------------------------------------------------
// Extensions — API v1
// Les extensions sont des fichiers .ecrivain-plugin (JSON) installés globalement.
// Leur code s'exécute dans un iframe sandboxé côté interface. Le processus principal
// n'expose que les données explicitement autorisées par les permissions du manifeste.
// -----------------------------------------------------------------------------
const PLUGIN_PACKAGE_FORMAT = 'ecrivain-plugin';
const PLUGIN_PACKAGE_VERSION = 1;
const PLUGIN_API_VERSION = 1;
const PLUGIN_MAX_PACKAGE_BYTES = 2 * 1024 * 1024;
const PLUGIN_MAX_CODE_BYTES = 768 * 1024;
const PLUGIN_MAX_STYLE_BYTES = 192 * 1024;
const PLUGIN_MAX_STORAGE_BYTES = 512 * 1024;
const PLUGIN_ALLOWED_PERMISSIONS = new Set([
    'project.read',
    'chapters.read',
    'storage.read',
    'storage.write'
]);

function pluginsRootDir() {
    return path.join(app.getPath('userData'), 'extensions');
}

function pluginsRegistryFile() {
    return path.join(pluginsRootDir(), 'registry.json');
}

function pluginDir(pluginId) {
    return path.join(pluginsRootDir(), pluginId);
}

function safePluginId(value) {
    const id = String(value || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(id)) {
        throw new Error('Identifiant d’extension invalide. Utilisez 3 à 64 caractères : lettres minuscules, chiffres, point, tiret ou soulignement.');
    }
    return id;
}

function loadPluginRegistrySync() {
    try {
        const file = pluginsRegistryFile();
        if (!fsSync.existsSync(file)) return { enabled: {} };
        const data = JSON.parse(fsSync.readFileSync(file, 'utf8'));
        return { enabled: data && typeof data.enabled === 'object' ? data.enabled : {} };
    } catch (_) {
        return { enabled: {} };
    }
}

async function loadPluginRegistry() {
    await fs.mkdir(pluginsRootDir(), { recursive: true });
    try {
        if (!fsSync.existsSync(pluginsRegistryFile())) return { enabled: {} };
        const data = await readJson(pluginsRegistryFile());
        return { enabled: data && typeof data.enabled === 'object' ? data.enabled : {} };
    } catch (_) {
        return { enabled: {} };
    }
}

async function savePluginRegistry(registry) {
    await fs.mkdir(pluginsRootDir(), { recursive: true });
    await writeJson(pluginsRegistryFile(), { enabled: registry?.enabled || {} });
}

function validatePluginManifest(raw = {}) {
    const manifest = {
        id: safePluginId(raw.id),
        name: String(raw.name || '').trim(),
        version: String(raw.version || '').trim(),
        author: String(raw.author || '').trim(),
        description: String(raw.description || '').trim(),
        icon: String(raw.icon || '🧩').trim().slice(0, 4) || '🧩',
        ecrivainApi: Number(raw.ecrivainApi || 1),
        permissions: Array.isArray(raw.permissions) ? [...new Set(raw.permissions.map((p) => String(p || '').trim()))] : [],
        commands: Array.isArray(raw.commands) ? raw.commands : []
    };

    if (!manifest.name || manifest.name.length > 80) throw new Error('Le nom de l’extension est obligatoire (80 caractères maximum).');
    if (!manifest.version || manifest.version.length > 30) throw new Error('La version de l’extension est obligatoire.');
    if (manifest.author.length > 100 || manifest.description.length > 500) throw new Error('Métadonnées d’extension trop longues.');
    if (manifest.ecrivainApi !== PLUGIN_API_VERSION) throw new Error(`Cette extension utilise l’API ${manifest.ecrivainApi}. Écrivain prend en charge l’API ${PLUGIN_API_VERSION}.`);

    for (const permission of manifest.permissions) {
        if (!PLUGIN_ALLOWED_PERMISSIONS.has(permission)) throw new Error(`Permission d’extension inconnue : ${permission}`);
    }
    if (manifest.commands.length > 20) throw new Error('Une extension ne peut pas déclarer plus de 20 commandes.');
    manifest.commands = manifest.commands.map((command) => {
        const id = String(command?.id || '').trim().toLowerCase();
        const label = String(command?.label || '').trim();
        if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(id)) throw new Error(`Identifiant de commande invalide : ${id || '(vide)'}`);
        if (!label || label.length > 80) throw new Error(`Libellé de commande invalide pour ${id}.`);
        return { id, label };
    });
    return manifest;
}

function readInstalledPluginManifestSync(dirName) {
    try {
        const file = path.join(pluginsRootDir(), dirName, 'manifest.json');
        if (!fsSync.existsSync(file)) return null;
        return validatePluginManifest(JSON.parse(fsSync.readFileSync(file, 'utf8')));
    } catch (_) {
        return null;
    }
}

function enabledPluginMenuEntriesSync() {
    try {
        const root = pluginsRootDir();
        if (!fsSync.existsSync(root)) return [];
        const registry = loadPluginRegistrySync();
        const entries = [];
        for (const dirent of fsSync.readdirSync(root, { withFileTypes: true })) {
            if (!dirent.isDirectory()) continue;
            const manifest = readInstalledPluginManifestSync(dirent.name);
            if (!manifest || registry.enabled[manifest.id] === false || !manifest.commands.length) continue;
            entries.push({
                label: `${manifest.icon || '🧩'} ${manifest.name}`,
                submenu: manifest.commands.map((command) => ({
                    label: command.label,
                    click: () => sendMenuAction({ type: 'plugin:command', pluginId: manifest.id, commandId: command.id })
                }))
            });
        }
        return entries.sort((a, b) => a.label.localeCompare(b.label, 'fr'));
    } catch (_) {
        return [];
    }
}

async function installedPluginsState() {
    await fs.mkdir(pluginsRootDir(), { recursive: true });
    const registry = await loadPluginRegistry();
    const entries = await fs.readdir(pluginsRootDir(), { withFileTypes: true });
    const plugins = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        try {
            const manifest = validatePluginManifest(await readJson(path.join(pluginsRootDir(), entry.name, 'manifest.json')));
            plugins.push({
                ...manifest,
                enabled: registry.enabled[manifest.id] !== false,
                installedPath: path.join(pluginsRootDir(), manifest.id),
                hasProjectData: Boolean(currentProjectDir && fsSync.existsSync(path.join(currentProjectDir, 'extensions', manifest.id, 'data.json')))
            });
        } catch (_) {
            // Une extension illisible n’empêche pas l’ouverture du gestionnaire.
        }
    }
    plugins.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    return {
        apiVersion: PLUGIN_API_VERSION,
        plugins,
        projectOpen: Boolean(currentProjectDir),
        extensionsFolder: pluginsRootDir()
    };
}

async function installPluginPackage() {
    const picked = await dialog.showOpenDialog(mainWindow, {
        title: 'Installer une extension Écrivain',
        properties: ['openFile'],
        filters: [
            { name: 'Extension Écrivain', extensions: ['ecrivain-plugin'] },
            { name: 'Tous les fichiers', extensions: ['*'] }
        ]
    });
    if (picked.canceled || !picked.filePaths?.[0]) return { canceled: true };

    const source = picked.filePaths[0];
    const stat = await fs.stat(source);
    if (stat.size > PLUGIN_MAX_PACKAGE_BYTES) throw new Error('Le fichier d’extension dépasse la taille maximale autorisée (2 Mo).');

    let pkg;
    try {
        pkg = JSON.parse(await fs.readFile(source, 'utf8'));
    } catch (_) {
        throw new Error('Le fichier .ecrivain-plugin n’est pas un paquet Écrivain valide.');
    }
    if (pkg?.format !== PLUGIN_PACKAGE_FORMAT || Number(pkg?.packageVersion) !== PLUGIN_PACKAGE_VERSION) {
        throw new Error('Format de paquet d’extension non reconnu.');
    }

    const manifest = validatePluginManifest(pkg.manifest || {});
    const code = String(pkg.code || '');
    const style = String(pkg.style || '');
    if (!code.trim()) throw new Error('L’extension ne contient aucun code.');
    if (Buffer.byteLength(code, 'utf8') > PLUGIN_MAX_CODE_BYTES) throw new Error('Le code de l’extension est trop volumineux.');
    if (Buffer.byteLength(style, 'utf8') > PLUGIN_MAX_STYLE_BYTES) throw new Error('La feuille de style de l’extension est trop volumineuse.');

    const target = pluginDir(manifest.id);
    if (fsSync.existsSync(target)) {
        const answer = await dialog.showMessageBox(mainWindow, {
            type: 'question',
            title: 'Remplacer l’extension ?',
            message: `${manifest.name} est déjà installée.`,
            detail: `Installer la version ${manifest.version} à la place de la version existante ?`,
            buttons: ['Annuler', 'Remplacer'],
            defaultId: 1,
            cancelId: 0,
            noLink: true
        });
        if (answer.response !== 1) return { canceled: true };
        await fs.rm(target, { recursive: true, force: true });
    }

    await fs.mkdir(target, { recursive: true });
    await writeJson(path.join(target, 'manifest.json'), manifest);
    await fs.writeFile(path.join(target, 'plugin.js'), code, 'utf8');
    if (style.trim()) await fs.writeFile(path.join(target, 'style.css'), style, 'utf8');

    const registry = await loadPluginRegistry();
    registry.enabled[manifest.id] = true;
    await savePluginRegistry(registry);
    buildMenu();
    return { canceled: false, installed: manifest.id, state: await installedPluginsState() };
}

async function togglePlugin(pluginId, enabled) {
    const id = safePluginId(pluginId);
    const manifestFile = path.join(pluginDir(id), 'manifest.json');
    if (!fsSync.existsSync(manifestFile)) throw new Error('Extension introuvable.');
    const registry = await loadPluginRegistry();
    registry.enabled[id] = Boolean(enabled);
    await savePluginRegistry(registry);
    buildMenu();
    return installedPluginsState();
}

async function uninstallPlugin(pluginId) {
    const id = safePluginId(pluginId);
    const manifestFile = path.join(pluginDir(id), 'manifest.json');
    let name = id;
    if (fsSync.existsSync(manifestFile)) {
        try { name = validatePluginManifest(await readJson(manifestFile)).name || id; } catch (_) {}
    }
    const answer = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Désinstaller l’extension ?',
        message: `Désinstaller « ${name} » ?`,
        detail: 'Les données enregistrées par cette extension dans vos projets seront conservées. Vous pourrez réinstaller l’extension plus tard.',
        buttons: ['Annuler', 'Désinstaller'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
    });
    if (answer.response !== 1) return installedPluginsState();
    await fs.rm(pluginDir(id), { recursive: true, force: true });
    const registry = await loadPluginRegistry();
    delete registry.enabled[id];
    await savePluginRegistry(registry);
    buildMenu();
    return installedPluginsState();
}

async function pluginRuntime(pluginId) {
    const id = safePluginId(pluginId);
    const registry = await loadPluginRegistry();
    if (registry.enabled[id] === false) throw new Error('Cette extension est désactivée.');
    const dir = pluginDir(id);
    const manifest = validatePluginManifest(await readJson(path.join(dir, 'manifest.json')));
    const code = await fs.readFile(path.join(dir, 'plugin.js'), 'utf8');
    let style = '';
    try { style = await fs.readFile(path.join(dir, 'style.css'), 'utf8'); } catch (_) {}
    return { apiVersion: PLUGIN_API_VERSION, manifest, code, style };
}

async function installedPluginManifest(pluginId) {
    const id = safePluginId(pluginId);
    const registry = await loadPluginRegistry();
    if (registry.enabled[id] === false) throw new Error('Cette extension est désactivée.');
    return validatePluginManifest(await readJson(path.join(pluginDir(id), 'manifest.json')));
}

function requirePluginPermission(manifest, permission) {
    if (!manifest.permissions.includes(permission)) {
        throw new Error(`L’extension « ${manifest.name} » n’a pas la permission ${permission}.`);
    }
}

async function pluginApiRequest(pluginId, method, params = {}) {
    const manifest = await installedPluginManifest(pluginId);
    const action = String(method || '').trim();

    if (action === 'app.version') {
        return { appVersion: APP_VERSION, apiVersion: PLUGIN_API_VERSION };
    }

    if (action === 'project.getCurrent') {
        requirePluginPermission(manifest, 'project.read');
        if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
        const project = await readJson(path.join(currentProjectDir, 'project.json'));
        return {
            id: project.id || '',
            title: project.title || '',
            author: project.author || '',
            language: project.language || 'fr',
            format: project.format || PROJECT_FORMAT_ID,
            formatVersion: Number(project.formatVersion || PROJECT_FORMAT_VERSION),
            schemaVersion: project.schemaVersion || PROJECT_SCHEMA_VERSION
        };
    }

    if (action === 'chapters.list') {
        requirePluginPermission(manifest, 'chapters.read');
        if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
        return flattenTree(await listChapters(currentProjectDir)).map((chapter) => ({
            id: chapter.id,
            title: chapter.title || '',
            parent: chapter.parent || null,
            position: Number(chapter.position || 0),
            status: chapter.status || 'draft',
            wordCount: Number(chapter.wordCount || 0),
            depth: Number(chapter._depth || 0)
        }));
    }

    if (action === 'chapters.get') {
        requirePluginPermission(manifest, 'chapters.read');
        if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
        const id = String(params?.id || '').trim();
        const chapters = await listChapters(currentProjectDir);
        const chapter = chapters.find((item) => item.id === id);
        if (!chapter) throw new Error('Chapitre introuvable.');
        return {
            id: chapter.id,
            title: chapter.title || '',
            parent: chapter.parent || null,
            position: Number(chapter.position || 0),
            status: chapter.status || 'draft',
            content: chapter.content || '',
            wordCount: Number(chapter.wordCount || 0),
            updatedAt: chapter.updatedAt || ''
        };
    }

    if (action === 'chapters.readAll') {
        requirePluginPermission(manifest, 'chapters.read');
        if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
        return flattenTree(await listChapters(currentProjectDir)).map((chapter) => ({
            id: chapter.id,
            title: chapter.title || '',
            parent: chapter.parent || null,
            position: Number(chapter.position || 0),
            status: chapter.status || 'draft',
            content: chapter.content || '',
            wordCount: Number(chapter.wordCount || 0),
            depth: Number(chapter._depth || 0),
            updatedAt: chapter.updatedAt || ''
        }));
    }

    if (action === 'storage.read') {
        requirePluginPermission(manifest, 'storage.read');
        if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
        const file = path.join(currentProjectDir, 'extensions', manifest.id, 'data.json');
        if (!fsSync.existsSync(file)) return null;
        return readJson(file);
    }

    if (action === 'storage.write') {
        requirePluginPermission(manifest, 'storage.write');
        if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
        const json = JSON.stringify(params?.value ?? null);
        if (Buffer.byteLength(json, 'utf8') > PLUGIN_MAX_STORAGE_BYTES) throw new Error('Les données de l’extension dépassent 512 Ko pour ce projet.');
        const dir = path.join(currentProjectDir, 'extensions', manifest.id);
        await fs.mkdir(dir, { recursive: true });
        await writeJson(path.join(dir, 'data.json'), params?.value ?? null);
        return true;
    }

    throw new Error(`Commande d’API inconnue : ${action}`);
}

async function openPluginsFolder() {
    await fs.mkdir(pluginsRootDir(), { recursive: true });
    const result = await shell.openPath(pluginsRootDir());
    if (result) throw new Error(result);
    return true;
}

function sendMenuAction(action) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('menu:action', action);
    }
}


function persistUiZoomSync(value) {
    const current = loadPreferencesSync();
    const prefs = sanitizePreferences({ ...current, uiZoom: value });
    try {
        fsSync.mkdirSync(path.dirname(preferencesFile()), { recursive: true });
        fsSync.writeFileSync(preferencesFile(), `${JSON.stringify(prefs, null, 2)}\n`, 'utf8');
    } catch (_) {}
    return prefs.uiZoom;
}

function currentWindowState() {
    if (!mainWindow || mainWindow.isDestroyed()) return { fullscreen: false, zoom: loadPreferencesSync().uiZoom };
    return {
        fullscreen: mainWindow.isFullScreen(),
        zoom: mainWindow.webContents.getZoomFactor()
    };
}

function emitWindowState() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('window:state-changed', currentWindowState());
}

function setMainZoom(value, persist = true) {
    if (!mainWindow || mainWindow.isDestroyed()) return currentWindowState();
    const n = Number(value);
    const clamped = Math.round(Math.min(1.5, Math.max(0.8, Number.isFinite(n) ? n : 1)) * 20) / 20;
    mainWindow.webContents.setZoomFactor(clamped);
    if (persist) persistUiZoomSync(clamped);
    emitWindowState();
    return currentWindowState();
}

function adjustMainZoom(delta) {
    const current = mainWindow?.webContents?.getZoomFactor?.() || 1;
    return setMainZoom(current + Number(delta || 0), true);
}

function resetMainZoom() {
    return setMainZoom(1, true);
}

function setMainFullscreen(value) {
    if (!mainWindow || mainWindow.isDestroyed()) return currentWindowState();
    mainWindow.setFullScreen(Boolean(value));
    return currentWindowState();
}

function toggleMainFullscreen() {
    if (!mainWindow || mainWindow.isDestroyed()) return currentWindowState();
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
    return currentWindowState();
}

async function openExternalUrl(rawUrl) {
    const url = String(rawUrl || '').trim();
    if (!/^https:\/\//i.test(url)) throw new Error('Seuls les liens HTTPS sont autorisés.');
    await shell.openExternal(url);
    return true;
}

function buildMenu() {
    const template = [
        {
            label: 'Fichier',
            submenu: [
                { label: 'Nouveau projet…', accelerator: 'CmdOrCtrl+N', click: () => sendMenuAction('project:new') },
                { label: 'Ouvrir un projet…', accelerator: 'CmdOrCtrl+O', click: () => sendMenuAction('project:open') },
                {
                    label: 'Projets récents',
                    submenu: (() => {
                        const recent = loadRecentProjectsSync();
                        if (!recent.length) return [{ label: 'Aucun projet récent', enabled: false }];
                        return recent.map((projectDir, index) => ({
                            label: `${index + 1}. ${recentProjectTitle(projectDir)}`,
                            click: () => sendMenuAction({ type: 'project:openRecent', projectDir })
                        }));
                    })()
                },
                { type: 'separator' },
                { label: 'Enregistrer', accelerator: 'CmdOrCtrl+S', click: () => sendMenuAction('chapter:save') },
                { type: 'separator' },
                {
                    label: 'Exporter',
                    submenu: [
                        { label: 'Markdown (.md)', click: () => sendMenuAction('export:md') },
                        { label: 'Word (.docx)', click: () => sendMenuAction('export:docx') },
                        { label: 'OpenDocument (.odt)', click: () => sendMenuAction('export:odt') },
                        { label: 'EPUB (.epub)', click: () => sendMenuAction('export:epub') },
                        { label: 'PDF (.pdf)', click: () => sendMenuAction('export:pdf') }
                    ]
                },
                { type: 'separator' },
                { label: 'Quitter', accelerator: 'Alt+F4', role: 'quit' }
            ]
        },
        {
            label: 'Édition',
            submenu: [
                { label: 'Annuler', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
                { label: 'Rétablir', accelerator: 'CmdOrCtrl+Y', role: 'redo' },
                { type: 'separator' },
                { label: 'Couper', accelerator: 'CmdOrCtrl+X', role: 'cut' },
                { label: 'Copier', accelerator: 'CmdOrCtrl+C', role: 'copy' },
                { label: 'Coller', accelerator: 'CmdOrCtrl+V', role: 'paste' },
                { label: 'Tout sélectionner', accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
                { type: 'separator' },
                { label: 'Rechercher dans le chapitre…', accelerator: 'CmdOrCtrl+F', click: () => sendMenuAction('edit:findChapter') },
                { label: 'Remplacer dans le chapitre…', accelerator: 'CmdOrCtrl+H', click: () => sendMenuAction('edit:replaceChapter') },
                { type: 'separator' },
                { label: 'Rechercher dans le projet…', accelerator: 'CmdOrCtrl+Shift+F', click: () => sendMenuAction('edit:findProject') },
                { label: 'Remplacer dans tout le projet…', accelerator: 'CmdOrCtrl+Shift+H', click: () => sendMenuAction('edit:replaceProject') }
            ]
        },
        {
            label: 'Affichage',
            submenu: [
                { label: 'Afficher/masquer les chapitres', accelerator: 'CmdOrCtrl+B', click: () => sendMenuAction('view:sidebar') },
                { label: 'Afficher les caractères invisibles', type: 'checkbox', accelerator: 'F6', click: () => sendMenuAction('view:invisibles') },
                { type: 'separator' },
                { label: 'Zoom avant', accelerator: 'CmdOrCtrl+Plus', click: () => adjustMainZoom(0.05) },
                { label: 'Zoom arrière', accelerator: 'CmdOrCtrl+-', click: () => adjustMainZoom(-0.05) },
                { label: 'Taille réelle', accelerator: 'CmdOrCtrl+0', click: () => resetMainZoom() },
                { type: 'separator' },
                { label: 'Plein écran / quitter le plein écran', accelerator: 'F11', click: () => toggleMainFullscreen() }
            ]
        },
        {
            label: 'Projet',
            submenu: [
                { label: 'Informations du projet…', click: () => sendMenuAction('project:info') },
                { label: 'Configuration du document…', click: () => sendMenuAction('project:layout') },
                { label: 'Vérifier et réparer le projet…', click: () => sendMenuAction('project:verify') },
                { type: 'separator' },
                { label: 'Synopsis global', click: () => sendMenuAction('feature:globalSynopsis') },
                { label: 'Synoptique', click: () => sendMenuAction('feature:synopsis') },
                { label: 'Notes', click: () => sendMenuAction('feature:notes') },
                { label: 'Chronologie', click: () => sendMenuAction('feature:timeline') },
                { label: 'Carte mentale', click: () => sendMenuAction('feature:mindmap') },
                { label: 'Statistiques', click: () => sendMenuAction('feature:stats') },
                { type: 'separator' },
                { label: 'Sauvegardes', click: () => sendMenuAction('feature:backups') },
                { label: 'Historique', click: () => sendMenuAction('feature:history') }
            ]
        },
        {
            label: 'Chapitres',
            submenu: [
                { label: 'Nouveau chapitre…', accelerator: 'CmdOrCtrl+Shift+N', click: () => sendMenuAction('chapter:new') },
                { label: 'Nouveau sous-chapitre…', click: () => sendMenuAction('chapter:newChild') },
                { type: 'separator' },
                { label: 'Dupliquer le chapitre', click: () => sendMenuAction('chapter:duplicate') },
                { label: 'Renommer le chapitre…', click: () => sendMenuAction('chapter:rename') },
                { type: 'separator' },
                { label: 'Transformer en sous-chapitre du précédent', accelerator: 'Alt+Right', click: () => sendMenuAction('chapter:indent') },
                { label: 'Remonter d’un niveau', accelerator: 'Alt+Left', click: () => sendMenuAction('chapter:outdent') },
                { type: 'separator' },
                { label: 'Supprimer le chapitre…', click: () => sendMenuAction('chapter:delete') }
            ]
        },
        {
            label: 'Outils',
            submenu: [
                { label: 'Typographie française', click: () => sendMenuAction('tool:typography') },
                { label: 'Assistant IA', click: () => sendMenuAction('tool:ai') },
                { type: 'separator' },
                {
                    label: 'Extensions',
                    submenu: [
                        { label: 'Gérer les extensions…', click: () => sendMenuAction('tool:plugins') },
                        ...(() => {
                            const items = enabledPluginMenuEntriesSync();
                            return items.length ? [{ type: 'separator' }, ...items] : [];
                        })()
                    ]
                },
                { label: 'Préférences', click: () => sendMenuAction('tool:preferences') }
            ]
        },
        {
            label: 'Aide',
            submenu: [
                { label: 'Guide de prise en main', click: () => sendMenuAction('help:guide') },
                { label: 'Raccourcis clavier', click: () => sendMenuAction('help:shortcuts') },
                { type: 'separator' },
                { label: 'Informations techniques', click: () => sendMenuAction('help:systemInfo') },
                { label: 'Créer un rapport de diagnostic…', click: () => createDiagnosticReport().catch((error) => writeDiagnostic('ERROR', 'Création du rapport impossible.', error)) },
                { label: 'Ouvrir les journaux', click: () => openDiagnosticFolder().catch((error) => writeDiagnostic('ERROR', 'Ouverture du journal impossible.', error)) },
                { type: 'separator' },
                { label: 'À propos d’Écrivain', click: () => sendMenuAction('help:about') }
            ]
        }
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 920,
        minWidth: 1050,
        minHeight: 680,
        show: false,
        backgroundColor: '#f5f1e8',
        title: 'Écrivain',
        icon: path.join(__dirname, 'assets', 'branding', 'ecrivain-logo.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });

    mainWindow.loadFile('index.html');
    mainWindow.webContents.setZoomFactor(loadPreferencesSync().uiZoom);

    // Raccourcis gérés directement par la fenêtre pour rester fiables,
    // y compris avec les claviers AZERTY et lorsque la barre de menus est masquée.
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') return;
        const key = String(input.key || '');
        const code = String(input.code || '');
        const ctrl = Boolean(input.control || input.meta);

        if (key === 'Escape' && mainWindow?.isFullScreen()) {
            event.preventDefault();
            mainWindow.setFullScreen(false);
            return;
        }
        if (key === 'F11') {
            event.preventDefault();
            toggleMainFullscreen();
            return;
        }
        if (!ctrl) return;

        const zoomIn = ['+', '='].includes(key) || ['Equal', 'NumpadAdd'].includes(code);
        const zoomOut = key === '-' || ['Minus', 'NumpadSubtract'].includes(code);
        const zoomReset = key === '0' || ['Digit0', 'Numpad0'].includes(code);
        if (zoomIn) { event.preventDefault(); adjustMainZoom(0.05); }
        else if (zoomOut) { event.preventDefault(); adjustMainZoom(-0.05); }
        else if (zoomReset) { event.preventDefault(); resetMainZoom(); }
    });

    mainWindow.on('enter-full-screen', emitWindowState);
    mainWindow.on('leave-full-screen', emitWindowState);
    mainWindow.webContents.on('did-finish-load', emitWindowState);
    mainWindow.webContents.on('render-process-gone', (_event, details) => writeDiagnostic('ERROR', 'Le processus d’affichage s’est arrêté.', details));
    mainWindow.webContents.on('unresponsive', () => writeDiagnostic('WARN', 'La fenêtre d’Écrivain ne répond plus.'));
    mainWindow.webContents.on('responsive', () => writeDiagnostic('INFO', 'La fenêtre d’Écrivain répond de nouveau.'));
    mainWindow.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
        if (isMainFrame) writeDiagnostic('ERROR', 'Échec du chargement de l’interface.', { code, description, url });
    });
    mainWindow.once('ready-to-show', () => mainWindow.show());
    mainWindow.on('closed', () => { mainWindow = null; });
}

ipcMain.handle('project:create', async (_event, metadata) => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Choisir le dossier où créer le projet',
        defaultPath: loadPreferencesSync().defaultProjectsDir || undefined,
        properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const state = await createProject(result.filePaths[0], metadata || {});
    return { canceled: false, ...state };
});

ipcMain.handle('project:open', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Ouvrir un projet Écrivain',
        defaultPath: loadPreferencesSync().defaultProjectsDir || undefined,
        properties: ['openDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const opened = await openProjectDirectory(result.filePaths[0]);
    return { canceled: false, ...opened.state, healthReport: opened.report };
});

ipcMain.handle('project:openRecent', async (_event, projectDir) => {
    const dir = path.resolve(String(projectDir || ''));
    if (!dir || !fsSync.existsSync(dir)) {
        forgetRecentProject(dir);
        throw new Error('Ce projet récent est introuvable ou a été déplacé.');
    }
    try {
        const opened = await openProjectDirectory(dir);
        return { canceled: false, ...opened.state, healthReport: opened.report };
    } catch (error) {
        if (!fsSync.existsSync(path.join(dir, 'project.json'))) forgetRecentProject(dir);
        throw error;
    }
});

ipcMain.handle('project:state', async () => loadCurrentProject());
ipcMain.handle('project:verify', async () => verifyCurrentProject());
ipcMain.handle('project:updateLayout', async (_event, settings) => updateProjectLayout(settings || {}));
ipcMain.handle('chapter:create', async (_event, data) => createChapter(data?.title, data?.parent || null));
ipcMain.handle('chapter:save', async (_event, chapter, options) => saveChapter(chapter, options || {}));
ipcMain.handle('chapter:duplicate', async (_event, chapterId) => duplicateChapter(chapterId));
ipcMain.handle('chapter:delete', async (_event, chapterId) => deleteChapter(chapterId));
ipcMain.handle('chapter:changeLevel', async (_event, chapterId, direction) => changeChapterLevel(chapterId, direction));
ipcMain.handle('chapters:reorder', async (_event, orderedIds) => reorderChapters(Array.isArray(orderedIds) ? orderedIds : []));
ipcMain.handle('export:markdown', async () => exportMarkdown());
ipcMain.handle('export:docx', async () => exportDocx());
ipcMain.handle('export:odt', async () => exportOdt());
ipcMain.handle('export:epub', async () => exportEpub());
ipcMain.handle('export:pdf', async () => exportPdf());
ipcMain.handle('globalSynopsis:state', async () => globalSynopsisState());
ipcMain.handle('globalSynopsis:save', async (_event, data) => saveGlobalSynopsis(data || {}));
ipcMain.handle('synopsis:state', async () => synopsisState());
ipcMain.handle('synopsis:save', async (_event, data) => saveSynopsisCard(data || {}));
ipcMain.handle('synopsis:delete', async (_event, cardId) => deleteSynopsisCard(cardId));
ipcMain.handle('synopsis:reorder', async (_event, ids) => reorderSynopsisCards(Array.isArray(ids) ? ids : []));
ipcMain.handle('notes:state', async () => notesState());
ipcMain.handle('notes:saveText', async (_event, data) => saveTextNote(data || {}));
ipcMain.handle('notes:pickAttachment', async () => pickNoteAttachment());
ipcMain.handle('notes:saveFile', async (_event, data) => saveFileNote(data || {}));
ipcMain.handle('notes:delete', async (_event, noteId) => deleteNote(noteId));
ipcMain.handle('notes:openFile', async (_event, noteId) => openNoteAttachment(noteId));
ipcMain.handle('notes:openFolder', async () => openNotesAttachmentsFolder());
ipcMain.handle('notes:cnrtl', async (_event, mode, word) => openCnrtl(mode, word));
ipcMain.handle('timeline:state', async () => timelineState());
ipcMain.handle('timeline:save', async (_event, data) => saveTimelineEvent(data || {}));
ipcMain.handle('timeline:delete', async (_event, eventId) => deleteTimelineEvent(eventId));
ipcMain.handle('timeline:move', async (_event, data) => moveTimelineEvent(data || {}));
ipcMain.handle('timeline:savePalette', async (_event, entries) => saveTimelinePalette(entries || {}));
ipcMain.handle('mindmap:state', async () => mindmapState());
ipcMain.handle('mindmap:save', async (_event, graph) => saveMindmapGraph(graph || {}));
ipcMain.handle('mindmap:exportPng', async (_event, dataUrl) => exportMindmapPng(dataUrl));
ipcMain.handle('stats:state', async () => statisticsState());
ipcMain.handle('backups:state', async () => projectBackupsState());
ipcMain.handle('search:project', async (_event, query, options) => searchProjectChapters(query, options || {}));
ipcMain.handle('search:replaceProject', async (_event, query, replacement, options) => replaceAcrossProject(query, replacement, options || {}));
ipcMain.handle('backups:create', async (_event, reason) => createProjectBackup(String(reason || 'Sauvegarde manuelle')));
ipcMain.handle('backups:restore', async (_event, backupId) => restoreProjectBackup(backupId));
ipcMain.handle('backups:openFolder', async () => openProjectBackupsFolder());
ipcMain.handle('history:state', async (_event, chapterId) => chapterHistoryState(chapterId));
ipcMain.handle('history:get', async (_event, chapterId, versionId) => getChapterHistoryVersion(chapterId, versionId));
ipcMain.handle('history:restore', async (_event, chapterId, versionId) => restoreChapterHistoryVersion(chapterId, versionId));
ipcMain.handle('ai:settings', async () => publicAiSettings());
ipcMain.handle('ai:saveSettings', async (_event, payload) => updateAiSettings(payload || {}));
ipcMain.handle('ai:test', async (_event, payload) => testAiConnection(payload?.provider));
ipcMain.handle('ai:models', async (_event, payload) => listAiModels(payload?.provider));
ipcMain.handle('ai:openGuide', async (_event, payload) => openAiProviderGuide(payload?.provider));
ipcMain.handle('ai:run', async (_event, payload) => runAiRequest(payload || {}));


ipcMain.handle('plugins:state', async () => installedPluginsState());
ipcMain.handle('plugins:install', async () => installPluginPackage());
ipcMain.handle('plugins:toggle', async (_event, pluginId, enabled) => togglePlugin(pluginId, enabled));
ipcMain.handle('plugins:uninstall', async (_event, pluginId) => uninstallPlugin(pluginId));
ipcMain.handle('plugins:runtime', async (_event, pluginId) => pluginRuntime(pluginId));
ipcMain.handle('plugins:api', async (_event, pluginId, method, params) => pluginApiRequest(pluginId, method, params || {}));
ipcMain.handle('plugins:openFolder', async () => openPluginsFolder());

ipcMain.handle('preferences:state', async () => preferencesState());
ipcMain.handle('preferences:save', async (_event, payload) => savePreferences(payload || {}));
ipcMain.handle('preferences:reset', async () => savePreferences({ ...DEFAULT_PREFERENCES }));
ipcMain.handle('preferences:pickProjectsDir', async () => pickDefaultProjectsDirectory());
ipcMain.handle('app:info', async () => applicationInfo());
ipcMain.handle('app:openDataFolder', async () => openApplicationDataFolder());
ipcMain.handle('app:openExternal', async (_event, url) => openExternalUrl(url));
ipcMain.handle('diagnostics:log', async (_event, level, message, details) => { writeDiagnostic(level, message, details); return true; });
ipcMain.handle('diagnostics:openFolder', async () => openDiagnosticFolder());
ipcMain.handle('diagnostics:report', async () => createDiagnosticReport());
ipcMain.handle('window:state', async () => currentWindowState());
ipcMain.handle('window:toggleFullscreen', async () => toggleMainFullscreen());
ipcMain.handle('window:exitFullscreen', async () => setMainFullscreen(false));
ipcMain.handle('window:setZoom', async (_event, zoom) => setMainZoom(zoom, true));
ipcMain.handle('window:adjustZoom', async (_event, delta) => adjustMainZoom(delta));
ipcMain.handle('window:resetZoom', async () => resetMainZoom());
ipcMain.handle('project:updateInfo', async (_event, metadata) => updateProjectInfo(metadata || {}));
ipcMain.handle('project:openFolder', async () => openCurrentProjectFolder());

process.on('uncaughtException', (error) => {
    writeDiagnostic('ERROR', 'Exception non interceptée dans le processus principal.', error);
    process.exit(1);
});
process.on('unhandledRejection', (reason) => {
    writeDiagnostic('ERROR', 'Promesse rejetée sans gestionnaire dans le processus principal.', reason);
});
app.on('child-process-gone', (_event, details) => {
    writeDiagnostic('ERROR', 'Un processus enfant Electron s’est arrêté.', details);
});
app.on('before-quit', closeDiagnosticSession);

if (HAS_SINGLE_INSTANCE_LOCK) {
    app.whenReady().then(() => {
        if (process.platform === 'win32') app.setAppUserModelId('Ecrivain.App');
        initializeDiagnostics();
        buildMenu();
        createWindow();

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });
    });
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
