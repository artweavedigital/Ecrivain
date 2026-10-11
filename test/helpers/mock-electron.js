'use strict';

/*
 * Faux module « electron » pour exécuter les vrais gestionnaires IPC de main.js
 * dans Node, sans fenêtre : on enregistre les ipcMain.handle(), on répond aux
 * boîtes de dialogue avec des réponses préparées par le test, et on charge
 * main.js tel quel.
 */

const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAIN_FILE = path.resolve(__dirname, '..', '..', 'main.js');

function createHarness(options = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecrivain-test-'));
    const userData = path.join(root, 'userData');
    const projects = path.join(root, 'projets');
    fs.mkdirSync(userData, { recursive: true });
    fs.mkdirSync(projects, { recursive: true });

    const handlers = new Map();
    const appListeners = new Map();
    const answers = { open: [], save: [], message: [] };
    const log = { messageBoxes: [], saveDialogs: [], openDialogs: [], openedPaths: [], externalUrls: [] };

    const app = {
        setName() {},
        requestSingleInstanceLock: () => true,
        on(event, listener) {
            if (!appListeners.has(event)) appListeners.set(event, []);
            appListeners.get(event).push(listener);
        },
        whenReady: () => new Promise(() => {}), // la fenêtre n'est jamais créée
        isReady: () => true,
        quit() {},
        setAppUserModelId() {},
        getPath(name) {
            if (name === 'userData') return userData;
            if (name === 'temp') return path.join(root, 'tmp');
            if (name === 'documents') return projects;
            return path.join(root, name);
        }
    };
    fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });

    const next = (queue, fallback) => (queue.length ? queue.shift() : fallback);
    const dialog = {
        async showOpenDialog(_window, opts) { log.openDialogs.push(opts); return next(answers.open, { canceled: true, filePaths: [] }); },
        async showSaveDialog(_window, opts) { log.saveDialogs.push(opts); return next(answers.save, { canceled: true }); },
        async showMessageBox(_window, opts) { log.messageBoxes.push(opts); return next(answers.message, { response: 0 }); }
    };

    const electron = {
        app,
        BrowserWindow: class { static getAllWindows() { return []; } },
        Menu: { buildFromTemplate: (template) => ({ template }), setApplicationMenu() {} },
        dialog,
        ipcMain: {
            handle(name, handler) { handlers.set(name, handler); },
            on() {},
            removeListener() {}
        },
        shell: {
            async openPath(target) { log.openedPaths.push(target); return ''; },
            async openExternal(url) { log.externalUrls.push(url); }
        },
        safeStorage: {
            isEncryptionAvailable: () => false,
            isAsyncEncryptionAvailable: async () => false
        }
    };

    function loadMain() {
        const originalLoad = Module._load;
        Module._load = function patched(request, parent, isMain) {
            if (request === 'electron') return electron;
            return originalLoad.call(this, request, parent, isMain);
        };
        process.env.ECRIVAIN_TEST = '1';
        try {
            delete require.cache[MAIN_FILE];
            return require(MAIN_FILE).__test;
        } finally {
            Module._load = originalLoad;
        }
    }

    async function invoke(channel, ...args) {
        const handler = handlers.get(channel);
        if (!handler) throw new Error(`Canal IPC inconnu : ${channel}`);
        return handler({ sender: {} }, ...args);
    }

    function cleanup() {
        try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) { /* ignoré */ }
    }

    const internals = loadMain();
    return { root, userData, projects, handlers, answers, log, invoke, cleanup, appListeners, internals };
}

module.exports = { createHarness };
