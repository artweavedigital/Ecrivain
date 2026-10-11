'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../shared/text-utils');

const NBSP = ' ';
const NNBSP = ' ';

test('comptage de mots : les tirets de dialogue et la ponctuation isolée ne sont pas des mots', () => {
    const html = '<p>— Bonjour, dit-il.</p><p>— Salut !</p>';
    // « Bonjour, » + « dit-il. » + « Salut » = 3 ; « — » et « ! » seuls ne comptent pas.
    assert.equal(T.countWordsFromHtml(html), 3);
    assert.equal(T.countWordsFromHtml('<p>— Bonjour, dit-il. — Salut ! répondit Marie.</p>'), 5);
});

test('comptage de mots : balises de mise en forme sans espace parasite', () => {
    assert.equal(T.countWordsFromHtml('<p>Le 2<sup>e</sup> tome</p>'), 3);
    assert.equal(T.countWordsFromHtml('<p>sou<b>ligné</b></p>'), 1);
});

test('comptage de mots : retours de ligne et blocs séparent les mots', () => {
    assert.equal(T.countWordsFromHtml('<p>un</p><p>deux</p>'), 2);
    assert.equal(T.countWordsFromHtml('un<br>deux'), 2);
    assert.equal(T.countWordsFromHtml('<ul><li>a</li><li>b</li></ul>'), 2);
});

test('comptage de mots : espaces insécables et entités', () => {
    assert.equal(T.countWords(`Quoi${NNBSP}? Vraiment${NBSP}!`), 2);
    assert.equal(T.countWordsFromHtml('<p>un&nbsp;deux&#160;trois</p>'), 3);
    // « l’homme », « la », « femme » ; le « & » isolé ne compte pas.
    assert.equal(T.countWordsFromHtml('<p>l&rsquo;homme &amp; la femme</p>'), 3);
});

test('comptage de mots : vide, scripts et commentaires', () => {
    assert.equal(T.countWordsFromHtml(''), 0);
    assert.equal(T.countWordsFromHtml('<p></p>'), 0);
    assert.equal(T.countWordsFromHtml('<p>a</p><script>alert(1 2 3)</script><!-- x y z -->'), 1);
});

test('entités : décodage en une seule passe', () => {
    assert.equal(T.decodeEntities('&amp;lt;'), '&lt;');
    assert.equal(T.decodeEntities('&#8217;&#x2019;&eacute;&hellip;'), '’’é…');
    assert.equal(T.decodeEntities('&inconnue;'), '&inconnue;');
    assert.equal(T.decodeEntities('&#0;&#99999999;'), '&#0;&#99999999;');
});

test('typographie : ponctuation haute', () => {
    assert.equal(T.applyFrenchTypography('Bonjour: oui'), `Bonjour${NBSP}: oui`);
    assert.equal(T.applyFrenchTypography('Vraiment?'), `Vraiment${NNBSP}?`);
    assert.equal(T.applyFrenchTypography('Non ; peut-être'), `Non${NNBSP}; peut-être`);
});

test('typographie : « ?! » et « !! » reçoivent une seule espace fine', () => {
    assert.equal(T.applyFrenchTypography('Quoi?!'), `Quoi${NNBSP}?!`);
    assert.equal(T.applyFrenchTypography('Non!!'), `Non${NNBSP}!!`);
});

test('typographie : espace insécable ordinaire (U+00A0) avant « ; ? ! » sur demande, espace fine par défaut', () => {
    const office = { narrowSpaces: false };
    assert.equal(T.applyFrenchTypography('Vraiment?', office), `Vraiment${NBSP}?`);
    assert.equal(T.applyFrenchTypography('Non ; peut-être', office), `Non${NBSP}; peut-être`);
    assert.equal(T.applyFrenchTypography('Quoi?! Non!!', office), `Quoi${NBSP}?! Non${NBSP}!!`);
    assert.ok(!T.applyFrenchTypography('Quoi ? Oui ; non ! Bon : soit. « Ah » 5 %', office).includes(NNBSP));
    // Le reste de la typographie ne change pas.
    assert.equal(T.applyFrenchTypography('Bonjour: «oui» 5 %', office), `Bonjour${NBSP}: «${NBSP}oui${NBSP}» 5${NBSP}%`);
    // Sans option (éditeur, EPUB, PDF), le comportement de la bêta.11 est conservé.
    assert.equal(T.applyFrenchTypography('Vraiment?'), `Vraiment${NNBSP}?`);
    assert.equal(T.applyFrenchTypography('Vraiment?', {}), `Vraiment${NNBSP}?`);
    // Les espaces fines déjà présentes dans le manuscrit sont converties ; la fonction reste idempotente.
    const converted = T.applyFrenchTypography(`Vraiment${NNBSP}? Oui${NNBSP}!`, office);
    assert.equal(converted, `Vraiment${NBSP}? Oui${NBSP}!`);
    assert.equal(T.applyFrenchTypography(converted, office), converted);
});

test('typographie : heures, adresses web et courriels intacts', () => {
    assert.equal(T.applyFrenchTypography('Rendez-vous à 12:30'), 'Rendez-vous à 12:30');
    assert.equal(T.applyFrenchTypography('Voir https://exemple.fr/a?b=c;d'), 'Voir https://exemple.fr/a?b=c;d');
    assert.equal(T.applyFrenchTypography('écrire à jean.dupont@exemple.fr: merci'), `écrire à jean.dupont@exemple.fr${NBSP}: merci`);
});

test('typographie : apostrophes, points de suspension, guillemets, unités', () => {
    assert.equal(T.applyFrenchTypography("l'homme"), 'l’homme');
    assert.equal(T.applyFrenchTypography('Alors...'), 'Alors…');
    assert.equal(T.applyFrenchTypography('Il dit «bonjour»'), `Il dit «${NBSP}bonjour${NBSP}»`);
    assert.equal(T.applyFrenchTypography('50 %'), `50${NBSP}%`);
    assert.equal(T.applyFrenchTypography('10€'), `10${NBSP}€`);
    assert.equal(T.applyFrenchTypography('mot , mot .'), 'mot, mot.');
});

test('typographie : idempotente', () => {
    const samples = [
        "Il dit: «ça va?!» et puis... 12:30 https://a.fr/x?y=1; l'homme, 50 % ; non!",
        '— Bonjour : oui ; non ? Peut-être !',
        'Prix: 10€ , soit 5 %.'
    ];
    for (const sample of samples) {
        const once = T.applyFrenchTypography(sample);
        assert.equal(T.applyFrenchTypography(once), once, sample);
    }
});

test('dialogue : tiret ou demi-cadratin en début de paragraphe devient cadratin', () => {
    assert.equal(T.fixDialogueDash('- Bonjour'), '— Bonjour');
    assert.equal(T.fixDialogueDash('– Bonjour'), '— Bonjour');
    assert.equal(T.fixDialogueDash('  - Bonjour'), '— Bonjour');
    assert.equal(T.fixDialogueDash('Il dit - non'), 'Il dit - non');
    assert.equal(T.fixDialogueDash('-3 degrés'), '-3 degrés');
});
