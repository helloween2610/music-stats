import AppIntents
import MediaPlayer
import Security
import WidgetKit

private let statsWidgetKeychainService = "com.minlab.musicstats.widget"
private let statsWidgetKeychainAccessGroup = "AK73F5WL6J.com.minlab.musicstats.shared"
private let statsWidgetQueuePageKey = "statsWidgetQueuePage"
private let statsWidgetPlaylistSelectionKey = "statsWidgetPlaylistSelection"
private let statsWidgetRecentPlayStartsKey = "statsRecentPlayStarts"

private func readStatsWidgetData(account: String) -> Data? {
    let query: [CFString: Any] = [
        kSecClass: kSecClassGenericPassword,
        kSecAttrService: statsWidgetKeychainService,
        kSecAttrAccount: account,
        kSecAttrAccessGroup: statsWidgetKeychainAccessGroup,
        kSecReturnData: true,
        kSecMatchLimit: kSecMatchLimitOne,
    ]
    var result: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess else { return nil }
    return result as? Data
}

private func writeStatsWidgetData(_ data: Data, account: String) {
    let query: [CFString: Any] = [
        kSecClass: kSecClassGenericPassword,
        kSecAttrService: statsWidgetKeychainService,
        kSecAttrAccount: account,
        kSecAttrAccessGroup: statsWidgetKeychainAccessGroup,
    ]
    let attributes: [CFString: Any] = [
        kSecValueData: data,
        kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    if status == errSecItemNotFound {
        var addQuery = query
        attributes.forEach { addQuery[$0.key] = $0.value }
        SecItemAdd(addQuery as CFDictionary, nil)
    }
}

private func writeStatsWidgetQueuePage(_ page: Int) {
    writeStatsWidgetData(Data(String(max(0, page)).utf8), account: statsWidgetQueuePageKey)
}

private func recordStatsWidgetPlayStart(_ item: MPMediaItem?) {
    guard let item, item.persistentID != 0 else { return }
    var starts = readStatsWidgetData(account: statsWidgetRecentPlayStartsKey)
        .flatMap { try? JSONDecoder().decode([String: String].self, from: $0) } ?? [:]
    let id = String(item.persistentID, radix: 16, uppercase: true)
    starts[id] = ISO8601DateFormatter().string(from: Date())
    starts = starts.sorted { $0.value > $1.value }.prefix(200).reduce(into: [String: String]()) {
        $0[$1.key] = $1.value
    }
    if let data = try? JSONEncoder().encode(starts) {
        writeStatsWidgetData(data, account: statsWidgetRecentPlayStartsKey)
    }
}

private func statsWidgetPersistentID(_ value: String) -> UInt64? {
    let cleaned = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if let decimal = UInt64(cleaned) { return decimal }
    let hexadecimal = cleaned.lowercased().hasPrefix("0x") ? String(cleaned.dropFirst(2)) : cleaned
    return UInt64(hexadecimal, radix: 16)
}

@MainActor
private func playStatsWidgetPlaylist(_ playlistID: String, next: Bool) async {
    guard let persistentID = statsWidgetPersistentID(playlistID),
          let playlists = MPMediaQuery.playlists().collections as? [MPMediaPlaylist],
          let playlist = playlists.first(where: { $0.persistentID == persistentID }) else { return }

    let player = MPMusicPlayerController.systemMusicPlayer
    if next, player.nowPlayingItem != nil {
        player.prepend(MPMusicPlayerMediaItemQueueDescriptor(itemCollection: playlist))
    } else {
        player.setQueue(with: playlist)
        player.play()
        writeStatsWidgetQueuePage(0)
    }
    try? await Task.sleep(nanoseconds: 220_000_000)
    if !next { recordStatsWidgetPlayStart(player.nowPlayingItem) }
    WidgetCenter.shared.reloadTimelines(ofKind: "StatsNowPlayingWidget")
}

@available(iOS 17.0, *)
struct ToggleStatsPlaybackIntent: AudioPlaybackIntent {
    static let title: LocalizedStringResource = "Phát hoặc tạm dừng"
    static let description = IntentDescription("Điều khiển bài đang phát trong Stats.")

    @MainActor
    func perform() async throws -> some IntentResult {
        let player = MPMusicPlayerController.systemMusicPlayer
        if player.playbackState == .playing {
            player.pause()
        } else {
            player.play()
            recordStatsWidgetPlayStart(player.nowPlayingItem)
        }
        WidgetCenter.shared.reloadTimelines(ofKind: "StatsNowPlayingWidget")
        return .result()
    }
}

@available(iOS 17.0, *)
struct ToggleStatsRepeatIntent: AudioPlaybackIntent {
    static let title: LocalizedStringResource = "Đổi chế độ lặp"
    static let description = IntentDescription("Đổi giữa không lặp, lặp queue và lặp một bài.")

    @MainActor
    func perform() async throws -> some IntentResult {
        let player = MPMusicPlayerController.systemMusicPlayer
        switch player.repeatMode {
        case .all: player.repeatMode = .one
        case .one: player.repeatMode = .none
        default: player.repeatMode = .all
        }
        WidgetCenter.shared.reloadTimelines(ofKind: "StatsNowPlayingWidget")
        return .result()
    }
}

@available(iOS 17.0, *)
struct OpenStatsPlaylistIntent: AppIntent {
    static let title: LocalizedStringResource = "Mở playlist"
    static let description = IntentDescription("Mở chi tiết playlist trong Stats.")
    static var openAppWhenRun = true

    @Parameter(title: "Playlist ID")
    var playlistID: String

    init() {
        playlistID = ""
    }

    init(playlistID: String) {
        self.playlistID = playlistID
    }

    func perform() async throws -> some IntentResult {
        let value = playlistID.trimmingCharacters(in: .whitespacesAndNewlines)
        if !value.isEmpty {
            writeStatsWidgetData(Data(value.utf8), account: statsWidgetPlaylistSelectionKey)
        }
        return .result()
    }
}

@available(iOS 17.0, *)
struct PlayStatsPlaylistIntent: AudioPlaybackIntent {
    static let title: LocalizedStringResource = "Phát playlist"
    static let description = IntentDescription("Phát playlist này và thay hàng chờ hiện tại.")

    @Parameter(title: "Playlist ID")
    var playlistID: String

    init() {
        playlistID = ""
    }

    init(playlistID: String) {
        self.playlistID = playlistID
    }

    func perform() async throws -> some IntentResult {
        await playStatsWidgetPlaylist(playlistID, next: false)
        return .result()
    }
}

@available(iOS 17.0, *)
struct PlayStatsPlaylistNextIntent: AudioPlaybackIntent {
    static let title: LocalizedStringResource = "Phát playlist tiếp theo"
    static let description = IntentDescription("Thêm playlist này ngay sau bài đang phát.")

    @Parameter(title: "Playlist ID")
    var playlistID: String

    init() {
        playlistID = ""
    }

    init(playlistID: String) {
        self.playlistID = playlistID
    }

    func perform() async throws -> some IntentResult {
        await playStatsWidgetPlaylist(playlistID, next: true)
        return .result()
    }
}

@available(iOS 17.0, *)
struct PlayStatsUpcomingItemIntent: AudioPlaybackIntent {
    static let title: LocalizedStringResource = "Phát bài trong hàng chờ"
    static let description = IntentDescription("Chuyển tới một bài sắp phát mà không thay đổi hàng chờ Apple Music.")

    @Parameter(title: "Số bài cần chuyển")
    var steps: Int

    init() {
        steps = 1
    }

    init(steps: Int) {
        self.steps = steps
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        let player = MPMusicPlayerController.systemMusicPlayer
        let safeSteps = min(max(steps, 1), 40)
        for step in 0..<safeSteps {
            player.skipToNextItem()
            if step < safeSteps - 1 {
                try? await Task.sleep(nanoseconds: 160_000_000)
            }
        }
        player.play()
        writeStatsWidgetQueuePage(0)
        try? await Task.sleep(nanoseconds: 220_000_000)
        recordStatsWidgetPlayStart(player.nowPlayingItem)
        WidgetCenter.shared.reloadTimelines(ofKind: "StatsNowPlayingWidget")
        return .result()
    }
}

@available(iOS 17.0, *)
struct ChangeStatsQueuePageIntent: AppIntent {
    static let title: LocalizedStringResource = "Đổi trang hàng chờ"
    static let description = IntentDescription("Xem thêm các bài sắp phát trong widget Stats.")

    @Parameter(title: "Trang")
    var page: Int

    init() {
        page = 0
    }

    init(page: Int) {
        self.page = page
    }

    func perform() async throws -> some IntentResult {
        writeStatsWidgetQueuePage(page)
        WidgetCenter.shared.reloadTimelines(ofKind: "StatsNowPlayingWidget")
        return .result()
    }
}
