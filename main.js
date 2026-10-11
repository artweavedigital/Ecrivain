const { app, BrowserWindow, Menu, dialog, ipcMain, shell, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const fsSafe = require('./lib/fs-safe');
const { makeZip } = require('./lib/zip');
const Text = require('./shared/text-utils');
const { pathToFileURL } = require('node:url');
const crypto = require('node:crypto');

let mainWindow = null;
let currentProjectDir = null;

const PROJECT_FORMAT_ID = 'ecrivain-project';
const PROJECT_FORMAT_VERSION = 1;
const PROJECT_SCHEMA_VERSION = '1.5.0';
const APP_VERSION = '0.6.0-beta.11.1';
const MAX_RECENT_PROJECTS = 5;

// Réglages d'export et vocabulaire des chapitres.
const CHAPTER_STATUSES = ['draft', 'writing', 'review', 'final', 'cut'];
const DEFAULT_EXPORT_EXCLUDED_STATUSES = ['cut'];
// En-têtes courants : aucun, titre du livre, nom de l'auteur, ou — comme dans
// l'édition française — nom de l'auteur sur les pages paires et titre sur les impaires.
const RUNNING_HEADERS = ['none', 'title', 'author', 'author-title'];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    externalBackupDir: '',
    recentProjectsLimit: 5,
    autosaveDelayMs: 1800,
    spellcheckEnabled: true,
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
    const spellcheckEnabled = input.spellcheckEnabled !== false;
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
        externalBackupDir: String(input.externalBackupDir || '').trim(),
        recentProjectsLimit,
        autosaveDelayMs,
        spellcheckEnabled,
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
    await fsSafe.writeJsonAtomic(preferencesFile(), prefs);

    // Nettoyer la liste si l'utilisateur réduit le nombre de projets récents.
    saveRecentProjectsSync(loadRecentProjectsSync().slice(0, prefs.recentProjectsLimit));
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.setZoomFactor(prefs.uiZoom);
        applySpellCheckerPreferences(prefs);
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


function applySpellCheckerPreferences(prefs = loadPreferencesSync()) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
        const ses = mainWindow.webContents.session;
        const enabled = prefs?.spellcheckEnabled !== false;
        ses.setSpellCheckerEnabled(enabled);
        if (!enabled || process.platform === 'darwin') return;

        const available = Array.isArray(ses.availableSpellCheckerLanguages)
            ? ses.availableSpellCheckerLanguages
            : [];
        const french = available.find((code) => String(code).toLowerCase() === 'fr')
            || available.find((code) => String(code).toLowerCase() === 'fr-fr')
            || available.find((code) => String(code).toLowerCase().startsWith('fr'));
        if (french) {
            ses.setSpellCheckerLanguages([french]);
            writeDiagnostic('INFO', 'Correcteur orthographique activé.', { language: french });
        } else {
            writeDiagnostic('WARN', 'Aucun dictionnaire français Hunspell n’est annoncé par Electron.');
        }
    } catch (error) {
        writeDiagnostic('WARN', 'Initialisation du correcteur orthographique impossible.', error);
    }
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

async function pickExternalBackupDirectory() {
    const prefs = loadPreferencesSync();
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Choisir le dossier de sauvegarde externe',
        defaultPath: prefs.externalBackupDir || undefined,
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

// Écriture atomique (fichier temporaire unique + fsync + renommage), sérialisée
// par fichier : deux enregistrements simultanés ne peuvent plus se mélanger.
async function writeJson(filePath, data) {
    return fsSafe.writeJsonAtomic(filePath, data);
}

// Chemins dérivés d'un identifiant : toujours validés, jamais construits à la main.
function chapterFile(chapterId, projectDir = currentProjectDir) {
    if (!projectDir) throw new Error('Aucun projet ouvert.');
    return fsSafe.resolveInside(projectDir, 'chapters', `${fsSafe.safeSegment(chapterId, 'Identifiant de chapitre')}.json`);
}

function chapterHistoryDir(chapterId, projectDir = currentProjectDir) {
    if (!projectDir) throw new Error('Aucun projet ouvert.');
    return fsSafe.resolveInside(projectDir, 'history', fsSafe.safeSegment(chapterId, 'Identifiant de chapitre'));
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
    const historyDir = chapterHistoryDir(chapterId, projectDir);
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

    const backup = await findValidJsonInBackups(projectDir, path.join('chapters', `${fsSafe.safeSegment(chapterId, 'Identifiant de chapitre')}.json`));
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
    // Identifiant stable du livre (utilisé par l'EPUB). Champ additif : les anciennes
    // versions d'Écrivain l'ignorent et le conservent.
    if (!UUID_PATTERN.test(String(next.uuid || ''))) {
        next.uuid = crypto.randomUUID();
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
    await fsSafe.cleanStaleTempFiles(chapterDir);
    await fsSafe.cleanStaleTempFiles(projectDir);
    const migratedWordCounts = {};
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

            // Migration silencieuse du comptage de mots (méthode unique depuis la bêta.11).
            // Ce n'est pas une réparation : rien n'est signalé à l'auteur, et les
            // instantanés de statistiques sont recalés pour ne créer aucun « mot ajouté ».
            if (normalizedChapter.wcv !== Text.WORD_COUNT_VERSION && typeof normalizedChapter.content === 'string') {
                normalizedChapter.wordCount = Text.countWordsFromHtml(normalizedChapter.content);
                normalizedChapter.wcv = Text.WORD_COUNT_VERSION;
                await writeJson(file, normalizedChapter);
                migratedWordCounts[normalizedChapter.id || stem] = normalizedChapter.wordCount;
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

    if (Object.keys(migratedWordCounts).length) {
        try {
            const snapshotFile = path.join(projectDir, 'stats', 'chapter-snapshots.json');
            if (fsSync.existsSync(snapshotFile)) {
                await fsSafe.runExclusive(`stats:${projectDir}`, async () => {
                    const snapshots = await readJsonOrEmpty(snapshotFile);
                    for (const [chapterId, words] of Object.entries(migratedWordCounts)) {
                        if (Object.prototype.hasOwnProperty.call(snapshots, chapterId)) snapshots[chapterId] = words;
                    }
                    await writeJson(snapshotFile, snapshots);
                });
            }
        } catch (error) {
            writeDiagnostic('WARN', 'Recalage des statistiques de mots impossible.', error);
        }
        writeDiagnostic('INFO', 'Comptage de mots migré vers la méthode unique.', { chapters: Object.keys(migratedWordCounts).length });
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
    // Une valeur absente ou vide garde la valeur de repli (sinon « vide » vaudrait 0 et
    // ramènerait la page à sa taille minimale).
    const text = String(value ?? '').trim().replace(',', '.');
    if (!text) return fallback;
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function updateProjectLayout(settings = {}) {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const projectDir = currentProjectDir;
    return fsSafe.runExclusive(`project:${projectDir}`, () => updateProjectLayoutNow(settings, projectDir));
}

async function updateProjectLayoutNow(settings, projectDir) {
    const projectFile = path.join(projectDir, 'project.json');
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

    // Pagination et sélection des chapitres exportés.
    if (typeof settings.pageNumbers === 'boolean') project.pageNumbers = settings.pageNumbers;
    else if (typeof project.pageNumbers !== 'boolean') project.pageNumbers = true;
    if (RUNNING_HEADERS.includes(settings.runningHeader)) project.runningHeader = settings.runningHeader;
    else if (!RUNNING_HEADERS.includes(project.runningHeader)) project.runningHeader = 'none';
    if (Array.isArray(settings.exportExcludeStatuses)) {
        project.exportExcludeStatuses = [...new Set(settings.exportExcludeStatuses.map(String).filter((value) => CHAPTER_STATUSES.includes(value)))];
    } else if (!Array.isArray(project.exportExcludeStatuses)) {
        project.exportExcludeStatuses = [...DEFAULT_EXPORT_EXCLUDED_STATUSES];
    }

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

function updateProjectInfo(metadata = {}) {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const projectDir = currentProjectDir;
    return fsSafe.runExclusive(`project:${projectDir}`, () => updateProjectInfoNow(metadata, projectDir));
}

async function updateProjectInfoNow(metadata, projectDir) {
    const file = path.join(projectDir, 'project.json');
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
        uuid: crypto.randomUUID(),
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
        pageNumbers: true,
        runningHeader: 'none',
        exportExcludeStatuses: [...DEFAULT_EXPORT_EXCLUDED_STATUSES],
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
    await writeJson(chapterFile(id), chapter);
    return chapter;
}

function saveChapter(chapter, options = {}) {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    if (!chapter || !chapter.id) throw new Error('Chapitre invalide.');
    const projectDir = currentProjectDir;
    const id = fsSafe.safeSegment(chapter.id, 'Identifiant de chapitre');
    // Un enregistrement à la fois par chapitre : lecture, historique, écriture et
    // statistiques forment une séquence qui ne doit jamais s'entrecroiser.
    return fsSafe.runExclusive(`chapter:${projectDir}:${id}`, () => saveChapterNow(chapter, options));
}

async function saveChapterNow(chapter, options = {}) {
    const existingPath = chapterFile(chapter.id);
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

    // Un seul compteur de mots pour toute l'application (voir shared/text-utils.js).
    const html = String(chapter.content || '<p></p>');
    const wordCount = Text.countWordsFromHtml(html);

    const merged = {
        ...existing,
        ...chapter,
        parent: chapter.parent || null,
        position: Number(chapter.position || existing.position || 1),
        status: chapter.status || 'draft',
        content: html,
        wordCount,
        wcv: Text.WORD_COUNT_VERSION,
        createdAt: existing.createdAt || chapter.createdAt || nowString(),
        updatedAt: nowString()
    };

    await writeJson(existingPath, merged);

    // Statistiques d’écriture : on enregistre uniquement les mots réellement
    // ajoutés depuis la sauvegarde précédente. Une baisse de mots n'est pas
    // retranchée de l'historique quotidien, comme dans le module Zwii.
    // Si le chapitre a été compté avec l'ancienne méthode, on recompte son état
    // précédent avec la nouvelle : un changement de méthode ne crée aucun « mot ajouté ».
    if (!options?.skipStats) {
        try {
            const previousWords = existing.content === undefined
                ? 0
                : (existing.wcv === Text.WORD_COUNT_VERSION ? Number(existing.wordCount || 0) : Text.countWordsFromHtml(existing.content));
            await recordWritingStats(merged, previousWords, existing.wcv !== Text.WORD_COUNT_VERSION && existing.content !== undefined);
        } catch (_) {
            // Une erreur de statistiques ne doit jamais empêcher la sauvegarde.
        }
    }

    return merged;
}

async function duplicateChapter(chapterId) {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const sourcePath = chapterFile(chapterId);
    const source = await readJson(sourcePath);
    const duplicate = await createChapter(`${source.title || 'Chapitre'} — Copie`, source.parent || null);
    duplicate.status = source.status || 'draft';
    duplicate.content = source.content || '<p></p>';
    duplicate.wordCount = Number(source.wordCount || 0);
    return saveChapter(duplicate);
}

// Marque un chapitre (et donc ses sous-chapitres) comme exclu des exports.
async function setChapterExcluded(chapterId, excluded) {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const next = await patchChapterMeta(chapterId, { excludeFromExport: excluded === true }, { touch: false });
    return { id: next.id, excludeFromExport: next.excludeFromExport === true };
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

// -----------------------------------------------------------------------------
// Mise à jour des métadonnées d'un chapitre (position, parent) sans jamais
// écraser son texte : on relit le fichier courant sous le verrou du chapitre.
// -----------------------------------------------------------------------------
function patchChapterMeta(chapterId, patch = {}, { touch = true } = {}) {
    const projectDir = currentProjectDir;
    const id = fsSafe.safeSegment(chapterId, 'Identifiant de chapitre');
    return fsSafe.runExclusive(`chapter:${projectDir}:${id}`, async () => {
        const file = chapterFile(id, projectDir);
        const fresh = await readJson(file);
        const next = { ...fresh, ...patch };
        if (touch) next.updatedAt = nowString();
        await writeJson(file, next);
        return next;
    });
}

// -----------------------------------------------------------------------------
// Corbeille du projet
// Supprimer un chapitre ou une note ne détruit plus rien : les fichiers sont
// déplacés dans trash/<date>-<id>/ avec un manifeste, et peuvent être restaurés
// depuis Projet → Corbeille. Le dossier trash/ est additif (format de projet v1).
// -----------------------------------------------------------------------------
function trashRoot(projectDir = currentProjectDir) {
    if (!projectDir) throw new Error('Aucun projet ouvert.');
    return path.join(projectDir, 'trash');
}

function trashEntryDir(entryId) {
    return fsSafe.resolveInside(trashRoot(), fsSafe.safeSegment(entryId, 'Élément de corbeille'));
}

async function moveFileSafe(from, to) {
    await fs.mkdir(path.dirname(to), { recursive: true });
    try {
        await fs.rename(from, to);
    } catch (error) {
        if (error?.code !== 'EXDEV') throw error;
        await fs.copyFile(from, to);
        await fs.rm(from, { force: true });
    }
}

// Pièce jointe d'une note : le chemin enregistré dans la note ne peut désigner
// qu'un fichier de assets/notes/ à l'intérieur du projet (un projet reçu d'un
// tiers ne doit pas pouvoir viser un fichier extérieur).
function noteAssetFile(note) {
    const relative = String(note?.path || '').replace(/\\/g, '/');
    if (!relative.startsWith('assets/notes/')) throw new Error('Chemin de pièce jointe invalide.');
    const file = fsSafe.resolveInside(currentProjectDir, ...relative.split('/'));
    if (!fsSafe.isInside(path.join(currentProjectDir, 'assets', 'notes'), file)) throw new Error('Chemin de pièce jointe invalide.');
    return file;
}

function noteJsonFile(noteId) {
    const id = normalizeNoteId(noteId);
    if (!id) throw new Error('Identifiant de note invalide.');
    return path.join(currentProjectDir, 'notes', `${id}.json`);
}

async function moveNoteToTrash(noteId, entryDir) {
    const jsonFile = noteJsonFile(noteId);
    if (!fsSync.existsSync(jsonFile)) return null;
    let raw = {};
    try { raw = await readJson(jsonFile); } catch (_) {}
    const summary = {
        id: normalizeNoteId(noteId),
        title: String(raw.title || 'Note'),
        chapterId: String(raw.chapterId || ''),
        type: raw.type === 'file' ? 'file' : 'text',
        path: raw.type === 'file' ? String(raw.path || '') : '',
        originalName: String(raw.originalName || '')
    };
    if (summary.type === 'file' && summary.path) {
        try {
            const asset = noteAssetFile(raw);
            if (fsSync.existsSync(asset)) await moveFileSafe(asset, path.join(entryDir, 'files', ...summary.path.split('/')));
        } catch (error) {
            writeDiagnostic('WARN', 'Pièce jointe de note non déplacée vers la corbeille.', { note: summary.id, message: error.message });
        }
    }
    await moveFileSafe(jsonFile, path.join(entryDir, 'notes', `${summary.id}.json`));
    return summary;
}

async function chapterDeletionPreview(chapterId) {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    fsSafe.safeSegment(chapterId, 'Identifiant de chapitre');
    const chapters = await listChapters(currentProjectDir);
    const ids = await collectDescendants(chapters, chapterId);
    const byId = new Map(chapters.map((chapter) => [chapter.id, chapter]));
    let noteCount = 0;
    try {
        const notes = await listNotes();
        noteCount = notes.filter((note) => note.chapterId && ids.includes(note.chapterId)).length;
    } catch (_) {}
    return {
        chapters: ids.filter((id) => byId.has(id)).length,
        subchapters: Math.max(0, ids.filter((id) => byId.has(id)).length - 1),
        notes: noteCount,
        words: ids.reduce((sum, id) => sum + Number(byId.get(id)?.wordCount || 0), 0)
    };
}

async function deleteChapter(chapterId) {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    fsSafe.safeSegment(chapterId, 'Identifiant de chapitre');
    const projectDir = currentProjectDir;
    const chapters = await listChapters(projectDir);
    const ids = (await collectDescendants(chapters, chapterId)).filter((id) => chapters.some((chapter) => chapter.id === id));
    if (!ids.length) throw new Error('Chapitre introuvable.');
    const byId = new Map(chapters.map((chapter) => [chapter.id, chapter]));

    // On mémorise les notes liées AVANT de déplacer les chapitres, sinon leur
    // lien serait normalisé en « livre entier » lors d'une lecture ultérieure.
    let linkedNoteIds = [];
    try {
        const notes = await listNotes();
        linkedNoteIds = notes.filter((note) => note.chapterId && ids.includes(note.chapterId)).map((note) => note.id);
    } catch (_) {}

    const root = byId.get(chapterId);
    const entryId = `${compactTimestamp()}-${chapterId}`;
    const entryDir = trashEntryDir(entryId);
    await fs.mkdir(entryDir, { recursive: true });

    // Le manifeste est écrit en premier : si l'opération est interrompue, le
    // contenu déjà déplacé reste identifiable et restaurable.
    const manifest = {
        formatVersion: 1,
        id: entryId,
        kind: 'chapters',
        title: String(root?.title || 'Chapitre'),
        deletedAt: nowString(),
        rootChapterId: chapterId,
        chapters: ids.map((id) => ({
            id,
            title: String(byId.get(id)?.title || ''),
            parent: byId.get(id)?.parent || null,
            position: Number(byId.get(id)?.position || 0),
            wordCount: Number(byId.get(id)?.wordCount || 0)
        })),
        notes: [],
        wordCount: ids.reduce((sum, id) => sum + Number(byId.get(id)?.wordCount || 0), 0)
    };
    await writeJson(path.join(entryDir, 'manifest.json'), manifest);

    for (const id of ids) {
        await fsSafe.runExclusive(`chapter:${projectDir}:${id}`, () => moveFileSafe(chapterFile(id, projectDir), path.join(entryDir, 'chapters', `${id}.json`)));
    }

    // Les notes explicitement liées à un chapitre supprimé (ou à l'un de ses
    // sous-chapitres) suivent le chapitre ; les notes globales ne sont jamais touchées.
    for (const noteId of linkedNoteIds) {
        try {
            const summary = await moveNoteToTrash(noteId, entryDir);
            if (summary) manifest.notes.push(summary);
        } catch (error) {
            writeDiagnostic('WARN', 'Note liée non déplacée vers la corbeille.', { note: noteId, message: error.message });
        }
    }
    await writeJson(path.join(entryDir, 'manifest.json'), manifest);
    writeDiagnostic('INFO', 'Chapitre placé dans la corbeille.', { entry: entryId, chapters: ids.length, notes: manifest.notes.length });
    return ids;
}

async function listTrashEntries() {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const root = trashRoot();
    if (!fsSync.existsSync(root)) return [];
    const items = [];
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(entry.name)) continue;
        const dir = path.join(root, entry.name);
        let manifest = null;
        try { manifest = await readJson(path.join(dir, 'manifest.json')); } catch (_) {}
        items.push({
            id: entry.name,
            kind: manifest?.kind === 'note' ? 'note' : 'chapters',
            title: String(manifest?.title || entry.name),
            deletedAt: String(manifest?.deletedAt || ''),
            chapterCount: Array.isArray(manifest?.chapters) ? manifest.chapters.length : 0,
            noteCount: Array.isArray(manifest?.notes) ? manifest.notes.length : 0,
            wordCount: Number(manifest?.wordCount || 0),
            sizeBytes: await folderSizeBytes(dir),
            incomplete: !manifest
        });
    }
    items.sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)) || b.id.localeCompare(a.id));
    return items;
}

async function trashState() {
    const items = await listTrashEntries();
    return { items, totalBytes: items.reduce((sum, item) => sum + item.sizeBytes, 0) };
}

async function restoreTrashEntry(entryId) {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const projectDir = currentProjectDir;
    const entryDir = trashEntryDir(entryId);
    if (!fsSync.existsSync(entryDir)) throw new Error('Élément de corbeille introuvable.');
    let manifest = {};
    try { manifest = await readJson(path.join(entryDir, 'manifest.json')); } catch (_) {}

    const restored = { chapters: 0, notes: 0, skipped: [] };
    const chaptersDir = path.join(entryDir, 'chapters');
    const trashedIds = new Set();
    if (fsSync.existsSync(chaptersDir)) {
        for (const file of await fs.readdir(chaptersDir)) {
            if (file.toLowerCase().endsWith('.json')) trashedIds.add(path.basename(file, '.json'));
        }
    }
    const existingChapters = await listChapters(projectDir);
    const existingIds = new Set(existingChapters.map((chapter) => chapter.id));

    for (const id of trashedIds) {
        const target = chapterFile(id, projectDir);
        if (fsSync.existsSync(target) || existingIds.has(id)) {
            restored.skipped.push(`chapitre ${id} (déjà présent)`);
            continue;
        }
        const source = path.join(chaptersDir, `${id}.json`);
        let chapter = null;
        try { chapter = await readJson(source); } catch (_) {}
        if (chapter && typeof chapter === 'object') {
            // Le parent doit exister (ou être restauré avec lui) ; sinon le chapitre redevient principal.
            const parent = chapter.parent || null;
            if (parent && !existingIds.has(parent) && !trashedIds.has(parent)) chapter.parent = null;
            const siblings = existingChapters.filter((item) => (item.parent || null) === (chapter.parent || null));
            if (siblings.some((item) => Number(item.position || 0) === Number(chapter.position || 0))) {
                chapter.position = await nextChapterPosition(projectDir, chapter.parent || null);
            }
            chapter.updatedAt = nowString();
            await writeJson(target, chapter);
            await fs.rm(source, { force: true });
        } else {
            await moveFileSafe(source, target);
        }
        existingIds.add(id);
        existingChapters.push({ id, parent: chapter?.parent || null, position: Number(chapter?.position || 0) });
        restored.chapters += 1;
    }

    const notesDir = path.join(entryDir, 'notes');
    if (fsSync.existsSync(notesDir)) {
        for (const file of await fs.readdir(notesDir)) {
            if (!file.toLowerCase().endsWith('.json')) continue;
            const noteId = normalizeNoteId(path.basename(file, '.json'));
            if (!noteId) continue;
            const target = noteJsonFile(noteId);
            if (fsSync.existsSync(target)) { restored.skipped.push(`note ${noteId} (déjà présente)`); continue; }
            const source = path.join(notesDir, file);
            let note = null;
            try { note = await readJson(source); } catch (_) {}
            if (note && note.type === 'file' && note.path) {
                try {
                    const original = noteAssetFile(note);
                    const stored = path.join(entryDir, 'files', ...String(note.path).split('/'));
                    if (fsSync.existsSync(stored)) {
                        let destination = original;
                        if (fsSync.existsSync(destination)) {
                            const parsed = path.parse(original);
                            destination = path.join(parsed.dir, `${parsed.name}-restaure-${Date.now()}${parsed.ext}`);
                            note.path = path.posix.join('assets', 'notes', path.basename(destination));
                        }
                        await moveFileSafe(stored, destination);
                    }
                } catch (error) {
                    writeDiagnostic('WARN', 'Pièce jointe de note non restaurée.', { note: noteId, message: error.message });
                }
            }
            if (note) { await writeJson(target, note); await fs.rm(source, { force: true }); }
            else await moveFileSafe(source, target);
            restored.notes += 1;
        }
    }

    if (!restored.skipped.length) await fs.rm(entryDir, { recursive: true, force: true });
    writeDiagnostic('INFO', 'Élément restauré depuis la corbeille.', { entry: entryId, chapters: restored.chapters, notes: restored.notes, skipped: restored.skipped.length });
    return { restored, trash: await trashState(), project: await loadCurrentProject() };
}

async function purgeTrashEntry(entryId) {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const entryDir = trashEntryDir(entryId);
    const confirm = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Supprimer définitivement',
        message: 'Supprimer définitivement cet élément de la corbeille ?',
        detail: 'Cette action est irréversible : le contenu ne pourra plus être restauré.',
        buttons: ['Annuler', 'Supprimer définitivement'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
    });
    if (confirm.response !== 1) return { canceled: true, trash: await trashState() };
    await fs.rm(entryDir, { recursive: true, force: true });
    return { canceled: false, trash: await trashState() };
}

async function openTrashFolder() {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const dir = trashRoot();
    await fs.mkdir(dir, { recursive: true });
    const result = await shell.openPath(dir);
    if (result) throw new Error(result);
    return true;
}

async function emptyTrash() {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const state = await trashState();
    if (!state.items.length) return { canceled: false, trash: state };
    const confirm = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Vider la corbeille',
        message: `Supprimer définitivement ${state.items.length} élément${state.items.length > 1 ? 's' : ''} ?`,
        detail: 'Cette action est irréversible : les chapitres et notes de la corbeille ne pourront plus être restaurés.',
        buttons: ['Annuler', 'Vider la corbeille'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
    });
    if (confirm.response !== 1) return { canceled: true, trash: state };
    for (const item of state.items) await fs.rm(trashEntryDir(item.id), { recursive: true, force: true });
    return { canceled: false, trash: await trashState() };
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
            await patchChapterMeta(siblings[i].id, { position: i + 1 });
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
            await patchChapterMeta(siblings[index].id, { position: index + 1 }, { touch: false });
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
        await patchChapterMeta(chapter.id, { parent: chapter.parent, position: chapter.position });
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
                await patchChapterMeta(item.id, { position: item.position }, { touch: false });
            }
        }

        chapter.parent = newParent;
        chapter.position = targetPosition;
        await patchChapterMeta(chapter.id, { parent: chapter.parent, position: chapter.position });
        await reindex(oldParent);
        await reindex(newParent);
        return flattenTree(await listChapters(currentProjectDir));
    }

    throw new Error('Direction de hiérarchie inconnue.');
}

// Décodage des entités et typographie française : voir shared/text-utils.js
// (même code dans l'éditeur, les statistiques et les exports).
function decodeHtmlEntities(text) {
    return Text.decodeEntities(text);
}

// Typographie des exports destinés à Word, OpenDocument et Markdown (puis à la mise en page dans XPress,
// Scribus…) : espace insécable ordinaire (U+00A0) avant « ; ? ! ». L'EPUB, le PDF et le bouton « Typo FR »
// gardent l'espace fine insécable (U+202F).
const OFFICE_TYPOGRAPHY = Object.freeze({ narrowSpaces: false });

function applyFrenchTypography(text, options) {
    return Text.applyFrenchTypography(text, options);
}

function markdownRuns(runs) {
    return (runs || []).map((run) => {
        let text = String(run.text || '')
            // Seuls les <br> explicites, représentés par \n dans un run,
            // deviennent des sauts de ligne Markdown.
            .replace(/\n/g, '  \n');
        if (run.strike) text = `<s>${text}</s>`;
        if (run.underline) text = `<u>${text}</u>`;
        if (run.superscript) text = `<sup>${text}</sup>`;
        if (run.subscript) text = `<sub>${text}</sub>`;
        if (run.italic) text = `*${text}*`;
        if (run.bold) text = `**${text}**`;
        const css = [];
        if (run.fontFamily) css.push(`font-family:${String(run.fontFamily).replace(/[;<>]/g, '')}`);
        if (run.fontSizePt !== null && run.fontSizePt !== undefined && run.fontSizePt !== '' && Number.isFinite(Number(run.fontSizePt))) css.push(`font-size:${Number(run.fontSizePt)}pt`);
        if (run.color) css.push(`color:${cssColorToHex(run.color)}`);
        if (run.backgroundColor) css.push(`background-color:${cssColorToHex(run.backgroundColor)}`);
        if (css.length) text = `<span style="${htmlEscape(css.join(';'))}">${text}</span>`;
        return text;
    }).join('');
}

function htmlToMarkdown(html, typo) {
    const blocks = htmlToBlocks(html, typo);
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

// -----------------------------------------------------------------------------
// Sélection des chapitres à exporter
// Un chapitre n'est pas exporté s'il est marqué « Exclure de l'export » ou si son
// statut figure dans project.exportExcludeStatuses (par défaut : « Coupé »).
// Les sous-chapitres d'un chapitre exclu sont exclus avec lui.
// -----------------------------------------------------------------------------
function exportExcludedStatuses(project = {}) {
    const raw = Array.isArray(project.exportExcludeStatuses) ? project.exportExcludeStatuses : DEFAULT_EXPORT_EXCLUDED_STATUSES;
    return new Set(raw.map((value) => String(value)).filter((value) => CHAPTER_STATUSES.includes(value)));
}

function selectChaptersForExport(project, chapters) {
    const statuses = exportExcludedStatuses(project);
    const kept = [];
    let excluded = 0;
    let skipDepth = null;
    for (const chapter of chapters || []) {
        const depth = Number(chapter._depth || 0);
        if (skipDepth !== null) {
            if (depth > skipDepth) { excluded += 1; continue; }
            skipDepth = null;
        }
        if (chapter.excludeFromExport === true || statuses.has(String(chapter.status || 'draft'))) {
            excluded += 1;
            skipDepth = depth;
            continue;
        }
        kept.push(chapter);
    }
    return { chapters: kept, excluded };
}

async function loadExportState() {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const state = await loadCurrentProject();
    const selection = selectChaptersForExport(state.project, state.chapters);
    return { project: state.project, chapters: selection.chapters, excluded: selection.excluded };
}

async function exportMarkdown() {
    const { project, chapters, excluded } = await loadExportState();
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
        lines.push(htmlToMarkdown(chapter.content || '', OFFICE_TYPOGRAPHY));
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
    return { canceled: false, filePath: result.filePath, excluded };
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


function inlineFormatBase(overrides = {}) {
    return {
        fontFamily: null,
        fontSizePt: null,
        bold: false,
        italic: false,
        underline: false,
        strike: false,
        position: 'normal',
        color: null,
        backgroundColor: null,
        ...overrides
    };
}

function normalizeCssFontFamily(value) {
    const first = String(value || '').split(',')[0].trim();
    return first.replace(/^['"]|['"]$/g, '').trim();
}

function cssColorToHex(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!text || text === 'transparent' || text === 'rgba(0, 0, 0, 0)') return null;
    if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(text)) {
        return `#${text.slice(1).split('').map((c) => c + c).join('')}`.toLowerCase();
    }
    const rgb = text.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*([\d.]+))?\s*\)$/);
    if (rgb) {
        if (rgb[4] !== undefined && Number(rgb[4]) === 0) return null;
        return `#${[rgb[1], rgb[2], rgb[3]].map((n) => Math.max(0, Math.min(255, Math.round(Number(n)))).toString(16).padStart(2, '0')).join('')}`;
    }
    const names = {
        black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff',
        yellow: '#ffff00', gray: '#808080', grey: '#808080', orange: '#ffa500', purple: '#800080',
        brown: '#a52a2a', pink: '#ffc0cb'
    };
    return names[text] || text;
}

function parseCssSizePt(value, currentPt = null) {
    const text = String(value || '').trim().toLowerCase();
    const n = Number.parseFloat(text);
    if (!Number.isFinite(n)) return null;
    if (text.endsWith('pt')) return n;
    if (text.endsWith('px')) return n * 72 / 96;
    if (text.endsWith('em') && Number.isFinite(currentPt)) return n * currentPt;
    if (text.endsWith('rem')) return n * 12;
    if (/^\d+(?:\.\d+)?$/.test(text)) return n;
    return null;
}

function parseStyleDeclarations(styleText) {
    const result = {};
    for (const piece of String(styleText || '').split(';')) {
        const colon = piece.indexOf(':');
        if (colon < 0) continue;
        const key = piece.slice(0, colon).trim().toLowerCase();
        const value = piece.slice(colon + 1).trim();
        if (key) result[key] = value;
    }
    return result;
}

function htmlTagInfo(token) {
    const raw = String(token || '');
    const closing = /^<\s*\//.test(raw);
    const nameMatch = raw.match(/^<\s*\/?\s*([a-zA-Z0-9]+)/);
    const name = nameMatch ? nameMatch[1].toLowerCase() : '';
    const selfClosing = /\/\s*>$/.test(raw) || ['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'wbr'].includes(name);
    const attrs = {};
    if (!closing) {
        const attrPart = raw.replace(/^<\s*[a-zA-Z0-9]+/, '').replace(/\/?>\s*$/, '');
        const re = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
        let match;
        while ((match = re.exec(attrPart)) !== null) attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
    }
    return { raw, closing, name, selfClosing, attrs };
}

function applyTagInlineFormat(base, info) {
    const next = inlineFormatBase(base);
    const name = info?.name || '';
    if (['strong', 'b'].includes(name)) next.bold = true;
    if (['em', 'i'].includes(name)) next.italic = true;
    if (name === 'u') next.underline = true;
    if (['s', 'strike', 'del'].includes(name)) next.strike = true;
    if (name === 'sup') next.position = 'super';
    if (name === 'sub') next.position = 'sub';
    if (name === 'blockquote') next.italic = true;
    if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(name)) next.bold = true;

    if (name === 'font') {
        if (info.attrs.face) next.fontFamily = normalizeCssFontFamily(info.attrs.face) || next.fontFamily;
        if (info.attrs.color) next.color = cssColorToHex(info.attrs.color);
        if (info.attrs.size) {
            const oldSizeMap = { '1': 8, '2': 10, '3': 12, '4': 14, '5': 18, '6': 24, '7': 36 };
            next.fontSizePt = oldSizeMap[String(info.attrs.size).trim()] || next.fontSizePt;
        }
    }

    const css = parseStyleDeclarations(info?.attrs?.style || '');
    if (css['font-family']) next.fontFamily = normalizeCssFontFamily(css['font-family']) || next.fontFamily;
    if (css['font-size']) {
        const size = parseCssSizePt(css['font-size'], next.fontSizePt);
        if (Number.isFinite(size)) next.fontSizePt = size;
    }
    if (css['font-weight']) {
        const weight = String(css['font-weight']).toLowerCase();
        const numeric = Number.parseInt(weight, 10);
        if (weight === 'normal' || weight === 'lighter' || (Number.isFinite(numeric) && numeric < 600)) next.bold = false;
        if (weight === 'bold' || weight === 'bolder' || (Number.isFinite(numeric) && numeric >= 600)) next.bold = true;
    }
    if (css['font-style']) {
        const fontStyle = String(css['font-style']).toLowerCase();
        if (fontStyle === 'normal') next.italic = false;
        if (fontStyle === 'italic' || fontStyle === 'oblique') next.italic = true;
    }
    const decoration = css['text-decoration-line'] || css['text-decoration'];
    if (decoration) {
        const d = String(decoration).toLowerCase();
        if (d.includes('none')) { next.underline = false; next.strike = false; }
        if (d.includes('underline')) next.underline = true;
        if (d.includes('line-through')) next.strike = true;
    }
    if (css['vertical-align']) {
        const pos = String(css['vertical-align']).toLowerCase();
        if (pos === 'super') next.position = 'super';
        else if (pos === 'sub') next.position = 'sub';
        else if (['baseline', 'normal', '0', '0px'].includes(pos)) next.position = 'normal';
    }
    if (css.color) next.color = cssColorToHex(css.color);
    if (css['background-color']) next.backgroundColor = cssColorToHex(css['background-color']);
    else if (css.background) next.backgroundColor = cssColorToHex(css.background);
    return next;
}

function htmlStyledTokens(html, defaults = {}) {
    const rawTokens = String(html || '').match(/<[^>]+>|[^<]+/g) || [];
    const base = inlineFormatBase(defaults);
    const stack = [{ tag: '#root', format: base }];
    const output = [];

    for (const raw of rawTokens) {
        if (!raw.startsWith('<')) {
            output.push({ type: 'text', raw, format: inlineFormatBase(stack[stack.length - 1].format) });
            continue;
        }
        const info = htmlTagInfo(raw);
        output.push({ type: 'tag', raw, info });
        if (!info.name) continue;
        if (info.closing) {
            for (let i = stack.length - 1; i > 0; i -= 1) {
                const item = stack.pop();
                if (item.tag === info.name) break;
            }
            continue;
        }
        if (!info.selfClosing) {
            const next = applyTagInlineFormat(stack[stack.length - 1].format, info);
            stack.push({ tag: info.name, format: next });
        }
    }
    return output;
}

function cleanFormatSearchSpec(input = {}) {
    const size = Number(String(input.fontSizePt ?? '').replace(',', '.'));
    const fontStyle = ['normal', 'bold', 'italic', 'bold-italic'].includes(input.fontStyle) ? input.fontStyle : null;
    const position = ['normal', 'super', 'sub'].includes(input.position) ? input.position : null;
    return {
        fontFamily: String(input.fontFamily || '').trim() || null,
        fontStyle,
        fontSizePt: Number.isFinite(size) && size > 0 ? size : null,
        underline: typeof input.underline === 'boolean' ? input.underline : null,
        strike: typeof input.strike === 'boolean' ? input.strike : null,
        position,
        color: input.color ? cssColorToHex(input.color) : null,
        backgroundColor: input.backgroundColor ? cssColorToHex(input.backgroundColor) : null
    };
}

function hasFormatSearchSpec(input = {}) {
    return Object.values(cleanFormatSearchSpec(input)).some((value) => value !== null && value !== '');
}

function inlineFormatMatchesSpec(actual = {}, wanted = {}) {
    const spec = cleanFormatSearchSpec(wanted);
    if (!hasFormatSearchSpec(spec)) return true;
    if (spec.fontFamily) {
        if (!actual.fontFamily || normalizeCssFontFamily(actual.fontFamily).toLocaleLowerCase('fr') !== normalizeCssFontFamily(spec.fontFamily).toLocaleLowerCase('fr')) return false;
    }
    if (spec.fontSizePt !== null) {
        if (!Number.isFinite(Number(actual.fontSizePt)) || Math.abs(Number(actual.fontSizePt) - spec.fontSizePt) > 0.35) return false;
    }
    if (spec.fontStyle) {
        const bold = Boolean(actual.bold);
        const italic = Boolean(actual.italic);
        if (spec.fontStyle === 'normal' && (bold || italic)) return false;
        if (spec.fontStyle === 'bold' && (!bold || italic)) return false;
        if (spec.fontStyle === 'italic' && (bold || !italic)) return false;
        if (spec.fontStyle === 'bold-italic' && (!bold || !italic)) return false;
    }
    if (spec.underline !== null && Boolean(actual.underline) !== spec.underline) return false;
    if (spec.strike !== null && Boolean(actual.strike) !== spec.strike) return false;
    if (spec.position && String(actual.position || 'normal') !== spec.position) return false;
    if (spec.color && cssColorToHex(actual.color) !== spec.color) return false;
    if (spec.backgroundColor && cssColorToHex(actual.backgroundColor) !== spec.backgroundColor) return false;
    return true;
}

function replacementFormatStyle(specInput = {}) {
    const spec = cleanFormatSearchSpec(specInput);
    const css = [];
    if (spec.fontFamily) css.push(`font-family:${String(spec.fontFamily).replace(/[;<>]/g, '')}`);
    if (spec.fontSizePt !== null) css.push(`font-size:${spec.fontSizePt}pt`);
    if (spec.fontStyle) {
        css.push(`font-weight:${spec.fontStyle.includes('bold') ? '700' : '400'}`);
        css.push(`font-style:${spec.fontStyle.includes('italic') ? 'italic' : 'normal'}`);
    }
    if (spec.underline !== null || spec.strike !== null) {
        const lines = [];
        if (spec.underline === true) lines.push('underline');
        if (spec.strike === true) lines.push('line-through');
        css.push(`text-decoration-line:${lines.length ? lines.join(' ') : 'none'}`);
    }
    if (spec.position) css.push(`vertical-align:${spec.position === 'normal' ? 'baseline' : spec.position}`);
    if (spec.color) css.push(`color:${spec.color}`);
    if (spec.backgroundColor) css.push(`background-color:${spec.backgroundColor}`);
    return css.join(';');
}

function formattedReplacementHtml(text, spec = {}) {
    const escaped = htmlEscape(String(text ?? ''));
    if (!escaped || !hasFormatSearchSpec(spec)) return escaped;
    const style = replacementFormatStyle(spec);
    return `<span data-ecrivain-format="replace" style="${htmlEscape(style)}">${escaped}</span>`;
}

function normalizeExportText(value, typo) {
    // Les retours à la ligne présents dans le HTML source (indentation, formatage
    // interne de contenteditable, copier-coller) ne sont PAS des sauts de ligne
    // du manuscrit. Comme dans un navigateur, on réduit ces espaces blancs à un
    // simple espace. Seule une balise <br> créera ensuite un saut de ligne réel.
    const decoded = decodeHtmlEntities(String(value || ''))
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t\n\f\v]+/g, ' ');
    return applyFrenchTypography(decoded, typo);
}

function htmlToBlocks(html, typo) {
    const input = String(html || '<p></p>')
        .replace(/\r\n?/g, '\n')
        .replace(/<br\s*\/?>/gi, '<br>');
    const tokens = htmlStyledTokens(input);
    const blocks = [];
    let current = null;
    let listType = null;

    function newBlock(type = 'paragraph') {
        if (current && current.runs.length) flush();
        current = { type, runs: [], listType: type === 'list-item' ? (listType || 'ul') : null };
    }

    function sameRunStyle(a, b) {
        return Boolean(a) &&
            a.bold === b.bold &&
            a.italic === b.italic &&
            a.underline === b.underline &&
            a.strike === b.strike &&
            a.superscript === b.superscript &&
            a.subscript === b.subscript &&
            (a.fontFamily || null) === (b.fontFamily || null) &&
            Number(a.fontSizePt || 0) === Number(b.fontSizePt || 0) &&
            (a.color || null) === (b.color || null) &&
            (a.backgroundColor || null) === (b.backgroundColor || null);
    }

    function addText(text, format = {}) {
        if (!current) current = { type: 'paragraph', runs: [], listType: null };
        let clean = normalizeExportText(text, typo);
        if (!clean) return;

        // En HTML, les blancs ordinaires en début d'un élément de bloc ne sont
        // pas affichés. Les supprimer évite qu'une indentation du code source
        // devienne un espace parasite au début d'un paragraphe exporté.
        if (current.runs.length === 0) clean = clean.replace(/^ +/, '');
        if (!clean) return;

        const style = {
            bold: Boolean(format.bold),
            italic: Boolean(format.italic),
            underline: Boolean(format.underline),
            strike: Boolean(format.strike),
            superscript: format.position === 'super',
            subscript: format.position === 'sub',
            fontFamily: format.fontFamily || null,
            fontSizePt: format.fontSizePt !== null && format.fontSizePt !== undefined && format.fontSizePt !== '' && Number.isFinite(Number(format.fontSizePt)) ? Number(format.fontSizePt) : null,
            color: format.color ? cssColorToHex(format.color) : null,
            backgroundColor: format.backgroundColor ? cssColorToHex(format.backgroundColor) : null
        };
        const last = current.runs[current.runs.length - 1];

        // Reproduit la fusion des espaces du navigateur à la frontière de deux
        // nœuds texte/éléments inline. Cela évite les doubles espaces quand une
        // phrase contient du gras, de l'italique ou un format local.
        if (last && / $/.test(last.text) && /^ /.test(clean)) clean = clean.replace(/^ +/, '');
        if (!clean) return;

        if (sameRunStyle(last, style)) {
            last.text += clean;
        } else {
            current.runs.push({ text: clean, ...style });
        }
    }

    function addBreak() {
        if (!current) current = { type: 'paragraph', runs: [], listType: null };
        current.runs.push({
            text: '\n', bold: false, italic: false, underline: false, strike: false,
            superscript: false, subscript: false, fontFamily: null, fontSizePt: null,
            color: null, backgroundColor: null
        });
    }

    function flush(force = false) {
        if (!current) return;

        // Les espaces ordinaires de fin d'un bloc sont également ignorés par
        // le rendu HTML. On ne touche pas aux espaces insécables typographiques.
        for (let i = current.runs.length - 1; i >= 0; i -= 1) {
            const run = current.runs[i];
            if (run.text === '\n') break;
            run.text = run.text.replace(/ +$/, '');
            if (run.text.length > 0) break;
            current.runs.splice(i, 1);
        }

        const meaningful = current.runs.some((run) => run.text.replace(/[\s\u00A0\u202F]/g, '').length > 0);
        if (meaningful || force) blocks.push(current);
        current = null;
    }

    for (const token of tokens) {
        if (token.type === 'text') {
            addText(token.raw, token.format);
            continue;
        }

        const info = token.info || htmlTagInfo(token.raw);
        const name = info.name;
        const closing = info.closing;

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
        if (run.strike) text = `<s>${text}</s>`;
        if (run.underline) text = `<u>${text}</u>`;
        if (run.superscript) text = `<sup>${text}</sup>`;
        if (run.subscript) text = `<sub>${text}</sub>`;
        if (run.italic) text = `<em>${text}</em>`;
        if (run.bold) text = `<strong>${text}</strong>`;
        const css = [];
        if (run.fontFamily) css.push(`font-family:${String(run.fontFamily).replace(/[;<>]/g, '')}`);
        if (run.fontSizePt !== null && run.fontSizePt !== undefined && run.fontSizePt !== '' && Number.isFinite(Number(run.fontSizePt))) css.push(`font-size:${Number(run.fontSizePt)}pt`);
        if (run.color) css.push(`color:${cssColorToHex(run.color)}`);
        if (run.backgroundColor) css.push(`background-color:${cssColorToHex(run.backgroundColor)}`);
        if (css.length) text = `<span style="${htmlEscape(css.join(';'))}">${text}</span>`;
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

function chapterExportTitle(project, chapter, chapterNo, typo) {
    // Les titres de chapitres sont exportés tels qu'ils ont été saisis.
    // La numérotation de l'interface ne doit pas ajouter un chiffre devant le titre.
    return normalizeExportText(chapter.title || 'Sans titre', typo);
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
        chapterPageBreak: project.chapterPageBreak !== false,
        frontPage: project.frontPage !== false,
        pageNumbers: project.pageNumbers !== false,
        runningHeader: RUNNING_HEADERS.includes(project.runningHeader) ? project.runningHeader : 'none'
    };
}

function runningHeaderTexts(project, s, typo) {
    const title = normalizeExportText(project.title || '', typo);
    const author = normalizeExportText(project.author || '', typo);
    if (s.runningHeader === 'title') return { odd: title, even: title, mirrored: false };
    if (s.runningHeader === 'author') return { odd: author, even: author, mirrored: false };
    if (s.runningHeader === 'author-title') return { odd: title, even: author, mirrored: true };
    return { odd: '', even: '', mirrored: false };
}

// Distance entre le bord de la page et l'en-tête ou le pied de page (en mm) :
// 40 % de la marge, en laissant au moins 5 mm pour la ligne elle-même.
function headerFooterEdgeMm(marginMm) {
    return Math.max(0, Math.min(Number(marginMm) * 0.4, Number(marginMm) - 5));
}

// Échappe un texte pour l'insérer dans une chaîne CSS « content: "…" ».
function cssString(value) {
    return String(value ?? '')
        .replace(/[\\"]/g, (c) => `\\${c}`)
        .replace(/</g, '\\3C ')
        .replace(/[\r\n]+/g, ' ');
}

function cmToTwips(cm) { return Math.round(Number(cm) * 566.9291339); }
function mmToTwips(mm) { return Math.round(Number(mm) * 56.69291339); }
function mmToCm(mm) { return Number(mm) / 10; }

// Fabrication des archives ZIP (DOCX, ODT, EPUB, diagnostic) : voir lib/zip.js.

function docxRunXml(run, settings) {
    const runFont = String(run.fontFamily || settings.font || 'Garamond').replace(/["']/g, '').trim() || settings.font;
    const runSize = run.fontSizePt !== null && run.fontSizePt !== undefined && run.fontSizePt !== '' && Number.isFinite(Number(run.fontSizePt)) ? Number(run.fontSizePt) : settings.fontSizePt;
    // Ordre canonique de WordprocessingML (rFonts, b, i, strike, color, sz, u, shd, vertAlign, lang) :
    // certains lecteurs stricts refusent un ordre différent.
    const props = [`<w:rFonts w:ascii="${xmlEscape(runFont)}" w:hAnsi="${xmlEscape(runFont)}" w:cs="${xmlEscape(runFont)}"/>`];
    if (run.bold) props.push('<w:b/>');
    if (run.italic) props.push('<w:i/>');
    if (run.strike) props.push('<w:strike/>');
    const color = cssColorToHex(run.color);
    if (color && /^#[0-9a-f]{6}$/i.test(color)) props.push(`<w:color w:val="${color.slice(1).toUpperCase()}"/>`);
    props.push(`<w:sz w:val="${Math.round(runSize * 2)}"/>`, `<w:szCs w:val="${Math.round(runSize * 2)}"/>`);
    if (run.underline) props.push('<w:u w:val="single"/>');
    const background = cssColorToHex(run.backgroundColor);
    if (background && /^#[0-9a-f]{6}$/i.test(background)) props.push(`<w:shd w:val="clear" w:color="auto" w:fill="${background.slice(1).toUpperCase()}"/>`);
    if (run.superscript) props.push('<w:vertAlign w:val="superscript"/>');
    if (run.subscript) props.push('<w:vertAlign w:val="subscript"/>');
    props.push('<w:lang w:val="fr-FR"/>');
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

    // Ordre imposé par le schéma WordprocessingML : pStyle, pageBreakBefore, spacing, ind, jc.
    const pPr = [`<w:pStyle w:val="${style}"/>`];
    if (options.pageBreakBefore) pPr.push('<w:pageBreakBefore/>');

    // Les propriétés essentielles sont écrites directement sur les paragraphes
    // du corps, en plus du style Normal. Word et LibreOffice ne peuvent donc
    // pas les remplacer par leurs propres styles par défaut.
    const spacing = `<w:spacing w:before="${mmToTwips(settings.beforeMm)}" w:after="${mmToTwips(settings.afterMm)}" w:line="${Math.round(settings.lineSpacingPt * 20)}" w:lineRule="exact"/>`;
    if (style === 'Normal') {
        pPr.push(spacing);
        pPr.push(`<w:ind w:firstLine="${mmToTwips(settings.indentMm)}"/>`);
        pPr.push('<w:jc w:val="both"/>');
    } else if (style === 'Quote') {
        pPr.push(spacing);
        pPr.push(`<w:ind w:left="${mmToTwips(settings.indentMm)}" w:right="${mmToTwips(settings.indentMm)}" w:firstLine="0"/>`);
        pPr.push('<w:jc w:val="both"/>');
    } else if (style === 'ListParagraph') {
        pPr.push(spacing);
        pPr.push(`<w:ind w:left="${mmToTwips(settings.indentMm)}" w:firstLine="0"/>`);
        pPr.push('<w:jc w:val="both"/>');
    }

    const prefix = block.type === 'list-item' ? (block.listType === 'ol' ? `${options.listIndex || 1}. ` : '• ') : '';
    const prefixRun = prefix ? docxRunXml({ text: prefix }, settings) : '';
    const runs = prefixRun + (block.runs || []).map((run) => docxRunXml(run, settings)).join('');
    return `<w:p><w:pPr>${pPr.join('')}</w:pPr>${runs || docxRunXml({ text: '' }, settings)}</w:p>`;
}

const DOCX_NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const DOCX_NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function docxHeaderFooterXml(kind, text, s) {
    const tag = kind === 'header' ? 'w:hdr' : 'w:ftr';
    const style = kind === 'header' ? 'Header' : 'Footer';
    const font = xmlEscape(s.font);
    const rPr = `<w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/>${kind === 'header' ? '<w:i/>' : ''}<w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>`;
    const content = kind === 'header'
        ? (text ? `<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>` : '')
        : `<w:r>${rPr}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${rPr}<w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r>${rPr}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${rPr}<w:t>1</w:t></w:r><w:r>${rPr}<w:fldChar w:fldCharType="end"/></w:r>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<${tag} xmlns:w="${DOCX_NS_W}" xmlns:r="${DOCX_NS_R}"><w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${content}</w:p></${tag}>`;
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

    // En-têtes et numéros de page. La page de titre est comptée mais n'affiche rien.
    const headers = runningHeaderTexts(project, s, OFFICE_TYPOGRAPHY);
    const hasHeader = Boolean(headers.odd || headers.even);
    const hasFooter = s.pageNumbers;
    const titlePg = s.frontPage && (hasHeader || hasFooter);
    const parts = []; // { file, rId, kind, slot, xml }
    if (hasHeader) {
        parts.push({ file: 'header1.xml', rId: 'rIdHdr1', kind: 'header', slot: 'default', xml: docxHeaderFooterXml('header', headers.odd, s) });
        if (headers.mirrored) parts.push({ file: 'header2.xml', rId: 'rIdHdr2', kind: 'header', slot: 'even', xml: docxHeaderFooterXml('header', headers.even, s) });
    }
    if (hasFooter) {
        parts.push({ file: 'footer1.xml', rId: 'rIdFtr1', kind: 'footer', slot: 'default', xml: docxHeaderFooterXml('footer', '', s) });
        if (headers.mirrored) parts.push({ file: 'footer2.xml', rId: 'rIdFtr2', kind: 'footer', slot: 'even', xml: docxHeaderFooterXml('footer', '', s) });
    }

    const body = [];
    if (s.frontPage) {
        body.push(`<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>${docxRunXml({ text: normalizeExportText(project.title || 'Projet', OFFICE_TYPOGRAPHY), bold: true }, { ...s, fontSizePt: 18 })}</w:p>`);
        if (project.subtitle) body.push(`<w:p><w:pPr><w:pStyle w:val="Subtitle"/></w:pPr>${docxRunXml({ text: normalizeExportText(project.subtitle, OFFICE_TYPOGRAPHY), italic: true }, { ...s, fontSizePt: 13 })}</w:p>`);
        if (project.author) body.push(`<w:p><w:pPr><w:pStyle w:val="Author"/></w:pPr>${docxRunXml({ text: normalizeExportText(project.author, OFFICE_TYPOGRAPHY) }, s)}</w:p>`);
    }
    let rootNo = 0;
    for (let chapterIndex = 0; chapterIndex < chapters.length; chapterIndex += 1) {
        const chapter = chapters[chapterIndex];
        const root = Number(chapter._depth || 0) === 0;
        if (root) rootNo += 1;
        const title = chapterExportTitle(project, chapter, rootNo, OFFICE_TYPOGRAPHY);
        const pageBreakBefore = s.chapterPageBreak && (chapterIndex > 0 || s.frontPage);
        // Taille posée sur le texte : sinon la taille du corps l'emporterait sur celle du style de titre.
        body.push(docxParagraphXml({ type: 'heading1', runs: [{ text: title, bold: true, fontSizePt: root ? 15 : 13 }] }, s, { chapterTitle: true, pageBreakBefore }));
        let listIndex = 0;
        for (const block of htmlToBlocks(chapter.content || '', OFFICE_TYPOGRAPHY)) {
            if (block.type === 'list-item' && block.listType === 'ol') listIndex += 1;
            else if (block.type !== 'list-item') listIndex = 0;
            body.push(docxParagraphXml(block, s, { listIndex }));
        }
    }

    const headerEdge = hasHeader ? mmToTwips(headerFooterEdgeMm(s.topMm)) : 0;
    const footerEdge = hasFooter ? mmToTwips(headerFooterEdgeMm(s.bottomMm)) : 0;
    const references = parts
        .slice()
        .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'header' ? -1 : 1))
        .map((part) => `<w:${part.kind}Reference w:type="${part.slot}" r:id="${part.rId}"/>`)
        .join('');
    body.push(`<w:sectPr>${references}<w:pgSz w:w="${pageW}" w:h="${pageH}"/><w:pgMar w:top="${marginTop}" w:right="${marginRight}" w:bottom="${marginBottom}" w:left="${marginLeft}" w:header="${headerEdge}" w:footer="${footerEdge}" w:gutter="0"/>${titlePg ? '<w:titlePg/>' : ''}</w:sectPr>`);

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="${DOCX_NS_W}" xmlns:r="${DOCX_NS_R}"><w:body>${body.join('')}</w:body></w:document>`;

    // Les propriétés de paragraphe suivent l'ordre du schéma : keepNext, spacing, ind, jc.
    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${DOCX_NS_W}">
<w:docDefaults>
<w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/><w:sz w:val="${fontSize}"/><w:szCs w:val="${fontSize}"/><w:lang w:val="fr-FR"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:before="${before}" w:after="${after}" w:line="${line}" w:lineRule="exact"/><w:ind w:firstLine="${indent}"/><w:jc w:val="both"/></w:pPr></w:pPrDefault>
</w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:before="${before}" w:after="${after}" w:line="${line}" w:lineRule="exact"/><w:ind w:firstLine="${indent}"/><w:jc w:val="both"/></w:pPr><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/><w:sz w:val="${fontSize}"/><w:szCs w:val="${fontSize}"/><w:lang w:val="fr-FR"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Titre"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="0" w:after="240" w:line="264" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Sous-titre"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="0" w:after="0" w:line="264" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr><w:rPr><w:i/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Author"><w:name w:val="Auteur"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="0"/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Titre 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="240" w:line="264" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="Titre 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="180" w:after="120" w:line="264" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:jc w:val="left"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="Titre 3"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="0" w:line="264" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:jc w:val="left"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="Titre 4"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:ind w:firstLine="0"/><w:jc w:val="left"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Citation"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="${indent}" w:right="${indent}" w:firstLine="0"/><w:jc w:val="both"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="Liste"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="${indent}" w:firstLine="0"/><w:jc w:val="both"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="En-tête"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="0" w:after="0" w:line="220" w:lineRule="exact"/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr><w:rPr><w:i/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="Pied de page"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="0" w:after="0" w:line="220" w:lineRule="exact"/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
</w:styles>`;
    const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(project.title || '')}</dc:title><dc:creator>${xmlEscape(project.author || '')}</dc:creator><dc:language>fr-FR</dc:language><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created></cp:coreProperties>`;

    const wmlType = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
    const overrides = [
        `<Override PartName="/word/document.xml" ContentType="${wmlType}.document.main+xml"/>`,
        `<Override PartName="/word/styles.xml" ContentType="${wmlType}.styles+xml"/>`,
        ...(headers.mirrored ? [`<Override PartName="/word/settings.xml" ContentType="${wmlType}.settings+xml"/>`] : []),
        ...parts.map((part) => `<Override PartName="/word/${part.file}" ContentType="${wmlType}.${part.kind}+xml"/>`),
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
    ];
    const relBase = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const documentRels = [
        // Ce lien manquait dans les premières versions : sans lui Word/LibreOffice
        // pouvaient ignorer styles.xml et utiliser leur propre Normal.
        `<Relationship Id="rIdStyles" Type="${relBase}/styles" Target="styles.xml"/>`,
        ...(headers.mirrored ? [`<Relationship Id="rIdSettings" Type="${relBase}/settings" Target="settings.xml"/>`] : []),
        ...parts.map((part) => `<Relationship Id="${part.rId}" Type="${relBase}/${part.kind}" Target="${part.file}"/>`)
    ];
    const entries = [
        { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides.join('')}</Types>` },
        { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relBase}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
        { name: 'word/document.xml', data: documentXml },
        { name: 'word/styles.xml', data: stylesXml },
        { name: 'word/_rels/document.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${documentRels.join('')}</Relationships>` }
    ];
    if (headers.mirrored) {
        entries.push({ name: 'word/settings.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:settings xmlns:w="${DOCX_NS_W}"><w:evenAndOddHeaders/></w:settings>` });
    }
    for (const part of parts) entries.push({ name: `word/${part.file}`, data: part.xml });
    entries.push({ name: 'docProps/core.xml', data: coreXml });
    return makeZip(entries);
}

function createOdtTextStyleRegistry(defaultSettings) {
    const byKey = new Map();
    const definitions = [];

    function styleFor(run = {}) {
        const fontFamily = run.fontFamily ? String(run.fontFamily).replace(/["']/g, '').trim() : null;
        const fontSizePt = run.fontSizePt !== null && run.fontSizePt !== undefined && run.fontSizePt !== '' && Number.isFinite(Number(run.fontSizePt)) ? Number(run.fontSizePt) : null;
        const color = cssColorToHex(run.color);
        const backgroundColor = cssColorToHex(run.backgroundColor);
        const props = {
            bold: Boolean(run.bold), italic: Boolean(run.italic), underline: Boolean(run.underline),
            strike: Boolean(run.strike), superscript: Boolean(run.superscript), subscript: Boolean(run.subscript),
            fontFamily, fontSizePt, color, backgroundColor
        };
        const hasAny = Object.values(props).some((value) => value !== null && value !== false && value !== '');
        if (!hasAny) return '';
        const key = JSON.stringify(props);
        if (byKey.has(key)) return byKey.get(key);
        const name = `T${byKey.size + 1}`;
        byKey.set(key, name);

        const attrs = [];
        const effectiveFont = fontFamily || String(defaultSettings.font || 'Garamond').replace(/["']/g, '').trim();
        const effectiveSize = fontSizePt || Number(defaultSettings.fontSizePt || 11);
        attrs.push(`fo:font-family="${xmlEscape(effectiveFont)}"`);
        attrs.push(`fo:font-size="${effectiveSize}pt"`);
        if (props.bold) attrs.push('fo:font-weight="bold"');
        if (props.italic) attrs.push('fo:font-style="italic"');
        if (props.underline) {
            attrs.push('style:text-underline-style="solid"');
            attrs.push('style:text-underline-width="auto"');
        }
        if (props.strike) attrs.push('style:text-line-through-style="solid"');
        if (props.superscript) attrs.push('style:text-position="super 58%"');
        if (props.subscript) attrs.push('style:text-position="sub 58%"');
        if (color && /^#[0-9a-f]{6}$/i.test(color)) attrs.push(`fo:color="${color}"`);
        if (backgroundColor && /^#[0-9a-f]{6}$/i.test(backgroundColor)) attrs.push(`fo:background-color="${backgroundColor}"`);
        definitions.push(`<style:style style:name="${name}" style:family="text"><style:text-properties ${attrs.join(' ')}/></style:style>`);
        return name;
    }

    return {
        styleFor,
        xml: () => definitions.join('')
    };
}

function odtRunsXml(runs, registry) {
    return (runs || []).map((run) => {
        const parts = String(run.text || '').split('\n');
        const content = parts.map((part, i) => `${i ? '<text:line-break/>' : ''}${xmlEscape(part)}`).join('');
        const style = registry?.styleFor ? registry.styleFor(run) : '';
        return style ? `<text:span text:style-name="${style}">${content}</text:span>` : content;
    }).join('');
}

function buildOdt(project, chapters) {
    const s = projectExportSettings(project);
    const fontFamily = String(s.font || 'Garamond').replace(/["']/g, '').trim() || 'Garamond';
    const fontFaceName = 'ManuscriptFont';
    const body = [];
    const odtTextStyles = createOdtTextStyleRegistry(s);
    if (s.frontPage) {
        body.push(`<text:p text:style-name="Title">${xmlEscape(normalizeExportText(project.title || 'Projet', OFFICE_TYPOGRAPHY))}</text:p>`);
        if (project.subtitle) body.push(`<text:p text:style-name="Subtitle">${xmlEscape(normalizeExportText(project.subtitle, OFFICE_TYPOGRAPHY))}</text:p>`);
        if (project.author) body.push(`<text:p text:style-name="Author">${xmlEscape(normalizeExportText(project.author, OFFICE_TYPOGRAPHY))}</text:p>`);
    }
    let rootNo = 0;
    for (const chapter of chapters) {
        const root = Number(chapter._depth || 0) === 0;
        if (root) rootNo += 1;
        const title = chapterExportTitle(project, chapter, rootNo, OFFICE_TYPOGRAPHY);
        const chapterTitleStyle = root ? 'ChapterTitle' : 'SubchapterTitle';
        body.push(`<text:h text:style-name="${chapterTitleStyle}" text:outline-level="${Math.min(6, Number(chapter._depth || 0) + 1)}">${xmlEscape(title)}</text:h>`);
        let listCounter = 0;
        for (const block of htmlToBlocks(chapter.content || '', OFFICE_TYPOGRAPHY)) {
            if (block.type === 'list-item') {
                listCounter += 1;
                const prefix = block.listType === 'ol' ? `${listCounter}. ` : '• ';
                body.push(`<text:p text:style-name="List">${xmlEscape(prefix)}${odtRunsXml(block.runs, odtTextStyles)}</text:p>`);
            } else {
                listCounter = 0;
                const style = block.type === 'quote' ? 'Quote' : block.type === 'heading1' ? 'Heading2' : block.type === 'heading2' ? 'Heading3' : block.type === 'heading3' ? 'Heading4' : 'Body';
                const tag = block.type.startsWith('heading') ? 'text:h' : 'text:p';
                const level = block.type === 'heading1' ? 2 : block.type === 'heading2' ? 3 : 4;
                const outline = tag === 'text:h' ? ` text:outline-level="${level}"` : '';
                body.push(`<${tag} text:style-name="${style}"${outline}>${odtRunsXml(block.runs, odtTextStyles)}</${tag}>`);
            }
        }
    }
    const textStyles = odtTextStyles.xml();

    // En-têtes et numéros de page : la hauteur totale reste égale à la marge choisie,
    // de sorte que la zone de texte garde les mêmes dimensions avec ou sans numéros.
    const headers = runningHeaderTexts(project, s, OFFICE_TYPOGRAPHY);
    const hasHeader = Boolean(headers.odd || headers.even);
    const hasFooter = s.pageNumbers;
    const firstDistinct = s.frontPage && (hasHeader || hasFooter);
    const bandMm = 4;
    const topEdge = hasHeader ? headerFooterEdgeMm(s.topMm) : s.topMm;
    const bottomEdge = hasFooter ? headerFooterEdgeMm(s.bottomMm) : s.bottomMm;
    const headerStyleXml = hasHeader
        ? `<style:header-style><style:header-footer-properties fo:min-height="${mmToCm(bandMm)}cm" fo:margin-bottom="${mmToCm(Math.max(0, s.topMm - topEdge - bandMm))}cm"/></style:header-style>`
        : '';
    const footerStyleXml = hasFooter
        ? `<style:footer-style><style:header-footer-properties fo:min-height="${mmToCm(bandMm)}cm" fo:margin-top="${mmToCm(Math.max(0, s.bottomMm - bottomEdge - bandMm))}cm"/></style:footer-style>`
        : '';
    const headerParagraph = (text) => `<text:p text:style-name="Header">${xmlEscape(text)}</text:p>`;
    const footerParagraph = '<text:p text:style-name="Footer"><text:page-number text:select-page="current">1</text:page-number></text:p>';
    const masterParts = [];
    if (hasHeader) {
        masterParts.push(`<style:header>${headerParagraph(headers.odd)}</style:header>`);
        if (headers.mirrored) masterParts.push(`<style:header-left>${headerParagraph(headers.even)}</style:header-left>`);
        if (firstDistinct) masterParts.push('<style:header-first><text:p text:style-name="Header"/></style:header-first>');
    }
    if (hasFooter) {
        masterParts.push(`<style:footer>${footerParagraph}</style:footer>`);
        if (headers.mirrored) masterParts.push(`<style:footer-left>${footerParagraph}</style:footer-left>`);
        if (firstDistinct) masterParts.push('<style:footer-first><text:p text:style-name="Footer"/></style:footer-first>');
    }
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
<style:style style:name="Title" style:family="paragraph"><style:paragraph-properties fo:text-align="center" fo:text-indent="0cm" fo:margin-bottom="0.5cm" fo:line-height="115%"/><style:text-properties style:font-name="${fontFaceName}" fo:font-family="${xmlEscape(fontFamily)}" fo:font-size="18pt" fo:font-weight="bold"/></style:style>
<style:style style:name="Subtitle" style:family="paragraph"><style:paragraph-properties fo:text-align="center" fo:text-indent="0cm" fo:line-height="115%"/><style:text-properties style:font-name="${fontFaceName}" fo:font-family="${xmlEscape(fontFamily)}" fo:font-size="13pt" fo:font-style="italic"/></style:style>
<style:style style:name="Author" style:family="paragraph"><style:paragraph-properties fo:text-align="center" fo:text-indent="0cm" fo:margin-top="0.5cm"/><style:text-properties style:font-name="${fontFaceName}" fo:font-family="${xmlEscape(fontFamily)}" fo:font-size="${s.fontSizePt}pt"/></style:style>
<style:style style:name="ChapterTitle" style:family="paragraph"><style:paragraph-properties${s.chapterPageBreak ? ' fo:break-before="page"' : ''} fo:text-align="center" fo:text-indent="0cm" fo:margin-bottom="0.5cm" fo:line-height="115%"/><style:text-properties style:font-name="${fontFaceName}" fo:font-family="${xmlEscape(fontFamily)}" fo:font-size="15pt" fo:font-weight="bold"/></style:style>
<style:style style:name="SubchapterTitle" style:family="paragraph"><style:paragraph-properties${s.chapterPageBreak ? ' fo:break-before="page"' : ''} fo:text-align="left" fo:text-indent="0cm" fo:margin-top="0.4cm" fo:margin-bottom="0.2cm" fo:line-height="115%"/><style:text-properties style:font-name="${fontFaceName}" fo:font-family="${xmlEscape(fontFamily)}" fo:font-size="13pt" fo:font-weight="bold"/></style:style>
<style:style style:name="Heading2" style:family="paragraph"><style:paragraph-properties fo:text-align="left" fo:text-indent="0cm" fo:margin-top="0.4cm" fo:margin-bottom="0.2cm" fo:line-height="115%"/><style:text-properties style:font-name="${fontFaceName}" fo:font-family="${xmlEscape(fontFamily)}" fo:font-size="13pt" fo:font-weight="bold"/></style:style>
<style:style style:name="Heading3" style:family="paragraph"><style:paragraph-properties fo:text-align="left" fo:text-indent="0cm"/><style:text-properties style:font-name="${fontFaceName}" fo:font-family="${xmlEscape(fontFamily)}" fo:font-size="${s.fontSizePt}pt" fo:font-weight="bold"/></style:style>
<style:style style:name="Heading4" style:family="paragraph"><style:paragraph-properties fo:text-align="left" fo:text-indent="0cm"/><style:text-properties style:font-name="${fontFaceName}" fo:font-family="${xmlEscape(fontFamily)}" fo:font-size="${s.fontSizePt}pt" fo:font-weight="bold"/></style:style>
<style:style style:name="Quote" style:family="paragraph"><style:paragraph-properties fo:text-align="justify" fo:margin-left="0.5cm" fo:margin-right="0.5cm" fo:text-indent="0cm" fo:margin-top="${mmToCm(s.beforeMm)}cm" fo:margin-bottom="${mmToCm(s.afterMm)}cm"/><style:text-properties style:font-name="${fontFaceName}" fo:font-family="${xmlEscape(fontFamily)}" fo:font-size="${s.fontSizePt}pt" fo:font-style="italic"/></style:style>
<style:style style:name="List" style:family="paragraph"><style:paragraph-properties fo:text-align="justify" fo:margin-left="0.5cm" fo:text-indent="0cm" fo:margin-top="${mmToCm(s.beforeMm)}cm" fo:margin-bottom="${mmToCm(s.afterMm)}cm"/><style:text-properties style:font-name="${fontFaceName}" fo:font-family="${xmlEscape(fontFamily)}" fo:font-size="${s.fontSizePt}pt"/></style:style>
<style:style style:name="Header" style:family="paragraph"><style:paragraph-properties fo:text-align="center" fo:text-indent="0cm" fo:margin-top="0cm" fo:margin-bottom="0cm" fo:line-height="11pt"/><style:text-properties style:font-name="${fontFaceName}" fo:font-family="${xmlEscape(fontFamily)}" fo:font-size="9pt" fo:font-style="italic"/></style:style>
<style:style style:name="Footer" style:family="paragraph"><style:paragraph-properties fo:text-align="center" fo:text-indent="0cm" fo:margin-top="0cm" fo:margin-bottom="0cm" fo:line-height="11pt"/><style:text-properties style:font-name="${fontFaceName}" fo:font-family="${xmlEscape(fontFamily)}" fo:font-size="9pt"/></style:style>
</office:styles><office:automatic-styles><style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="${s.widthCm}cm" fo:page-height="${s.heightCm}cm" fo:margin-top="${mmToCm(topEdge)}cm" fo:margin-bottom="${mmToCm(bottomEdge)}cm" fo:margin-left="${mmToCm(s.leftMm)}cm" fo:margin-right="${mmToCm(s.rightMm)}cm" style:print-orientation="portrait"/>${headerStyleXml}${footerStyleXml}</style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1">${masterParts.join('')}</style:master-page></office:master-styles></office:document-styles>`;
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

// Sommaire EPUB imbriqué : un sous-chapitre apparaît dans la liste de son parent.
function epubNavMarkup(items) {
    const root = { children: [] };
    const stack = [{ depth: -1, node: root }];
    for (const item of items) {
        const depth = Math.min(item.depth, stack[stack.length - 1].depth + 1);
        while (stack[stack.length - 1].depth >= depth) stack.pop();
        const node = { ...item, children: [] };
        stack[stack.length - 1].node.children.push(node);
        stack.push({ depth, node });
    }
    const render = (nodes) => (nodes.length
        ? `<ol>${nodes.map((node) => `<li><a href="${node.file}">${htmlEscape(node.title)}</a>${render(node.children)}</li>`).join('')}</ol>`
        : '');
    return render(root.children);
}

function epubLanguage(project) {
    const language = String(project.language || 'fr').trim();
    return /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language) ? language : 'fr';
}

function buildEpub(project, chapters) {
    const lang = epubLanguage(project);
    const frontPage = project.frontPage !== false;
    const entries = [{ name: 'mimetype', data: 'application/epub+zip' }];
    entries.push({ name: 'META-INF/container.xml', data: `<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>` });
    entries.push({ name: 'OEBPS/style.css', data: epubCss(project) });
    const manifest = [`<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`, `<item id="css" href="style.css" media-type="text/css"/>`];
    const spine = [];
    const navItems = [];
    if (frontPage) {
        const titleBody = `<section class="title-page"><h1>${htmlEscape(normalizeExportText(project.title || 'Projet'))}</h1>${project.subtitle ? `<p><em>${htmlEscape(normalizeExportText(project.subtitle))}</em></p>` : ''}${project.author ? `<p>${htmlEscape(normalizeExportText(project.author))}</p>` : ''}</section>`;
        entries.push({ name: 'OEBPS/title.xhtml', data: xhtmlDocument(project.title || 'Projet', titleBody, lang) });
        manifest.push(`<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>`);
        spine.push('<itemref idref="title"/>');
    }
    let rootNo = 0;
    chapters.forEach((chapter, index) => {
        const depth = Number(chapter._depth || 0);
        const root = depth === 0;
        if (root) rootNo += 1;
        const title = chapterExportTitle(project, chapter, rootNo);
        const file = `chapter-${String(index + 1).padStart(3, '0')}.xhtml`;
        const id = `ch${index + 1}`;
        const level = Math.min(4, depth + 1);
        const body = `<section class="chapter ${root ? 'root-chapter' : 'subchapter'}"><h${level}>${htmlEscape(title)}</h${level}>${renderBlocksHtml(htmlToBlocks(chapter.content || ''))}</section>`;
        entries.push({ name: `OEBPS/${file}`, data: xhtmlDocument(title, body, lang) });
        manifest.push(`<item id="${id}" href="${file}" media-type="application/xhtml+xml"/>`);
        spine.push(`<itemref idref="${id}"/>`);
        navItems.push({ depth, file, title });
    });
    const nav = xhtmlDocument('Sommaire', `<nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><h1>Sommaire</h1>${epubNavMarkup(navItems)}</nav>`, lang);
    entries.push({ name: 'OEBPS/nav.xhtml', data: nav });

    // Identifiant stable : le même livre garde le même identifiant d'une exportation à l'autre
    // (les liseuses et les bibliothèques numériques s'en servent pour reconnaître le titre).
    const uuid = UUID_PATTERN.test(String(project.uuid || '')) ? String(project.uuid).toLowerCase() : crypto.randomUUID();
    const description = String(project.description || '').trim();
    const opf = `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${lang}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">urn:uuid:${uuid}</dc:identifier><dc:title>${xmlEscape(project.title || 'Projet')}</dc:title><dc:language>${lang}</dc:language>${project.author ? `<dc:creator>${xmlEscape(project.author)}</dc:creator>` : ''}${description ? `<dc:description>${xmlEscape(description)}</dc:description>` : ''}<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}</meta></metadata><manifest>${manifest.join('')}</manifest><spine>${spine.join('')}</spine></package>`;
    entries.push({ name: 'OEBPS/content.opf', data: opf });
    return makeZip(entries);
}

function buildPrintHtml(project, chapters) {
    const s = projectExportSettings(project);
    const sections = [];
    if (s.frontPage) {
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

    // Numéros de page et en-têtes courants : boîtes de marge CSS (@page), calculées
    // par le moteur d'impression. La page de titre est comptée mais reste vierge.
    const fontCss = `"${String(s.font).replace(/["\\<]/g, '')}", Garamond, Georgia, serif`;
    const boxStyle = `font-family: ${fontCss}; font-size: 9pt; line-height: 11pt; color: #000; text-indent: 0;`;
    const headers = runningHeaderTexts(project, s);
    const pageRules = [];
    if (s.pageNumbers) pageRules.push(`@page { @bottom-center { content: counter(page); ${boxStyle} } }`);
    if (headers.mirrored) {
        pageRules.push(`@page :right { @top-center { content: "${cssString(headers.odd)}"; font-style: italic; ${boxStyle} } }`);
        pageRules.push(`@page :left { @top-center { content: "${cssString(headers.even)}"; font-style: italic; ${boxStyle} } }`);
    } else if (headers.odd) {
        pageRules.push(`@page { @top-center { content: "${cssString(headers.odd)}"; font-style: italic; ${boxStyle} } }`);
    }
    if (s.frontPage && pageRules.length) {
        pageRules.push('@page :first { @top-center { content: none; } @bottom-center { content: none; } }');
    }

    return `<!DOCTYPE html><html lang="${epubLanguage(project)}"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><style>
@page { size: ${s.widthCm}cm ${s.heightCm}cm; margin: ${s.topMm}mm ${s.rightMm}mm ${s.bottomMm}mm ${s.leftMm}mm; }
${pageRules.join('\n')}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: ${fontCss}; font-size: ${s.fontSizePt}pt; line-height: ${s.lineSpacingPt}pt; color: #000; }
p { text-align: justify; text-indent: ${s.indentMm}mm; margin-top: ${s.beforeMm}mm; margin-bottom: ${s.afterMm}mm; orphans: 2; widows: 2; hyphens: auto; -webkit-hyphens: auto; }
h1,h2,h3,h4 { text-align: left; text-indent: 0; break-after: avoid; page-break-after: avoid; hyphens: manual; }
.chapter.root-chapter > h1 { text-align: center; }
${s.chapterPageBreak ? `.chapter:not(.first-chapter) { break-before: page; page-break-before: always; }
${s.frontPage ? '.chapter.first-chapter { break-before: page; page-break-before: always; }' : ''}` : ''}
.title-page { min-height: ${Math.max(1, s.heightCm - (s.topMm + s.bottomMm) / 10)}cm; display: flex; flex-direction: column; justify-content: center; text-align: center; break-after: page; page-break-after: always; }
.title-page h1 { font-size: 20pt; text-align: center; margin: 0 0 8mm 0; }
.title-page p { text-align: center; text-indent: 0; }
.subtitle { font-style: italic; }
blockquote { margin: 4mm 8mm; font-style: italic; }
blockquote p, li { text-indent: 0; }
ul,ol { margin-top: 0; margin-bottom: 0; }
</style></head><body>${sections.join('\n')}</body></html>`;
}

async function saveExportBuffer(extension, title, project, buffer, excluded = 0) {
    const defaultName = `${safeFolderName(project.title || 'export')}.${extension}`;
    const result = await dialog.showSaveDialog(mainWindow, {
        title,
        defaultPath: path.join(currentProjectDir, 'exports', defaultName),
        filters: [{ name: extension.toUpperCase(), extensions: [extension] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    await fsSafe.writeFileAtomic(result.filePath, buffer);
    return { canceled: false, filePath: result.filePath, excluded };
}

async function exportDocx() {
    const { project, chapters, excluded } = await loadExportState();
    return saveExportBuffer('docx', 'Exporter au format Word', project, buildDocx(project, chapters), excluded);
}

async function exportOdt() {
    const { project, chapters, excluded } = await loadExportState();
    return saveExportBuffer('odt', 'Exporter au format OpenDocument', project, buildOdt(project, chapters), excluded);
}

async function exportEpub() {
    const { project, chapters, excluded } = await loadExportState();
    return saveExportBuffer('epub', 'Exporter au format EPUB', project, buildEpub(project, chapters), excluded);
}

async function exportPdf() {
    const { project, chapters, excluded } = await loadExportState();
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
    hardenWebContents(pdfWindow.webContents, { allowedUrl: pathToFileURL(tempFile).href });
    try {
        await fs.writeFile(tempFile, buildPrintHtml(project, chapters), 'utf8');
        await pdfWindow.loadFile(tempFile);
        try { await pdfWindow.webContents.executeJavaScript('document.fonts ? document.fonts.ready.then(() => true) : true'); } catch (_) {}
        const pdf = await pdfWindow.webContents.printToPDF({
            printBackground: true,
            preferCSSPageSize: true,
            pageSize: { width: Math.round(s.widthCm * 10000), height: Math.round(s.heightCm * 10000) }
        });
        await fsSafe.writeFileAtomic(result.filePath, pdf);
        return { canceled: false, filePath: result.filePath, excluded };
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

// Fichiers que l'auteur a lui-même choisis dans la boîte de dialogue : seuls ceux-là
// peuvent être copiés dans le projet. L'interface ne peut pas désigner un chemin arbitraire.
const pickedAttachments = new Map();
const PICKED_ATTACHMENT_TTL_MS = 30 * 60 * 1000;

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
    pickedAttachments.set(path.resolve(sourcePath), Date.now() + PICKED_ATTACHMENT_TTL_MS);
    return {
        canceled: false,
        sourcePath,
        originalName: path.basename(sourcePath),
        size: stat.size
    };
}

async function copyNoteAttachment(sourcePath, noteId) {
    const resolvedSource = path.resolve(String(sourcePath || ''));
    const expires = pickedAttachments.get(resolvedSource);
    if (!expires || expires < Date.now()) {
        throw new Error('Choisissez le fichier avec le bouton « Choisir un fichier » avant de l’enregistrer.');
    }
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
    pickedAttachments.delete(resolvedSource);
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
        if (existing?.path) oldAbsolute = noteAssetFile(existing);
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
        const newAbsolute = noteAssetFile(note);
        if (path.resolve(oldAbsolute) !== path.resolve(newAbsolute)) {
            await fs.rm(oldAbsolute, { force: true }).catch(() => {});
        }
    }
    return note;
}

async function deleteNote(noteId) {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const note = await getNote(noteId);
    const entryId = `${compactTimestamp()}-${note.id}`;
    const entryDir = trashEntryDir(entryId);
    await fs.mkdir(entryDir, { recursive: true });
    const manifest = {
        formatVersion: 1,
        id: entryId,
        kind: 'note',
        title: String(note.title || 'Note'),
        deletedAt: nowString(),
        chapters: [],
        notes: [],
        wordCount: note.type === 'text' ? Text.countWordsFromHtml(note.content || '') : 0
    };
    await writeJson(path.join(entryDir, 'manifest.json'), manifest);
    const summary = await moveNoteToTrash(note.id, entryDir);
    if (summary) manifest.notes.push(summary);
    await writeJson(path.join(entryDir, 'manifest.json'), manifest);
    return listNotes();
}

async function openNoteAttachment(noteId) {
    const note = await getNote(noteId);
    if (note.type !== 'file' || !note.path) throw new Error('Cette note ne contient pas de fichier.');
    const asset = noteAssetFile(note);
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

function recordWritingStats(chapter, fallbackPreviousWords = 0, forcePrevious = false) {
    if (!currentProjectDir || !chapter?.id) return Promise.resolve();
    return fsSafe.runExclusive(`stats:${currentProjectDir}`, () => recordWritingStatsNow(chapter, fallbackPreviousWords, forcePrevious));
}

async function recordWritingStatsNow(chapter, fallbackPreviousWords = 0, forcePrevious = false) {
    if (!currentProjectDir || !chapter?.id) return;
    const paths = statisticsPaths();
    await fs.mkdir(paths.dir, { recursive: true });

    const snapshots = await readJsonOrEmpty(paths.snapshots);
    const currentWords = Math.max(0, Number(chapter.wordCount || 0));
    const hasSnapshot = Object.prototype.hasOwnProperty.call(snapshots, chapter.id);
    const previousWords = hasSnapshot && !forcePrevious
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
    const exported = new Set(selectChaptersForExport(state.project, chapters).chapters.map((chapter) => chapter.id));

    for (const chapter of chapters) {
        const words = Math.max(0, Number(chapter.wordCount || 0));
        totalWords += words;
        const excluded = !exported.has(chapter.id);
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

// Deux quotas distincts : les sauvegardes déclenchées automatiquement (avant un
// remplacement global, avant une restauration…) ne peuvent plus évincer celles que
// l'auteur a lancées lui-même.
const MAX_MANUAL_BACKUPS = 5;
const MAX_AUTO_BACKUPS = 5;
const MAX_PROJECT_BACKUPS = MAX_MANUAL_BACKUPS + MAX_AUTO_BACKUPS;
const MANUAL_BACKUP_REASON = 'Sauvegarde manuelle';
const MAX_EXTERNAL_BACKUPS = 10;
// Dossiers jamais copiés dans une sauvegarde (reconstituables ou déjà sauvegardés ailleurs).
const BACKUP_EXCLUDED = new Set(['backups', 'history', 'exports', 'trash']);
// Dossiers conservés tels quels lors d'une restauration.
const RESTORE_KEEP = new Set(['backups', 'history', 'exports', 'trash']);

function backupKind(meta = {}) {
    if (meta.kind === 'manual' || meta.kind === 'auto') return meta.kind;
    return String(meta.reason || '') === MANUAL_BACKUP_REASON ? 'manual' : 'auto';
}
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
    const dir = chapterHistoryDir(chapterId);
    if (!fsSync.existsSync(dir)) return [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
        .map((entry) => entry.name)
        .sort()
        .reverse();
}

// Dernier jalon automatique par chapitre, gardé en mémoire : évite de lister le
// dossier et de relire un fichier complet à chaque autosauvegarde.
const historyLastAt = new Map();

async function createChapterHistorySnapshot(chapter, source = 'manual') {
    if (!currentProjectDir || !chapter?.id) return null;
    const dir = chapterHistoryDir(chapter.id);
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
    historyLastAt.set(historyCacheKey(chapter.id), Date.now());
    // Rétention : on allège les anciens jalons automatiques (voir pruneChapterHistory).
    await pruneChapterHistory(chapter.id).catch((error) => writeDiagnostic('WARN', 'Allègement de l’historique impossible.', error));
    return fileName;
}

function historyCacheKey(chapterId) {
    return `${currentProjectDir}::${chapterId}`;
}

async function maybeCreateChapterHistory(existing, source = 'autosave') {
    if (!currentProjectDir || !existing?.id) return null;
    if (source === 'autosave') {
        const key = historyCacheKey(existing.id);
        let lastAt = historyLastAt.get(key);
        if (lastAt === undefined) {
            lastAt = 0;
            const files = await listChapterHistoryFiles(existing.id);
            if (files[0]) {
                try {
                    const latest = await readJson(path.join(chapterHistoryDir(existing.id), files[0]));
                    const parsed = Date.parse(latest?._history?.savedAt || '');
                    if (Number.isFinite(parsed)) lastAt = parsed;
                } catch (_) {}
            }
            historyLastAt.set(key, lastAt);
        }
        if (lastAt && (Date.now() - lastAt) < HISTORY_AUTOSAVE_INTERVAL_MS) return null;
    }
    return createChapterHistorySnapshot(existing, source);
}

// Rétention de l'historique des chapitres (jalons automatiques uniquement) :
//  - 7 derniers jours : tout est conservé ;
//  - 8 à 30 jours : un jalon par jour (le plus récent) ;
//  - au-delà : un jalon par semaine.
// Les jalons manuels, « avant restauration » et « remplacement global » ne sont jamais supprimés.
const HISTORY_NAME = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(\d{3})-autosave\.json$/;

function isoWeekKey(date) {
    const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNumber = (target.getUTCDay() + 6) % 7;
    target.setUTCDate(target.getUTCDate() - dayNumber + 3);
    const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
    const week = 1 + Math.round(((target - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
    return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function historyFilesToPrune(fileNames, now = Date.now()) {
    const day = 24 * 60 * 60 * 1000;
    const kept = new Set();
    const doomed = [];
    // Du plus récent au plus ancien.
    for (const name of [...fileNames].sort().reverse()) {
        const match = HISTORY_NAME.exec(name);
        if (!match) continue;
        const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]));
        const age = now - date.getTime();
        if (age <= 7 * day) continue;
        const key = age <= 30 * day
            ? `d:${match[1]}${match[2]}${match[3]}`
            : `w:${isoWeekKey(date)}`;
        if (kept.has(key)) doomed.push(name);
        else kept.add(key);
    }
    return doomed;
}

async function pruneChapterHistory(chapterId) {
    const dir = chapterHistoryDir(chapterId);
    if (!fsSync.existsSync(dir)) return 0;
    const names = (await fs.readdir(dir, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name);
    const doomed = historyFilesToPrune(names);
    for (const name of doomed) await fs.rm(path.join(dir, name), { force: true });
    return doomed.length;
}

function safeVersionFileName(value) {
    const base = path.basename(String(value || ''));
    if (!base || !base.toLowerCase().endsWith('.json')) throw new Error('Version invalide.');
    return base;
}

async function chapterHistoryState(chapterId) {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const file = chapterFile(chapterId);
    if (!fsSync.existsSync(file)) throw new Error('Chapitre introuvable.');
    const current = await readJson(file);
    const files = await listChapterHistoryFiles(chapterId);
    const versions = [];

    for (const fileName of files) {
        try {
            const item = await readJson(path.join(chapterHistoryDir(chapterId), fileName));
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
        return readJson(chapterFile(chapterId));
    }
    const safeName = safeVersionFileName(versionId);
    const file = path.join(chapterHistoryDir(chapterId), safeName);
    if (!fsSync.existsSync(file)) throw new Error('Cette version n’existe plus.');
    const version = await readJson(file);
    delete version._history;
    return version;
}

async function restoreChapterHistoryVersion(chapterId, versionId) {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const currentFile = chapterFile(chapterId);
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
    restored.wordCount = Text.countWordsFromHtml(restored.content || '');
    restored.wcv = Text.WORD_COUNT_VERSION;
    const projectDir = currentProjectDir;
    await fsSafe.runExclusive(`chapter:${projectDir}:${current.id}`, () => writeJson(currentFile, restored));
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
        if (BACKUP_EXCLUDED.has(entry.name)) continue;
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
            kind: backupKind(meta),
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
    // Quota par type, du plus récent au plus ancien.
    const counts = { manual: 0, auto: 0 };
    const limits = { manual: MAX_MANUAL_BACKUPS, auto: MAX_AUTO_BACKUPS };
    for (const item of items) {
        const kind = item.kind === 'manual' ? 'manual' : 'auto';
        if (counts[kind] >= limits[kind]) continue;
        counts[kind] += 1;
        keep.add(item.id);
    }
    for (const item of items) {
        if (!keep.has(item.id)) {
            await fs.rm(path.join(currentProjectDir, 'backups', item.id), { recursive: true, force: true });
        }
    }
}

async function createProjectBackup(reason = MANUAL_BACKUP_REASON, protectedIds = [], kind = null) {
    if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
    const backupKindValue = kind || (String(reason) === MANUAL_BACKUP_REASON ? 'manual' : 'auto');
    const root = path.join(currentProjectDir, 'backups');
    await fs.mkdir(root, { recursive: true });
    // Les écritures en cours (autosauvegarde du chapitre actif) doivent être terminées.
    await fsSafe.whenIdle(4000);
    const id = `backup-${compactTimestamp()}`;
    const dir = path.join(root, id);
    await fs.mkdir(dir, { recursive: true });
    await copyProjectToSnapshot(dir);
    const sizeBytes = await folderSizeBytes(dir);
    const createdAt = new Date().toISOString();
    await writeJson(path.join(dir, 'backup.json'), {
        id,
        createdAt,
        reason,
        kind: backupKindValue,
        sizeBytes,
        format: 'ecrivain-project-backup',
        version: 1
    });
    await pruneProjectBackups([id, ...(protectedIds || [])]);
    const external = await copyBackupToExternalFolder(dir, id);
    return { id, createdAt, reason, kind: backupKindValue, sizeBytes, external };
}

// Copie facultative de chaque sauvegarde dans un dossier choisi par l'auteur
// (disque externe, dossier synchronisé…). Un échec n'annule jamais la sauvegarde locale.
async function copyBackupToExternalFolder(sourceDir, backupId) {
    const configured = String(loadPreferencesSync().externalBackupDir || '').trim();
    if (!configured) return { enabled: false };
    try {
        const stat = await fs.stat(configured).catch(() => null);
        if (!stat || !stat.isDirectory()) throw new Error('Le dossier de sauvegarde externe est introuvable.');
        const projectFolder = safeFolderName(path.basename(currentProjectDir)) || 'projet';
        const targetRoot = path.join(configured, `Ecrivain-sauvegardes`, projectFolder);
        await fs.mkdir(targetRoot, { recursive: true });
        const target = path.join(targetRoot, backupId);
        await fs.cp(sourceDir, target, { recursive: true, force: true });
        const names = (await fs.readdir(targetRoot, { withFileTypes: true }))
            .filter((entry) => entry.isDirectory() && entry.name.startsWith('backup-'))
            .map((entry) => entry.name)
            .sort()
            .reverse();
        for (const name of names.slice(MAX_EXTERNAL_BACKUPS)) {
            await fs.rm(path.join(targetRoot, name), { recursive: true, force: true });
        }
        return { enabled: true, ok: true, path: target };
    } catch (error) {
        writeDiagnostic('WARN', 'Copie de sauvegarde vers le dossier externe impossible.', error);
        return { enabled: true, ok: false, message: error.message };
    }
}

async function projectBackupsState() {
    return {
        maxBackups: MAX_PROJECT_BACKUPS,
        maxManual: MAX_MANUAL_BACKUPS,
        maxAuto: MAX_AUTO_BACKUPS,
        backups: await listProjectBackups(),
        externalDir: String(loadPreferencesSync().externalBackupDir || ''),
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
        if (RESTORE_KEEP.has(entry.name)) continue;
        await fs.rm(path.join(currentProjectDir, entry.name), { recursive: true, force: true });
    }

    const snapshotEntries = await fs.readdir(source, { withFileTypes: true });
    for (const entry of snapshotEntries) {
        if (entry.name === 'backup.json' || RESTORE_KEEP.has(entry.name)) continue;
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

function projectSearchInlineDefaults() {
    // Valeurs d'affichage de l'éditeur. Les formats explicitement stockés dans
    // le HTML prennent évidemment le dessus sur ces valeurs de base.
    return inlineFormatBase({
        fontFamily: 'Georgia',
        fontSizePt: 17 * 72 / 96,
        bold: false,
        italic: false,
        underline: false,
        strike: false,
        position: 'normal'
    });
}

function chapterSearchDetails(chapter, query, options = {}) {
    const snippets = [];
    let count = 0;
    const searchFormat = cleanFormatSearchSpec(options.searchFormat || {});
    for (const token of htmlStyledTokens(chapter?.content || '', projectSearchInlineDefaults())) {
        if (token.type !== 'text' || !token.raw) continue;
        if (!inlineFormatMatchesSpec(token.format, searchFormat)) continue;
        const positions = findSearchPositions(token.raw, query, options);
        count += positions.length;
        if (snippets.length < 3 && positions.length) {
            const clean = decodeHtmlEntities(token.raw).replace(/\s+/g, ' ').trim();
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

    const replacementText = String(replacement ?? '');
    const replacementFormat = cleanFormatSearchSpec(options.replacementFormat || {});
    // Un champ « Remplacer par » vide accompagné d'un format signifie :
    // conserver le texte trouvé et modifier uniquement sa mise en forme.
    // Sans format, le champ vide conserve son sens classique : suppression.
    const formatOnly = replacementText.length === 0 && hasFormatSearchSpec(replacementFormat);
    const style = formatOnly ? replacementFormatStyle(replacementFormat) : '';

    let value = source;
    for (let i = positions.length - 1; i >= 0; i -= 1) {
        const pos = positions[i];
        const replacementHtml = formatOnly
            ? `<span data-ecrivain-format="replace" style="${htmlEscape(style)}">${source.slice(pos.start, pos.end)}</span>`
            : formattedReplacementHtml(replacementText, replacementFormat);
        value = value.slice(0, pos.start) + replacementHtml + value.slice(pos.end);
    }
    return { text: value, count: positions.length };
}

function replaceInChapterHtml(html, query, replacement, options = {}) {
    const tokens = htmlStyledTokens(html, projectSearchInlineDefaults());
    const searchFormat = cleanFormatSearchSpec(options.searchFormat || {});
    let total = 0;
    const output = [];
    for (const token of tokens) {
        if (token.type === 'tag') {
            output.push(token.raw);
            continue;
        }
        if (!token.raw || !inlineFormatMatchesSpec(token.format, searchFormat)) {
            output.push(token.raw || '');
            continue;
        }
        const replaced = replaceSearchTextToken(token.raw, query, replacement, options);
        output.push(replaced.text);
        total += replaced.count;
    }
    return { html: output.join(''), count: total };
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
// Extensions — API v3
// Les extensions sont des fichiers .ecrivain-plugin (JSON) installés globalement.
// Leur code s'exécute dans un iframe sandboxé côté interface. Le processus principal
// n'expose que les données explicitement autorisées par les permissions du manifeste.
// API v2 a ajouté les ressources privées de l'extension.
// API v3 ajoute des corrections de texte contrôlées : une extension ne peut modifier
// qu'un passage précis d'un chapitre et uniquement avec la permission chapters.write.
// -----------------------------------------------------------------------------
const PLUGIN_PACKAGE_FORMAT = 'ecrivain-plugin';
const PLUGIN_PACKAGE_VERSION = 1;
const PLUGIN_API_VERSION = 3;
const PLUGIN_SUPPORTED_API_VERSIONS = new Set([1, 2, 3]);
const PLUGIN_MAX_PACKAGE_BYTES = 16 * 1024 * 1024;
const PLUGIN_MAX_CODE_BYTES = 1024 * 1024;
const PLUGIN_MAX_STYLE_BYTES = 512 * 1024;
const PLUGIN_MAX_RESOURCES_BYTES = 12 * 1024 * 1024;
const PLUGIN_MAX_RESOURCE_BYTES = 8 * 1024 * 1024;
const PLUGIN_MAX_STORAGE_BYTES = 512 * 1024;
const PLUGIN_ALLOWED_PERMISSIONS = new Set([
    'project.read',
    'chapters.read',
    'chapters.write',
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

function safePluginResourcePath(value) {
    const raw = String(value || '').replace(/\\/g, '/').trim();
    if (!raw || raw.length > 240 || raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) {
        throw new Error('Chemin de ressource d’extension invalide.');
    }
    const parts = raw.split('/');
    if (parts.some((part) => !part || part === '.' || part === '..' || !/^[A-Za-z0-9._ -]+$/.test(part))) {
        throw new Error('Chemin de ressource d’extension invalide.');
    }
    return parts.join('/');
}

function pluginResourceFile(pluginId, resourcePath) {
    const id = safePluginId(pluginId);
    const safePath = safePluginResourcePath(resourcePath);
    return path.join(pluginDir(id), 'resources', ...safePath.split('/'));
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
    if (!PLUGIN_SUPPORTED_API_VERSIONS.has(manifest.ecrivainApi)) {
        throw new Error(`Cette extension utilise l’API ${manifest.ecrivainApi}. Écrivain prend en charge les API 1 à ${PLUGIN_API_VERSION}.`);
    }

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
    if (stat.size > PLUGIN_MAX_PACKAGE_BYTES) throw new Error('Le fichier d’extension dépasse la taille maximale autorisée (16 Mo).');

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
    const resources = pkg?.resources && typeof pkg.resources === 'object' && !Array.isArray(pkg.resources) ? pkg.resources : {};
    if (!code.trim()) throw new Error('L’extension ne contient aucun code.');
    if (Buffer.byteLength(code, 'utf8') > PLUGIN_MAX_CODE_BYTES) throw new Error('Le code de l’extension est trop volumineux.');
    if (Buffer.byteLength(style, 'utf8') > PLUGIN_MAX_STYLE_BYTES) throw new Error('La feuille de style de l’extension est trop volumineuse.');

    let resourcesBytes = 0;
    const normalizedResources = [];
    for (const [rawPath, rawValue] of Object.entries(resources)) {
        const resourcePath = safePluginResourcePath(rawPath);
        if (typeof rawValue !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(rawValue)) {
            throw new Error(`Ressource d’extension invalide : ${resourcePath}`);
        }
        const data = Buffer.from(rawValue, 'base64');
        if (data.byteLength > PLUGIN_MAX_RESOURCE_BYTES) throw new Error(`La ressource « ${resourcePath} » est trop volumineuse.`);
        resourcesBytes += data.byteLength;
        if (resourcesBytes > PLUGIN_MAX_RESOURCES_BYTES) throw new Error('Les ressources de l’extension dépassent 12 Mo.');
        normalizedResources.push({ resourcePath, data });
    }

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
    if (normalizedResources.length) {
        const resourcesDir = path.join(target, 'resources');
        for (const resource of normalizedResources) {
            const destination = path.join(resourcesDir, ...resource.resourcePath.split('/'));
            await fs.mkdir(path.dirname(destination), { recursive: true });
            await fs.writeFile(destination, resource.data);
        }
    }

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


function encodeHtmlTextNode(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function decodePluginTextNode(value) {
    return decodeHtmlEntities(String(value || ''))
        .replace(/&#(\d+);/g, (_m, n) => {
            const code = Number(n);
            return Number.isFinite(code) ? String.fromCodePoint(code) : _m;
        })
        .replace(/&#x([0-9a-f]+);/gi, (_m, h) => {
            const code = Number.parseInt(h, 16);
            return Number.isFinite(code) ? String.fromCodePoint(code) : _m;
        });
}

function normalizePluginContext(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function commonSuffixLength(a, b) {
    const left = String(a || '');
    const right = String(b || '');
    let count = 0;
    while (count < left.length && count < right.length && left[left.length - 1 - count] === right[right.length - 1 - count]) count += 1;
    return count;
}

function commonPrefixLength(a, b) {
    const left = String(a || '');
    const right = String(b || '');
    let count = 0;
    while (count < left.length && count < right.length && left[count] === right[count]) count += 1;
    return count;
}

function applyControlledTextCorrection(html, change = {}) {
    const source = String(html || '<p></p>');
    const target = String(change.target || '').normalize('NFC');
    const replacement = String(change.replacement ?? '').normalize('NFC');
    if (!target) throw new Error('Le passage à corriger est vide.');
    if (target.length > 500 || replacement.length > 500) throw new Error('La correction proposée est trop longue.');

    const tokens = source.match(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/g) || [];
    const textTokens = [];
    let flat = '';
    const blockTag = /^(?:<\/?(?:p|div|blockquote|h[1-6]|li|ul|ol)\b|<br\b)/i;

    for (let i = 0; i < tokens.length; i += 1) {
        const raw = tokens[i];
        if (raw.startsWith('<')) {
            if (blockTag.test(raw) && flat && !flat.endsWith('\n')) flat += '\n';
            continue;
        }
        const decoded = decodePluginTextNode(raw).normalize('NFC');
        const start = flat.length;
        flat += decoded;
        textTokens.push({ tokenIndex: i, decoded, flatStart: start });
    }

    const wantedStart = Number.isFinite(Number(change.start)) ? Number(change.start) : 0;
    const wantedBefore = normalizePluginContext(change.before).slice(-80);
    const wantedAfter = normalizePluginContext(change.after).slice(0, 90);
    const candidates = [];

    for (const entry of textTokens) {
        let from = 0;
        while (from <= entry.decoded.length) {
            const local = entry.decoded.indexOf(target, from);
            if (local < 0) break;
            const globalStart = entry.flatStart + local;
            const before = normalizePluginContext(flat.slice(Math.max(0, globalStart - 120), globalStart));
            const after = normalizePluginContext(flat.slice(globalStart + target.length, globalStart + target.length + 130));
            const contextScore = commonSuffixLength(before, wantedBefore) + commonPrefixLength(after, wantedAfter);
            const distance = Math.abs(globalStart - wantedStart);
            candidates.push({ ...entry, local, globalStart, contextScore, distance });
            from = local + Math.max(1, target.length);
        }
    }

    if (!candidates.length) {
        throw new Error('Le passage signalé n’a pas été retrouvé dans le chapitre. Réanalysez le chapitre puis réessayez.');
    }

    candidates.sort((a, b) => b.contextScore - a.contextScore || a.distance - b.distance);
    const best = candidates[0];
    const second = candidates[1];
    if (second && best.contextScore === second.contextScore && best.distance === second.distance) {
        throw new Error('Cette correction est ambiguë dans le chapitre. Corrigez ce passage directement dans le manuscrit.');
    }

    const beforeText = best.decoded.slice(0, best.local);
    const afterText = best.decoded.slice(best.local + target.length);
    tokens[best.tokenIndex] = encodeHtmlTextNode(beforeText + replacement + afterText);
    return tokens.join('');
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

    if (action === 'chapters.applyCorrection') {
        if (manifest.ecrivainApi < 3) throw new Error('Cette fonction nécessite l’API d’extensions 3.');
        requirePluginPermission(manifest, 'chapters.write');
        if (!currentProjectDir) throw new Error('Aucun projet ouvert.');
        const id = String(params?.id || '').trim();
        if (!id) throw new Error('Chapitre invalide.');
        const file = chapterFile(id);
        if (!fsSync.existsSync(file)) throw new Error('Chapitre introuvable.');
        const chapter = await readJson(file);
        const correctedHtml = applyControlledTextCorrection(chapter.content || '<p></p>', params?.change || {});
        if (correctedHtml === String(chapter.content || '<p></p>')) {
            return { applied: false, chapter };
        }
        const saved = await saveChapter({ ...chapter, content: correctedHtml }, { mode: 'manual' });
        return {
            applied: true,
            chapter: saved,
            previous: String(params?.change?.target || ''),
            replacement: String(params?.change?.replacement ?? '')
        };
    }

    if (action === 'resources.list') {
        if (manifest.ecrivainApi < 2) throw new Error('Cette fonction nécessite l’API d’extensions 2.');
        const root = path.join(pluginDir(manifest.id), 'resources');
        if (!fsSync.existsSync(root)) return [];
        const files = [];
        async function walk(dir, prefix = '') {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
                if (entry.isDirectory()) await walk(path.join(dir, entry.name), relative);
                else if (entry.isFile()) files.push(relative.replace(/\\/g, '/'));
            }
        }
        await walk(root);
        return files.sort((a, b) => a.localeCompare(b, 'fr'));
    }

    if (action === 'resources.text') {
        if (manifest.ecrivainApi < 2) throw new Error('Cette fonction nécessite l’API d’extensions 2.');
        const file = pluginResourceFile(manifest.id, params?.path);
        if (!fsSync.existsSync(file)) throw new Error('Ressource d’extension introuvable.');
        const stat = await fs.stat(file);
        if (!stat.isFile() || stat.size > PLUGIN_MAX_RESOURCE_BYTES) throw new Error('Ressource d’extension invalide.');
        return fs.readFile(file, 'utf8');
    }

    if (action === 'resources.json') {
        if (manifest.ecrivainApi < 2) throw new Error('Cette fonction nécessite l’API d’extensions 2.');
        const text = await pluginApiRequest(pluginId, 'resources.text', { path: params?.path });
        try { return JSON.parse(text); } catch (_) { throw new Error('La ressource JSON de l’extension est invalide.'); }
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
                { label: 'Corbeille', click: () => sendMenuAction('feature:trash') },
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

// -----------------------------------------------------------------------------
// Durcissement des fenêtres : l'interface ne doit jamais pouvoir être remplacée
// par une page distante (qui hériterait du pont window.ecrivain), ni ouvrir de
// nouvelle fenêtre, ni obtenir une permission web (caméra, position, etc.).
// -----------------------------------------------------------------------------
const APP_INDEX_URL = pathToFileURL(path.join(__dirname, 'index.html')).href;
const ALLOWED_WEB_PERMISSIONS = new Set(['clipboard-sanitized-write']);
let permissionPolicyInstalled = false;

function openHttpsExternally(url) {
    if (/^https:\/\//i.test(String(url || ''))) {
        shell.openExternal(String(url)).catch((error) => writeDiagnostic('WARN', 'Ouverture d’un lien externe impossible.', error));
    }
}

function installPermissionPolicy(session) {
    if (permissionPolicyInstalled || !session) return;
    permissionPolicyInstalled = true;
    session.setPermissionRequestHandler((_webContents, permission, callback) => callback(ALLOWED_WEB_PERMISSIONS.has(permission)));
    session.setPermissionCheckHandler((_webContents, permission) => ALLOWED_WEB_PERMISSIONS.has(permission));
    if (typeof session.setDevicePermissionHandler === 'function') session.setDevicePermissionHandler(() => false);
}

function hardenWebContents(webContents, { allowedUrl = null } = {}) {
    webContents.setWindowOpenHandler(({ url }) => {
        openHttpsExternally(url);
        return { action: 'deny' };
    });
    webContents.on('will-navigate', (event, url) => {
        const allowed = allowedUrl && (url === allowedUrl || url.startsWith(`${allowedUrl}#`));
        if (allowed) return;
        event.preventDefault();
        openHttpsExternally(url);
    });
    webContents.on('will-frame-navigate', (details) => {
        if (details.isMainFrame) return;
        if (/^(?:https?|file|ftp):/i.test(String(details.url || ''))) details.preventDefault();
    });
    webContents.on('will-attach-webview', (event) => event.preventDefault());
    installPermissionPolicy(webContents.session);
}

// -----------------------------------------------------------------------------
// Fermeture : vidage de l'interface avant de quitter
// -----------------------------------------------------------------------------
let closeFlushDone = false;
let closeInProgress = false;
let quitRequested = false;
let quitGuardPassed = false;

function requestRendererFlush(timeoutMs = 6000) {
    return new Promise((resolve) => {
        const win = mainWindow;
        const contents = win && !win.isDestroyed() ? win.webContents : null;
        if (!contents || contents.isDestroyed() || contents.isCrashed() || contents.isLoading()) { resolve(false); return; }
        let finished = false;
        let timer = null;
        let onDone = null;
        const finish = (ok) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            if (onDone) ipcMain.removeListener('app:flushDone', onDone);
            resolve(ok);
        };
        onDone = (event) => { if (event.sender === contents) finish(true); };
        timer = setTimeout(() => {
            writeDiagnostic('WARN', 'L’interface n’a pas confirmé l’enregistrement avant fermeture (délai dépassé).');
            finish(false);
        }, timeoutMs);
        ipcMain.on('app:flushDone', onDone);
        contents.send('app:flush-request');
    });
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
            sandbox: true,
            spellcheck: true
        }
    });

    closeFlushDone = false;
    closeInProgress = false;
    hardenWebContents(mainWindow.webContents, { allowedUrl: APP_INDEX_URL });

    // Fermeture sans perte : on demande à l'interface d'enregistrer le chapitre en
    // cours, puis on attend la fin de toutes les écritures avant de fermer vraiment.
    mainWindow.on('close', (event) => {
        if (closeFlushDone) return;
        event.preventDefault();
        if (closeInProgress) return;
        closeInProgress = true;
        (async () => {
            try {
                await requestRendererFlush();
                await fsSafe.whenIdle();
            } catch (error) {
                writeDiagnostic('WARN', 'Vidage avant fermeture incomplet.', error);
            } finally {
                closeFlushDone = true;
                closeInProgress = false;
                if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
                if (quitRequested) app.quit();
            }
        })();
    });

    mainWindow.loadFile('index.html');
    mainWindow.webContents.setZoomFactor(loadPreferencesSync().uiZoom);
    applySpellCheckerPreferences(loadPreferencesSync());

    const spellSession = mainWindow.webContents.session;
    spellSession.on('spellcheck-dictionary-download-begin', (_event, languageCode) => {
        writeDiagnostic('INFO', 'Téléchargement du dictionnaire orthographique.', { language: languageCode });
    });
    spellSession.on('spellcheck-dictionary-initialized', (_event, languageCode) => {
        writeDiagnostic('INFO', 'Dictionnaire orthographique prêt.', { language: languageCode });
    });

    // Menu contextuel natif : suggestions Hunspell pour les mots signalés,
    // dictionnaire personnel, puis commandes d'édition familières.
    mainWindow.webContents.on('context-menu', (_event, params) => {
        const editable = Boolean(params.isEditable);
        const hasSelection = Boolean(String(params.selectionText || '').length);
        const misspelledWord = String(params.misspelledWord || '').trim();
        if (!editable && !hasSelection) return;

        const editFlags = params.editFlags || {};
        const template = [];
        const spellEnabled = mainWindow.webContents.session.isSpellCheckerEnabled();

        if (editable && spellEnabled && misspelledWord) {
            const suggestions = Array.isArray(params.dictionarySuggestions)
                ? params.dictionarySuggestions.filter(Boolean).slice(0, 6)
                : [];
            if (suggestions.length) {
                for (const suggestion of suggestions) {
                    template.push({
                        label: suggestion,
                        click: () => mainWindow.webContents.replaceMisspelling(suggestion)
                    });
                }
            } else {
                template.push({ label: 'Aucune suggestion', enabled: false });
            }
            template.push({ type: 'separator' });
            template.push({
                label: `Ajouter « ${misspelledWord} » au dictionnaire`,
                click: () => {
                    const ok = mainWindow.webContents.session.addWordToSpellCheckerDictionary(misspelledWord);
                    writeDiagnostic(ok ? 'INFO' : 'WARN', ok ? 'Mot ajouté au dictionnaire personnel.' : 'Ajout au dictionnaire personnel impossible.', { word: misspelledWord });
                }
            });
            template.push({ type: 'separator' });
        }

        if (editable) {
            template.push({
                label: 'Couper',
                role: 'cut',
                enabled: hasSelection && Boolean(editFlags.canCut)
            });
        }
        template.push({
            label: 'Copier',
            role: 'copy',
            enabled: hasSelection && Boolean(editFlags.canCopy)
        });
        if (editable) {
            template.push({
                label: 'Coller',
                role: 'paste',
                enabled: Boolean(editFlags.canPaste)
            });
            template.push({ type: 'separator' });
            template.push({ label: 'Tout sélectionner', role: 'selectAll' });
        }

        Menu.buildFromTemplate(template).popup({ window: mainWindow });
    });

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
ipcMain.handle('chapter:deletePreview', async (_event, chapterId) => chapterDeletionPreview(chapterId));
ipcMain.handle('trash:state', async () => trashState());
ipcMain.handle('trash:restore', async (_event, entryId) => restoreTrashEntry(entryId));
ipcMain.handle('trash:purge', async (_event, entryId) => purgeTrashEntry(entryId));
ipcMain.handle('trash:empty', async () => emptyTrash());
ipcMain.handle('trash:openFolder', async () => openTrashFolder());
ipcMain.handle('chapter:setExcluded', async (_event, chapterId, excluded) => setChapterExcluded(chapterId, excluded));
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
ipcMain.handle('backups:create', async (_event, reason) => createProjectBackup(String(reason || MANUAL_BACKUP_REASON), [], 'manual'));
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
ipcMain.handle('preferences:pickBackupDir', async () => pickExternalBackupDirectory());
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
app.on('before-quit', () => { quitRequested = true; });
app.on('before-quit', closeDiagnosticSession);
// Ne jamais quitter au milieu d'une écriture : on attend la fin des opérations suivies.
app.on('will-quit', (event) => {
    if (quitGuardPassed || fsSafe.pendingCount() === 0) return;
    event.preventDefault();
    fsSafe.whenIdle(8000).finally(() => { quitGuardPassed = true; app.quit(); });
});

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

// Accès aux fonctions internes pour les tests automatisés (npm test). Jamais activé
// en usage normal : sans la variable d'environnement, ce module n'exporte rien.
if (process.env.ECRIVAIN_TEST === '1') {
    module.exports = {
        __test: {
            APP_VERSION,
            PROJECT_SCHEMA_VERSION,
            MAX_MANUAL_BACKUPS,
            MAX_AUTO_BACKUPS,
            historyFilesToPrune,
            selectChaptersForExport,
            projectExportSettings,
            htmlToBlocks,
            buildDocx,
            buildOdt,
            buildEpub,
            buildPrintHtml,
            createProjectBackup,
            listProjectBackups,
            getCurrentProjectDir: () => currentProjectDir
        }
    };
}
