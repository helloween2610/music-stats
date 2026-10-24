import Capacitor

final class AppBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(StatsMusicPlugin())
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        lockWebViewZoom()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        lockWebViewZoom()
    }

    private func lockWebViewZoom() {
        guard let scrollView = webView?.scrollView else { return }
        scrollView.minimumZoomScale = 1
        scrollView.maximumZoomScale = 1
        scrollView.zoomScale = 1
        scrollView.bouncesZoom = false
        scrollView.pinchGestureRecognizer?.isEnabled = false
    }
}

@objc(StatsMusicPlugin)
final class StatsMusicPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "StatsMusicPlugin"
    let jsName = "StatsMusic"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise)
    ]
    private let allowedPaths: Set<String> = [
        "/player-state", "/control", "/seek", "/queue-play", "/queue-move", "/queue-remove",
        "/tracks", "/track-action", "/play", "/album-action", "/queue-action"
    ]
    private var diagnosticEvents: [[String: Any]] = []
    private var recordedInitialState = false

    @objc func request(_ call: CAPPluginCall) {
        guard let path = call.getString("path"), allowedPaths.contains(path),
              let query = call.getObject("params") as? [String: String] else {
            call.reject("Lệnh trình phát không hợp lệ.")
            return
        }
        Task { @MainActor in
            let handler = LocalMusicServer(model: PebbleMusicBridge.shared)
            let started = Date()
            let response = await handler.response(path: path, query: query)
            recordDiagnostic(path: path, response: response, started: started)
            call.resolve(["status": response.status, "body": String(data: response.body, encoding: .utf8) ?? "null"])
        }
    }

    @MainActor private func recordDiagnostic(path: String, response: HTTPResponse, started: Date) {
        guard Bundle.main.url(forResource: "menu-motion", withExtension: "js", subdirectory: "public") != nil else { return }
        if path == "/player-state" && recordedInitialState && response.status == 200 { return }
        if path == "/player-state" { recordedInitialState = true }
        diagnosticEvents.append([
            "at": ISO8601DateFormatter().string(from: started), "path": path,
            "status": response.status, "durationMs": Date().timeIntervalSince(started) * 1000
        ])
        diagnosticEvents = Array(diagnosticEvents.suffix(40))
        guard let folder = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first,
              let data = try? JSONSerialization.data(withJSONObject: diagnosticEvents) else { return }
        try? data.write(to: folder.appendingPathComponent("bridge-actions.json"), options: .atomic)
    }
}
