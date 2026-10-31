(function () {
  'use strict';

  // ---------------------------------------------------------------- utilidades
  var $ = function (id) { return document.getElementById(id); };
  var STORE_KEY = 'teleprompter.v1';

  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* modo privado */ }
  }

  var defaults = {
    script: '',
    lang: 'es-MX',
    engine: 'auto',
    dgKey: '',
    fontSize: 40,
    markerPos: 30,
    mirror: false,
    showHeard: true,
    pos: 0
  };
  var state = Object.assign({}, defaults, load());

  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  // ---------------------------------------------------------------- editor
  var els = {
    script: $('script'), wordCount: $('wordCount'), startBtn: $('startBtn'),
    lang: $('lang'), engine: $('engine'), engineSupport: $('engineSupport'), dgKey: $('dgKey'),
    fontSize: $('fontSize'), fontVal: $('fontVal'), markerPos: $('markerPos'), markerVal: $('markerVal'),
    mirror: $('mirror'), showHeard: $('showHeard'),
    editor: $('editor'), prompter: $('prompter'), scroller: $('scroller'), text: $('text'),
    marker: $('marker'), heard: $('heard'), status: $('status'), statusText: $('statusText'),
    micBtn: $('micBtn'), backBtn: $('backBtn'), restartBtn: $('restartBtn'),
    smallerBtn: $('smallerBtn'), biggerBtn: $('biggerBtn'), toast: $('toast')
  };

  els.script.value = state.script;
  els.lang.value = state.lang;
  els.engine.value = state.engine;
  els.dgKey.value = state.dgKey;
  els.fontSize.value = state.fontSize;
  els.markerPos.value = state.markerPos;
  els.mirror.checked = state.mirror;
  els.showHeard.checked = state.showHeard;

  els.engineSupport.textContent = SR
    ? 'Este navegador tiene reconocimiento de voz integrado.'
    : 'Este navegador NO tiene reconocimiento de voz integrado: usa Deepgram (o abre la página en Safari).';

  function refreshEditor() {
    var n = Matcher.splitWords(els.script.value).length;
    els.wordCount.textContent = n + (n === 1 ? ' palabra' : ' palabras') +
      (n ? ' · ~' + Math.max(1, Math.round(n / 140)) + ' min de lectura' : '');
    els.startBtn.disabled = n === 0;
    els.fontVal.textContent = state.fontSize;
    els.markerVal.textContent = state.markerPos;
  }

  var scriptChanged = false;
  els.script.addEventListener('input', function () {
    state.script = els.script.value; state.pos = 0; scriptChanged = true; save(); refreshEditor();
  });
  els.lang.addEventListener('change', function () { state.lang = els.lang.value; save(); });
  els.engine.addEventListener('change', function () { state.engine = els.engine.value; save(); });
  els.dgKey.addEventListener('input', function () { state.dgKey = els.dgKey.value.trim(); save(); });
  els.fontSize.addEventListener('input', function () { state.fontSize = +els.fontSize.value; save(); refreshEditor(); });
  els.markerPos.addEventListener('input', function () { state.markerPos = +els.markerPos.value; save(); refreshEditor(); });
  els.mirror.addEventListener('change', function () { state.mirror = els.mirror.checked; save(); });
  els.showHeard.addEventListener('change', function () { state.showHeard = els.showHeard.checked; save(); });
  refreshEditor();

  // ---------------------------------------------------------------- prompter
  var tracker = null;
  var wordEls = [];     // span por cada palabra que cuenta para el seguimiento
  var shownPos = -1;    // posición pintada actualmente

  function buildText() {
    els.text.innerHTML = '';
    wordEls = [];
    var top = document.createElement('div'); top.className = 'spacer-top';
    els.text.appendChild(top);
    var words = [];
    var paragraphs = state.script.replace(/\r/g, '').split(/\n+/);
    paragraphs.forEach(function (para) {
      if (!para.trim()) return;
      var p = document.createElement('p');
      para.trim().split(/\s+/).forEach(function (raw, k) {
        if (k) p.appendChild(document.createTextNode(' '));
        var span = document.createElement('span');
        span.textContent = raw;
        var norm = Matcher.normalize(raw);
        if (norm) {
          span.className = 'w';
          span.dataset.i = words.length;
          words.push(norm);
          wordEls.push(span);
        }
        p.appendChild(span);
      });
      els.text.appendChild(p);
    });
    var bottom = document.createElement('div'); bottom.className = 'spacer-bottom';
    els.text.appendChild(bottom);
    tracker = new Matcher.Tracker(words);
    tracker.setPos(state.pos || 0);
    shownPos = -1;
  }

  function applyLayout() {
    document.documentElement.style.setProperty('--font', state.fontSize + 'px');
    document.documentElement.style.setProperty('--marker', state.markerPos + '%');
    var markerPx = Math.round(els.scroller.clientHeight * state.markerPos / 100);
    document.documentElement.style.setProperty('--marker-px', markerPx + 'px');
    els.text.classList.toggle('mirror', !!state.mirror);
    els.heard.classList.toggle('hidden', !state.showHeard);
  }

  function paintPos() {
    var pos = tracker.pos;
    if (pos === shownPos) return;
    var from = Math.max(0, Math.min(pos, shownPos < 0 ? 0 : shownPos) - 1);
    if (shownPos < 0) from = 0;
    var to = shownPos < 0 ? wordEls.length : Math.min(wordEls.length, Math.max(pos, shownPos) + 1);
    for (var i = from; i < to; i++) {
      wordEls[i].classList.toggle('read', i < pos);
      wordEls[i].classList.toggle('cur', i === pos);
    }
    shownPos = pos;
    state.pos = pos;
    save();
  }

  // Desplazamiento suave hacia la palabra actual.
  var userScrollUntil = 0;
  var rafId = 0;
  function targetScroll() {
    if (!wordEls.length) return 0;
    var el = wordEls[Math.min(tracker.pos, wordEls.length - 1)];
    var markerPx = els.scroller.clientHeight * state.markerPos / 100;
    return el.offsetTop + el.offsetHeight / 2 - markerPx;
  }
  function loop() {
    rafId = requestAnimationFrame(loop);
    if (Date.now() < userScrollUntil) return;
    var cur = els.scroller.scrollTop;
    var diff = targetScroll() - cur;
    if (Math.abs(diff) < 0.5) return;
    var step = diff * 0.12;
    if (Math.abs(step) < 0.6) step = diff > 0 ? Math.min(diff, 0.6) : Math.max(diff, -0.6);
    els.scroller.scrollTop = cur + step;
  }
  ['touchstart', 'touchmove', 'wheel'].forEach(function (ev) {
    els.scroller.addEventListener(ev, function () { userScrollUntil = Date.now() + 2500; }, { passive: true });
  });

  // Toca una palabra para continuar desde ahí.
  els.text.addEventListener('click', function (e) {
    var t = e.target;
    if (!t.classList || !t.classList.contains('w')) return;
    tracker.setPos(+t.dataset.i);
    paintPos();
    userScrollUntil = 0;
    resetEngineContext();
  });

  function openPrompter() {
    if (!Matcher.splitWords(state.script).length) return;
    if (scriptChanged) { state.pos = 0; scriptChanged = false; }
    els.editor.classList.add('hidden');
    els.prompter.classList.remove('hidden');
    applyLayout();
    buildText();
    paintPos();
    els.scroller.scrollTop = targetScroll();
    cancelAnimationFrame(rafId); loop();
    startListening(); // dentro del toque del usuario: necesario en iOS
  }

  function closePrompter() {
    stopListening();
    cancelAnimationFrame(rafId);
    els.prompter.classList.add('hidden');
    els.editor.classList.remove('hidden');
    refreshEditor();
  }

  els.startBtn.addEventListener('click', openPrompter);
  els.backBtn.addEventListener('click', closePrompter);
  els.restartBtn.addEventListener('click', function () {
    tracker.setPos(0); paintPos(); userScrollUntil = 0; resetEngineContext();
  });
  els.micBtn.addEventListener('click', function () {
    if (listening) stopListening(); else startListening();
  });
  function changeFont(delta) {
    state.fontSize = Math.max(20, Math.min(90, state.fontSize + delta));
    els.fontSize.value = state.fontSize;
    save(); applyLayout(); userScrollUntil = 0;
  }
  els.smallerBtn.addEventListener('click', function () { changeFont(-4); });
  els.biggerBtn.addEventListener('click', function () { changeFont(4); });
  window.addEventListener('resize', function () { if (tracker) applyLayout(); });

  // ---------------------------------------------------------------- estado / avisos
  var toastTimer = 0;
  function toast(msg, ms) {
    els.toast.textContent = msg;
    els.toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.classList.add('hidden'); }, ms || 4000);
  }
  function setStatus(kind, text) {
    els.status.className = kind || '';
    els.statusText.textContent = text;
  }
  var hearingTimer = 0;
  function flashHearing() {
    if (!listening) return;
    els.status.classList.add('hearing');
    clearTimeout(hearingTimer);
    hearingTimer = setTimeout(function () { els.status.classList.remove('hearing'); }, 700);
  }

  // Lo que entrega cualquier motor de reconocimiento llega aquí.
  function onSpeech(text) {
    flashHearing();
    if (state.showHeard) {
      var tail = Matcher.splitWords(text).length ? text.trim().split(/\s+/).slice(-14).join(' ') : '';
      els.heard.innerHTML = '';
      var s = document.createElement('span'); s.textContent = tail; els.heard.appendChild(s);
    }
    if (tracker && tracker.update(text)) paintPos();
  }

  // ---------------------------------------------------------------- pantalla encendida
  var wakeLock = null;
  function keepAwake(on) {
    if (!('wakeLock' in navigator)) return;
    if (on && !wakeLock) {
      navigator.wakeLock.request('screen').then(function (l) {
        wakeLock = l; l.addEventListener('release', function () { wakeLock = null; });
      }).catch(function () {});
    } else if (!on && wakeLock) {
      wakeLock.release().catch(function () {}); wakeLock = null;
    }
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && listening) keepAwake(true);
  });

  // ---------------------------------------------------------------- motores de voz
  var listening = false;
  var engine = null;

  function resetEngineContext() {
    // Tras saltar de posición, borra el contexto del motor para que lo dicho
    // antes no influya en la nueva posición.
    if (engine && engine.resetContext) engine.resetContext();
  }

  function pickEngine() {
    var want = state.engine;
    if (want === 'browser') return SR ? 'browser' : null;
    if (want === 'deepgram') return state.dgKey ? 'deepgram' : null;
    if (SR) return 'browser';
    if (state.dgKey) return 'deepgram';
    return null;
  }

  function startListening(forceKind) {
    var kind = forceKind || pickEngine();
    if (!kind) {
      setStatus('error', 'Sin reconocimiento de voz');
      if (state.engine === 'deepgram' || !SR) {
        toast('Este navegador no tiene reconocimiento de voz integrado. Abre la página en Safari o agrega una clave de Deepgram en Ajustes.', 7000);
      } else {
        toast('El reconocimiento del navegador no está disponible.', 5000);
      }
      return;
    }
    stopEngine();
    engine = kind === 'browser' ? new BrowserEngine() : new DeepgramEngine();
    listening = true;
    els.micBtn.classList.add('on');
    keepAwake(true);
    engine.start();
  }

  function stopEngine() {
    if (engine) { try { engine.stop(); } catch (e) {} engine = null; }
  }

  function stopListening(msg) {
    listening = false;
    stopEngine();
    els.micBtn.classList.remove('on');
    keepAwake(false);
    setStatus('', msg || 'Pausado');
  }

  // Si el motor del navegador falla en modo automático, pasa a Deepgram.
  function fallbackOrStop(reason) {
    if (state.engine === 'auto' && state.dgKey && engine instanceof BrowserEngine) {
      toast('El reconocimiento del navegador falló (' + reason + '). Cambiando a Deepgram…', 3500);
      startListening('deepgram');
      return true;
    }
    return false;
  }

  // --- Motor 1: Web Speech API (Safari / Chrome) ---------------------------
  function BrowserEngine() {
    this.rec = null;
    this.active = false;
    this.ends = [];
    this.gotResult = false;
  }
  BrowserEngine.prototype.start = function () {
    var self = this;
    self.active = true;
    setStatus('connecting', 'Iniciando micrófono…');
    var rec = new SR();
    rec.lang = state.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = function () { if (self.active) setStatus('listening', 'Escuchando'); };
    rec.onresult = function (e) {
      self.gotResult = true;
      var parts = [];
      for (var i = 0; i < e.results.length; i++) parts.push(e.results[i][0].transcript);
      onSpeech(parts.join(' '));
    };
    rec.onerror = function (e) {
      if (!self.active) return;
      var err = e.error;
      if (err === 'no-speech' || err === 'aborted') return; // se reinicia en onend
      self.active = false;
      if (err === 'not-allowed') {
        if (self.gotResult) { stopListening('Pausado'); toast('iOS detuvo el micrófono. Toca 🎙 para seguir.', 5000); }
        else { stopListening('Sin permiso'); toast('Permiso de micrófono denegado. Revísalo en Ajustes → Safari → Micrófono.', 7000); }
      } else if (err === 'service-not-allowed') {
        if (!fallbackOrStop('servicio no permitido')) {
          stopListening('No disponible');
          toast('El reconocimiento de voz no está permitido aquí. Activa el Dictado (Ajustes → General → Teclado), abre la página en Safari o usa Deepgram.', 8000);
        }
      } else if (err === 'network') {
        if (!fallbackOrStop('sin red')) { stopListening('Sin conexión'); toast('No hay conexión con el servicio de voz.', 5000); }
      } else if (err === 'audio-capture') {
        stopListening('Micrófono ocupado');
        toast('No se pudo usar el micrófono. ¿Otra app (como la Cámara) lo está usando?', 6000);
      } else if (err === 'language-not-supported') {
        stopListening('Idioma no soportado');
        toast('Este navegador no reconoce el idioma elegido. Prueba otra variante en Ajustes.', 6000);
      } else {
        if (!fallbackOrStop(err)) { stopListening('Error'); toast('Error de reconocimiento: ' + err, 5000); }
      }
    };
    rec.onend = function () {
      if (!self.active) return;
      // Safari/Chrome cortan la sesión tras pausas o ~1 min: la reabrimos.
      var now = Date.now();
      self.ends = self.ends.filter(function (t) { return now - t < 10000; });
      self.ends.push(now);
      if (self.ends.length > 6 && !self.gotResult) {
        self.active = false;
        if (!fallbackOrStop('se cierra solo')) {
          stopListening('Pausado');
          toast('El micrófono se cierra solo. Toca 🎙 para reintentar, o usa Deepgram en Ajustes.', 7000);
        }
        return;
      }
      setTimeout(function () {
        if (!self.active) return;
        try { rec.start(); } catch (e) {
          self.active = false;
          stopListening('Pausado');
          toast('Toca 🎙 para seguir escuchando.', 4000);
        }
      }, 120);
    };
    self.rec = rec;
    try { rec.start(); } catch (e) {
      self.active = false;
      if (!fallbackOrStop('no inicia')) { stopListening('Error'); toast('No se pudo iniciar el micrófono.', 5000); }
    }
  };
  BrowserEngine.prototype.resetContext = function () {
    // Reiniciar la sesión limpia el texto acumulado.
    if (this.rec && this.active) { try { this.rec.stop(); } catch (e) {} }
  };
  BrowserEngine.prototype.stop = function () {
    this.active = false;
    if (this.rec) { try { this.rec.abort(); } catch (e) {} }
  };

  // --- Motor 2: Deepgram (streaming por WebSocket) -----------------------
  function DeepgramEngine() {
    this.ws = null; this.ctx = null; this.stream = null; this.proc = null;
    this.finalText = ''; this.active = false; this.keepAlive = 0; this.gotResult = false;
  }
  DeepgramEngine.prototype.start = function () {
    var self = this;
    self.active = true;
    setStatus('connecting', 'Conectando con Deepgram…');
    // Crear el AudioContext dentro del toque del usuario (requisito de iOS).
    var AC = window.AudioContext || window.webkitAudioContext;
    try { self.ctx = new AC(); } catch (e) { stopListening('Error'); toast('Este navegador no permite capturar audio.', 5000); return; }
    if (self.ctx.resume) self.ctx.resume();

    var lang = /^es/.test(state.lang) ? 'es' : state.lang;
    var url = 'wss://api.deepgram.com/v1/listen?model=nova-2&language=' + encodeURIComponent(lang) +
      '&encoding=linear16&sample_rate=16000&channels=1&interim_results=true&punctuate=false&smart_format=false';

    navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
    }).then(function (stream) {
      if (!self.active) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      self.stream = stream;
      var ws;
      try { ws = new WebSocket(url, ['token', state.dgKey]); } catch (e) {
        self.active = false; stopListening('Error'); toast('No se pudo conectar con Deepgram.', 5000); return;
      }
      ws.binaryType = 'arraybuffer';
      self.ws = ws;
      ws.onopen = function () {
        if (!self.active) return;
        setStatus('listening', 'Escuchando (Deepgram)');
        var src = self.ctx.createMediaStreamSource(stream);
        var proc = self.ctx.createScriptProcessor(4096, 1, 1);
        var mute = self.ctx.createGain(); mute.gain.value = 0;
        var inRate = self.ctx.sampleRate;
        proc.onaudioprocess = function (ev) {
          if (ws.readyState !== 1) return;
          ws.send(downsampleTo16k(ev.inputBuffer.getChannelData(0), inRate).buffer);
        };
        src.connect(proc); proc.connect(mute); mute.connect(self.ctx.destination);
        self.proc = proc; self.src = src;
        self.keepAlive = setInterval(function () {
          if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'KeepAlive' }));
        }, 8000);
      };
      ws.onmessage = function (ev) {
        var data; try { data = JSON.parse(ev.data); } catch (e) { return; }
        if (data.type !== 'Results' || !data.channel) return;
        var alt = data.channel.alternatives && data.channel.alternatives[0];
        var t = alt ? alt.transcript : '';
        if (!t) return;
        self.gotResult = true;
        if (data.is_final) {
          self.finalText = (self.finalText + ' ' + t).split(/\s+/).slice(-40).join(' ');
          onSpeech(self.finalText);
        } else {
          onSpeech(self.finalText + ' ' + t);
        }
      };
      ws.onclose = function (ev) {
        if (!self.active) return;
        self.active = false;
        self.cleanup();
        if (!self.gotResult) {
          stopListening('Error de Deepgram');
          toast('Deepgram cerró la conexión. Revisa que la clave sea correcta y tenga saldo.', 7000);
        } else {
          stopListening('Pausado');
          toast('Se cortó la conexión con Deepgram. Toca 🎙 para seguir.', 5000);
        }
      };
    }).catch(function (err) {
      if (!self.active) return;
      self.active = false;
      self.cleanup();
      stopListening('Sin permiso');
      toast('No se pudo usar el micrófono (' + (err && err.name || 'error') + '). Revisa el permiso en Ajustes.', 7000);
    });
  };
  DeepgramEngine.prototype.resetContext = function () { this.finalText = ''; };
  DeepgramEngine.prototype.cleanup = function () {
    clearInterval(this.keepAlive);
    if (this.proc) { try { this.proc.disconnect(); } catch (e) {} this.proc.onaudioprocess = null; }
    if (this.src) { try { this.src.disconnect(); } catch (e) {} }
    if (this.stream) this.stream.getTracks().forEach(function (t) { t.stop(); });
    if (this.ctx && this.ctx.state !== 'closed') { try { this.ctx.close(); } catch (e) {} }
    this.proc = this.src = this.stream = this.ctx = null;
  };
  DeepgramEngine.prototype.stop = function () {
    this.active = false;
    var ws = this.ws;
    if (ws) {
      try { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'CloseStream' })); } catch (e) {}
      try { ws.close(); } catch (e) {}
    }
    this.cleanup();
  };

  function downsampleTo16k(f32, inRate) {
    var ratio = inRate / 16000;
    var outLen = Math.floor(f32.length / ratio);
    var out = new Int16Array(outLen);
    for (var i = 0; i < outLen; i++) {
      var start = Math.floor(i * ratio), end = Math.min(f32.length, Math.floor((i + 1) * ratio));
      var sum = 0, c = 0;
      for (var k = start; k < end; k++) { sum += f32[k]; c++; }
      var s = c ? sum / c : 0;
      s = Math.max(-1, Math.min(1, s));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  // ---------------------------------------------------------------- PWA
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  // Gancho de pruebas: window.tp.feed('texto') simula lo que escucha el micrófono.
  window.tp = {
    feed: onSpeech,
    get pos() { return tracker ? tracker.pos : 0; },
    get words() { return wordEls.length; }
  };
})();
