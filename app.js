/* ==============================================================
   Huiswiki – app.js
   Haalt huis.yml en taken.yml op en bouwt daarmee de pagina.
   Normaal hoef je hier niets te veranderen. Alleen als je je
   repository ooit een andere naam geeft, pas je hieronder
   "repository" aan.
   ============================================================== */
(function () {
  'use strict';

  var INSTELLINGEN = {
    githubGebruiker: 'mauritsknobben',
    repository: 'huiswiki',
    branch: 'main',
    huisBestand: 'huis.yml',
    takenBestand: 'taken.yml',
    reserveYamlLezer: 'https://cdnjs.cloudflare.com/ajax/libs/js-yaml/4.1.0/js-yaml.min.js'
  };

  var L = window.HuisLogica;
  var TAKEN = 'Taken';
  var SPECIALE_VELDEN = ['titel', 'naam', 'ruimte', 'ruimtes', 'notitie', 'notities'];

  var staat = {
    ruimtes: [],
    categorieen: [],
    taken: [],
    takenGeladen: false,
    binnenkortDagen: 14,
    meldingen: [],
    filterRuimte: null,
    filterCategorie: null,
    zoek: ''
  };

  /* ---------- Hulpjes ---------- */

  function el(tag, eigenschappen) {
    var e = document.createElement(tag);
    var kinderen = Array.prototype.slice.call(arguments, 2);
    if (eigenschappen) {
      Object.keys(eigenschappen).forEach(function (k) {
        var v = eigenschappen[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') e.className = v;
        else if (k === 'tekst') e.textContent = v;
        else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? '' : v);
      });
    }
    voegToe(e, kinderen);
    return e;
  }

  function voegToe(ouder, kinderen) {
    kinderen.forEach(function (kind) {
      if (kind === null || kind === undefined || kind === false) return;
      if (Array.isArray(kind)) { voegToe(ouder, kind); return; }
      ouder.append(kind instanceof Node ? kind : document.createTextNode(String(kind)));
    });
  }

  function githubUrl(soort, bestand, regel) {
    var url = 'https://github.com/' + INSTELLINGEN.githubGebruiker + '/' +
      INSTELLINGEN.repository + '/' + soort + '/' + INSTELLINGEN.branch + '/' + bestand;
    return regel ? url + '#L' + regel : url;
  }

  function zoekvorm(s) {
    return L.zonderAccenten(String(s)).toLowerCase();
  }

  function platslaan(waarde, uit) {
    if (Array.isArray(waarde)) waarde.forEach(function (w) { platslaan(w, uit); });
    else if (L.isObject(waarde)) Object.keys(waarde).forEach(function (k) { uit.push(k); platslaan(waarde[k], uit); });
    else if (waarde !== null && waarde !== undefined) uit.push(String(waarde));
    return uit;
  }

  var datumKort = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  var datumLang = new Intl.DateTimeFormat('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

  function korteDatum(d) { return datumKort.format(new Date(L.naarUTC(d))); }
  function langeDatum(d) { return datumLang.format(new Date(L.naarUTC(d))); }

  function relatief(dagen) {
    if (dagen === 0) return 'vandaag';
    if (dagen === 1) return 'morgen';
    if (dagen === -1) return '1 dag te laat';
    if (dagen > 1) return 'over ' + dagen + ' dagen';
    return (-dagen) + ' dagen te laat';
  }

  function meld(bestand, tekst, regel, ernstig, technisch) {
    staat.meldingen.push({ bestand: bestand, tekst: tekst, regel: regel || null, ernstig: !!ernstig, technisch: technisch || '' });
  }

  /* ---------- Gegevens ophalen ---------- */

  function zorgVoorYamlLezer() {
    return new Promise(function (klaar, mislukt) {
      if (window.jsyaml) { klaar(window.jsyaml); return; }
      var s = document.createElement('script');
      s.src = INSTELLINGEN.reserveYamlLezer;
      s.onload = function () { window.jsyaml ? klaar(window.jsyaml) : mislukt(); };
      s.onerror = function () { mislukt(); };
      document.head.appendChild(s);
    });
  }

  function haalOp(bestand) {
    // Het tijdstip achter de naam zorgt dat je altijd de nieuwste versie krijgt.
    return fetch(bestand + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (antwoord) {
        if (antwoord.status === 404) {
          return { fout: bestand + ' is niet gevonden. Staat het bestand in de hoofdmap van je repository, en heet het precies ' + bestand + ' (kleine letters)?' };
        }
        if (!antwoord.ok) return { fout: bestand + ' kon niet worden opgehaald (foutcode ' + antwoord.status + '). Probeer de pagina over een minuut opnieuw.' };
        return antwoord.text().then(function (t) { return { tekst: t }; });
      })
      .catch(function () {
        return { fout: bestand + ' kon niet worden opgehaald. Heb je internet? Open de site via https://' + INSTELLINGEN.githubGebruiker + '.github.io/' + INSTELLINGEN.repository + '/' };
      });
  }

  function leesBestand(bestand, opgehaald, yaml) {
    if (opgehaald.fout) { meld(bestand, opgehaald.fout, null, true); return null; }
    var gelezen = L.leesYaml(opgehaald.tekst, yaml);
    if (gelezen.fout) {
      var f = gelezen.fout;
      meld(bestand, 'Kan het bestand niet lezen. ' + f.uitleg + ' Kijk ook naar de regel erboven.', f.regel, true, f.technisch);
      return null;
    }
    gelezen.waarschuwingen.forEach(function (w) { meld(bestand, w.tekst, w.regel); });
    return gelezen.data;
  }

  /* ---------- Gegevens verwerken ---------- */

  function verwerkHuis(data) {
    var bestand = INSTELLINGEN.huisBestand;
    if (!L.isObject(data)) {
      meld(bestand, 'Het bestand is leeg, of begint niet met "ruimtes:" en "categorieen:".', null, true);
      return;
    }
    staat.ruimtes = L.ruimteLijst(L.veld(data, 'ruimtes'));
    var bekend = {};
    staat.ruimtes.forEach(function (r) { bekend[L.sleutel(r)] = r; });

    var categorieen = L.veld(data, 'categorieen');
    if (!Array.isArray(categorieen)) {
      meld(bestand, 'Ik vind geen lijst "categorieen:". Begint elke categorie met "- naam:"?', null, true);
      return;
    }

    var onbekend = [];
    categorieen.forEach(function (cat, ci) {
      if (!L.isObject(cat)) {
        meld(bestand, 'Categorie ' + (ci + 1) + ' begrijp ik niet. Begint hij met "- naam:"?');
        return;
      }
      var naam = L.tekst(L.veld(cat, 'naam')) || ('Categorie ' + (ci + 1));
      var ruweItems = L.veld(cat, 'items');
      if (ruweItems !== undefined && ruweItems !== null && !Array.isArray(ruweItems)) {
        meld(bestand, 'Bij "' + naam + '" staan de items niet in een lijst. Begint elk item met "- titel:"?');
      }
      var items = [];
      L.lijst(ruweItems).forEach(function (item, ii) {
        if (!L.isObject(item)) {
          meld(bestand, naam + ', item ' + (ii + 1) + ' begrijp ik niet. Staat er "titel:" achter het streepje?');
          return;
        }
        var titel = L.tekst(L.veld(item, 'titel')) || L.tekst(L.veld(item, 'naam'));
        if (!titel) meld(bestand, naam + ', item ' + (ii + 1) + ' heeft geen titel.');
        titel = titel || '(zonder titel)';

        var ruimteBron = L.veld(item, 'ruimte') !== undefined ? L.veld(item, 'ruimte') : L.veld(item, 'ruimtes');
        var ruimtes = L.ruimteLijst(ruimteBron).map(function (r) {
          if (bekend[L.sleutel(r)]) return bekend[L.sleutel(r)];
          onbekend.push({ ruimte: r, titel: titel });
          return r;
        });

        var notitie = L.tekst(L.veld(item, 'notitie')) || L.tekst(L.veld(item, 'notities'));
        var velden = Object.keys(item).filter(function (k) {
          return SPECIALE_VELDEN.indexOf(L.sleutel(k)) < 0;
        }).map(function (k) { return [k, item[k]]; });

        items.push({
          titel: titel,
          ruimtes: ruimtes,
          notitie: notitie,
          velden: velden,
          zoektekst: zoekvorm(platslaan([naam, titel, ruimtes, notitie, item], []).join(' '))
        });
      });
      staat.categorieen.push({ naam: naam, items: items });
    });

    onbekend.forEach(function (o) {
      meld(bestand, 'De ruimte "' + o.ruimte + '" (bij "' + o.titel + '") staat niet in de lijst met ruimtes bovenaan. Is het een tikfout, of moet je hem aan die lijst toevoegen?');
      if (staat.ruimtes.indexOf(o.ruimte) < 0) staat.ruimtes.push(o.ruimte);
    });
  }

  function verwerkTaken(data) {
    var bestand = INSTELLINGEN.takenBestand;
    var uit = L.controleerTaken(data);
    uit.meldingen.forEach(function (m) { meld(bestand, m.tekst, null, m.ernstig); });
    staat.binnenkortDagen = uit.binnenkortDagen;
    var bekend = {};
    staat.ruimtes.forEach(function (r) { bekend[L.sleutel(r)] = r; });
    staat.taken = uit.taken.map(function (t) {
      t.ruimtes = t.ruimtes.map(function (r) { return bekend[L.sleutel(r)] || r; });
      t.domId = 'taak-' + (t.id || ('nr' + t.nr));
      t.zoektekst = zoekvorm(platslaan([TAKEN, t.taak, t.ruimtes, t.notitie, t.intervalBron, t.extra], []).join(' '));
      return t;
    });
    staat.takenGeladen = uit.taken.length > 0 || uit.meldingen.length === 0;
  }

  function taakStatus(t, vandaag) {
    if (!t.volgende) return { soort: 'onbekend', label: 'Onvolledig', dagen: null };
    var d = L.dagenVerschil(vandaag, t.volgende);
    if (d < 0) return { soort: 'laat', label: 'Te laat', dagen: d };
    if (d === 0) return { soort: 'vandaag', label: 'Vandaag', dagen: 0 };
    if (d <= staat.binnenkortDagen) return { soort: 'binnenkort', label: 'Binnenkort', dagen: d };
    return { soort: 'gepland', label: 'Gepland', dagen: d };
  }

  function opVolgorde(a, b) {
    if (!a.volgende && !b.volgende) return 0;
    if (!a.volgende) return 1;
    if (!b.volgende) return -1;
    return a.volgende < b.volgende ? -1 : a.volgende > b.volgende ? 1 : 0;
  }

  /* ---------- Tonen ---------- */

  function toonMeldingen() {
    var vak = document.getElementById('meldingen');
    vak.replaceChildren();
    if (!staat.meldingen.length) return;
    var ernstig = staat.meldingen.some(function (m) { return m.ernstig; });
    var n = staat.meldingen.length;
    vak.append(el('details', { class: 'meldingen' + (ernstig ? ' ernstig' : ''), open: true },
      el('summary', { tekst: n === 1 ? 'Er is 1 ding om te controleren in je gegevens' : 'Er zijn ' + n + ' dingen om te controleren in je gegevens' }),
      el('ul', null, staat.meldingen.map(function (m) {
        var bestandUrl = /\.yml$/.test(m.bestand) ? githubUrl(m.regel ? 'blob' : 'edit', m.bestand, m.regel) : null;
        return el('li', null,
          el('strong', { tekst: m.bestand + (m.regel ? ', regel ' + m.regel : '') + ':' }),
          ' ', m.tekst, ' ',
          bestandUrl ? el('a', { href: bestandUrl, target: '_blank', rel: 'noopener', tekst: m.regel ? 'Bekijk regel ' + m.regel + ' op GitHub' : 'Open op GitHub' }) : null,
          m.technisch ? el('span', { class: 'technisch', tekst: 'Technische melding: ' + m.technisch }) : null
        );
      }))
    ));
  }

  function toonAandacht() {
    var vak = document.getElementById('aandacht');
    vak.replaceChildren();
    vak.hidden = !!staat.zoek;
    if (staat.zoek) return;

    vak.append(el('h2', { tekst: 'Binnenkort en te laat' }));
    if (!staat.taken.length) {
      vak.append(el('p', { class: 'rustig', tekst: staat.takenGeladen ? 'Er staan nog geen taken in taken.yml.' : 'De taken konden niet worden geladen. Zie de melding hierboven.' }));
      return;
    }

    var vandaag = L.vandaag();
    var metStatus = staat.taken.slice().sort(opVolgorde).map(function (t) { return { t: t, s: taakStatus(t, vandaag) }; });
    var dringend = metStatus.filter(function (x) { return x.s.soort === 'laat' || x.s.soort === 'vandaag' || x.s.soort === 'binnenkort'; });

    if (!dringend.length) {
      var eerst = metStatus.filter(function (x) { return x.s.soort === 'gepland'; })[0];
      vak.append(el('p', { class: 'rustig' },
        'Niets in de komende ' + staat.binnenkortDagen + ' dagen.',
        eerst ? ' Hierna: ' + eerst.t.taak + ' op ' + korteDatum(eerst.t.volgende) + '.' : ''));
      return;
    }

    vak.append(el('ul', { class: 'aandacht-lijst' }, dringend.map(function (x) {
      return el('li', null, el('button', {
        type: 'button',
        class: 'aandacht-rij ' + x.s.soort,
        onclick: function () { toonTaak(x.t); }
      },
        el('span', { class: 'aandacht-naam', tekst: x.t.taak }),
        el('span', { class: 'aandacht-wanneer', tekst: relatief(x.s.dagen) })
      ));
    })));
  }

  function maakChips(houderId, keuzes, gekozen, kies) {
    var houder = document.getElementById(houderId);
    houder.replaceChildren();
    keuzes.forEach(function (k) {
      houder.append(el('button', {
        type: 'button',
        class: 'chip',
        'aria-pressed': String(k.waarde === gekozen),
        onclick: function () { kies(k.waarde); },
        tekst: k.label
      }));
    });
    // Zorg dat de gekozen knop zichtbaar is, ook als hij ver rechts staat.
    var gekozenKnop = houder.querySelector('[aria-pressed="true"]');
    if (gekozenKnop) {
      var links = gekozenKnop.offsetLeft - houder.offsetLeft;
      var rechts = links + gekozenKnop.offsetWidth;
      if (links < houder.scrollLeft || rechts > houder.scrollLeft + houder.clientWidth - 24) {
        houder.scrollLeft = Math.max(0, links - 8);
      }
    }
  }

  function toonFilters() {
    var nav = document.getElementById('filters');
    nav.hidden = !!staat.zoek;
    maakChips('filter-ruimte',
      [{ waarde: null, label: 'Alle' }].concat(staat.ruimtes.map(function (r) { return { waarde: r, label: r }; })),
      staat.filterRuimte,
      function (w) { staat.filterRuimte = w; toonResultaten(); toonFilters(); });
    maakChips('filter-categorie',
      [{ waarde: null, label: 'Alles' }]
        .concat(staat.categorieen.map(function (c) { return { waarde: c.naam, label: c.naam }; }))
        .concat([{ waarde: TAKEN, label: TAKEN }]),
      staat.filterCategorie,
      function (w) { staat.filterCategorie = w; toonResultaten(); toonFilters(); });
  }

  function ruimteLabels(ruimtes) {
    if (!ruimtes.length) return null;
    return el('ul', { class: 'ruimtes', 'aria-label': 'Ruimte' },
      ruimtes.map(function (r) { return el('li', { tekst: r }); }));
  }

  function waardeNode(veldnaam, waarde) {
    if (Array.isArray(waarde)) {
      return el('ul', { class: 'opsomming' }, waarde.map(function (w) { return el('li', null, waardeNode(veldnaam, w)); }));
    }
    if (L.isObject(waarde)) {
      return el('dl', { class: 'velden genest' }, Object.keys(waarde).map(function (k) {
        return el('div', { class: 'veld' }, el('dt', { tekst: L.labelVan(k) }), el('dd', null, waardeNode(k, waarde[k])));
      }));
    }
    var s = L.tekst(waarde);
    if (!s) return el('span', { class: 'rustig', tekst: '–' });
    if (/^https?:\/\/\S+$/i.test(s)) {
      var host = s;
      try { host = new URL(s).hostname.replace(/^www\./, ''); } catch (e) { /* laat zo */ }
      return el('a', { href: s, target: '_blank', rel: 'noopener', tekst: 'Openen (' + host + ')' });
    }
    var datum = L.leesDatum(s);
    if (datum) {
      var delen = [korteDatum(datum)];
      if (L.sleutel(veldnaam).indexOf('garantie') === 0) {
        var verlopen = L.dagenVerschil(L.vandaag(), datum) < 0;
        delen.push(' ', el('span', { class: 'garantie ' + (verlopen ? 'verlopen' : 'geldig'), tekst: verlopen ? 'verlopen' : 'nog geldig' }));
      }
      return el('span', null, delen);
    }
    return document.createTextNode(s);
  }

  function veldenLijst(rijen) {
    if (!rijen.length) return null;
    return el('dl', { class: 'velden' }, rijen.map(function (r) {
      return el('div', { class: 'veld' }, el('dt', { tekst: r[0] }), el('dd', null, r[1]));
    }));
  }

  function itemKaart(item) {
    return el('article', { class: 'kaart' },
      el('div', { class: 'kaart-kop' }, el('h3', { tekst: item.titel }), ruimteLabels(item.ruimtes)),
      veldenLijst(item.velden.map(function (v) { return [L.labelVan(v[0]), waardeNode(v[0], v[1])]; })),
      item.notitie ? el('p', { class: 'notitie', tekst: item.notitie }) : null
    );
  }

  function taakKaart(t) {
    var s = taakStatus(t, L.vandaag());
    var rijen = [
      ['Volgende keer', t.volgende ? langeDatum(t.volgende) + ' (' + relatief(s.dagen) + ')' : '–'],
      ['Hoe vaak', t.interval ? L.intervalTekst(t.interval) : (t.intervalBron || '–')],
      ['Laatst gedaan', t.laatst ? korteDatum(t.laatst) : (t.laatstBron || '–')]
    ].concat(t.extra.map(function (v) { return [L.labelVan(v[0]), waardeNode(v[0], v[1])]; }));

    return el('article', { class: 'kaart taak ' + s.soort, id: t.domId },
      el('div', { class: 'kaart-kop' },
        el('h3', { tekst: t.taak }),
        el('span', { class: 'status ' + s.soort, tekst: s.label }),
        ruimteLabels(t.ruimtes)),
      veldenLijst(rijen),
      t.notitie ? el('p', { class: 'notitie', tekst: t.notitie }) : null,
      t.problemen.length ? el('ul', { class: 'problemen' }, t.problemen.map(function (p) {
        return el('li', { tekst: p.charAt(0).toUpperCase() + p.slice(1) });
      })) : null
    );
  }

  function toonResultaten() {
    var vak = document.getElementById('resultaten');
    vak.replaceChildren();
    var woorden = zoekvorm(staat.zoek).split(/\s+/).filter(Boolean);
    var zoekend = woorden.length > 0;

    function past(ding) {
      if (zoekend) return woorden.every(function (w) { return ding.zoektekst.indexOf(w) >= 0; });
      if (!staat.filterRuimte) return true;
      var gezocht = L.sleutel(staat.filterRuimte);
      return ding.ruimtes.some(function (r) { return L.sleutel(r) === gezocht; });
    }

    var groepen = [];
    staat.categorieen.forEach(function (cat) {
      if (!zoekend && staat.filterCategorie && staat.filterCategorie !== cat.naam) return;
      var items = cat.items.filter(past);
      if (items.length) groepen.push({ naam: cat.naam, kaarten: items.map(itemKaart) });
    });
    if (zoekend || !staat.filterCategorie || staat.filterCategorie === TAKEN) {
      var taken = staat.taken.filter(past).sort(opVolgorde);
      if (taken.length) groepen.push({ naam: TAKEN, kaarten: taken.map(taakKaart) });
    }

    if (zoekend) {
      var aantal = groepen.reduce(function (som, g) { return som + g.kaarten.length; }, 0);
      vak.append(el('p', { class: 'zoekinfo', tekst: aantal === 1 ? '1 resultaat, gezocht in alles' : aantal + ' resultaten, gezocht in alles' }));
    }

    if (!groepen.length) {
      vak.append(el('p', { class: 'leeg', tekst: zoekend
        ? 'Niets gevonden voor “' + staat.zoek + '”. Probeer een korter woord.'
        : 'Hier staat nog niets. Kies een andere ruimte of soort, of voeg iets toe in huis.yml.' }));
      return;
    }

    groepen.forEach(function (g) {
      vak.append(el('section', { class: 'groep' },
        el('h2', null, g.naam, ' ', el('span', { class: 'aantal', tekst: String(g.kaarten.length) })),
        el('div', { class: 'kaarten' }, g.kaarten)));
    });
  }

  function toonTaak(t) {
    staat.zoek = '';
    document.getElementById('zoek').value = '';
    staat.filterRuimte = null;
    staat.filterCategorie = TAKEN;
    toonAlles();
    var kaart = document.getElementById(t.domId);
    if (kaart) {
      kaart.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
      kaart.classList.add('uitgelicht');
      setTimeout(function () { kaart.classList.remove('uitgelicht'); }, 1600);
    }
  }

  function toonVoettekst() {
    document.getElementById('bewerken').replaceChildren(
      'Gegevens bewerken op GitHub: ',
      el('a', { href: githubUrl('edit', INSTELLINGEN.huisBestand), target: '_blank', rel: 'noopener', tekst: INSTELLINGEN.huisBestand }),
      ' en ',
      el('a', { href: githubUrl('edit', INSTELLINGEN.takenBestand), target: '_blank', rel: 'noopener', tekst: INSTELLINGEN.takenBestand })
    );
    var nu = new Date();
    document.getElementById('geladen').textContent = 'Geladen om ' +
      String(nu.getHours()).padStart(2, '0') + ':' + String(nu.getMinutes()).padStart(2, '0') +
      '. Veel veranderd? Vernieuw de pagina.';
  }

  function toonAlles() {
    toonMeldingen();
    toonAandacht();
    toonFilters();
    toonResultaten();
  }

  /* ---------- Starten ---------- */

  function start() {
    toonVoettekst();

    var zoekveld = document.getElementById('zoek');
    zoekveld.addEventListener('input', function () {
      staat.zoek = zoekveld.value.trim();
      toonAandacht();
      toonFilters();
      toonResultaten();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === '/' && document.activeElement !== zoekveld) { e.preventDefault(); zoekveld.focus(); }
    });

    if (location.protocol === 'file:') {
      meld('website', 'Je hebt index.html vanaf je computer geopend. Dat werkt niet: open de site via https://' +
        INSTELLINGEN.githubGebruiker + '.github.io/' + INSTELLINGEN.repository + '/', null, true);
      toonAlles();
      return;
    }

    zorgVoorYamlLezer().then(function (yaml) {
      return Promise.all([haalOp(INSTELLINGEN.huisBestand), haalOp(INSTELLINGEN.takenBestand)]).then(function (r) {
        var huis = leesBestand(INSTELLINGEN.huisBestand, r[0], yaml);
        if (huis !== null) verwerkHuis(huis);
        var taken = leesBestand(INSTELLINGEN.takenBestand, r[1], yaml);
        if (taken !== null) verwerkTaken(taken);
        toonAlles();
      });
    }).catch(function () {
      meld('website', 'Het hulpprogramma dat de gegevens leest, kon niet worden geladen. Controleer je internetverbinding en vernieuw de pagina.', null, true);
      toonAlles();
    });
  }

  start();
})();
