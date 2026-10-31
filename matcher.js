/*
 * Matcher: decide en qué palabra del guion vas, a partir de lo que el
 * reconocimiento de voz va escuchando.
 *
 * Idea: tomamos las últimas palabras reconocidas y hacemos un alineamiento
 * local (tipo Smith-Waterman) contra una ventana del guion alrededor de la
 * posición actual. Así toleramos palabras mal reconocidas, palabras que el
 * reconocedor se salta y muletillas que no están en el guion.
 * La posición solo avanza: si dejas de hablar no llegan palabras nuevas y el
 * texto se queda quieto.
 */
(function (root) {
  'use strict';

  function normalize(word) {
    return String(word)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // quita tildes
      .replace(/[^a-z0-9]/g, '');
  }

  function splitWords(text) {
    var out = [];
    var parts = String(text).split(/\s+/);
    for (var i = 0; i < parts.length; i++) {
      var n = normalize(parts[i]);
      if (n) out.push(n);
    }
    return out;
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    var m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    var prev = new Array(n + 1), cur = new Array(n + 1);
    for (var j = 0; j <= n; j++) prev[j] = j;
    for (var i = 1; i <= m; i++) {
      cur[0] = i;
      for (j = 1; j <= n; j++) {
        var cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      var t = prev; prev = cur; cur = t;
    }
    return prev[n];
  }

  // Parecido entre una palabra hablada y una del guion (0..1).
  function similarity(spoken, script) {
    if (spoken === script) return 1;
    var minLen = Math.min(spoken.length, script.length);
    if (minLen <= 2) return 0; // "de", "la", "y"... solo cuentan si son exactas
    // Palabra a medio reconocer (resultado provisional): "presen" ~ "presentacion"
    if (minLen >= 4 && (script.indexOf(spoken) === 0 || spoken.indexOf(script) === 0)) return 0.8;
    var ratio = 1 - levenshtein(spoken, script) / Math.max(spoken.length, script.length);
    return ratio >= 0.7 ? ratio : 0;
  }

  // Las palabras cortas son muy comunes y dan poca certeza.
  function weight(word) {
    if (word.length <= 2) return 0.35;
    if (word.length === 3) return 0.7;
    return 1;
  }

  var MISMATCH = 0.5;
  var GAP_SPOKEN = 0.4;  // palabra dicha que no está en el guion
  var GAP_SCRIPT = 0.25; // palabra del guion que el reconocedor no captó
  var TAIL = 10;         // cuántas palabras recientes miramos
  var BEHIND = 8;        // ventana hacia atrás (para no confundirse al repetir)
  var AHEAD = 60;        // ventana hacia adelante (para saltos si te saltas una frase)

  function Tracker(scriptWords) {
    this.words = scriptWords.slice(); // ya normalizadas
    this.pos = 0; // índice de la próxima palabra por leer
  }

  Tracker.prototype.setPos = function (i) {
    this.pos = Math.max(0, Math.min(this.words.length, i | 0));
  };

  // Recibe el texto reconocido (completo o la cola) y devuelve true si avanzó.
  Tracker.prototype.update = function (spokenText) {
    var spoken = splitWords(spokenText);
    if (!spoken.length || !this.words.length) return false;
    if (spoken.length > TAIL) spoken = spoken.slice(spoken.length - TAIL);

    var last = this.pos - 1; // última palabra ya leída
    var start = Math.max(0, this.pos - BEHIND);
    var end = Math.min(this.words.length, this.pos + AHEAD);
    var m = end - start, n = spoken.length;
    if (m <= 0) return false;

    // H[i][j]: mejor puntaje de un alineamiento que termina en spoken[i-1], words[start+j-1]
    var H = [];
    for (var i = 0; i <= n; i++) {
      H.push(new Float32Array(m + 1));
    }
    for (i = 1; i <= n; i++) {
      for (var j = 1; j <= m; j++) {
        var w = this.words[start + j - 1];
        var s = similarity(spoken[i - 1], w);
        var diag = H[i - 1][j - 1] + (s > 0 ? s * weight(w) : -MISMATCH);
        var up = H[i - 1][j] - GAP_SPOKEN;
        var left = H[i][j - 1] - GAP_SCRIPT * weight(w);
        H[i][j] = Math.max(0, diag, up, left);
      }
    }

    var bestJ = -1, bestAdj = -Infinity;
    for (j = 1; j <= m; j++) {
      var idx = start + j - 1;
      // Debe terminar en la última palabra dicha (o la penúltima, por si la
      // última es un resultado provisional todavía mal reconocido).
      var score = Math.max(H[n][j], n > 1 ? H[n - 1][j] - 0.3 : 0);
      if (score <= 0) continue;
      // Solo aceptamos alineamientos cuya última palabra coincide de verdad.
      var d = idx - last;
      var need = d <= 0 ? 1.0 : d <= 3 ? 0.9 : d <= 15 ? 1.8 : 2.6;
      if (score < need) continue;
      var adj = score - (d < 0 ? 0.3 * -d : 0.02 * d);
      if (adj > bestAdj) { bestAdj = adj; bestJ = idx; }
    }

    if (bestJ > last) {
      this.pos = bestJ + 1;
      return true;
    }
    return false;
  };

  var api = { normalize: normalize, splitWords: splitWords, similarity: similarity, Tracker: Tracker };
  root.Matcher = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
