// Opt-in device diagnostics. Keep measurements local and never include track metadata.
(function () {
  var reports = [];
  var active = [];
  var lastInput = null;
  var requests = [];
  var fetch = window.fetch;
  window.fetch = function (input, options) {
    if (typeof input !== 'string' || input.indexOf('127.0.0.1:8765/player-state') < 0) return fetch.call(this, input, options);
    var start = performance.now();
    return fetch.call(this, input + (input.indexOf('?') < 0 ? '?' : '&') + 'motion=1', options).then(function (response) {
      requests.push({ start: start, end: performance.now(), native: response.headers.get('Server-Timing') });
      requests = requests.slice(-100);
      return response;
    });
  };
  var saveTimer;
  var startedAt = new Date().toISOString();
  var round = function (n) { return Math.round(n * 10) / 10; };
  var save = function () {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      if (active.length) { save(); return; }
      var filesystem = window.Capacitor && window.Capacitor.Plugins.Filesystem;
      if (!filesystem) return;
      filesystem.writeFile({
        path: 'menu-motion.json', directory: 'DOCUMENTS', encoding: 'utf8',
        data: JSON.stringify({ startedAt: startedAt, userAgent: navigator.userAgent, reports: reports })
      }).catch(function () {});
    }, 1800);
  };
  ['pointerdown', 'pointerup', 'click', 'contextmenu'].forEach(function (name) {
    document.addEventListener(name, function (event) {
      var target = event.target.closest && event.target.closest('.shortcut-target,.playlist-tile,.playlist-rank-card');
      if (target) lastInput = { type: name, at: performance.now() };
    }, true);
  });
  function capture(backdrop) {
    var sheet = backdrop.querySelector('.shortcut-sheet');
    if (!sheet || active.some(function (entry) { return entry.sheet === sheet; })) return;
    var now = performance.now();
    var style = getComputedStyle(sheet);
    var report = {
      at: new Date().toISOString(),
      input: lastInput && now - lastInput.at < 2000 ? { type: lastInput.type, mountDelay: round(now - lastInput.at) } : null,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      viewport: [innerWidth, innerHeight, devicePixelRatio],
      animation: [style.animationName, style.animationDuration, style.animationTimingFunction],
      frames: [], events: [],
      domNodes: document.getElementsByTagName('*').length
    };
    var entry = { sheet: sheet, report: report, start: now };
    active.push(entry);
    function frame(at) {
      var elapsed = at - now;
      if (sheet.isConnected) {
        var rect = sheet.getBoundingClientRect();
        report.frames.push([round(elapsed), round(rect.y), round(rect.height)]);
      }
      if (elapsed < 1800 && sheet.isConnected && document.visibilityState === 'visible') requestAnimationFrame(frame);
      else {
        report.playerRequests = requests.filter(function (request) { return request.end >= now && request.start <= at; }).map(function (request) {
          return { start: round(request.start - now), end: round(request.end - now), native: request.native };
        });
        active = active.filter(function (item) { return item !== entry; });
        reports.push(report);
        reports = reports.slice(-24);
        save();
      }
    }
    requestAnimationFrame(frame);
  }
  ['animationstart', 'animationend', 'animationcancel'].forEach(function (name) {
    document.addEventListener(name, function (event) {
      active.forEach(function (entry) {
        if (event.target === entry.sheet) entry.report.events.push([round(performance.now() - entry.start), name, event.animationName]);
      });
    }, true);
  });
  new MutationObserver(function (mutations) {
    mutations.forEach(function (mutation) {
      mutation.addedNodes.forEach(function (node) {
        if (node.nodeType !== 1) return;
        if (node.matches('.shortcut-backdrop')) capture(node);
        node.querySelectorAll('.shortcut-backdrop').forEach(capture);
      });
    });
  }).observe(document.body, { childList: true, subtree: true });
})();
