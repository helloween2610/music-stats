import Foundation
import Network

@MainActor
final class LocalMusicServer {
    private let model: PebbleMusicBridge
    private var listener: NWListener?
    private var ready = false
    private var restartWorkItem: DispatchWorkItem?
    private let port: NWEndpoint.Port = 8765

    init(model: PebbleMusicBridge) {
        self.model = model
    }

    func start() {
        guard listener == nil else {
            if !ready {
                restart()
            }
            return
        }

        do {
            let listener = try NWListener(using: .tcp, on: port)
            listener.newConnectionHandler = { [weak self] connection in
                Task { @MainActor in
                    self?.handle(connection)
                }
            }
            listener.stateUpdateHandler = { [weak self, weak listener] state in
                Task { @MainActor in
                    guard let listener else { return }
                    self?.handleListenerState(state, for: listener)
                }
            }
            listener.start(queue: .main)
            self.listener = listener
        } catch {
            listener = nil
            ready = false
        }
    }

    func restart() {
        restartWorkItem?.cancel()
        let oldListener = listener
        listener = nil
        ready = false
        oldListener?.cancel()
        start()
    }

    func ensureRunning() {
        if listener == nil || !ready {
            restart()
        }
    }

    private func handleListenerState(_ state: NWListener.State, for currentListener: NWListener) {
        guard listener === currentListener else { return }

        switch state {
        case .ready:
            restartWorkItem?.cancel()
            restartWorkItem = nil
            ready = true
        case .failed, .cancelled:
            self.listener = nil
            ready = false
            scheduleRestart(after: 1)
        case .waiting:
            ready = false
            scheduleRestart(after: 2)
        default:
            break
        }
    }

    private func scheduleRestart(after delay: TimeInterval) {
        restartWorkItem?.cancel()
        let item = DispatchWorkItem { [weak self] in
            Task { @MainActor in
                self?.ensureRunning()
            }
        }
        restartWorkItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: item)
    }

    private func handle(_ connection: NWConnection) {
        connection.start(queue: .main)
        connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] data, _, _, _ in
            guard let self else {
                connection.cancel()
                return
            }
            Task { @MainActor in
                let response = await self.response(for: data)
                self.send(response, on: connection)
            }
        }
    }

    private func response(for data: Data?) async -> HTTPResponse {
        guard let data, let request = String(data: data, encoding: .utf8) else {
            return .json(["error": "empty request"], status: 400)
        }

        let firstLine = request.components(separatedBy: "\r\n").first ?? ""
        let parts = firstLine.split(separator: " ")
        guard parts.count >= 2 else {
            return .json(["error": "bad request"], status: 400)
        }

        let method = parts.first.map(String.init) ?? "GET"
        let parsed = parsePath(String(parts[1]))
        model.noteBridgeRequest(path: parsed.path, fromPebble: parsed.query["source"] == "pebble")

        if method == "OPTIONS" {
            return .json(["ok": true])
        }

        switch parsed.path {
        case "/bootstrap":
            return .codable(model.bootstrap())
        case "/status":
            return .codable(["nowPlaying": model.nowPlaying()])
        case "/player-state":
            return .codable(model.playerState())
        case "/widget-playlists":
            guard let payload = parsed.query["payload"], model.updateWidgetPlaylists(payload: payload) else {
                return .json(["error": "invalid widget playlists"], status: 400)
            }
            return .json(["ok": true])
        case "/widget-playlist-selection":
            return .json(["playlist": model.consumeWidgetPlaylistSelection()])
        case "/artwork":
            guard let persistentID = parsed.query["pid"].flatMap(PebbleMusicBridge.parsePersistentID),
                  let artwork = model.artworkData(persistentID: persistentID) else {
                return .json(["error": "artwork not found"], status: 404)
            }
            return .binary(artwork, contentType: "image/jpeg")
        case "/settings":
            return .json(["keepAlive": model.keepAliveEnabled()])
        case "/playlists":
            return .codable(model.playlistsForPebble())
        case "/all-playlists":
            return .codable(model.allPlaylists())
        case "/tracks":
            guard let playlistID = parsed.query["playlist"].flatMap(PebbleMusicBridge.parsePersistentID) else {
                return .json(["error": "missing playlist"], status: 400)
            }
            return .codable(model.tracks(playlistID: playlistID))
        case "/play":
            guard let playlistID = parsed.query["playlist"].flatMap(PebbleMusicBridge.parsePersistentID) else {
                return .json(["error": "missing playlist"], status: 400)
            }
            let trackID = parsed.query["track"].flatMap(PebbleMusicBridge.parsePersistentID)
            let action = parsed.query["action"] ?? "play"
            guard await model.play(playlistID: playlistID, trackID: trackID, trackArtist: parsed.query["artist"], trackTitle: parsed.query["title"], action: action) else {
                return .json(["error": "Apple Music không tải được playlist để phát."], status: 400)
            }
            return .json(["ok": true, "action": action])
        case "/album-action":
            guard let album = parsed.query["album"]?.trimmingCharacters(in: .whitespacesAndNewlines), !album.isEmpty else {
                return .json(["error": "missing album"], status: 400)
            }
            let action = parsed.query["action"] ?? "play"
            guard model.playLibraryAlbum(
                artist: parsed.query["artist"],
                album: album,
                startPersistentID: parsed.query["track"].flatMap(PebbleMusicBridge.parsePersistentID),
                startTitle: parsed.query["title"],
                action: action
            ) else {
                return .json(["error": "Không tìm thấy album này trong thư viện Apple Music."], status: 400)
            }
            return .json(["ok": true, "action": action])
        case "/queue-action":
            let persistentIDs = (parsed.query["ids"] ?? "")
                .split(separator: ",")
                .compactMap { PebbleMusicBridge.parsePersistentID(String($0)) }
            guard !persistentIDs.isEmpty, persistentIDs.count <= 200 else {
                return .json(["error": "Hàng chờ chưa hợp lệ."], status: 400)
            }
            guard model.playLibraryQueue(persistentIDs: persistentIDs) else {
                return .json(["error": "Không tìm thấy các bài này trong thư viện Apple Music."], status: 400)
            }
            return .json(["ok": true, "count": persistentIDs.count])
        case "/queue-play":
            guard let index = parsed.query["index"].flatMap(Int.init), model.playManagedQueue(at: index) else {
                return .json(["error": "Không phát được bài này trong hàng chờ."], status: 400)
            }
            return .json(["ok": true])
        case "/queue-move":
            guard let from = parsed.query["from"].flatMap(Int.init),
                  let to = parsed.query["to"].flatMap(Int.init),
                  await model.moveManagedQueue(from: from, to: to) else {
                return .json(["error": "Không đổi được thứ tự hàng chờ."], status: 400)
            }
            return .json(["ok": true])
        case "/queue-remove":
            guard let index = parsed.query["index"].flatMap(Int.init), await model.removeManagedQueueItem(at: index) else {
                return .json(["error": "Không xóa được bài khỏi hàng chờ."], status: 400)
            }
            return .json(["ok": true])
        case "/open-playlist":
            guard let playlistID = parsed.query["playlist"].flatMap(PebbleMusicBridge.parsePersistentID) else {
                return .json(["error": "missing playlist"], status: 400)
            }
            guard model.openPlaylist(playlistID: playlistID) else {
                return .json(["error": "Không mở được playlist này trong Apple Music."], status: 400)
            }
            return .json(["ok": true])
        case "/playlist-add-track":
            guard let playlistID = parsed.query["playlist"].flatMap(PebbleMusicBridge.parsePersistentID) else {
                return .json(["error": "Thiếu playlist đích."], status: 400)
            }
            return await model.addTrackToPlaylist(
                playlistID: playlistID,
                persistentID: parsed.query["pid"],
                storeID: parsed.query["sid"],
                artist: parsed.query["artist"],
                title: parsed.query["title"],
                album: parsed.query["album"]
            )
        case "/track-action":
            let action = parsed.query["action"] ?? "play"
            guard model.playLibraryTrack(
                persistentID: parsed.query["pid"],
                storeID: parsed.query["sid"],
                artist: parsed.query["artist"],
                title: parsed.query["title"],
                album: parsed.query["album"],
                action: action
            ) else {
                return .json(["error": "track action failed"], status: 400)
            }
            return .json(["ok": true, "action": action])
        case "/library-sync":
            guard let apiBase = parsed.query["api"], let token = parsed.query["token"] else {
                return .json(["error": "missing API config"], status: 400)
            }
            return await model.syncLibraryToStats(apiBase: apiBase, token: token)
        case "/library-add":
            return await model.addLibraryTrack(
                storeID: parsed.query["sid"],
                artist: parsed.query["artist"],
                title: parsed.query["title"],
                album: parsed.query["album"]
            )
        case "/library-add-current":
            return await model.addCurrentTrackToLibrary()
        case "/control":
            guard let action = parsed.query["action"], model.control(action) else {
                return .json(["error": "bad action"], status: 400)
            }
            return .json(["ok": true])
        case "/seek":
            if let position = parsed.query["position"].flatMap(Double.init) {
                guard model.seek(to: position) else {
                    return .json(["error": "bad seek"], status: 400)
                }
                return .json(["ok": true])
            }
            let seconds = parsed.query["seconds"].flatMap(Double.init) ?? 15
            guard model.seekForward(seconds: seconds) else {
                return .json(["error": "bad seek"], status: 400)
            }
            return .json(["ok": true])
        case "/mark":
            let action = parsed.query["action"] ?? "save"
            guard model.markCurrentTrack(action: action) else {
                return .json(["error": "mark failed"], status: 400)
            }
            return .json(["ok": true])
        case "/marks":
            let action = parsed.query["action"] ?? "save"
            return .codable(model.markedTracks(action: action))
        case "/open-mark":
            let action = parsed.query["action"] ?? "save"
            guard let id = parsed.query["id"], model.openMarkedTrack(action: action, id: id) else {
                return .json(["error": "open failed"], status: 400)
            }
            return .json(["ok": true])
        case "/favorite":
            guard let playlistID = parsed.query["playlist"].flatMap(PebbleMusicBridge.parsePersistentID) else {
                return .json(["error": "missing playlist"], status: 400)
            }
            let enabled = parsed.query["enabled"] != "0"
            model.setFavorite(playlistID: playlistID, enabled: enabled)
            return .json(["ok": true])
        case "/keepalive":
            let enabled = parsed.query["enabled"] != "0"
            model.setKeepAliveEnabled(enabled)
            return .json(["ok": true, "keepAlive": enabled])
        case "/restart":
            model.restartBridgeServer()
            return .json(["ok": true, "serverReady": ready])
        case "/watch":
            model.updateWatchHealth(batteryPercent: parsed.query["battery"].flatMap(Int.init))
            return .json(["ok": true])
        case "/health":
            return .json(model.health(serverReady: ready))
        default:
            return .json(["error": "not found"], status: 404)
        }
    }

    private func send(_ response: HTTPResponse, on connection: NWConnection) {
        connection.send(content: response.data, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }

    private func parsePath(_ rawPath: String) -> (path: String, query: [String: String]) {
        // Browser URLSearchParams uses form encoding, where `+` means a space.
        // URLComponents does not apply that conversion to query item values.
        let formEncodedPath = rawPath.replacingOccurrences(of: "+", with: "%20")
        guard let components = URLComponents(string: formEncodedPath) else {
            return (rawPath, [:])
        }
        let query = Dictionary(uniqueKeysWithValues: (components.queryItems ?? []).compactMap { item in
            item.value.map { (item.name, $0) }
        })
        return (components.path, query)
    }
}

struct HTTPResponse {
    let data: Data

    static func codable<T: Encodable>(_ value: T, status: Int = 200) -> HTTPResponse {
        let body = (try? JSONEncoder().encode(value)) ?? Data("{}".utf8)
        return make(status: status, contentType: "application/json", body: body)
    }

    static func json(_ value: [String: Any], status: Int = 200) -> HTTPResponse {
        let body = (try? JSONSerialization.data(withJSONObject: value)) ?? Data("{}".utf8)
        return make(status: status, contentType: "application/json", body: body)
    }

    static func rawJSON(_ body: Data, status: Int = 200) -> HTTPResponse {
        make(status: status, contentType: "application/json", body: body)
    }

    static func binary(_ body: Data, contentType: String, status: Int = 200) -> HTTPResponse {
        make(status: status, contentType: contentType, body: body)
    }

    private static func make(status: Int, contentType: String, body: Data) -> HTTPResponse {
        let reason = status == 200 ? "OK" : "Error"
        let headers = [
            "HTTP/1.1 \(status) \(reason)",
            "Content-Type: \(contentType)",
            "Content-Length: \(body.count)",
            "Cache-Control: no-store, max-age=0",
            "Connection: close",
            "Access-Control-Allow-Origin: *",
            "Access-Control-Allow-Methods: GET, POST, OPTIONS",
            "Access-Control-Allow-Headers: Content-Type, Authorization",
            "Access-Control-Allow-Private-Network: true",
            "Access-Control-Max-Age: 86400",
            "",
            ""
        ].joined(separator: "\r\n")
        var data = Data(headers.utf8)
        data.append(body)
        return HTTPResponse(data: data)
    }
}
