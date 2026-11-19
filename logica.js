/* ==============================================================
   Huiswiki – logica.js
   De rekenregels: datums lezen, intervallen begrijpen en de
   volgende datum van een taak uitrekenen.
   Dit bestand wordt door de website gebruikt en in fase 2 ook
   door het script dat het agendabestand maakt. Zo rekenen de
   website en je agenda altijd precies hetzelfde.
   Je hoeft hier niets aan te veranderen.
   ============================================================== */
(function (wereld, maak) {
  'use strict';
  var api = maak();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;          // gebruikt door het agendascript (fase 2)
  } else {
    wereld.HuisLogica = api;       // gebruikt door de website
  }
})(this, function () {
  'use strict';

  var MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni',
    'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

  var MAAND_AFKORTINGEN = {
    jan: 1, feb: 2, mrt: 3, maa: 3, apr: 4, mei: 5, jun: 6, jul: 7,
    aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, dec: 12
  };

  /* ---------- Kleine hulpjes ---------- */

  function tekst(waarde) {
    if (waarde === null || waarde === undefined) return '';
    if (typeof waarde === 'object') return '';
    return String(waarde).trim();
  }

  function isObject(waarde) {
    return waarde !== null && typeof waarde === 'object' && !Array.isArray(waarde);
  }

  function lijst(waarde) {
    if (Array.isArray(waarde)) return waarde;
    if (waarde === null || waarde === undefined || waarde === '') return [];
    return [waarde];
  }

  function zonderAccenten(s) {
    return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  /* Maakt van een veldnaam een vaste vorm, zodat "Laatst gedaan",
     "laatst_gedaan" en "categorieën" ook herkend worden. */
  function sleutel(naam) {
    return zonderAccenten(String(naam)).toLowerCase().trim().replace(/[\s-]+/g, '_');
  }

  function veld(object, naam) {
    if (!isObject(object)) return undefined;
    var gezocht = sleutel(naam);
    var namen = Object.keys(object);
    for (var i = 0; i < namen.length; i++) {
      if (sleutel(namen[i]) === gezocht) return object[namen[i]];
    }
    return undefined;
  }

  /* "garantie_tot" wordt "Garantie tot" */
  function labelVan(naam) {
    var s = String(naam).replace(/_/g, ' ').trim();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /* Ruimtes mogen als één naam, als [lijst] of als "Keuken, Hal". */
  function ruimteLijst(waarde) {
    var uit = [];
    lijst(waarde).forEach(function (r) {
      tekst(r).split(',').forEach(function (deel) {
        var naam = deel.trim();
        if (naam) uit.push(naam);
      });
    });
    return uit;
  }

  /* ---------- Datums ----------
     Een datum is bij ons altijd een tekst "JJJJ-MM-DD".
     We rekenen in UTC, zodat zomer- en wintertijd nooit
     een dag verschil geven. */

  function tweeCijfers(n) { return (n < 10 ? '0' : '') + n; }

  function dagenInMaand(jaar, maand) {
    return new Date(Date.UTC(jaar, maand, 0)).getUTCDate();
  }

  function maakDatum(jaar, maand, dag) {
    return jaar + '-' + tweeCijfers(maand) + '-' + tweeCijfers(dag);
  }

  function delen(datum) {
    var p = datum.split('-');
    return { j: parseInt(p[0], 10), m: parseInt(p[1], 10), d: parseInt(p[2], 10) };
  }

  /* Leest 2025-10-14, 2025/10/14, 14-10-2025, 14/10/2025 of 14.10.2025 */
  function leesDatum(waarde) {
    var s = tekst(waarde);
    var j, m, d, r;
    if ((r = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/))) {
      j = +r[1]; m = +r[2]; d = +r[3];
    } else if ((r = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/))) {
      d = +r[1]; m = +r[2]; j = +r[3];
    } else {
      return null;
    }
    if (m < 1 || m > 12 || d < 1 || d > dagenInMaand(j, m)) return null;
    return maakDatum(j, m, d);
  }

  function naarUTC(datum) {
    var p = delen(datum);
    return Date.UTC(p.j, p.m - 1, p.d);
  }

  function telDagenOp(datum, aantal) {
    var t = new Date(naarUTC(datum) + aantal * 86400000);
    return maakDatum(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }

  /* Telt maanden op. Bestaat de dag niet (31 april), dan wordt het
     de laatste dag van de maand. Met maxDag kun je de dag begrenzen. */
  function telMaandenOp(datum, aantal, maxDag) {
    var p = delen(datum);
    var totaal = p.j * 12 + (p.m - 1) + aantal;
    var jaar = Math.floor(totaal / 12);
    var maand = (totaal % 12) + 1;
    var dag = Math.min(p.d, dagenInMaand(jaar, maand));
    if (maxDag) dag = Math.min(dag, maxDag);
    return maakDatum(jaar, maand, dag);
  }

  function dagenVerschil(van, tot) {
    return Math.round((naarUTC(tot) - naarUTC(van)) / 86400000);
  }

  function vandaag() {
    var nu = new Date();
    return maakDatum(nu.getFullYear(), nu.getMonth() + 1, nu.getDate());
  }

  /* ---------- Intervallen ----------
     Begrijpt bijvoorbeeld: elke week, elke 2 weken, elke maand,
     elke 3 maanden, elk kwartaal, elk half jaar, elk jaar,
     elke 2 jaar, elk jaar in oktober, jaarlijks, maandelijks. */

  function leesMaand(woord) {
    var w = zonderAccenten(String(woord)).toLowerCase().replace(/\.$/, '');
    var i = MAANDEN.indexOf(w);
    if (i >= 0) return i + 1;
    if (MAAND_AFKORTINGEN[w]) return MAAND_AFKORTINGEN[w];
    if (w.length >= 3 && MAAND_AFKORTINGEN[w.slice(0, 3)]) return MAAND_AFKORTINGEN[w.slice(0, 3)];
    return null;
  }

  var EENHEDEN = {
    dag: 'dag', dagen: 'dag', week: 'week', weken: 'week',
    maand: 'maand', maanden: 'maand', jaar: 'jaar', jaren: 'jaar'
  };

  var ALIASSEN = {
    dagelijks: '1 dag', wekelijks: '1 week', maandelijks: '1 maand',
    jaarlijks: '1 jaar', kwartaal: '3 maanden', 'half jaar': '6 maanden',
    halfjaar: '6 maanden', halfjaarlijks: '6 maanden'
  };

  function leesInterval(waarde) {
    var s = zonderAccenten(tekst(waarde)).toLowerCase().replace(/\s+/g, ' ').trim();
    if (!s) return null;
    s = s.replace(/^(elke|elk|iedere|ieder|om de|per)\s+/, '');
    var maandWoord = null;
    var r = s.match(/^(.*?)\s+in\s+([a-z]+\.?)$/);
    if (r) { s = r[1].trim(); maandWoord = r[2]; }
    if (ALIASSEN[s]) s = ALIASSEN[s];
    r = s.match(/^(\d+)?\s*(dag|dagen|week|weken|maand|maanden|jaar|jaren)$/);
    if (!r) return null;
    var aantal = r[1] ? parseInt(r[1], 10) : 1;
    if (!(aantal >= 1)) return null;
    var eenheid = EENHEDEN[r[2]];
    var maand = null;
    if (maandWoord) {
      if (eenheid !== 'jaar') return null;
      maand = leesMaand(maandWoord);
      if (!maand) return null;
    }
    return { aantal: aantal, eenheid: eenheid, maand: maand };
  }

  function intervalTekst(iv) {
    var meervoud = { dag: 'dagen', week: 'weken', maand: 'maanden', jaar: 'jaar' };
    var s;
    if (iv.aantal === 1) s = (iv.eenheid === 'jaar' ? 'elk ' : 'elke ') + iv.eenheid;
    else s = 'elke ' + iv.aantal + ' ' + meervoud[iv.eenheid];
    if (iv.maand) s += ' in ' + MAANDEN[iv.maand - 1];
    return s;
  }

  /* De volgende keer = laatst gedaan + interval.
     - Maandelijkse taken op de 29e, 30e of 31e schuiven naar de 28e,
       zodat ze echt elke maand terugkomen (ook in februari).
     - "elk jaar in oktober": de eerstvolgende 1 oktober die minstens
       een half jaar na "laatst gedaan" valt. Wie het een maandje te
       vroeg of te laat deed, krijgt de taak dus niet meteen opnieuw. */
  function volgendeDatum(laatst, iv) {
    switch (iv.eenheid) {
      case 'dag': return telDagenOp(laatst, iv.aantal);
      case 'week': return telDagenOp(laatst, 7 * iv.aantal);
      case 'maand': return telMaandenOp(laatst, iv.aantal, 28);
      case 'jaar':
        if (iv.maand) {
          var drempel = delen(telMaandenOp(laatst, 12 * iv.aantal - 6));
          var jaar = iv.maand >= drempel.m ? drempel.j : drempel.j + 1;
          return maakDatum(jaar, iv.maand, 1);
        }
        return telMaandenOp(laatst, 12 * iv.aantal);
    }
    return null;
  }

  /* ---------- YAML lezen ----------
     We lezen alles als gewone tekst ("failsafe"), zodat datums,
     serienummers met nullen vooraan en woorden als "nee" niet
     stiekem worden omgezet. Tabs vooraan worden spaties. */

  var YAML_UITLEG = [
    [/duplicated mapping key/, 'Deze veldnaam komt twee keer voor in hetzelfde item.'],
    [/bad indentation of a sequence entry/, 'Het streepje (-) staat niet recht onder de streepjes van de andere items.'],
    [/bad indentation of a mapping entry/, 'De inspringing (het aantal spaties vooraan) klopt niet, of er staat een dubbele punt met een spatie in de tekst. Zet die tekst dan tussen aanhalingstekens.'],
    [/multiline key|implicit key/, 'Er mist waarschijnlijk een dubbele punt, of een regel springt verkeerd in.'],
    [/incomplete explicit mapping pair|a key node is missed/, 'Er staat een dubbele punt op een vreemde plek. Zet de tekst tussen aanhalingstekens.'],
    [/double quoted scalar|single quoted scalar/, 'Er mist een afsluitend aanhalingsteken.'],
    [/missed comma between flow collection entries/, 'Tussen de blokhaken [ ] moeten de namen met een komma gescheiden zijn.'],
    [/end of the stream or a document separator is expected/, 'De inspringing klopt niet: een regel staat verder of minder ver naar rechts dan zou moeten.'],
    [/unexpected end of the stream within a flow collection/, 'Er mist een sluitende blokhaak ].'],
    [/tab/, 'Er staat een Tab op een plek waar een spatie moet.']
  ];

  function leesYaml(bron, yaml) {
    var s = String(bron).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    s = s.split('\n').map(function (regel) {
      return regel.replace(/^[\t ]+/, function (begin) { return begin.replace(/\t/g, '  '); });
    }).join('\n');
    // Een waarde die met # begint (zoals #FFFFFF) ziet YAML als uitleg.
    var waarschuwingen = [];
    s.split('\n').forEach(function (regel, i) {
      if (/^[^#]*?:[ \t]+#\S/.test(regel)) {
        waarschuwingen.push({ regel: i + 1, tekst: 'Hier begint een waarde met #. Alles vanaf de # wordt dan als uitleg gezien en niet getoond. Zet de waarde tussen aanhalingstekens, bijvoorbeeld "#F5F5F0".' });
      }
    });
    try {
      return { data: yaml.load(s, { schema: yaml.FAILSAFE_SCHEMA }), fout: null, waarschuwingen: waarschuwingen };
    } catch (e) {
      var reden = e.reason || e.message || String(e);
      var uitleg = 'Er staat een schrijffout in dit bestand.';
      for (var i = 0; i < YAML_UITLEG.length; i++) {
        if (YAML_UITLEG[i][0].test(reden)) { uitleg = YAML_UITLEG[i][1]; break; }
      }
      return {
        data: null,
        fout: { regel: e.mark ? e.mark.line + 1 : null, uitleg: uitleg, technisch: reden },
        waarschuwingen: waarschuwingen
      };
    }
  }

  /* ---------- Taken controleren ---------- */

  var TAAK_VELDEN = ['id', 'taak', 'titel', 'interval', 'laatst_gedaan', 'ruimte', 'ruimtes', 'notitie'];

  function controleerTaken(data) {
    var uit = { taken: [], binnenkortDagen: 14, meldingen: [] };
    if (!isObject(data)) {
      uit.meldingen.push({ tekst: 'Het bestand is leeg of begint niet met "taken:".', ernstig: true });
      return uit;
    }
    var dagen = parseInt(tekst(veld(data, 'binnenkort_dagen')), 10);
    if (dagen >= 0) uit.binnenkortDagen = dagen;

    var ruw = veld(data, 'taken');
    if (!Array.isArray(ruw)) {
      uit.meldingen.push({ tekst: 'Ik vind geen lijst "taken:". Begint elke taak met "- id:"?', ernstig: true });
      return uit;
    }

    var gezien = {};
    ruw.forEach(function (t, i) {
      var nr = i + 1;
      if (!isObject(t)) {
        uit.meldingen.push({ tekst: 'Taak ' + nr + ' begrijp ik niet. Begint hij met "- id:" en staan de regels eronder even ver ingesprongen?' });
        return;
      }
      var naam = tekst(veld(t, 'taak')) || tekst(veld(t, 'titel')) || ('Taak ' + nr);
      var problemen = [];

      var id = tekst(veld(t, 'id'));
      if (!id) problemen.push('het id ontbreekt.');
      else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) problemen.push('het id "' + id + '" mag alleen kleine letters, cijfers en streepjes bevatten (geen spaties).');
      else if (gezien[id]) problemen.push('het id "' + id + '" wordt al door een andere taak gebruikt. Elke taak heeft een eigen id nodig.');
      if (id) gezien[id] = true;

      var intervalBron = tekst(veld(t, 'interval'));
      var interval = leesInterval(intervalBron);
      if (!intervalBron) problemen.push('het interval ontbreekt.');
      else if (!interval) problemen.push('het interval "' + intervalBron + '" wordt niet begrepen. Voorbeelden: elke maand, elke 3 maanden, elk jaar in oktober.');

      var laatstBron = tekst(veld(t, 'laatst_gedaan'));
      var laatst = leesDatum(laatstBron);
      if (!laatstBron) problemen.push('de datum bij laatst_gedaan ontbreekt.');
      else if (!laatst) problemen.push('de datum "' + laatstBron + '" bij laatst_gedaan klopt niet. Schrijf hem als 2025-10-14.');

      var extra = Object.keys(t).filter(function (k) {
        return TAAK_VELDEN.indexOf(sleutel(k)) < 0;
      }).map(function (k) { return [k, t[k]]; });

      problemen.forEach(function (p) {
        uit.meldingen.push({ tekst: 'Bij taak "' + naam + '": ' + p });
      });

      uit.taken.push({
        nr: nr,
        id: id,
        taak: naam,
        ruimtes: ruimteLijst(veld(t, 'ruimte') !== undefined ? veld(t, 'ruimte') : veld(t, 'ruimtes')),
        intervalBron: intervalBron,
        interval: interval,
        laatstBron: laatstBron,
        laatst: laatst,
        volgende: (interval && laatst) ? volgendeDatum(laatst, interval) : null,
        notitie: tekst(veld(t, 'notitie')),
        extra: extra,
        problemen: problemen
      });
    });
    return uit;
  }

  return {
    MAANDEN: MAANDEN,
    tekst: tekst,
    isObject: isObject,
    lijst: lijst,
    zonderAccenten: zonderAccenten,
    sleutel: sleutel,
    veld: veld,
    labelVan: labelVan,
    ruimteLijst: ruimteLijst,
    maakDatum: maakDatum,
    leesDatum: leesDatum,
    naarUTC: naarUTC,
    telDagenOp: telDagenOp,
    telMaandenOp: telMaandenOp,
    dagenVerschil: dagenVerschil,
    vandaag: vandaag,
    leesInterval: leesInterval,
    intervalTekst: intervalTekst,
    volgendeDatum: volgendeDatum,
    leesYaml: leesYaml,
    controleerTaken: controleerTaken
  };
});
