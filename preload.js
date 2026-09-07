'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ecrivain', {
    preferences: {
        state: () => ipcRenderer.invoke('preferences:state'),
        save: (payload) => ipcRenderer.invoke('preferences:save', payload || {}),
        reset: () => ipcRenderer.invoke('preferences:reset'),
        pickProjectsDir: () => ipcRenderer.invoke('preferences:pickProjectsDir')
    },
    appInfo: {
        state: () => ipcRenderer.invoke('app:info'),
        openDataFolder: () => ipcRenderer.invoke('app:openDataFolder'),
        openExternal: (url) => ipcRenderer.invoke('app:openExternal', url)
    },
    diagnostics: {
        log: (level, message, details) => ipcRenderer.invoke('diagnostics:log', level, message, details ?? null),
        openFolder: () => ipcRenderer.invoke('diagnostics:openFolder'),
        report: () => ipcRenderer.invoke('diagnostics:report')
    },
    windowControl: {
        state: () => ipcRenderer.invoke('window:state'),
        toggleFullscreen: () => ipcRenderer.invoke('window:toggleFullscreen'),
        exitFullscreen: () => ipcRenderer.invoke('window:exitFullscreen'),
        setZoom: (zoom) => ipcRenderer.invoke('window:setZoom', zoom),
        adjustZoom: (delta) => ipcRenderer.invoke('window:adjustZoom', delta),
        resetZoom: () => ipcRenderer.invoke('window:resetZoom'),
        onState: (callback) => {
            const handler = (_event, payload) => callback(payload);
            ipcRenderer.on('window:state-changed', handler);
            return () => ipcRenderer.removeListener('window:state-changed', handler);
        }
    },
    project: {
        create: (metadata) => ipcRenderer.invoke('project:create', metadata),
        open: () => ipcRenderer.invoke('project:open'),
        openRecent: (projectDir) => ipcRenderer.invoke('project:openRecent', projectDir),
        state: () => ipcRenderer.invoke('project:state'),
        verify: () => ipcRenderer.invoke('project:verify'),
        updateLayout: (settings) => ipcRenderer.invoke('project:updateLayout', settings),
        updateInfo: (metadata) => ipcRenderer.invoke('project:updateInfo', metadata || {}),
        openFolder: () => ipcRenderer.invoke('project:openFolder'),
        onBackgroundValidation: (callback) => {
            const handler = (_event, payload) => callback(payload);
            ipcRenderer.on('project:background-validation', handler);
            return () => ipcRenderer.removeListener('project:background-validation', handler);
        }
    },
    chapters: {
        create: (data) => ipcRenderer.invoke('chapter:create', data),
        save: (chapter, options) => ipcRenderer.invoke('chapter:save', chapter, options || {}),
        duplicate: (chapterId) => ipcRenderer.invoke('chapter:duplicate', chapterId),
        delete: (chapterId) => ipcRenderer.invoke('chapter:delete', chapterId),
        changeLevel: (chapterId, direction) => ipcRenderer.invoke('chapter:changeLevel', chapterId, direction),
        reorder: (orderedIds) => ipcRenderer.invoke('chapters:reorder', orderedIds)
    },
    globalSynopsis: {
        state: () => ipcRenderer.invoke('globalSynopsis:state'),
        save: (data) => ipcRenderer.invoke('globalSynopsis:save', data)
    },
    synopsis: {
        state: () => ipcRenderer.invoke('synopsis:state'),
        save: (card) => ipcRenderer.invoke('synopsis:save', card),
        delete: (cardId) => ipcRenderer.invoke('synopsis:delete', cardId),
        reorder: (ids) => ipcRenderer.invoke('synopsis:reorder', ids)
    },
    notes: {
        state: () => ipcRenderer.invoke('notes:state'),
        saveText: (note) => ipcRenderer.invoke('notes:saveText', note),
        pickAttachment: () => ipcRenderer.invoke('notes:pickAttachment'),
        saveFile: (note) => ipcRenderer.invoke('notes:saveFile', note),
        delete: (noteId) => ipcRenderer.invoke('notes:delete', noteId),
        openFile: (noteId) => ipcRenderer.invoke('notes:openFile', noteId),
        openFolder: () => ipcRenderer.invoke('notes:openFolder'),
        cnrtl: (mode, word) => ipcRenderer.invoke('notes:cnrtl', mode, word)
    },
    timeline: {
        state: () => ipcRenderer.invoke('timeline:state'),
        save: (event) => ipcRenderer.invoke('timeline:save', event),
        delete: (eventId) => ipcRenderer.invoke('timeline:delete', eventId),
        move: (event) => ipcRenderer.invoke('timeline:move', event),
        savePalette: (entries) => ipcRenderer.invoke('timeline:savePalette', entries)
    },
    mindmap: {
        state: () => ipcRenderer.invoke('mindmap:state'),
        save: (graph) => ipcRenderer.invoke('mindmap:save', graph),
        exportPng: (dataUrl) => ipcRenderer.invoke('mindmap:exportPng', dataUrl)
    },
    stats: {
        state: () => ipcRenderer.invoke('stats:state')
    },
    backups: {
        state: () => ipcRenderer.invoke('backups:state'),
        create: (reason) => ipcRenderer.invoke('backups:create', reason),
        restore: (backupId) => ipcRenderer.invoke('backups:restore', backupId),
        openFolder: () => ipcRenderer.invoke('backups:openFolder')
    },
    history: {
        state: (chapterId) => ipcRenderer.invoke('history:state', chapterId),
        get: (chapterId, versionId) => ipcRenderer.invoke('history:get', chapterId, versionId),
        restore: (chapterId, versionId) => ipcRenderer.invoke('history:restore', chapterId, versionId)
    },
    search: {
        project: (query, options) => ipcRenderer.invoke('search:project', query, options || {}),
        replaceProject: (query, replacement, options) => ipcRenderer.invoke('search:replaceProject', query, replacement, options || {})
    },
    ai: {
        settings: () => ipcRenderer.invoke('ai:settings'),
        saveSettings: (payload) => ipcRenderer.invoke('ai:saveSettings', payload || {}),
        test: (payload) => ipcRenderer.invoke('ai:test', payload || {}),
        models: (payload) => ipcRenderer.invoke('ai:models', payload || {}),
        openGuide: (payload) => ipcRenderer.invoke('ai:openGuide', payload || {}),
        run: (payload) => ipcRenderer.invoke('ai:run', payload || {})
    },
    plugins: {
        state: () => ipcRenderer.invoke('plugins:state'),
        install: () => ipcRenderer.invoke('plugins:install'),
        toggle: (pluginId, enabled) => ipcRenderer.invoke('plugins:toggle', pluginId, enabled),
        uninstall: (pluginId) => ipcRenderer.invoke('plugins:uninstall', pluginId),
        runtime: (pluginId) => ipcRenderer.invoke('plugins:runtime', pluginId),
        api: (pluginId, method, params) => ipcRenderer.invoke('plugins:api', pluginId, method, params || {}),
        openFolder: () => ipcRenderer.invoke('plugins:openFolder')
    },
    export: {
        markdown: () => ipcRenderer.invoke('export:markdown'),
        docx: () => ipcRenderer.invoke('export:docx'),
        odt: () => ipcRenderer.invoke('export:odt'),
        epub: () => ipcRenderer.invoke('export:epub'),
        pdf: () => ipcRenderer.invoke('export:pdf')
    },
    menu: {
        onAction: (callback) => {
            const handler = (_event, action) => callback(action);
            ipcRenderer.on('menu:action', handler);
            return () => ipcRenderer.removeListener('menu:action', handler);
        }
    }
});
