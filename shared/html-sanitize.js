/*
 * Écrivain — nettoyage HTML à liste blanche (interface uniquement).
 *
 * Tout contenu HTML venu d'un fichier de projet (chapitres, notes) est filtré
 * avant d'être placé dans la page : un projet reçu d'un tiers ne doit pas pouvoir
 * y introduire de script, de cadre, de formulaire, de lien dangereux ou de style
 * capable de masquer l'interface.
 *
 * Principe : on analyse le texte avec DOMParser (document inerte : rien ne
 * s'exécute et rien ne se charge), puis on ne conserve que les balises, attributs
 * et déclarations de style explicitement autorisés. Les balises inconnues sont
 * « déroulées » (leur texte est conservé), les balises dangereuses supprimées avec
 * leur contenu.
 *
 * Ce filtre conserve tout ce que produit l'éditeur : gras, italique, souligné,
 * barré, exposant, indice, titres, citations, listes, <font>, et les <span style>
 * de police, corps, couleur et surlignage.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.EcrivainSanitize = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const ALLOWED_TAGS = new Set([
        'a', 'abbr', 'b', 'bdi', 'bdo', 'big', 'blockquote', 'br', 'caption', 'center', 'cite', 'code',
        'col', 'colgroup', 'dd', 'del', 'dfn', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'font',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'pre',
        'q', 's', 'samp', 'small', 'span', 'strike', 'strong', 'sub', 'sup', 'table', 'tbody', 'td',
        'tfoot', 'th', 'thead', 'tr', 'tt', 'u', 'ul', 'var', 'wbr'
    ]);

    // Supprimées avec tout leur contenu.
    const DROP_WITH_CONTENT = new Set([
        'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'link', 'meta',
        'base', 'form', 'input', 'button', 'textarea', 'select', 'option', 'optgroup', 'datalist', 'svg',
        'math', 'audio', 'video', 'source', 'track', 'canvas', 'noscript', 'noembed', 'noframes',
        'template', 'title', 'head', 'portal', 'dialog', 'slot', 'xmp', 'plaintext', 'listing',
        'marquee', 'map', 'area', 'picture', 'param', 'fencedframe', 'selectedcontent'
    ]);

    const GLOBAL_ATTRIBUTES = new Set(['style', 'lang', 'dir', 'title']);
    const TAG_ATTRIBUTES = {
        a: new Set(['href']),
        img: new Set(['src', 'alt', 'width', 'height']),
        font: new Set(['face', 'size', 'color']),
        ol: new Set(['start', 'type', 'reversed']),
        li: new Set(['value']),
        td: new Set(['colspan', 'rowspan', 'align']),
        th: new Set(['colspan', 'rowspan', 'align', 'scope']),
        col: new Set(['span']),
        colgroup: new Set(['span']),
        p: new Set(['align']),
        div: new Set(['align']),
        h1: new Set(['align']), h2: new Set(['align']), h3: new Set(['align']),
        h4: new Set(['align']), h5: new Set(['align']), h6: new Set(['align'])
    };

    const ALLOWED_STYLE_PROPERTIES = new Set([
        'font-family', 'font-size', 'font-style', 'font-weight', 'font-variant', 'font-variant-caps',
        'color', 'background', 'background-color',
        'text-align', 'text-indent', 'text-decoration', 'text-decoration-line', 'text-decoration-color',
        'text-decoration-style', 'text-transform', 'letter-spacing', 'word-spacing', 'line-height',
        'vertical-align', 'white-space',
        'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
        'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right'
    ]);

    const DANGEROUS_STYLE_VALUE = /url\s*\(|expression\s*\(|javascript\s*:|vbscript\s*:|data\s*:|@import|behaviou?r\s*:|-moz-binding|\\|<|>|\/\*|image-set\s*\(|var\s*\(|attr\s*\(/i;
    const MAX_STYLE_LENGTH = 1500;
    const MAX_DATA_IMAGE_BYTES = 4 * 1024 * 1024;

    const XHTML_NS = 'http://www.w3.org/1999/xhtml';

    function normalizeUrl(value) {
        // Les navigateurs ignorent les caractères de contrôle et espaces dans le schéma.
        return String(value || '').replace(new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(32) + String.fromCharCode(127) + '-' + String.fromCharCode(159) + String.fromCharCode(0x2028) + String.fromCharCode(0x2029) + ']+', 'g'), '');
    }

    function isSafeLink(value) {
        const url = normalizeUrl(value);
        if (!url) return false;
        if (url.startsWith('#')) return true;
        return /^(?:https?:|mailto:|tel:)/i.test(url);
    }

    function isSafeImageSource(value) {
        const url = normalizeUrl(value);
        const match = /^data:image\/(?:png|jpe?g|gif|webp);base64,([A-Za-z0-9+/=]+)$/i.exec(url);
        return Boolean(match) && match[1].length * 0.75 <= MAX_DATA_IMAGE_BYTES;
    }

    /** Filtre une déclaration de style ; renvoie le texte conservé et le nombre de déclarations retirées. */
    function sanitizeStyle(value) {
        const source = String(value || '');
        if (source.length > MAX_STYLE_LENGTH) return { css: '', removed: 1 };
        const kept = [];
        let removed = 0;
        for (const piece of source.split(';')) {
            if (!piece.trim()) continue;
            const colon = piece.indexOf(':');
            if (colon < 1) { removed += 1; continue; }
            const property = piece.slice(0, colon).trim().toLowerCase();
            const declared = piece.slice(colon + 1).trim();
            if (!ALLOWED_STYLE_PROPERTIES.has(property) || !declared || DANGEROUS_STYLE_VALUE.test(declared) || declared.length > 200) {
                removed += 1;
                continue;
            }
            kept.push(`${property}: ${declared}`);
        }
        return { css: kept.join('; '), removed };
    }

    function cleanAttributes(element, tag, stats) {
        const allowedForTag = TAG_ATTRIBUTES[tag];
        for (const attribute of Array.from(element.attributes)) {
            const name = attribute.name.toLowerCase();
            const allowed = GLOBAL_ATTRIBUTES.has(name) || (allowedForTag && allowedForTag.has(name));
            if (!allowed || name.startsWith('on')) {
                element.removeAttribute(attribute.name);
                stats.removed += 1;
                continue;
            }
            if (name === 'style') {
                const result = sanitizeStyle(attribute.value);
                stats.removed += result.removed;
                // Rien de retiré : on laisse l'attribut tel quel (pas de reformatage inutile).
                if (result.removed === 0) continue;
                if (result.css) element.setAttribute('style', result.css);
                else element.removeAttribute('style');
            } else if (tag === 'a' && name === 'href' && !isSafeLink(attribute.value)) {
                element.removeAttribute('href');
                stats.removed += 1;
            } else if (tag === 'img' && name === 'src' && !isSafeImageSource(attribute.value)) {
                element.removeAttribute('src');
                stats.removed += 1;
            }
        }
        if (tag === 'a' && element.hasAttribute('href')) {
            element.setAttribute('rel', 'noopener noreferrer');
        }
    }

    function cleanNode(parent, node, stats) {
        if (node.nodeType === 3) return; // texte

        if (node.nodeType !== 1) { // commentaires, instructions de traitement, etc.
            parent.removeChild(node);
            stats.removed += 1;
            return;
        }

        const tag = String(node.localName || '').toLowerCase();
        if (node.namespaceURI && node.namespaceURI !== XHTML_NS) {
            parent.removeChild(node);
            stats.removed += 1;
            return;
        }
        if (DROP_WITH_CONTENT.has(tag)) {
            parent.removeChild(node);
            stats.removed += 1;
            return;
        }

        // Nettoyer d'abord les enfants (copie : la liste change pendant la boucle).
        for (const child of Array.from(node.childNodes)) cleanNode(node, child, stats);

        if (!ALLOWED_TAGS.has(tag)) {
            // Balise inconnue (ex. <o:p> de Word) : on garde le texte, pas l'enveloppe.
            while (node.firstChild) parent.insertBefore(node.firstChild, node);
            parent.removeChild(node);
            stats.removed += 1;
            return;
        }

        cleanAttributes(node, tag, stats);

        if (tag === 'img' && !node.getAttribute('src')) {
            parent.removeChild(node);
            stats.removed += 1;
        }
    }

    /**
     * @param {string} html
     * @returns {{html: string, removed: number}} `removed` compte les éléments,
     *   attributs et déclarations retirés (0 = contenu intact).
     */
    function sanitizeHtml(html) {
        const source = String(html || '');
        if (!source) return { html: '', removed: 0 };
        if (typeof DOMParser === 'undefined') {
            throw new Error('sanitizeHtml nécessite un DOM (DOMParser).');
        }
        const doc = new DOMParser().parseFromString(`<!DOCTYPE html><html><body>${source}</body></html>`, 'text/html');
        const stats = { removed: 0 };
        for (const child of Array.from(doc.body.childNodes)) cleanNode(doc.body, child, stats);
        return { html: doc.body.innerHTML, removed: stats.removed };
    }

    return { sanitizeHtml, sanitizeStyle, isSafeLink, isSafeImageSource };
}));
