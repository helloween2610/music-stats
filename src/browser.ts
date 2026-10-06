const params = new URLSearchParams(window.location.search);
const desktopMode = params.has("desktop") || window.location.pathname.endsWith("/web.html");

async function start() {
  if (params.has("embed") || desktopMode) {
    document.body.classList.add("browser-preview");
    if (desktopMode) document.body.classList.add("browser-desktop");
    await import("./app");
    if (desktopMode) await import("./css/desktop.scss");
    return;
  }

  await import("./css/browser.scss");
  const mockNowPlaying = params.get("nowPlaying") === "mock" ? "&nowPlaying=mock" : "";
  document.getElementById("app")!.innerHTML = `
    <main class="preview-stage" aria-label="Giao diện Sổ Nghe Nhạc">
      <div class="preview-version">VERSION 2</div><div class="phone"><iframe title="Sổ Nghe Nhạc" src="./browser.html?embed=1${mockNowPlaying}"></iframe></div>
    </main>`;
}

void start();
