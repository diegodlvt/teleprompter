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
    camQuality: '1080',
    camFps: 30,
    camBitrate: 'high',
    camAudio: 'clean',
    camMarker: 18,
    shade: 55,
    camRotate: 0,
    pos: 0
  };
  var state = Object.assign({}, defaults, load());
  // v7: la cámara frontal da 30 fps desde Safari y el giro manual ya no hace falta
  // (provocaba recorte/zoom si quedaba activado).
  state.camFps = 30;
  state.camRotate = 0;

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
    smallerBtn: $('smallerBtn'), biggerBtn: $('biggerBtn'), toast: $('toast'),
    camQuality: $('camQuality'), camBitrate: $('camBitrate'), camAudio: $('camAudio'),
    camEstimate: $('camEstimate'), camMarker: $('camMarker'), camMarkerVal: $('camMarkerVal'),
    shade: $('shade'), shadeVal: $('shadeVal'),
    cam: $('cam'), camBtn: $('camBtn'), recBtn: $('recBtn'), camInfo: $('camInfo'), camTime: $('camTime'),
    camLevel: $('camLevel'), savePanel: $('savePanel'), saveInfo: $('saveInfo'),
    saveBtn: $('saveBtn'), discardBtn: $('discardBtn')
  };

  els.script.value = state.script;
  els.lang.value = state.lang;
  els.engine.value = state.engine;
  els.dgKey.value = state.dgKey;
  els.fontSize.value = state.fontSize;
  els.markerPos.value = state.markerPos;
  els.mirror.checked = state.mirror;
  els.showHeard.checked = state.showHeard;
  els.camQuality.value = state.camQuality;
  els.camBitrate.value = state.camBitrate;
  els.camAudio.value = state.camAudio;
  els.camMarker.value = state.camMarker;
  els.shade.value = state.shade;

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
    els.camMarkerVal.textContent = state.camMarker;
    if (els.camEstimate) {
      var d = camDims();
      var mbps = videoBitrate(d.short, state.camFps) / 1e6;
      var mbMin = Math.round((mbps + 0.2) * 60 / 8);
      els.camEstimate.textContent = '≈ ' + Math.round(mbps) + ' Mbps · unos ' +
        (mbMin >= 1000 ? (mbMin / 1000).toFixed(1) + ' GB' : mbMin + ' MB') + ' por minuto de video' +
        ' · máximo ~' + Math.max(1, Math.floor(1400 / Math.max(1, mbMin))) + ' min por toma';
    }
    els.shadeVal.textContent = state.shade;
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
  els.camQuality.addEventListener('change', function () { state.camQuality = els.camQuality.value; save(); refreshEditor(); });
  els.camBitrate.addEventListener('change', function () { state.camBitrate = els.camBitrate.value; save(); refreshEditor(); });
  els.camAudio.addEventListener('change', function () { state.camAudio = els.camAudio.value; save(); });
  els.camMarker.addEventListener('input', function () { state.camMarker = +els.camMarker.value; save(); refreshEditor(); });
  els.shade.addEventListener('input', function () { state.shade = +els.shade.value; save(); refreshEditor(); });
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

  function markerPct() { return cam.on ? state.camMarker : state.markerPos; }

  function applyLayout() {
    document.documentElement.style.setProperty('--font', state.fontSize + 'px');
    document.documentElement.style.setProperty('--marker', markerPct() + '%');
    document.documentElement.style.setProperty('--shade', String(state.shade / 100));
    var markerPx = Math.round(els.scroller.clientHeight * markerPct() / 100);
    document.documentElement.style.setProperty('--marker-px', markerPx + 'px');
    els.text.classList.toggle('mirror', !!state.mirror && !cam.on);
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
    var markerPx = els.scroller.clientHeight * markerPct() / 100;
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
    if (cam.recorder && cam.recorder.state === 'recording') { toast('Primero detén la grabación (botón rojo).', 3000); return; }
    if (cam.blob && !window.confirm('Tienes un video sin guardar. ¿Salir y descartarlo?')) return;
    camOff();
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
        if (cam.on) {
          toast('iOS no deja reconocer la voz mientras la cámara usa el micrófono. Avísale a Claude: hay que usar el plan B.', 9000);
        } else {
          toast('No se pudo usar el micrófono. ¿Otra app (como la Cámara) lo está usando?', 6000);
        }
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


  // ---------------------------------------------------------------- MODO GRABACIÓN
  var cam = {
    on: false, stream: null, recorder: null, chunks: [], blob: null, mime: '',
    startTs: 0, timer: 0, audioCtx: null, analyser: null, levelRaf: 0, saved: false
  };

  function camToggle() {
    if (cam.on) {
      if (cam.recorder && cam.recorder.state === 'recording') { toast('Primero detén la grabación.', 3000); return; }
      if (cam.blob && !window.confirm('Tienes un video sin guardar. ¿Apagar la cámara y descartarlo?')) return;
      camOff();
    } else {
      camOn();
    }
  }

  function camOn() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('Este navegador no permite usar la cámara desde una página web.', 5000); return;
    }
    if (!window.MediaRecorder) {
      toast('Este navegador no puede grabar video. Actualiza iOS o usa Safari.', 5000); return;
    }
    // El AudioContext se crea dentro del toque del usuario (requisito de iOS).
    var AC = window.AudioContext || window.webkitAudioContext;
    try { cam.audioCtx = new AC(); if (cam.audioCtx.resume) cam.audioCtx.resume(); } catch (e) { cam.audioCtx = null; }

    var portrait = window.innerHeight >= window.innerWidth;
    // Safari en iPhone interpreta ancho/alto en la orientación del sensor (horizontal):
    // pedir 1920×1080 con el teléfono vertical entrega 1080×1920 vertical con el
    // encuadre completo. Otros navegadores lo interpretan al revés, así que pedimos
    // primero "a la manera del iPhone", revisamos qué llegó y, si no coincide con
    // la orientación del teléfono, pedimos lo contrario.
    els.camBtn.disabled = true;
    var openCam = function () {
      return navigator.mediaDevices.getUserMedia({ video: camConstraints(false), audio: camAudioConstraints() })
        .catch(function (err) {
          // Si la cámara no acepta la resolución/fps pedida, reintenta con 1080p 30.
          if (!err || (err.name !== 'OverconstrainedError' && err.name !== 'ConstraintNotSatisfiedError')) throw err;
          return navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 } },
            audio: camAudioConstraints()
          });
        });
    };
    openCam().then(function (stream) {
      els.camBtn.disabled = false;
      cam.stream = stream;
      cam.on = true;
      els.cam.srcObject = stream;
      var p = els.cam.play(); if (p && p.catch) p.catch(function () {});
      els.prompter.classList.add('cam');
      els.recBtn.classList.remove('hidden');
      els.camInfo.classList.remove('hidden');
      applyLayout();
      userScrollUntil = 0;
      startLevelMeter();
      var at = stream.getAudioTracks()[0];
      if (at) {
        at.onmute = function () { els.camInfo.classList.add('nomic'); toast('iOS silenció el micrófono de la grabación.', 5000); };
        at.onunmute = function () { els.camInfo.classList.remove('nomic'); };
      }
      // Revisar la orientación recién cuando la imagen ya está corriendo: justo al
      // abrir, iOS informa el tamaño "sin girar" y engaña a cualquier verificación.
      cam.ready = false;
      els.recBtn.disabled = true;
      els.camTime.textContent = 'Preparando…';
      ensureOrientation(stream, portrait).then(function () {
        if (cam.stream !== stream) return;
        cam.ready = true;
        els.recBtn.disabled = false;
        els.camTime.textContent = camLabel();
        checkDelivered();
      });
    }).catch(function (err) {
      els.camBtn.disabled = false;
      if (cam.audioCtx) { try { cam.audioCtx.close(); } catch (e) {} cam.audioCtx = null; }
      var name = err && err.name;
      if (name === 'NotAllowedError') toast('Sin permiso para la cámara o el micrófono. Revísalo en Ajustes → Safari → Cámara / Micrófono.', 7000);
      else if (name === 'NotReadableError') toast('La cámara está ocupada por otra app.', 5000);
      else toast('No se pudo abrir la cámara (' + (name || 'error') + ').', 5000);
    });
  }

  // Medidas del video según la resolución elegida.
  function camDims() {
    if (state.camQuality === '3x4') return { long: 1920, short: 1440 };
    if (state.camQuality === '2160') return { long: 3840, short: 2160 };
    if (state.camQuality === '720') return { long: 1280, short: 720 };
    return { long: 1920, short: 1080 };
  }

  // Calidad de compresión (bits por segundo) según resolución y fotogramas.
  function videoBitrate(shortSide, fps) {
    var base = shortSide >= 2000 ? 45e6 : shortSide >= 1400 ? 22e6 : shortSide >= 1000 ? 16e6 : shortSide >= 700 ? 8e6 : 4e6; // a 30 fps, "alta"
    if (fps > 40) base *= 1.5;
    if (state.camBitrate === 'max') base *= 2;
    else if (state.camBitrate === 'std') base *= 0.5;
    return Math.round(base);
  }

  function camAudioConstraints() {
    if (state.camAudio === 'natural') {
      return { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } };
    }
    return { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  }

  function camConstraints(swapped) {
    var d = camDims();
    return {
      facingMode: 'user',
      width: { ideal: swapped ? d.short : d.long },
      height: { ideal: swapped ? d.long : d.short },
      frameRate: { ideal: state.camFps || 30 }
    };
  }

  // Tamaño real de la imagen: el del <video> en pantalla (ya girado por iOS) es el
  // más confiable; los "settings" de la pista pueden venir sin girar al principio.
  function trackSize(vt) {
    var w = els.cam.videoWidth, h = els.cam.videoHeight;
    if (!w || !h) {
      var st = vt && vt.getSettings ? vt.getSettings() : {};
      w = st.width; h = st.height;
    }
    return { w: w || 0, h: h || 0 };
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // Espera a que el <video> tenga imagen y su tamaño se mantenga estable.
  function waitStableSize(maxMs) {
    var t0 = Date.now(), last = '', stableSince = 0;
    return new Promise(function (resolve) {
      (function poll() {
        var cur = els.cam.videoWidth + 'x' + els.cam.videoHeight;
        if (els.cam.videoWidth) {
          if (cur !== last) { last = cur; stableSince = Date.now(); }
          else if (Date.now() - stableSince >= 600) return resolve();
        }
        if (Date.now() - t0 > maxMs) return resolve();
        setTimeout(poll, 100);
      })();
    });
  }

  function ensureOrientation(stream, portrait) {
    var vt = stream.getVideoTracks()[0];
    return waitStableSize(4000).then(function () {
      cam.orientDebug = 'inicio ' + els.cam.videoWidth + '×' + els.cam.videoHeight;
      if (trackMatches(vt, portrait) || !vt || !vt.applyConstraints) return;
      // Solo si de verdad viene al revés: pedir las medidas invertidas…
      return vt.applyConstraints(camConstraints(true)).catch(function () {})
        .then(function () { return sleep(300); })
        .then(function () { return waitStableSize(3000); })
        .then(function () {
          cam.orientDebug += ' → invertido ' + els.cam.videoWidth + '×' + els.cam.videoHeight;
          if (trackMatches(vt, portrait)) return;
          // …y si no sirvió, volver a lo original (no empeorar).
          return vt.applyConstraints(camConstraints(false)).catch(function () {})
            .then(function () { return sleep(300); })
            .then(function () { return waitStableSize(3000); })
            .then(function () { cam.orientDebug += ' → original ' + els.cam.videoWidth + '×' + els.cam.videoHeight; });
        });
    });
  }

  // ¿La imagen de la cámara ya viene en la orientación en que sostienes el teléfono?
  function trackMatches(vt, portrait) {
    var z = trackSize(vt);
    if (!z.w || !z.h) return true; // sin datos: no tocar
    return portrait ? z.h >= z.w : z.w >= z.h;
  }

  function camOff() {
    stopRecording(true);
    cancelAnimationFrame(cam.levelRaf);
    if (cam.stream) cam.stream.getTracks().forEach(function (t) { t.stop(); });
    if (cam.audioCtx) { try { cam.audioCtx.close(); } catch (e) {} }
    cam.stream = null; cam.audioCtx = null; cam.analyser = null;
    cam.blob = null; cam.chunks = [];
    els.cam.srcObject = null;
    cam.on = false;
    cam.ready = false;
    els.recBtn.disabled = false;
    els.prompter.classList.remove('cam');
    els.recBtn.classList.add('hidden');
    els.camInfo.classList.add('hidden');
    els.camInfo.classList.remove('recording', 'nomic');
    els.savePanel.classList.add('hidden');
    if (tracker) { applyLayout(); userScrollUntil = 0; }
  }

  // Medidor de nivel: confirma que el audio de la grabación está entrando.
  function startLevelMeter() {
    if (!cam.audioCtx || !cam.stream || !cam.stream.getAudioTracks().length) return;
    try {
      var src = cam.audioCtx.createMediaStreamSource(cam.stream);
      var an = cam.audioCtx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      cam.analyser = an;
    } catch (e) { return; }
    var buf = new Uint8Array(cam.analyser.fftSize);
    (function tick() {
      cam.levelRaf = requestAnimationFrame(tick);
      if (!cam.analyser) return;
      cam.analyser.getByteTimeDomainData(buf);
      var sum = 0;
      for (var i = 0; i < buf.length; i++) { var v = (buf[i] - 128) / 128; sum += v * v; }
      var rms = Math.sqrt(sum / buf.length);
      els.camLevel.style.width = Math.min(100, Math.round(rms * 400)) + '%';
    })();
  }

  var MAX_REC_BYTES = 1400 * 1048576; // ~1,4 GB

  function pickMime() {
    var options = [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4;codecs=avc1,mp4a',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ];
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
    for (var i = 0; i < options.length; i++) if (MediaRecorder.isTypeSupported(options[i])) return options[i];
    return '';
  }

  function fmtTime(ms) {
    var s = Math.floor(ms / 1000);
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }

  // Safari en iPhone graba los cuadros de la cámara en la orientación del sensor
  // (horizontal). Para controlar la orientación dibujamos cada cuadro en un lienzo
  // del tamaño deseado (vertical u horizontal según cómo tengas el teléfono) y
  // grabamos ese lienzo junto con el audio del micrófono.
  var rc = { canvas: null, g: null, raf: 0, vfc: 0, track: null };

  function buildRecordStream() {
    var portrait = window.innerHeight >= window.innerWidth;
    var dd = camDims(), short = dd.short, long = dd.long;
    var W = portrait ? short : long, H = portrait ? long : short;
    if (!rc.canvas) rc.canvas = document.createElement('canvas');
    var c = rc.canvas;
    if (!c.captureStream) return null;
    c.width = W; c.height = H;
    rc.g = c.getContext('2d', { alpha: false });
    var video = els.cam;
    var rot = (state.camRotate || 0) * Math.PI / 180;

    function draw() {
      var vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh) return;
      var turned = state.camRotate === 90 || state.camRotate === -90;
      var srcW = turned ? vh : vw, srcH = turned ? vw : vh;
      var scale = Math.max(W / srcW, H / srcH); // recorte tipo "cover", sin bordes negros
      var g = rc.g;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.translate(W / 2, H / 2);
      if (rot) g.rotate(rot);
      g.scale(scale, scale);
      g.drawImage(video, -vw / 2, -vh / 2, vw, vh);
    }
    function loopRaf() { rc.raf = requestAnimationFrame(loopRaf); draw(); }
    function loopVfc() { draw(); rc.vfc = video.requestVideoFrameCallback(loopVfc); }
    stopDrawing();
    draw();
    if (video.requestVideoFrameCallback) rc.vfc = video.requestVideoFrameCallback(loopVfc);
    else loopRaf();

    var canvasStream = c.captureStream(state.camFps || 30);
    rc.track = canvasStream.getVideoTracks()[0];
    var tracks = [rc.track].concat(cam.stream.getAudioTracks());
    return new MediaStream(tracks);
  }

  function stopDrawing() {
    cancelAnimationFrame(rc.raf); rc.raf = 0;
    if (rc.vfc && els.cam.cancelVideoFrameCallback) { try { els.cam.cancelVideoFrameCallback(rc.vfc); } catch (e) {} }
    rc.vfc = 0;
    if (rc.track) { try { rc.track.stop(); } catch (e) {} rc.track = null; } // solo el lienzo, NO el micrófono
  }

  function startRecording() {
    if (!cam.stream) return;
    if (!cam.ready) { toast('Un momento, preparando la cámara…', 2000); return; }
    if (cam.blob && !window.confirm('Tienes un video sin guardar. ¿Descartarlo y grabar otro?')) return;
    cam.blob = null; cam.chunks = []; cam.saved = false;
    els.savePanel.classList.add('hidden');
    var mime = pickMime();
    // La compresión se calcula con lo que la cámara entregó de verdad (no con lo pedido).
    var real = cam.stream.getVideoTracks()[0];
    var rs = real && real.getSettings ? real.getSettings() : {};
    var realShort = rs.width && rs.height ? Math.min(rs.width, rs.height) : camDims().short;
    var realFps = rs.frameRate || state.camFps || 30;
    var opts = {
      videoBitsPerSecond: videoBitrate(realShort, realFps),
      audioBitsPerSecond: state.camAudio === 'natural' ? 256000 : 192000
    };
    if (mime) opts.mimeType = mime;
    var portrait = window.innerHeight >= window.innerWidth;
    var vt = cam.stream.getVideoTracks()[0];
    var recStream = null;
    if (!state.camRotate && trackMatches(vt, portrait)) {
      recStream = cam.stream; // la cámara ya viene derecha: se graba directo, sin recortes
      cam.path = 'directo';
    } else {
      cam.path = 'lienzo (recorte)';
      // Solo si la orientación no coincide (o pediste girar): pasar por el lienzo.
      try { recStream = buildRecordStream(); } catch (e) { recStream = null; }
      if (!recStream) { stopDrawing(); recStream = cam.stream; }
    }
    var rec;
    try { rec = new MediaRecorder(recStream, opts); }
    catch (e) {
      try { rec = new MediaRecorder(recStream); } catch (e2) { stopDrawing(); toast('Este navegador no puede grabar video.', 5000); return; }
    }
    cam.bytes = 0;
    rec.ondataavailable = function (e) {
      if (!e.data || !e.data.size) return;
      cam.chunks.push(e.data);
      cam.bytes += e.data.size;
      // Safari guarda la grabación en memoria: si crece demasiado puede cerrar la
      // pestaña y perderse todo. Cortamos antes para no perder el video.
      if (cam.bytes > MAX_REC_BYTES && cam.recorder === rec && rec.state === 'recording') {
        stopRecording(false);
        toast('Se detuvo la grabación para no perderla (archivo muy grande). Guárdala y graba la siguiente parte. Para videos largos usa 1080p.', 9000);
      }
    };
    rec.onstop = function () {
      stopDrawing();
      var type = (rec.mimeType || mime || 'video/mp4').split(';')[0];
      cam.mime = type;
      cam.blob = new Blob(cam.chunks, { type: type });
      cam.chunks = [];
      if (rec._discard) { cam.blob = null; return; }
      var dur = Date.now() - cam.startTs;
      els.saveInfo.textContent = fmtTime(dur) + ' min · ' + (cam.blob.size / 1048576).toFixed(1) + ' MB';
      els.savePanel.classList.remove('hidden');
    };
    rec.onerror = function () { toast('Error al grabar el video.', 5000); };
    rec.start(1000);
    cam.recorder = rec;
    cam.startTs = Date.now();
    els.recBtn.classList.add('on');
    els.camInfo.classList.add('recording');
    els.camTime.textContent = '0:00';
    clearInterval(cam.timer);
    cam.timer = setInterval(function () { els.camTime.textContent = fmtTime(Date.now() - cam.startTs); }, 500);
    if (!listening) startListening(); // estamos dentro del toque: iOS lo permite
  }

  function stopRecording(discard) {
    clearInterval(cam.timer);
    els.recBtn.classList.remove('on');
    els.camInfo.classList.remove('recording');
    if (cam.recorder && cam.recorder.state !== 'inactive') {
      cam.recorder._discard = !!discard;
      try { cam.recorder.stop(); } catch (e) {}
    }
    else stopDrawing();
    cam.recorder = null;
    if (cam.stream && !discard) {
      els.camTime.textContent = camLabel();
    }
  }

  function camLabel() {
    var vt = cam.stream && cam.stream.getVideoTracks()[0];
    var st = vt && vt.getSettings ? vt.getSettings() : {};
    if (!st.width) return 'Lista';
    var short = Math.min(st.width, st.height);
    var ratio = short / Math.max(st.width, st.height);
    var name = (ratio > 0.7 && ratio < 0.8) ? '3:4' : short >= 2000 ? '4K' : short >= 1000 ? '1080p' : short >= 700 ? '720p' : st.width + '×' + st.height;
    return 'Lista · ' + name + (st.frameRate ? (/p$|K$/.test(name) ? '' : ' ') + Math.round(st.frameRate) + (/p$|K$/.test(name) ? '' : 'fps') : '');
  }

  // Avisa si la cámara no pudo dar lo que pediste.
  function checkDelivered() {
    var vt = cam.stream && cam.stream.getVideoTracks()[0];
    var st = vt && vt.getSettings ? vt.getSettings() : {};
    if (!st.width) return;
    var short = Math.min(st.width, st.height), want = camDims().short;
    var msgs = [];
    if (short < want * 0.9) msgs.push('resolución ' + st.width + '×' + st.height);
    if (st.frameRate && st.frameRate < (state.camFps || 30) - 5) msgs.push(Math.round(st.frameRate) + ' fps');
    if (msgs.length) toast('Tu cámara entregó ' + msgs.join(' y ') + ' (menos de lo elegido en Ajustes).', 5000);
  }

  function fileName() {
    var d = new Date();
    var pad = function (n) { return ('0' + n).slice(-2); };
    var ext = /mp4/.test(cam.mime) ? 'mp4' : 'webm';
    return 'teleprompter-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' +
      pad(d.getHours()) + pad(d.getMinutes()) + '.' + ext;
  }

  function saveVideo() {
    if (!cam.blob) return;
    var name = fileName();
    var file;
    try { file = new File([cam.blob], name, { type: cam.mime }); } catch (e) { file = null; }
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file] }).then(function () {
        cam.saved = true; cam.blob = null;
        els.savePanel.classList.add('hidden');
        toast('¡Listo! Revisa tu app Fotos.', 3500);
      }).catch(function (e) {
        if (e && e.name === 'AbortError') return; // cerró el menú sin elegir
        downloadVideo(name);
      });
    } else {
      downloadVideo(name);
    }
  }

  function downloadVideo(name) {
    var url = URL.createObjectURL(cam.blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    cam.saved = true; cam.blob = null;
    els.savePanel.classList.add('hidden');
    toast('Video descargado (revisa la app Archivos → Descargas).', 5000);
  }

  els.camBtn.addEventListener('click', camToggle);
  els.recBtn.addEventListener('click', function () {
    if (cam.recorder && cam.recorder.state === 'recording') stopRecording(false); else startRecording();
  });
  els.saveBtn.addEventListener('click', saveVideo);
  els.discardBtn.addEventListener('click', function () {
    if (!window.confirm('¿Descartar este video?')) return;
    cam.blob = null; els.savePanel.classList.add('hidden');
  });

  // Gancho de pruebas: window.tp.feed('texto') simula lo que escucha el micrófono.
  window.tp = {
    feed: onSpeech,
    get pos() { return tracker ? tracker.pos : 0; },
    get words() { return wordEls.length; },
    get cam() { return cam; },
    get rc() { return rc; }
  };
})();
