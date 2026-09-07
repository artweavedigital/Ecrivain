'use strict';

(() => {
    const $ = (id) => document.getElementById(id);
    const ui = {
        view: $('pluginsView'),
        back: $('pluginsBackBtn'),
        install: $('pluginsInstallBtn'),
        openFolder: $('pluginsOpenFolderBtn'),
        count: $('pluginsCount'),
        list: $('pluginsList'),
        empty: $('pluginsEmpty'),
        runtimeTitle: $('pluginRuntimeTitle'),
        runtimeSubtitle: $('pluginRuntimeSubtitle'),
        runtimeEmpty: $('pluginRuntimeEmpty'),
        runtimeEmptyTitle: $('pluginRuntimeEmptyTitle'),
        runtimeEmptyText: $('pluginRuntimeEmptyText'),
        runtimeActions: $('pluginRuntimeActions'),
        frame: $('pluginRuntimeFrame'),
        editorArea: $('editorArea'),
        welcome: $('welcome'),
        toast: $('toast')
    };

    if (!ui.view || !window.ecrivain?.plugins) return;

    const PERMISSIONS = {
        'project.read': 'Lire les informations du projet',
        'chapters.read': 'Lire les chapitres et leur contenu',
        'storage.read': 'Lire ses propres données dans le projet',
        'storage.write': 'Enregistrer ses propres données dans le projet'
    };

    const state = {
        payload: null,
        activePluginId: '',
        activeRuntime: null,
        queuedCommand: '',
        requestCounter: 0,
        runtimeToken: '',
        readyTimer: null
    };

    function toast(message, error = false) {
        if (!ui.toast) return;
        ui.toast.textContent = message;
        ui.toast.classList.toggle('is-error', error);
        ui.toast.hidden = false;
        window.clearTimeout(toast.timer);
        toast.timer = window.setTimeout(() => { ui.toast.hidden = true; }, 3800);
    }

    function hideOtherViews() {
        [
            'globalSynopsisView', 'synopsisView', 'notesView', 'timelineView',
            'mindmapView', 'statsView', 'backupsView', 'historyView',
            'projectSearchView', 'aiView'
        ].forEach((id) => {
            const element = document.getElementById(id);
            if (element) element.hidden = true;
        });
        if (ui.editorArea) ui.editorArea.hidden = true;
        if (ui.welcome) ui.welcome.hidden = true;
    }

    function backToManuscript() {
        closeForSwitch();
        const active = document.querySelector('.chapter-item.is-active');
        if (active) {
            if (ui.editorArea) ui.editorArea.hidden = false;
            if (ui.welcome) ui.welcome.hidden = true;
        } else {
            if (ui.editorArea) ui.editorArea.hidden = true;
            if (ui.welcome) ui.welcome.hidden = false;
        }
    }

    function permissionLabel(permission) {
        return PERMISSIONS[permission] || permission;
    }

    function pluginById(pluginId) {
        return state.payload?.plugins?.find((plugin) => plugin.id === pluginId) || null;
    }

    function showReady(pluginId) {
        const plugin = pluginById(pluginId);
        if (!plugin) return clearRuntime();

        state.activePluginId = plugin.id;
        state.activeRuntime = null;
        state.queuedCommand = '';
        state.runtimeToken = '';
        if (state.readyTimer) { window.clearTimeout(state.readyTimer); state.readyTimer = null; }
        ui.runtimeTitle.textContent = plugin.name;
        ui.runtimeSubtitle.textContent = plugin.enabled
            ? 'Extension activée. Choisissez une action ci-dessous.'
            : 'Extension désactivée. Activez-la pour utiliser ses actions.';
        ui.runtimeEmpty.hidden = false;
        ui.frame.hidden = true;
        ui.frame.removeAttribute('srcdoc');

        if (ui.runtimeEmptyTitle) {
            ui.runtimeEmptyTitle.textContent = plugin.enabled ? 'Extension prête' : 'Extension désactivée';
        }
        if (ui.runtimeEmptyText) {
            ui.runtimeEmptyText.textContent = plugin.commands?.length
                ? 'Cliquez sur une action pour lancer l’extension. « Activée » signifie seulement qu’elle est autorisée à fonctionner.'
                : 'Cette extension ne déclare aucune action à lancer.';
        }
        if (ui.runtimeActions) {
            ui.runtimeActions.innerHTML = '';
            for (const command of plugin.commands || []) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'button button-primary plugin-runtime-action';
                button.textContent = command.label;
                button.disabled = !plugin.enabled;
                button.addEventListener('click', () => runCommand(plugin.id, command.id));
                ui.runtimeActions.appendChild(button);
            }
        }
    }

    function render() {
        const plugins = Array.isArray(state.payload?.plugins) ? state.payload.plugins : [];
        ui.list.innerHTML = '';
        ui.empty.hidden = plugins.length > 0;
        ui.count.textContent = `${plugins.length} extension${plugins.length > 1 ? 's' : ''}`;

        for (const plugin of plugins) {
            const card = document.createElement('article');
            card.className = `plugin-card${plugin.enabled ? '' : ' is-disabled'}`;
            card.dataset.pluginId = plugin.id;
            card.addEventListener('click', () => showReady(plugin.id));

            const head = document.createElement('div');
            head.className = 'plugin-card__head';

            const icon = document.createElement('div');
            icon.className = 'plugin-card__icon';
            icon.textContent = plugin.icon || '🧩';

            const identity = document.createElement('div');
            identity.className = 'plugin-card__identity';
            const titleRow = document.createElement('div');
            titleRow.className = 'plugin-card__title-row';
            const title = document.createElement('h4');
            title.textContent = plugin.name;
            const version = document.createElement('span');
            version.className = 'plugin-version';
            version.textContent = `v${plugin.version}`;
            titleRow.append(title, version);
            const author = document.createElement('p');
            author.textContent = plugin.author ? `par ${plugin.author}` : 'Auteur non renseigné';
            identity.append(titleRow, author);

            const status = document.createElement('span');
            status.className = `plugin-status ${plugin.enabled ? 'is-enabled' : 'is-disabled'}`;
            status.textContent = plugin.enabled ? 'Activée' : 'Désactivée';
            head.append(icon, identity, status);

            const description = document.createElement('p');
            description.className = 'plugin-card__description';
            description.textContent = plugin.description || 'Aucune description.';

            const permissions = document.createElement('div');
            permissions.className = 'plugin-permissions';
            if (!plugin.permissions?.length) {
                const chip = document.createElement('span');
                chip.className = 'plugin-permission-chip plugin-permission-chip--none';
                chip.textContent = 'Aucune donnée du projet';
                permissions.appendChild(chip);
            } else {
                for (const permission of plugin.permissions) {
                    const chip = document.createElement('span');
                    chip.className = 'plugin-permission-chip';
                    chip.textContent = permissionLabel(permission);
                    permissions.appendChild(chip);
                }
            }

            const commands = document.createElement('div');
            commands.className = 'plugin-commands';
            if (plugin.commands?.length) {
                for (const command of plugin.commands) {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'button button-small plugin-command-button';
                    button.textContent = command.label;
                    button.disabled = !plugin.enabled;
                    button.addEventListener('click', (event) => { event.stopPropagation(); runCommand(plugin.id, command.id); });
                    commands.appendChild(button);
                }
            } else {
                const noCommand = document.createElement('span');
                noCommand.className = 'plugin-no-command';
                noCommand.textContent = 'Aucune commande déclarée';
                commands.appendChild(noCommand);
            }

            const actions = document.createElement('div');
            actions.className = 'plugin-card__actions';
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'button button-small';
            toggle.textContent = plugin.enabled ? 'Désactiver' : 'Activer';
            toggle.addEventListener('click', (event) => { event.stopPropagation(); togglePlugin(plugin); });
            const uninstall = document.createElement('button');
            uninstall.type = 'button';
            uninstall.className = 'button button-small plugin-uninstall';
            uninstall.textContent = 'Désinstaller';
            uninstall.addEventListener('click', (event) => { event.stopPropagation(); uninstallPlugin(plugin); });
            actions.append(toggle, uninstall);

            if (plugin.hasProjectData) {
                const dataHint = document.createElement('span');
                dataHint.className = 'plugin-data-hint';
                dataHint.textContent = 'Données présentes dans ce projet';
                actions.prepend(dataHint);
            }

            card.append(head, description, permissions, commands, actions);
            ui.list.appendChild(card);
        }
    }

    async function refresh() {
        state.payload = await window.ecrivain.plugins.state();
        render();
        return state.payload;
    }

    async function open() {
        try {
            hideOtherViews();
            ui.view.hidden = false;
            await refresh();
            if (!state.activePluginId) {
                const firstEnabled = state.payload?.plugins?.find((plugin) => plugin.enabled) || state.payload?.plugins?.[0];
                if (firstEnabled) showReady(firstEnabled.id);
            }
        } catch (error) {
            toast(error.message || 'Impossible d’ouvrir les extensions.', true);
        }
    }

    async function install() {
        try {
            const result = await window.ecrivain.plugins.install();
            if (result?.canceled) return;
            if (result?.state) state.payload = result.state;
            else await refresh();
            render();
            const plugin = pluginById(result?.installed);
            if (plugin) showReady(plugin.id);
            toast(plugin ? `${plugin.name} est installée et prête à être utilisée.` : 'Extension installée.');
        } catch (error) {
            toast(error.message || 'Installation impossible.', true);
        }
    }

    async function togglePlugin(plugin) {
        try {
            state.payload = await window.ecrivain.plugins.toggle(plugin.id, !plugin.enabled);
            render();
            const updated = pluginById(plugin.id);
            if (updated) showReady(updated.id);
            else clearRuntime();
            toast(`${plugin.name} ${plugin.enabled ? 'désactivée' : 'activée'}.`);
        } catch (error) {
            toast(error.message || 'Impossible de modifier l’extension.', true);
        }
    }

    async function uninstallPlugin(plugin) {
        try {
            state.payload = await window.ecrivain.plugins.uninstall(plugin.id);
            if (!pluginById(plugin.id)) clearRuntime();
            render();
        } catch (error) {
            toast(error.message || 'Désinstallation impossible.', true);
        }
    }

    async function openFolder() {
        try {
            await window.ecrivain.plugins.openFolder();
        } catch (error) {
            toast(error.message || 'Impossible d’ouvrir le dossier.', true);
        }
    }

    function textToBase64(text) {
        const bytes = new TextEncoder().encode(String(text || ''));
        let binary = '';
        const block = 0x8000;
        for (let i = 0; i < bytes.length; i += block) {
            binary += String.fromCharCode(...bytes.subarray(i, i + block));
        }
        return btoa(binary);
    }

    function safeJson(value) {
        return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
    }

    function runtimeDocument(runtime, runtimeToken) {
        const code64 = textToBase64(runtime.code || '');
        const style64 = textToBase64(runtime.style || '');
        const manifest = safeJson(runtime.manifest || {});
        const token = safeJson(runtimeToken || '');
        return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root{color-scheme:light;font-family:Georgia,serif;color:#2e2924;background:#fbf8f2}
*{box-sizing:border-box}body{margin:0;padding:20px;background:#fbf8f2;color:#2e2924;line-height:1.55}
#plugin-root{min-height:100%}h1,h2,h3{color:#3f3329}button{font:inherit;border:1px solid #b89a75;background:#fffaf1;color:#49392d;border-radius:8px;padding:8px 12px;cursor:pointer}button:hover{background:#f5eadb}
.plugin-error{padding:14px;border:1px solid #c77;background:#fff1f0;border-radius:9px;color:#7b2e2e;white-space:pre-wrap}
.plugin-loading{padding:18px;border:1px dashed #c8b79f;border-radius:10px;color:#786a5c;background:#fffdfa}
</style>
</head>
<body><main id="plugin-root"><div class="plugin-loading">Extension prête. Lancez une commande.</div></main>
<script>
const __manifest=${manifest};
const __runtimeToken=${token};
const __code64=${safeJson(code64)};
const __style64=${safeJson(style64)};
const __handlers=new Map();
const __pending=new Map();
let __counter=0;
function __decode(value){const binary=atob(value||'');const bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return new TextDecoder().decode(bytes)}
function __post(message){parent.postMessage({source:'ecrivain-plugin',pluginId:__manifest.id,runtimeToken:__runtimeToken,...message},'*')}
function request(method,params={}){return new Promise((resolve,reject)=>{const requestId='r'+(++__counter);__pending.set(requestId,{resolve,reject});__post({type:'api',requestId,method,params})})}
const ecrivain={
 manifest:Object.freeze({...__manifest}),
 request,
 app:{version:()=>request('app.version')},
 project:{getCurrent:()=>request('project.getCurrent')},
 chapters:{list:()=>request('chapters.list'),get:(id)=>request('chapters.get',{id}),readAll:()=>request('chapters.readAll')},
 storage:{read:()=>request('storage.read'),write:(value)=>request('storage.write',{value})},
 notify:(message)=>__post({type:'notify',message:String(message||'')}),
 onCommand:(id,handler)=>{if(typeof handler==='function')__handlers.set(String(id),handler)}
};
window.ecrivain=ecrivain;
window.addEventListener('message',async(event)=>{
 const msg=event.data||{};
 if(msg.source!=='ecrivain-host'||msg.pluginId!==__manifest.id||msg.runtimeToken!==__runtimeToken)return;
 if(msg.type==='api-result'){
  const pending=__pending.get(msg.requestId);if(!pending)return;__pending.delete(msg.requestId);msg.ok?pending.resolve(msg.value):pending.reject(new Error(msg.error||'Erreur API'));
 }
 if(msg.type==='command'){
  const handler=__handlers.get(String(msg.commandId||''));
  if(!handler){__post({type:'error',message:'Commande non prise en charge : '+String(msg.commandId||'')});return;}
  try{await handler();}catch(error){document.getElementById('plugin-root').innerHTML='<div class="plugin-error"></div>';document.querySelector('.plugin-error').textContent=error?.message||String(error);__post({type:'error',message:error?.message||String(error)})}
 }
});
try{
 const style=__decode(__style64);if(style){const node=document.createElement('style');node.textContent=style;document.head.appendChild(node)}
 const code=__decode(__code64);new Function('ecrivain',code)(ecrivain);__post({type:'ready'});
}catch(error){document.getElementById('plugin-root').innerHTML='<div class="plugin-error"></div>';document.querySelector('.plugin-error').textContent='Impossible de charger l’extension.\\n\\n'+(error?.message||String(error));__post({type:'error',message:error?.message||String(error)})}
</script>
</body>
</html>`;
    }

    function clearRuntime() {
        state.activePluginId = '';
        state.activeRuntime = null;
        state.queuedCommand = '';
        state.runtimeToken = '';
        if (state.readyTimer) { window.clearTimeout(state.readyTimer); state.readyTimer = null; }
        ui.runtimeTitle.textContent = 'Aucune extension sélectionnée';
        ui.runtimeSubtitle.textContent = 'Sélectionnez une extension installée pour afficher ses actions.';
        if (ui.runtimeEmptyTitle) ui.runtimeEmptyTitle.textContent = 'Aucune action lancée';
        if (ui.runtimeEmptyText) ui.runtimeEmptyText.textContent = 'Sélectionnez une extension à gauche, puis choisissez l’action à exécuter.';
        if (ui.runtimeActions) ui.runtimeActions.innerHTML = '';
        ui.runtimeEmpty.hidden = false;
        ui.frame.hidden = true;
        ui.frame.removeAttribute('srcdoc');
    }

    async function loadRuntime(pluginId, commandId) {
        const runtime = await window.ecrivain.plugins.runtime(pluginId);
        state.activePluginId = pluginId;
        state.activeRuntime = runtime;
        state.queuedCommand = commandId;
        state.runtimeToken = (globalThis.crypto?.randomUUID?.() || `rt-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        if (state.readyTimer) window.clearTimeout(state.readyTimer);
        ui.runtimeTitle.textContent = runtime.manifest?.name || pluginId;
        ui.runtimeSubtitle.textContent = 'Chargement de l’extension…';
        ui.runtimeEmpty.hidden = true;
        ui.frame.hidden = false;
        ui.frame.srcdoc = runtimeDocument(runtime, state.runtimeToken);
        const expectedToken = state.runtimeToken;
        state.readyTimer = window.setTimeout(() => {
            if (state.runtimeToken !== expectedToken || !state.queuedCommand) return;
            ui.runtimeSubtitle.textContent = 'L’extension ne répond pas. Réessayez ou réinstallez-la.';
            toast('L’extension n’a pas terminé son chargement. Réessayez ou réinstallez-la.', true);
        }, 5000);
    }

    async function runCommand(pluginId, commandId) {
        try {
            if (ui.view.hidden) await open();
            const plugin = pluginById(pluginId);
            if (!plugin) {
                await refresh();
                if (!pluginById(pluginId)) throw new Error('Extension introuvable.');
            }
            if (!pluginById(pluginId)?.enabled) throw new Error('Cette extension est désactivée.');

            if (state.activePluginId !== pluginId || !state.activeRuntime) {
                await loadRuntime(pluginId, commandId);
                return;
            }
            state.queuedCommand = '';
            ui.runtimeSubtitle.textContent = 'Analyse en cours…';
            ui.frame.contentWindow?.postMessage({ source: 'ecrivain-host', pluginId, runtimeToken: state.runtimeToken, type: 'command', commandId }, '*');
        } catch (error) {
            toast(error.message || 'Impossible de lancer la commande.', true);
        }
    }

    window.addEventListener('message', async (event) => {
        const msg = event.data || {};
        if (msg.source !== 'ecrivain-plugin') return;
        if (!state.activePluginId || msg.pluginId !== state.activePluginId) return;
        if (!state.runtimeToken || msg.runtimeToken !== state.runtimeToken) return;

        if (msg.type === 'ready') {
            if (state.readyTimer) { window.clearTimeout(state.readyTimer); state.readyTimer = null; }
            if (state.queuedCommand) {
                const commandId = state.queuedCommand;
                state.queuedCommand = '';
                ui.runtimeSubtitle.textContent = 'Analyse en cours…';
                ui.frame.contentWindow?.postMessage({ source: 'ecrivain-host', pluginId: state.activePluginId, runtimeToken: state.runtimeToken, type: 'command', commandId }, '*');
            } else {
                ui.runtimeSubtitle.textContent = 'Extension chargée. Choisissez une action.';
            }
            return;
        }

        if (msg.type === 'notify') {
            ui.runtimeSubtitle.textContent = String(msg.message || 'Action terminée.');
            toast(String(msg.message || 'Extension'));
            return;
        }

        if (msg.type === 'error') {
            toast(String(msg.message || 'Erreur de l’extension'), true);
            return;
        }

        if (msg.type === 'api') {
            try {
                const value = await window.ecrivain.plugins.api(state.activePluginId, msg.method, msg.params || {});
                ui.frame.contentWindow?.postMessage({
                    source: 'ecrivain-host', pluginId: state.activePluginId, runtimeToken: state.runtimeToken, type: 'api-result',
                    requestId: msg.requestId, ok: true, value
                }, '*');
            } catch (error) {
                ui.frame.contentWindow?.postMessage({
                    source: 'ecrivain-host', pluginId: state.activePluginId, runtimeToken: state.runtimeToken, type: 'api-result',
                    requestId: msg.requestId, ok: false, error: error.message || 'Erreur API'
                }, '*');
            }
        }
    });

    function closeForSwitch() {
        ui.view.hidden = true;
    }

    ui.back?.addEventListener('click', backToManuscript);
    ui.install?.addEventListener('click', install);
    ui.openFolder?.addEventListener('click', openFolder);

    window.ecrivainPlugins = { open, closeForSwitch, runCommand };
})();
