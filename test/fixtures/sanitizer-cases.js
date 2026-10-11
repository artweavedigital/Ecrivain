'use strict';

// Charges hostiles : après filtrage, aucune ne doit laisser de balise active,
// de gestionnaire d'événement, de lien « javascript: » ni d'adresse distante.
const HOSTILE = {
    script: '<p>a</p><script>alert(1)</script>',
    onerror: '<img src=x onerror="alert(1)">',
    iframe: '<iframe srcdoc="<script src=data:text/javascript,alert(1)></script>"></iframe><p>ok</p>',
    js_href: '<a href="javascript:alert(1)">clic</a>',
    js_href_obf: '<a href="  JaVa\tScRiPt:alert(1)">clic</a>',
    js_href_entity: '<a href="jav&#x61;script:alert(1)">clic</a>',
    data_href: '<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>',
    svg: '<svg onload=alert(1)><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>',
    math: '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
    form: '<form action="https://evil.example"><input name=a></form>',
    style_url: '<p style="background:url(https://evil.example/x);color:red;position:fixed">t</p>',
    style_expr: '<p style="width:expression(alert(1));color:blue">t</p>',
    style_escape: '<p style="background:\\75rl(https://evil.example/x)">t</p>',
    meta: '<meta http-equiv="refresh" content="0;url=https://evil.example"><p>t</p>',
    base: '<base href="https://evil.example/"><p>t</p>',
    object: '<object data="x"></object><embed src="x">',
    comment: '<p>a<!-- <script>alert(1)</script> -->b</p>',
    mutation: '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
    img_remote: '<img src="https://evil.example/track.gif">',
    img_svg_data: '<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">',
    template: '<template><script>alert(1)</script></template>',
    id_clobber: '<p id="chapterContent" name="x">t</p>'
};

// Contenu d'éditeur légitime : doit traverser le filtre sans aucune perte.
const BENIGN = '<h1>Titre</h1><p style="text-indent: 5mm">Il lut <b>Silmarillion</b>, <i>vraiment</i> <u>bien</u> <s>x</s> 2<sup>e</sup> H<sub>2</sub>O.</p><blockquote>Citation</blockquote><ul><li>un</li></ul><p><font face="Garamond" size="4" color="#333">police</font> <span style="font-family: Garamond; font-size: 12pt; color: rgb(10, 20, 30); background-color: rgb(255, 255, 0); text-decoration-line: underline line-through">mise en forme</span> — Bonjour&nbsp;! « Salut »</p><p><br></p><p><img src="data:image/png;base64,iVBORw0KGgo=" alt="ok"></p>';

module.exports = { HOSTILE, BENIGN };
