(function () {
  var BASE = "http://127.0.0.1:8765";
  var state = {
    status: "Đang kết nối",
    now: null,
    playlists: [],
    marks: { save: [], dislike: [] },
    health: null,
    healthChecked: false,
    healthPending: false,
    healthErrorCount: 0,
    keepAlive: true,
    loadingPlaylists: false
  };

  function request(path, options) {
    return fetch(BASE + path, options).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    });
  }

  function text(value, fallback) {
    value = value == null ? "" : String(value);
    return value.trim() || fallback || "";
  }

  function button(label, title, onClick) {
    var el = document.createElement("button");
    el.type = "button";
    el.textContent = label;
    el.title = title || label;
    el.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    return el;
  }

  function controlIcon(icon, title, onClick) {
    var el = document.createElement("span");
    el.className = "pebble-now-chip pebble-now-icon";
    el.role = "button";
    el.tabIndex = 0;
    el.title = title;
    el.setAttribute("aria-label", title);
    el.innerHTML = icon;
    function run(event) {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    }
    el.addEventListener("click", run);
    el.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") run(event);
    });
    return el;
  }

  function iconSvg(path, viewBox) {
    return '<svg viewBox="' + (viewBox || "0 0 24 24") + '" aria-hidden="true">' + path + '</svg>';
  }

  function control(action) {
    request("/control?action=" + encodeURIComponent(action))
      .then(refreshNow)
      .catch(function () { state.status = "Bridge chưa sẵn sàng"; renderAll(); });
  }

  function seek(seconds) {
    request("/seek?seconds=" + encodeURIComponent(seconds))
      .then(refreshNow)
      .catch(function () { state.status = "Chưa tua được"; renderAll(); });
  }

  function refreshSettings() {
    return request("/settings").then(function (data) {
      state.keepAlive = data.keepAlive !== false;
      renderAll();
    }).catch(function () {
      renderAll();
    });
  }

  function setKeepAlive(enabled) {
    request("/keepalive?enabled=" + (enabled ? "1" : "0"))
      .then(function (data) {
        state.keepAlive = data.keepAlive !== false;
        state.status = state.keepAlive ? "Đã bật chạy nền" : "Đã tắt chạy nền";
        renderAll();
      })
      .catch(function () {
        state.status = "Chưa đổi được chạy nền";
        renderAll();
      });
  }

  function refreshNow() {
    return request("/status").then(function (data) {
      state.now = data.nowPlaying || data;
      state.status = state.now && state.now.playing ? "Đang phát" : "Sẵn sàng cho Pebble";
      renderAll();
    }).catch(function () {
      state.status = "Mở app một lần để cấp quyền Music";
      renderAll();
    });
  }

  function refreshPlaylists() {
    if (state.loadingPlaylists) return Promise.resolve();
    state.loadingPlaylists = true;
    return request("/all-playlists").then(function (rows) {
      state.playlists = Array.isArray(rows) ? rows : [];
      state.loadingPlaylists = false;
      state.status = "Sẵn sàng cho Pebble";
      renderAll();
    }).catch(function () {
      state.loadingPlaylists = false;
      state.status = "Chưa đọc được playlist";
      renderAll();
    });
  }

  function refreshHealth() {
    var firstCheck = !state.healthChecked;
    if (firstCheck) {
      state.healthPending = true;
      renderAll();
    }
    return request("/health").then(function (data) {
      state.health = data || null;
      state.healthChecked = true;
      state.healthPending = false;
      state.healthErrorCount = 0;
      renderAll();
    }).catch(function () {
      state.healthErrorCount += 1;
      if (state.healthErrorCount >= 2 || !state.health) state.health = null;
      state.healthChecked = true;
      state.healthPending = false;
      if (!state.health) state.status = "Bridge offline";
      renderAll();
    });
  }

  function restartBridge() {
    request("/restart").then(function () {
      state.status = "Đã restart bridge";
      return refreshHealth();
    }).catch(function () {
      state.status = "Chưa restart được bridge";
      renderAll();
    });
  }

  function refreshMarks() {
    return Promise.all([
      request("/marks?action=save").catch(function () { return []; }),
      request("/marks?action=dislike").catch(function () { return []; })
    ]).then(function (rows) {
      state.marks.save = Array.isArray(rows[0]) ? rows[0] : [];
      state.marks.dislike = Array.isArray(rows[1]) ? rows[1] : [];
      renderAll();
    });
  }

  function openMarkedTrack(action, track) {
    if (!track || !track.id) return;
    request("/open-mark?action=" + encodeURIComponent(action) + "&id=" + encodeURIComponent(track.id))
      .then(function () {
        state.status = "Đã mở Apple Music";
        renderAll();
      })
      .catch(function () {
        state.status = "Chưa mở được Apple Music";
        renderAll();
      });
  }

  function markedTrackInLibrary(track) {
    if (track && typeof track.inLibrary === "boolean") return track.inLibrary;
    return !!(track && text(track.persistentID));
  }

  function bindLongPress(el, onLongPress) {
    var timer = 0;
    var consumed = false;
    function clear() {
      if (timer) window.clearTimeout(timer);
      timer = 0;
    }
    function start() {
      consumed = false;
      clear();
      timer = window.setTimeout(function () {
        consumed = true;
        onLongPress();
      }, 650);
    }
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchend", clear);
    el.addEventListener("touchcancel", clear);
    el.addEventListener("mousedown", start);
    el.addEventListener("mouseup", clear);
    el.addEventListener("mouseleave", clear);
    el.addEventListener("click", function (event) {
      if (!consumed) return;
      event.preventDefault();
      event.stopPropagation();
      consumed = false;
    }, true);
  }

  function showMarkedTrackMenu(action, track) {
    var existing = document.getElementById("pebble-track-menu");
    if (existing) existing.remove();

    var sheet = document.createElement("div");
    sheet.id = "pebble-track-menu";
    sheet.className = "pebble-track-menu";
    sheet.innerHTML = '<div class="pebble-mark-backdrop"></div>' +
      '<div class="pebble-track-menu-card">' +
      '<div class="pebble-track-menu-title"><strong></strong><span></span></div>' +
      '<button type="button" class="pebble-track-menu-action">Mở trong Apple Music</button>' +
      '<button type="button" class="pebble-track-menu-close">Đóng</button>' +
      '</div>';
    sheet.querySelector(".pebble-track-menu-title strong").textContent = text(track.title, "Untitled Song");
    sheet.querySelector(".pebble-track-menu-title span").textContent = [track.artist, track.album].filter(Boolean).join(" · ");

    function close(event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      sheet.remove();
    }
    sheet.querySelector(".pebble-mark-backdrop").addEventListener("click", close);
    sheet.querySelector(".pebble-track-menu-close").addEventListener("click", close);
    sheet.querySelector(".pebble-track-menu-action").addEventListener("click", function (event) {
      close(event);
      openMarkedTrack(action, track);
    });
    document.body.appendChild(sheet);
  }

  function showMarkSheet(action) {
    var rows = state.marks[action] || [];
    var existing = document.getElementById("pebble-mark-sheet");
    if (existing) existing.remove();

    var sheet = document.createElement("div");
    sheet.id = "pebble-mark-sheet";
    sheet.className = "pebble-mark-sheet";
    var title = action === "dislike" ? "Disliked from Pebble" : "Saved from Pebble";
    sheet.innerHTML = '<div class="pebble-mark-backdrop"></div>' +
      '<div class="pebble-mark-card">' +
      '<div class="pebble-mark-head"><strong>' + title + '</strong><button type="button" aria-label="Close">×</button></div>' +
      '<div class="pebble-mark-list"></div>' +
      '</div>';

    var list = sheet.querySelector(".pebble-mark-list");
    if (!rows.length) {
      var empty = document.createElement("div");
      empty.className = "pebble-mark-empty";
      empty.textContent = "Chưa có bài nào.";
      list.appendChild(empty);
    } else {
      rows.forEach(function (track) {
        var inLibrary = markedTrackInLibrary(track);
        var row = document.createElement("button");
        row.type = "button";
        row.className = "pebble-mark-row" + (inLibrary ? "" : " is-outside-library");
        row.title = inLibrary ? "Long press để mở menu" : "Open in Apple Music";
        var meta = [track.artist, track.album, track.year].filter(Boolean).join(" · ");
        var extra = [track.statsLine, formatMarkDate(track.createdAt)].filter(Boolean).join(" · ");
        row.innerHTML =
          '<strong><span class="pebble-mark-name"></span><span class="pebble-mark-plus" aria-label="Chưa có trong thư viện"></span></strong>' +
          '<span class="pebble-mark-meta"></span>' +
          '<span class="pebble-mark-extra"></span>';
        row.querySelector(".pebble-mark-name").textContent = text(track.title, "Untitled Song");
        row.querySelector(".pebble-mark-meta").textContent = meta || "Unknown artist";
        row.querySelector(".pebble-mark-extra").textContent = extra;
        row.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();
          openMarkedTrack(action, track);
        });
        if (inLibrary) {
          bindLongPress(row, function () {
            showMarkedTrackMenu(action, track);
          });
        }
        list.appendChild(row);
      });
    }

    function close(event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      sheet.remove();
    }
    sheet.querySelector(".pebble-mark-backdrop").addEventListener("click", close);
    sheet.querySelector(".pebble-mark-head button").addEventListener("click", close);
    document.body.appendChild(sheet);
  }

  function formatMarkDate(value) {
    if (!value) return "";
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
  }

  function setFavorite(playlist, enabled) {
    request("/favorite?playlist=" + encodeURIComponent(playlist.id) + "&enabled=" + (enabled ? "1" : "0"))
      .then(function () {
        playlist.favorite = enabled;
        state.status = enabled ? "Đã chọn cho Pebble" : "Đã bỏ khỏi Pebble";
        renderAll();
      })
      .catch(function () {
        state.status = "Chưa lưu được playlist";
        renderAll();
      });
  }

  function ensureLibraryPanel() {
    var screen = document.querySelector(".screen-library");
    if (!screen) {
      var old = document.getElementById("pebble-now-panel");
      var oldDivider = document.getElementById("pebble-source-divider");
      if (old) old.remove();
      if (oldDivider) oldDivider.remove();
      return null;
    }
    var group = screen.querySelector(".group");
    if (!group) return null;
    var existing = document.getElementById("pebble-now-panel");
    if (existing && existing.parentElement === group) return existing;
    if (existing) existing.remove();
    var existingDivider = document.getElementById("pebble-source-divider");
    if (existingDivider) existingDivider.remove();

    var divider = document.createElement("div");
    divider.id = "pebble-source-divider";
    divider.className = "pebble-source-divider";
    var panel = document.createElement("div");
    panel.id = "pebble-now-panel";
    panel.className = "pebble-source-row";
    group.append(divider, panel);
    return panel;
  }

  function ensureTodayStatusPanel() {
    var screen = document.querySelector(".screen-today");
    if (!screen) {
      var old = document.getElementById("pebble-today-status");
      if (old) old.remove();
      return null;
    }
    var existing = document.getElementById("pebble-today-status");
    if (existing && existing.parentElement === screen) return existing;
    if (existing) existing.remove();

    var panel = document.createElement("div");
    panel.id = "pebble-today-status";
    panel.className = "pebble-today-status";
    screen.insertBefore(panel, screen.firstChild);
    return panel;
  }

  function renderTodayStatusPanel() {
    var panel = ensureTodayStatusPanel();
    if (!panel) return;
    panel.innerHTML = "";

    var dot = document.createElement("span");
    dot.className = "pebble-source-dot";
    if (state.healthPending || !state.healthChecked) {
      dot.className += " is-checking";
    } else if (!state.health || state.health.serverReady === false) {
      dot.className += " is-off";
    }

    var label = document.createElement("span");
    label.className = "pebble-today-status-label";
    label.textContent = "Pebble";

    var value = document.createElement("strong");
    value.textContent = todayHealthText();

    var restart = document.createElement("button");
    restart.type = "button";
    restart.className = "pebble-today-restart";
    restart.textContent = "Restart";
    restart.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      restartBridge();
    });

    panel.append(dot, label, value, restart);
  }

  function todayHealthText() {
    var health = state.health;
    if (state.healthPending || !state.healthChecked) return "Đang kiểm tra...";
    if (!health) return "Bridge offline";
    if (health.serverReady === false) return "Server restarting";

    var age = Number(health.lastPebbleRequestAge);
    if (!Number.isFinite(age) || age < 0) return "chưa có request";
    return compactAge(age);
  }

  function compactAge(seconds) {
    if (seconds < 5) return "vừa xong";
    if (seconds < 60) return seconds + "s trước";
    var minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + "p trước";
    return Math.floor(minutes / 60) + "g trước";
  }

  function renderNowPanel() {
    var panel = ensureLibraryPanel();
    if (!panel) return;
    var now = state.now || {};
    panel.innerHTML = "";

    var main = document.createElement("div");
    main.className = "pebble-source-main";
    var title = document.createElement("div");
    title.className = "pebble-source-title";
    var titleText = document.createElement("span");
    titleText.textContent = "Pebble Remote";
    var dot = document.createElement("span");
    dot.className = "pebble-source-dot";
    title.append(titleText, dot);

    var track = document.createElement("div");
    track.className = "pebble-track";
    var trackTitle = document.createElement("strong");
    trackTitle.textContent = text(now.title, "Nothing playing");
    var subtitle = document.createElement("span");
    subtitle.textContent = [text(now.subtitle, "Choose playlist"), text(now.year, "")].filter(Boolean).join(" · ");
    track.append(trackTitle, subtitle);

    var detail = document.createElement("div");
    detail.className = "pebble-source-detail";
    detail.textContent = state.status + " · chạy nền " + (state.keepAlive ? "bật" : "tắt");

    main.append(title, track, detail);

    var toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "pebble-toggle" + (state.keepAlive ? " is-on" : "");
    toggle.textContent = state.keepAlive ? "Chạy nền" : "Tắt nền";
    toggle.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      setKeepAlive(!state.keepAlive);
    });

    panel.append(main, toggle);
  }

  function renderNowPlayingControls() {
    var old = document.getElementById("pebble-now-card-controls");
    if (old) old.remove();
  }

  function ensurePlaylistPanel() {
    var grid = document.querySelector(".playlist-grid");
    if (!grid) return null;
    var existing = document.getElementById("pebble-playlist-panel");
    if (existing && existing.nextElementSibling === grid) return existing;
    if (existing) existing.remove();

    var old = document.getElementById("pebble-playlist-panel");
    if (old) old.remove();
    bindPlaylistTiles();
    return null;
  }

  function renderPlaylistPanel() {
    ensurePlaylistPanel();
    bindPlaylistTiles();
  }

  function markExistingTiles() {
    var favs = new Set(state.playlists.filter(function (p) { return p.favorite; }).map(function (p) {
      return text(p.name).toLocaleLowerCase("vi");
    }));
    document.querySelectorAll(".playlist-tile").forEach(function (tile) {
      var name = tile.querySelector(".playlist-tile-name");
      var key = text(name && name.textContent).toLocaleLowerCase("vi");
      tile.classList.toggle("pebble-favorite", favs.has(key));
    });
  }

  function playlistForTile(tile) {
    var name = tile.querySelector(".playlist-tile-name");
    var key = text(name && name.textContent).toLocaleLowerCase("vi");
    return state.playlists.find(function (p) {
      return text(p.name).toLocaleLowerCase("vi") === key;
    });
  }

  function bindPlaylistTiles() {
    markExistingTiles();
  }

  function renderAll() {
    suppressObserver = true;
    renderNowPanel();
    renderTodayStatusPanel();
    renderNowPlayingControls();
    renderPlaylistPanel();
    bindPlaylistTiles();
    window.setTimeout(function () { suppressObserver = false; }, 0);
  }

  var suppressObserver = false;
  var renderQueued = false;
  function queueRender() {
    if (suppressObserver || renderQueued) return;
    renderQueued = true;
    window.requestAnimationFrame(function () {
      renderQueued = false;
      renderAll();
    });
  }

  var observer = new MutationObserver(queueRender);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  function refreshAfterOpen() {
    state.healthPending = !state.healthChecked;
    renderAll();
    refreshNow();
    refreshPlaylists();
    refreshMarks();
    refreshHealth();
    [500, 1500, 3000, 6000].forEach(function (delay) {
      window.setTimeout(refreshHealth, delay);
    });
  }

  window.addEventListener("focus", refreshAfterOpen);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") {
      refreshAfterOpen();
    }
  });
  setInterval(refreshNow, 15000);
  setInterval(refreshHealth, 20000);
  refreshSettings();
  refreshAfterOpen();
})();
