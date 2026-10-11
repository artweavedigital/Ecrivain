/*
 * Écrivain — utilitaires de texte partagés.
 *
 * Ce fichier est chargé par le processus principal (require) ET par l'interface
 * (balise <script>). Il ne dépend ni de Node ni du DOM afin que le comptage des
 * mots et la typographie française donnent exactement les mêmes résultats partout :
 * éditeur, statistiques, sauvegarde, exports.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.EcrivainText = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const NBSP = '\u00A0';
    const NNBSP = '\u202F';

    // -------------------------------------------------------------------------
    // HTML → texte brut
    // -------------------------------------------------------------------------

    const NAMED_ENTITIES = {
        nbsp: NBSP, amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
        laquo: '«', raquo: '»', hellip: '…', mdash: '—', ndash: '–',
        rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', eacute: 'é', egrave: 'è',
        agrave: 'à', ecirc: 'ê', ccedil: 'ç', oelig: 'œ', euro: '€', thinsp: ' ',
        ensp: ' ', emsp: ' '
    };

    function decodeEntities(value) {
        return String(value || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, body) => {
            if (body[0] === '#') {
                const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
                if (!Number.isFinite(code) || code <= 0 || code > 0x10FFFF) return match;
                try { return String.fromCodePoint(code); } catch (_) { return match; }
            }
            const named = NAMED_ENTITIES[body.toLowerCase()];
            return named === undefined ? match : named;
        });
    }

    // Balises qui séparent deux blocs de texte : un mot ne peut jamais les traverser.
    const BLOCK_TAG = /<\/?(?:p|div|h[1-6]|li|ul|ol|dl|dt|dd|blockquote|pre|table|thead|tbody|tfoot|tr|td|th|section|article|header|footer|figure|figcaption|hr)\b[^>]*>|<br\b[^>]*>/gi;

    /**
     * Convertit du HTML d'éditeur en texte brut. Les balises de bloc et <br>
     * deviennent des retours à la ligne ; les balises de mise en forme (gras,
     * italique, exposant…) disparaissent sans introduire d'espace, de sorte
     * que « 2<sup>e</sup> » reste un seul mot.
     */
    function htmlToPlainText(html) {
        let text = String(html || '');
        if (!text) return '';
        text = text.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '');
        text = text.replace(/<!--[\s\S]*?-->/g, '');
        text = text.replace(BLOCK_TAG, '\n');
        text = text.replace(/<[^>]*>/g, '');
        return decodeEntities(text);
    }

    // -------------------------------------------------------------------------
    // Comptage de mots
    // -------------------------------------------------------------------------

    const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

    /**
     * Un mot est une suite de caractères séparés par des espaces (y compris
     * insécables) qui contient au moins une lettre ou un chiffre. Les tirets
     * cadratins de dialogue, les « & » isolés ou les ponctuations seules ne
     * comptent donc pas ; « dit-il », « l’homme » ou « c’est-à-dire » comptent
     * pour un mot, comme dans un traitement de texte classique.
     */
    function countWords(text) {
        const tokens = String(text || '').split(/\s+/);
        let count = 0;
        for (const token of tokens) {
            if (token && HAS_LETTER_OR_DIGIT.test(token)) count += 1;
        }
        return count;
    }

    function countWordsFromHtml(html) {
        return countWords(htmlToPlainText(html));
    }

    /** Version du compteur, enregistrée dans chaque chapitre pour migrer une seule fois. */
    const WORD_COUNT_VERSION = 2;

    // -------------------------------------------------------------------------
    // Typographie française
    // -------------------------------------------------------------------------

    const SPACES = '[ \\t\\u00A0\\u202F]';
    const RE_COLON = new RegExp(`${SPACES}*:`, 'g');
    const RE_HIGH_PUNCT = new RegExp(`${SPACES}*([?!]+|;)`, 'g');
    const RE_SPACE_BEFORE_LOW = new RegExp(`${SPACES}+([,.])`, 'g');
    const RE_OPEN_QUOTE = new RegExp(`«${SPACES}*`, 'g');
    const RE_CLOSE_QUOTE = new RegExp(`${SPACES}*»`, 'g');
    const RE_MULTI_SPACE_AFTER = new RegExp(`([,:;?!])${SPACES}{2,}`, 'g');
    const RE_NUMBER_UNIT = new RegExp(`(\\d)${SPACES}*([%‰€])`, 'g');

    // Adresses web et courriel : on n'y touche jamais (« https://… », « ?a=b », « ; »).
    const PROTECTED_RE = /(?:https?:\/\/|www\.)[^\s<>«»"]*[^\s<>«»".,;:!?)\]…]|[\w.+-]+@[\w-]+(?:\.[\w-]+)+/giu;

    /**
     * Applique les espaces typographiques françaises à un fragment de texte.
     *  - apostrophe typographique, points de suspension ;
     *  - pas d'espace avant « , » et « . » ;
     *  - espace insécable avant « : » (sauf heures « 12:30 » et « :// ») ;
     *  - espace fine insécable avant « ; ? ! » (une seule pour « ?! » ou « !! ») ;
     *  - espaces insécables à l'intérieur des guillemets français ;
     *  - espace insécable avant « % » et « € » après un nombre.
     * Avec `options.narrowSpaces === false`, l'espace avant « ; ? ! » est une espace insécable
     * ordinaire (U+00A0) au lieu de l'espace fine insécable (U+202F) : c'est celle que reconnaissent
     * tous les logiciels de mise en page.
     * La fonction est idempotente : l'appliquer deux fois donne le même résultat.
     */
    function applyFrenchTypography(text, options) {
        let value = String(text == null ? '' : text);
        if (!value) return value;
        const highPunctSpace = options && options.narrowSpaces === false ? NBSP : NNBSP;

        const protectedParts = [];
        value = value.replace(PROTECTED_RE, (match) => {
            protectedParts.push(match);
            return `${protectedParts.length - 1}`;
        });

        // Apostrophes et points de suspension.
        value = value.replace(/([\p{L}\p{N}])'(?=[\p{L}\p{N}])/gu, '$1’');
        value = value.replace(/(?<!\.)\.\.\.(?!\.)/g, '…');

        // Pas d'espace avant virgule ni point.
        value = value.replace(RE_SPACE_BEFORE_LOW, '$1');

        // Deux-points : insécable, sauf « 12:30 », « 3:1 » et les protocoles « :// ».
        value = value.replace(RE_COLON, (match, offset, whole) => {
            const before = whole[offset - 1];
            const after = whole[offset + match.length];
            if (before === ':') return match;
            if (after === '/' && whole[offset + match.length + 1] === '/') return ':';
            if (before && after && /\d/.test(before) && /\d/.test(after) && match === ':') return ':';
            return `${NBSP}:`;
        });

        // Point-virgule, point d'interrogation, point d'exclamation : espace fine insécable.
        value = value.replace(RE_HIGH_PUNCT, (match, group, offset, whole) => {
            const before = whole[offset - 1];
            // Pas d'espace juste après une parenthèse ou un crochet ouvrant : « (?) ».
            if (before && /[(\[{]/.test(before) && match === group) return match;
            return `${highPunctSpace}${group}`;
        });

        // Guillemets français : espace insécable à l'intérieur.
        value = value.replace(RE_OPEN_QUOTE, `«${NBSP}`);
        value = value.replace(RE_CLOSE_QUOTE, `${NBSP}»`);

        // Une seule espace après la ponctuation.
        value = value.replace(RE_MULTI_SPACE_AFTER, '$1 ');

        // Espace insécable entre un nombre et « % », « ‰ » ou « € ».
        value = value.replace(RE_NUMBER_UNIT, `$1${NBSP}$2`);

        value = value.replace(/(\d+)/g, (_m, index) => protectedParts[Number(index)] ?? '');
        return value;
    }

    /**
     * Dialogue : un paragraphe qui commence par « - » ou « – » suivi d'une espace
     * devient un tiret cadratin. Seul le début du paragraphe est concerné.
     */
    function fixDialogueDash(paragraphStart) {
        return String(paragraphStart || '').replace(/^\s*[-–]\s+/, '— ');
    }

    return {
        NBSP,
        NNBSP,
        WORD_COUNT_VERSION,
        decodeEntities,
        htmlToPlainText,
        countWords,
        countWordsFromHtml,
        applyFrenchTypography,
        fixDialogueDash
    };
}));
