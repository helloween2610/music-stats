import AVFoundation
import Darwin
import Foundation
import MediaPlayer
import Security
import UIKit
import WidgetKit

private typealias QueueItemCountFunction = @convention(c) (AnyObject, Selector) -> UInt
private typealias QueueItemAtIndexFunction = @convention(c) (AnyObject, Selector, UInt) -> Unmanaged<AnyObject>?
private typealias QueueContextAtIndexFunction = @convention(c) (AnyObject, Selector, Int) -> Unmanaged<AnyObject>?
private typealias MediaRemoteSendCommandFunction = @convention(c) (Int, CFDictionary?) -> Bool

struct BridgePlaylistSummary: Codable {
    let id: String
    let name: String
    let trackCount: Int
    let favorite: Bool
}

struct BridgeTrackSummary: Codable {
    let id: String
    let persistentID: String
    let title: String
    let subtitle: String
    let year: String
    let lastPlayed: String?
}

struct BridgeNowPlaying: Codable {
    let title: String
    let subtitle: String
    let album: String
    let persistentID: String
    let trackID: String?
    let year: String
    let statsLine: String
    let inLibrary: Bool
    let scrobbles: Int?
    let listeners: Int?
    let plays: Int
    let minutes: Int
    let duration: Int
    let elapsed: Int
    let playing: Bool
}

struct BridgeQueueItem: Codable {
    let id: String
    let trackID: String?
    let title: String
    let artist: String
    let album: String
    let year: String
    let statsLine: String
    let lastPlayed: String?
    let inLibrary: Bool
    let scrobbles: Int?
    let listeners: Int?
    let plays: Int
    let minutes: Int
    let duration: Int
    let current: Bool
}

struct BridgePlayerState: Codable {
    let nowPlaying: BridgeNowPlaying
    let queue: [BridgeQueueItem]
    let currentIndex: Int
    let queueTitle: String
    let queueEditable: Bool
    let repeatMode: String
    let shuffleMode: String
    let recentPlayStarts: [String: String]
}

private struct LastfmTrackStats: Codable {
    let status: String
    let listeners: Int?
    let scrobbles: Int?
}

private struct SongChartResponse: Codable {
    let rows: [SongChartRow]
}

private struct SongChartRow: Codable {
    let track_id: String?
    let rank: Int?
    let plays: Int?
    let minutes: Int?
}

private struct SongHistoryResponse: Codable {
    let rows: [SongHistoryRow]
}

private struct SongHistoryRow: Codable {
    let track_id: String?
    let best: SongHistoryBest?
}

private struct SongHistoryBest: Codable {
    let rank: Int?
}

private struct LibraryTracksResponse: Codable {
    let rows: [LibraryTrackRow]
}

private struct LibraryTrackRow: Codable {
    let id: String
    let title: String
    let artist: String
    let album: String?
    let apple_pid: String?
}

private struct AllTimeSongRank {
    let rank: Int
    let change: Int?
    let plays: Int?
    let minutes: Int?
}

private struct StatsWidgetSnapshot: Codable {
    let title: String
    let artist: String
    let album: String
    let year: String
    let statsLine: String
    let plays: Int
    let minutes: Int
    let duration: Int?
    let elapsed: Int?
    let playing: Bool
    let repeatMode: String
    let queueTitle: String
    let queuePosition: Int
    let queueCount: Int
    let queueUpcomingDuration: Int
    let queue: [StatsWidgetQueueItem]
}

private struct StatsWidgetPlaylistItem: Codable {
    let id: String
    let name: String
    let path: String
    let rank: Int
    let plays: Int
    let trackCount: Int
    let hue: Double
}

private struct StatsWidgetQueueItem: Codable {
    let title: String
    let artist: String
    let year: String
    let statsLine: String
    let plays: Int
    let duration: Int
    let lastPlayed: String?
}

private struct BridgeRequestEvent {
    let path: String
    let fromPebble: Bool
    let at: Date
}

struct BridgeBootstrap: Codable {
    let playlists: [BridgePlaylistSummary]
    let nowPlaying: BridgeNowPlaying
}

struct BridgeMarkedTrack: Codable {
    let id: String
    let action: String
    let title: String
    let artist: String
    let album: String
    let year: String
    let statsLine: String
    let persistentID: String
    let inLibrary: Bool?
    let createdAt: String
}

struct NativeLibraryMetadata: Codable {
    let persistentId: String?
    let playbackStoreId: String?
    let releaseDate: String?
    let disc: Int?
    let discCount: Int?
    let trackCount: Int?
    let trackNumber: Int?
    let loved: Bool?
    let disliked: Bool?
    let albumRating: Int?
    let bpm: Int?
    let composer: String?
    let artworkCount: Int?
    let isCloudItem: Bool?
    let hasProtectedAsset: Bool?
    let albumPersistentID: String?
    let artistPersistentID: String?
    let albumArtistPersistentID: String?
    let genrePersistentID: String?
}

struct NativeLibraryTrack: Codable {
    let title: String
    let artist: String?
    let album: String?
    let albumArtist: String?
    let genre: String?
    let duration_s: Int?
    let year: Int?
    let date_added: String?
    let comments: String?
    let apple_plays: Int
    let apple_skips: Int
    let my_rating: Int?
    let last_played: String?
    let apple_pid: String?
    let catalog_id: String?
    let metadata: NativeLibraryMetadata
}

struct NativePlaylistTrack: Codable {
    let title: String
    let artist: String?
    let album: String?
    let albumArtist: String?
    let duration: Int?
    let year: Int?
    let persistentId: String?
    let inLibrary: Bool?
}

struct NativePlaylist: Codable {
    let id: String
    let name: String
    let folder: String
    let favourite: Bool
    let path: String
    let items: [String]
}

struct NativePlaylistSnapshot: Codable {
    let exportedAt: String?
    let folders: [String]
    let playlists: [NativePlaylist]
    let tracks: [String: NativePlaylistTrack]
}

struct NativeLibrarySyncPayload: Codable {
    let source: String
    let exportedAt: String
    let tracks: [NativeLibraryTrack]
    let playlists: NativePlaylistSnapshot
}

@MainActor
final class PebbleMusicBridge {
    static let shared = PebbleMusicBridge()

    private let player = MPMusicPlayerController.systemMusicPlayer
    private let favoritesKey = "pebbleFavoritePlaylistIDs"
    private let keepAliveKey = "pebbleBridgeKeepAliveEnabled"
    private let savedTracksKey = "pebbleSavedTracks"
    private let dislikedTracksKey = "pebbleDislikedTracks"
    private let managedQueueKey = "statsManagedQueuePersistentIDs"
    private let managedQueueTitleKey = "statsManagedQueueTitle"
    private let managedQueueIndexKey = "statsManagedQueueIndex"
    private let widgetKeychainService = "com.minlab.musicstats.widget"
    private let widgetKeychainAccessGroup = "AK73F5WL6J.com.minlab.musicstats.shared"
    private let widgetSnapshotKey = "statsWidgetSnapshot"
    private let widgetArtworkKey = "statsWidgetArtwork"
    private let widgetQueuePageKey = "statsWidgetQueuePage"
    private let widgetPlaylistsKey = "statsWidgetPlaylists"
    private let widgetPlaylistsBackupKey = "statsWidgetPlaylistsBackup"
    private let widgetPlaylistSelectionKey = "statsWidgetPlaylistSelection"
    private let widgetRecentPlayStartsKey = "statsRecentPlayStarts"
    private var playlistObjects: [UInt64: MPMediaPlaylist] = [:]
    private var favoriteIDs: Set<UInt64> = []
    private var libraryTrackIDs: Set<UInt64> = []
    private var libraryTrackKeys: Set<String> = []
    private var libraryItemsByID: [UInt64: MPMediaItem] = [:]
    private var lastfmStatsCache: [String: String] = [:]
    private var lastfmStatsByKey: [String: LastfmTrackStats] = [:]
    private var lastfmStatsLoading: Set<String> = []
    private var allTimeRankByTrackID: [String: AllTimeSongRank] = [:]
    private var allTimeTrackIDByPersistentHex: [String: String] = [:]
    private var allTimeTrackIDByKey: [String: String] = [:]
    private var allTimeTrackIDByArtistTitle: [String: String] = [:]
    private var allTimeRanksLoading = false
    private var allTimeRanksLoaded = false
    private var observers: [NSObjectProtocol] = []
    private var server: LocalMusicServer?
    private var serverWatchdog: Timer?
    private var audioEngine: AVAudioEngine?
    private var audioPlayerNode: AVAudioPlayerNode?
    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid
    private var lastPebbleRequestAt: Date?
    private var requestEvents: [BridgeRequestEvent] = []
    private var lastWatchBatteryPercent: Int?
    private var lastWatchBatteryAt: Date?

    private var nowTitle = "Nothing playing"
    private var nowSubtitle = "Choose playlist"
    private var nowYear = ""
    private var nowStatsLine = ""
    private var nowStatsKey = ""
    private var nowStatsItemInLibrary = true
    private var nowDuration = 0
    private var nowElapsed = 0
    private var isPlaying = false
    private var managedQueue: [MPMediaItem] = []
    private var managedQueueContentItemIDs: [String] = []
    private var managedQueueIndex = -1
    private var managedQueueTitle = "Hàng chờ"
    private var managedQueueEditable = false
    private var lastManagedQueueSetAt = Date.distantPast
    private var lastSystemQueueSignature = ""
    private var lastWidgetSignature = ""
    private var lastWidgetArtworkID = ""
    private var lastWidgetQueuePosition = -1
    private var lastRecordedPlayingPersistentID: UInt64?
    private var mediaRemoteHandle: UnsafeMutableRawPointer?

    private init() {}

    func start() {
        loadFavorites()
        configureBackgroundAudio()
        setupPlaybackObservers()
        refresh()
        refreshNowPlaying()
        requestMediaAccessIfNeeded()
        startServer()
        startServerWatchdog()

        if UserDefaults.standard.object(forKey: keepAliveKey) == nil {
            UserDefaults.standard.set(true, forKey: keepAliveKey)
        }
        if UserDefaults.standard.bool(forKey: keepAliveKey) {
            startKeepAliveAudio()
        }
    }

    func resumeBridge() {
        endBackgroundBridgeTask()
        configureBackgroundAudio()
        refreshNowPlaying()
        requestMediaAccessIfNeeded()
        startServer()
        server?.ensureRunning()
        startServerWatchdog()
        if keepAliveEnabled() {
            startKeepAliveAudio()
        }
    }

    func prepareForBackground() {
        configureBackgroundAudio()
        refreshNowPlaying()
        startServer()
        server?.ensureRunning()
        startServerWatchdog()
        if keepAliveEnabled() {
            startKeepAliveAudio()
        }
        beginBackgroundBridgeTask()
    }

    func noteBridgeRequest(path: String, fromPebble: Bool) {
        let now = Date()
        requestEvents.append(BridgeRequestEvent(path: path, fromPebble: fromPebble, at: now))
        let cutoff = now.addingTimeInterval(-300)
        requestEvents.removeAll { $0.at < cutoff }
        if fromPebble {
            lastPebbleRequestAt = now
        }
    }

    func notePebbleRequest() {
        lastPebbleRequestAt = Date()
    }

    func updateWatchHealth(batteryPercent: Int?) {
        if let batteryPercent {
            lastWatchBatteryPercent = min(100, max(0, batteryPercent))
            lastWatchBatteryAt = Date()
        }
    }

    func restartBridgeServer() {
        startServer()
        server?.restart()
        startServerWatchdog()
        if keepAliveEnabled() {
            startKeepAliveAudio()
        }
    }

    func health(serverReady: Bool) -> [String: Any] {
        let now = Date()
        let formatter = ISO8601DateFormatter()
        let lastPebbleRequest = lastPebbleRequestAt.map { formatter.string(from: $0) } ?? ""
        let lastPebbleRequestAge = lastPebbleRequestAt.map { Int(now.timeIntervalSince($0)) } ?? -1
        let watchBatteryAge = lastWatchBatteryAt.map { Int(now.timeIntervalSince($0)) } ?? -1
        let recentRequests = requestEvents.filter { now.timeIntervalSince($0.at) <= 60 }
        let recentPebbleRequests = recentRequests.filter(\.fromPebble)
        let requestsByPath = Dictionary(grouping: recentRequests, by: \.path).mapValues(\.count)
        let topRequest = requestsByPath.max { lhs, rhs in
            if lhs.value == rhs.value {
                return lhs.key > rhs.key
            }
            return lhs.value < rhs.value
        }
        var payload: [String: Any] = [
            "ok": true,
            "name": "PebbleMusicBridge",
            "serverReady": serverReady,
            "keepAlive": keepAliveEnabled(),
            "backgroundTaskActive": backgroundTask != .invalid,
            "backgroundTimeRemaining": Self.safeBackgroundTimeRemaining(),
            "lastPebbleRequest": lastPebbleRequest,
            "lastPebbleRequestAge": lastPebbleRequestAge,
            "watchBatteryAge": watchBatteryAge,
            "requestCount60s": recentRequests.count,
            "pebbleRequestCount60s": recentPebbleRequests.count,
            "topRequestPath60s": topRequest?.key ?? "",
            "topRequestCount60s": topRequest?.value ?? 0,
            "nowTitle": nowTitle,
            "nowArtist": nowSubtitle
        ]
        if let lastWatchBatteryPercent {
            payload["watchBatteryPercent"] = lastWatchBatteryPercent
        }
        return payload
    }

    func keepAliveEnabled() -> Bool {
        if UserDefaults.standard.object(forKey: keepAliveKey) == nil {
            UserDefaults.standard.set(true, forKey: keepAliveKey)
        }
        return UserDefaults.standard.bool(forKey: keepAliveKey)
    }

    func setKeepAliveEnabled(_ enabled: Bool) {
        UserDefaults.standard.set(enabled, forKey: keepAliveKey)
        enabled ? startKeepAliveAudio() : stopKeepAliveAudio()
    }

    func refresh() {
        guard MPMediaLibrary.authorizationStatus() == .authorized else {
            playlistObjects = [:]
            return
        }

        let collections = MPMediaQuery.playlists().collections as? [MPMediaPlaylist] ?? []
        playlistObjects = Dictionary(uniqueKeysWithValues: collections.map { ($0.persistentID, $0) })
        refreshLibraryTrackIndex()
        restoreManagedQueueIfNeeded()
    }

    func playlistsForPebble() -> [BridgePlaylistSummary] {
        refresh()
        let summaries = playlistObjects.values
            .map {
                BridgePlaylistSummary(
                    id: String($0.persistentID),
                    name: $0.name?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty ?? "Untitled Playlist",
                    trackCount: $0.items.count,
                    favorite: favoriteIDs.contains($0.persistentID)
                )
            }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }

        return summaries.filter { UInt64($0.id).map(favoriteIDs.contains) ?? false }
    }

    func allPlaylists() -> [BridgePlaylistSummary] {
        refresh()
        return playlistObjects.values
            .map {
                BridgePlaylistSummary(
                    id: String($0.persistentID),
                    name: $0.name?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty ?? "Untitled Playlist",
                    trackCount: $0.items.count,
                    favorite: favoriteIDs.contains($0.persistentID)
                )
            }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    func tracks(playlistID: UInt64) -> [BridgeTrackSummary] {
        let playlist = playlistObjects[playlistID] ?? (MPMediaQuery.playlists().collections as? [MPMediaPlaylist])?
            .first(where: { $0.persistentID == playlistID })
        let starts = recentPlayStarts()
        return playlist?.items.map { item in
            let recordedStart = starts[Self.persistentHex(item.persistentID)].flatMap(ISO8601DateFormatter().date)
            let latestPlayed = [item.lastPlayedDate, recordedStart]
                .compactMap { $0 }
                .max()
            return BridgeTrackSummary(
                id: String(item.persistentID),
                persistentID: Self.persistentHex(item.persistentID),
                title: item.title?.nonEmpty ?? "Untitled Song",
                subtitle: item.artist?.nonEmpty ?? "",
                year: Self.releaseYear(item),
                lastPlayed: latestPlayed.map(Self.isoString)
            )
        } ?? []
    }

    func bootstrap() -> BridgeBootstrap {
        BridgeBootstrap(playlists: playlistsForPebble(), nowPlaying: nowPlaying())
    }

    func nowPlaying(refreshQueue: Bool = true) -> BridgeNowPlaying {
        refreshNowPlaying(refreshQueue: refreshQueue)
        let item = player.nowPlayingItem
        let lastfm = nowStatsItemInLibrary ? nil : lastfmStatsByKey[nowStatsKey]
        let metrics = item.map { item in
            allTimeMetrics(for: item, key: Self.trackKey(artist: item.artist ?? "", album: item.albumTitle, title: item.title ?? ""))
        }
        return BridgeNowPlaying(
            title: nowTitle,
            subtitle: nowSubtitle,
            album: item?.albumTitle?.nonEmpty ?? "",
            persistentID: item.map { $0.persistentID == 0 ? "" : Self.persistentHex($0.persistentID) } ?? "",
            trackID: item.flatMap { trackID(for: $0, key: Self.trackKey(artist: $0.artist ?? "", album: $0.albumTitle, title: $0.title ?? "")) },
            year: nowYear,
            statsLine: nowStatsLine,
            inLibrary: nowStatsItemInLibrary,
            scrobbles: lastfm?.scrobbles,
            listeners: lastfm?.listeners,
            plays: metrics?.plays ?? 0,
            minutes: metrics?.minutes ?? 0,
            duration: nowDuration,
            elapsed: nowElapsed,
            playing: isPlaying
        )
    }

    private(set) var playerStateTiming = ""
    private var cachedPlayerState: BridgePlayerState?
    private var cachedSystemQueueCount: UInt = 0
    private var cachedSystemQueueIndex = -1

    func playerState(includeQueue: Bool = true) -> BridgePlayerState {
        let timingStart = ProcessInfo.processInfo.systemUptime
        let now = nowPlaying(refreshQueue: false)
        let timingNow = ProcessInfo.processInfo.systemUptime
        // Polling elapsed time must not enumerate hundreds of MediaPlayer objects on the UI thread.
        if !includeQueue, let cached = cachedPlayerState,
           cached.nowPlaying.persistentID == now.persistentID,
           cached.nowPlaying.title == now.title,
           cached.nowPlaying.subtitle == now.subtitle,
           cached.nowPlaying.album == now.album,
           !systemQueuePositionChanged() {
            playerStateTiming = String(format: "now;dur=%.2f, queue;dur=%.2f, rows;dur=0", (timingNow - timingStart) * 1000, (ProcessInfo.processInfo.systemUptime - timingNow) * 1000)
            return BridgePlayerState(
                nowPlaying: now, queue: cached.queue, currentIndex: cached.currentIndex,
                queueTitle: cached.queueTitle, queueEditable: cached.queueEditable,
                repeatMode: player.repeatMode == .one ? "one" : player.repeatMode == .all ? "all" : "none",
                shuffleMode: player.shuffleMode == .songs ? "songs" : "off",
                recentPlayStarts: cached.recentPlayStarts
            )
        }
        refreshSystemQueueIfAvailable()
        syncManagedQueueIndex()
        let timingQueue = ProcessInfo.processInfo.systemUptime
        if libraryTrackIDs.isEmpty, MPMediaLibrary.authorizationStatus() == .authorized {
            refreshLibraryTrackIndex()
        }
        let starts = recentPlayStarts()
        let rows = managedQueue.enumerated().map { index, item in
            let key = Self.trackKey(artist: item.artist ?? "", album: item.albumTitle, title: item.title ?? "")
            let inLibrary = isInLibrary(item, key: key)
            if !inLibrary, let artist = item.artist?.nonEmpty, let title = item.title?.nonEmpty {
                fetchLastfmStatsIfNeeded(key: key, artist: artist, title: title)
            }
            let metrics = allTimeMetrics(for: item, key: key)
            let lastfm = inLibrary ? nil : lastfmStatsByKey[key]
            let playedStart = starts[Self.persistentHex(item.persistentID)].flatMap(ISO8601DateFormatter().date)
            let libraryItem = libraryItemsByID[item.persistentID]
            let lastPlayed = inLibrary
                ? [item.lastPlayedDate, libraryItem?.lastPlayedDate, playedStart].compactMap { $0 }.max()
                : nil
            return BridgeQueueItem(
                id: item.persistentID == 0 ? "" : Self.persistentHex(item.persistentID),
                trackID: trackID(for: item, key: key),
                title: item.title?.nonEmpty ?? "Untitled Song",
                artist: item.artist?.nonEmpty ?? "",
                album: item.albumTitle?.nonEmpty ?? "",
                year: Self.releaseYear(item),
                statsLine: inLibrary ? allTimeRankLine(for: item, key: key) ?? "" : "",
                lastPlayed: lastPlayed.map(Self.isoString),
                inLibrary: inLibrary,
                scrobbles: lastfm?.scrobbles,
                listeners: lastfm?.listeners,
                plays: metrics.plays,
                minutes: metrics.minutes,
                duration: item.playbackDuration.isFinite ? Int(item.playbackDuration) : 0,
                current: index == managedQueueIndex
            )
        }
        let timingRows = ProcessInfo.processInfo.systemUptime
        playerStateTiming = String(format: "now;dur=%.2f, queue;dur=%.2f, rows;dur=%.2f", (timingNow - timingStart) * 1000, (timingQueue - timingNow) * 1000, (timingRows - timingQueue) * 1000)
        let repeatMode = player.repeatMode == .one ? "one" : player.repeatMode == .all ? "all" : "none"
        let shuffleMode = player.shuffleMode == .songs ? "songs" : "off"
        let state = BridgePlayerState(
            nowPlaying: now,
            queue: rows,
            currentIndex: managedQueueIndex,
            queueTitle: managedQueueTitle,
            queueEditable: managedQueueEditable,
            repeatMode: repeatMode,
            shuffleMode: shuffleMode,
            recentPlayStarts: recentPlayStarts()
        )
        cachedPlayerState = state
        publishWidgetSnapshot(item: player.nowPlayingItem)
        return state
    }

    func artworkData(persistentID: UInt64, size: CGFloat = 360) -> Data? {
        guard let item = libraryItem(persistentID: persistentID),
              let image = item.artwork?.image(at: CGSize(width: size, height: size)) else { return nil }
        return image.jpegData(compressionQuality: 0.86)
    }

    func play(playlistID: UInt64, trackID: UInt64?, trackArtist: String? = nil, trackTitle: String? = nil, action: String = "play") async -> Bool {
        refresh()
        guard let playlist = playlistObjects[playlistID] else { return false }

        let descriptor: MPMusicPlayerMediaItemQueueDescriptor
        let wantedArtist = Self.normalizedKeyPart(trackArtist ?? "")
        let wantedTitle = Self.normalizedKeyPart(trackTitle ?? "")
        let startTrack = trackID.flatMap { id in playlist.items.first(where: { $0.persistentID == id }) }
            ?? playlist.items.first(where: { item in
                guard !wantedTitle.isEmpty, Self.normalizedKeyPart(item.title ?? "") == wantedTitle else { return false }
                return wantedArtist.isEmpty || Self.normalizedKeyPart(item.artist ?? "") == wantedArtist
            })
        if let track = startTrack {
            if action == "play" {
                descriptor = MPMusicPlayerMediaItemQueueDescriptor(itemCollection: playlist)
                descriptor.startItem = track
            } else {
                descriptor = MPMusicPlayerMediaItemQueueDescriptor(itemCollection: MPMediaItemCollection(items: [track]))
            }
        } else {
            descriptor = MPMusicPlayerMediaItemQueueDescriptor(itemCollection: playlist)
        }

        let items = playlist.items
        let startIndex = startTrack.flatMap { track in items.firstIndex(where: { $0.persistentID == track.persistentID }) } ?? 0
        switch action {
        case "play":
            guard await prepareAndPlayManagedQueue(items, startIndex: startIndex, title: playlist.name?.nonEmpty ?? "Playlist") else { return false }
        case "next":
            if player.nowPlayingItem == nil {
                setManagedQueue(items, startIndex: startIndex, title: playlist.name?.nonEmpty ?? "Playlist")
            } else {
                player.prepend(descriptor)
                insertManagedQueue(items, afterCurrent: true)
            }
        case "last":
            if player.nowPlayingItem == nil {
                setManagedQueue(items, startIndex: startIndex)
            } else {
                player.append(descriptor)
                insertManagedQueue(items, afterCurrent: false)
            }
        default:
            return false
        }

        refreshNowPlaying()
        return true
    }

    private func prepareAndPlayManagedQueue(_ items: [MPMediaItem], startIndex: Int, title: String) async -> Bool {
        guard !items.isEmpty else { return false }
        let safeIndex = min(max(startIndex, 0), items.count - 1)
        let descriptor = MPMusicPlayerMediaItemQueueDescriptor(itemCollection: MPMediaItemCollection(items: items))
        descriptor.startItem = items[safeIndex]
        player.setQueue(with: descriptor)
        let prepared = await withCheckedContinuation { continuation in
            player.prepareToPlay { error in continuation.resume(returning: error == nil) }
        }
        guard prepared else {
            refreshNowPlaying()
            return false
        }
        managedQueue = items
        managedQueueContentItemIDs = []
        managedQueueIndex = safeIndex
        managedQueueEditable = true
        managedQueueTitle = title
        lastManagedQueueSetAt = Date()
        saveManagedQueue()
        player.play()
        refreshNowPlaying()
        return true
    }

    func openPlaylist(playlistID: UInt64) -> Bool {
        refresh()
        guard let playlist = playlistObjects[playlistID] else { return false }
        let cloudID = playlist.cloudGlobalID?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !cloudID.isEmpty,
              let encoded = cloudID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) else {
            return false
        }
        guard let url = URL(string: "music://music.apple.com/library/playlist/\(encoded)") else {
            return false
        }
        UIApplication.shared.open(url)
        return true
    }

    func addTrackToPlaylist(playlistID: UInt64, persistentID rawPersistentID: String?, storeID rawStoreID: String?, artist: String?, title: String?, album: String?) async -> HTTPResponse {
        guard await ensureMediaAccess() else {
            return .json(["error": "Bạn chưa cấp quyền Apple Music cho app Stats."], status: 403)
        }
        refresh()
        guard let playlist = playlistObjects[playlistID] else {
            return .json(["error": "Không tìm thấy playlist A_Recommend songs trên iPhone."], status: 404)
        }
        let item = rawPersistentID.flatMap(Self.parsePersistentID).flatMap { libraryItem(persistentID: $0) }
            ?? libraryItem(artist: artist, title: title, album: album)
        if let item {
            if playlist.items.contains(where: { $0.persistentID == item.persistentID }) {
                return .json(["ok": true, "alreadyInPlaylist": true])
            }
            return await withCheckedContinuation { continuation in
                playlist.add([item]) { [weak self] error in
                    Task { @MainActor in
                        if let error {
                            continuation.resume(returning: .json(["error": error.localizedDescription], status: 400))
                            return
                        }
                        self?.refresh()
                        continuation.resume(returning: .json(["ok": true, "added": 1]))
                    }
                }
            }
        }
        guard let storeID = Self.cleanStoreID(rawStoreID) else {
            return .json(["error": "Bài này chưa có ID Apple Music để thêm vào playlist."], status: 400)
        }
        if playlist.items.contains(where: { Self.cleanStoreID($0.playbackStoreID) == storeID }) {
            return .json(["ok": true, "alreadyInPlaylist": true])
        }
        return await withCheckedContinuation { continuation in
            playlist.addItem(withProductID: storeID) { [weak self] error in
                Task { @MainActor in
                    if let error {
                        continuation.resume(returning: .json(["error": error.localizedDescription], status: 400))
                        return
                    }
                    self?.refresh()
                    continuation.resume(returning: .json(["ok": true, "added": 1]))
                }
            }
        }
    }

    func playLibraryTrack(persistentID rawPersistentID: String?, storeID rawStoreID: String?, artist: String?, title: String?, album: String?, action: String) -> Bool {
        guard MPMediaLibrary.authorizationStatus() == .authorized else { return false }
        let itemFromID = rawPersistentID
            .flatMap(Self.parsePersistentID)
            .flatMap { libraryItem(persistentID: $0) }
        let item = itemFromID ?? libraryItem(artist: artist, title: title, album: album)
        let descriptor: MPMusicPlayerQueueDescriptor
        if let item {
            descriptor = MPMusicPlayerMediaItemQueueDescriptor(itemCollection: MPMediaItemCollection(items: [item]))
        } else if let storeID = Self.cleanStoreID(rawStoreID) {
            descriptor = MPMusicPlayerStoreQueueDescriptor(storeIDs: [storeID])
        } else {
            return false
        }
        switch action {
        case "play":
            if let item {
                setManagedQueue([item], startIndex: 0, title: item.albumTitle?.nonEmpty ?? "Một bài")
            } else {
                player.setQueue(with: descriptor)
                player.play()
                managedQueue = []
                managedQueueIndex = -1
                saveManagedQueue()
            }
        case "playpause":
            if let item,
               let current = player.nowPlayingItem,
               current.persistentID == item.persistentID {
                isPlaying ? player.pause() : player.play()
            } else if let item {
                setManagedQueue([item], startIndex: 0, title: item.albumTitle?.nonEmpty ?? "Một bài")
            } else {
                player.setQueue(with: descriptor)
                player.play()
                managedQueue = []
                managedQueueIndex = -1
                saveManagedQueue()
            }
        case "next":
            if player.nowPlayingItem == nil {
                if let item {
                    setManagedQueue([item], startIndex: 0, title: item.albumTitle?.nonEmpty ?? "Một bài")
                } else {
                    player.setQueue(with: descriptor)
                    player.play()
                }
            } else {
                player.prepend(descriptor)
                if let item { insertManagedQueue([item], afterCurrent: true) }
            }
        case "last":
            if player.nowPlayingItem == nil {
                if let item {
                    setManagedQueue([item], startIndex: 0, title: item.albumTitle?.nonEmpty ?? "Một bài")
                } else {
                    player.setQueue(with: descriptor)
                    player.play()
                }
            } else {
                player.append(descriptor)
                if let item { insertManagedQueue([item], afterCurrent: false) }
            }
        default:
            return false
        }
        refreshNowPlaying()
        return true
    }

    func playLibraryAlbum(artist: String?, album: String, startPersistentID: UInt64? = nil, startTitle: String? = nil, action: String) -> Bool {
        guard MPMediaLibrary.authorizationStatus() == .authorized,
              let collection = libraryAlbum(artist: artist, title: album) else { return false }
        let descriptor = MPMusicPlayerMediaItemQueueDescriptor(itemCollection: collection)
        let wantedTitle = Self.normalizedKeyPart(startTitle ?? "")
        descriptor.startItem = startPersistentID.flatMap { id in collection.items.first(where: { $0.persistentID == id }) }
            ?? collection.items.first(where: { !wantedTitle.isEmpty && Self.normalizedKeyPart($0.title ?? "") == wantedTitle })
        switch action {
        case "play":
            let startIndex = descriptor.startItem.flatMap { start in collection.items.firstIndex(where: { $0.persistentID == start.persistentID }) } ?? 0
            setManagedQueue(collection.items, startIndex: startIndex, title: album)
        case "next":
            if player.nowPlayingItem == nil {
                let startIndex = descriptor.startItem.flatMap { start in collection.items.firstIndex(where: { $0.persistentID == start.persistentID }) } ?? 0
                setManagedQueue(collection.items, startIndex: startIndex, title: album)
            } else {
                player.prepend(descriptor)
                insertManagedQueue(collection.items, afterCurrent: true)
            }
        default:
            return false
        }
        refreshNowPlaying()
        return true
    }

    func playLibraryQueue(persistentIDs: [UInt64]) -> Bool {
        guard MPMediaLibrary.authorizationStatus() == .authorized else { return false }
        let items = persistentIDs.compactMap { libraryItem(persistentID: $0) }
        guard !items.isEmpty else { return false }
        setManagedQueue(items, startIndex: 0, title: "Danh sách")
        return true
    }

    func playManagedQueue(at index: Int) -> Bool {
        guard managedQueueEditable, managedQueue.indices.contains(index) else { return false }
        setManagedQueue(managedQueue, startIndex: index)
        return true
    }

    func moveManagedQueue(from: Int, to: Int) async -> Bool {
        guard managedQueueEditable,
              managedQueue.indices.contains(from),
              managedQueue.indices.contains(to),
              from != to,
              from != managedQueueIndex,
              to > managedQueueIndex else { return false }
        refreshNowPlaying()
        let current = player.nowPlayingItem
        let elapsed = player.currentPlaybackTime
        let wasPlaying = player.playbackState == .playing
        var reordered = managedQueue
        let moved = reordered.remove(at: from)
        reordered.insert(moved, at: to)
        if await reorderSystemQueue(from: from, to: to) {
            return true
        }
        managedQueue = reordered
        managedQueueContentItemIDs = []
        let index = current.flatMap { currentItem in managedQueue.firstIndex(where: { Self.sameMediaItem($0, currentItem) }) } ?? min(to, managedQueue.count - 1)
        return await rebuildManagedQueue(startIndex: index, shouldPlay: wasPlaying, resumeAt: elapsed)
    }

    func removeManagedQueueItem(at index: Int) async -> Bool {
        guard managedQueueEditable, managedQueue.indices.contains(index), index != managedQueueIndex else { return false }
        refreshNowPlaying()
        let current = player.nowPlayingItem
        let elapsed = player.currentPlaybackTime
        let wasPlaying = player.playbackState == .playing
        if await removeSystemQueueItem(at: index) {
            return true
        }
        let removedCurrent = current.map { Self.sameMediaItem(managedQueue[index], $0) } ?? false
        managedQueue.remove(at: index)
        managedQueueContentItemIDs = []
        guard !managedQueue.isEmpty else {
            player.stop()
            managedQueueIndex = -1
            saveManagedQueue()
            refreshNowPlaying()
            return true
        }
        let nextIndex = current.flatMap { currentItem in managedQueue.firstIndex(where: { Self.sameMediaItem($0, currentItem) }) }
            ?? min(index, managedQueue.count - 1)
        return await rebuildManagedQueue(startIndex: nextIndex, shouldPlay: wasPlaying, resumeAt: removedCurrent ? nil : elapsed)
    }

    func seek(to seconds: Double) -> Bool {
        guard seconds.isFinite, seconds >= 0, player.nowPlayingItem != nil else { return false }
        let duration = player.nowPlayingItem?.playbackDuration ?? 0
        player.currentPlaybackTime = duration > 0 ? min(seconds, duration) : seconds
        refreshNowPlaying()
        return true
    }

    func addLibraryTrack(storeID rawStoreID: String?, artist: String?, title: String?, album: String?) async -> HTTPResponse {
        guard await ensureMediaAccess() else {
            return .json(["error": "Bạn chưa cấp quyền Apple Music cho app Stats."], status: 403)
        }
        if libraryItem(artist: artist, title: title, album: album) != nil {
            return .json(["ok": true, "alreadyInLibrary": true])
        }
        guard let storeID = Self.cleanStoreID(rawStoreID) else {
            return .json(["error": "Chưa có ID Apple Music để thêm bài này."], status: 400)
        }
        return await withCheckedContinuation { continuation in
            MPMediaLibrary.default().addItem(withProductID: storeID) { [weak self] entities, error in
                Task { @MainActor in
                    if let error {
                        continuation.resume(returning: .json(["error": error.localizedDescription], status: 400))
                        return
                    }
                    self?.refresh()
                    continuation.resume(returning: .json(["ok": true, "added": entities.count]))
                }
            }
        }
    }

    func addCurrentTrackToLibrary() async -> HTTPResponse {
        refreshNowPlaying()
        guard let item = player.nowPlayingItem,
              let title = item.title?.nonEmpty else {
            return .json(["error": "Không có bài đang phát."], status: 400)
        }
        return await addLibraryTrack(
            storeID: item.playbackStoreID,
            artist: item.artist,
            title: title,
            album: item.albumTitle
        )
    }

    func syncLibraryToStats(apiBase: String, token: String) async -> HTTPResponse {
        guard await ensureMediaAccess() else {
            return .json(["error": "Bạn chưa cấp quyền Apple Music cho app Stats."], status: 403)
        }
        guard let base = URL(string: apiBase), ["https", "http"].contains(base.scheme?.lowercased() ?? "") else {
            return .json(["error": "API không hợp lệ"], status: 400)
        }

        refresh()
        let items = MPMediaQuery.songs().items ?? []
        let tracks = items.compactMap(Self.nativeTrack)
        guard !tracks.isEmpty else {
            return .json(["error": "Không đọc được bài hát nào trong Apple Music Library."], status: 400)
        }
        let payload = NativeLibrarySyncPayload(
            source: "ios-media-library",
            exportedAt: Self.isoString(Date()),
            tracks: tracks,
            playlists: Self.nativePlaylistSnapshot(playlists: Array(playlistObjects.values), exportedAt: Self.isoString(Date()))
        )

        do {
            var url = base
            url.appendPathComponent("library/native-sync")
            var request = URLRequest(url: url, timeoutInterval: 120)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            request.httpBody = try JSONEncoder().encode(payload)
            let (data, response) = try await URLSession.shared.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 502
            if (200..<300).contains(status) {
                allTimeRanksLoaded = false
                allTimeRankByTrackID = [:]
                return .rawJSON(data, status: status)
            }
            let message = Self.serverErrorMessage(data) ?? "Không nhập được thư viện vào server Stats."
            return .json(["error": message], status: status)
        } catch {
            return .json(["error": "Không gửi được thư viện lên server Stats."], status: 502)
        }
    }

    func control(_ action: String) -> Bool {
        switch action {
        case "playpause":
            isPlaying ? player.pause() : player.play()
        case "next":
            player.skipToNextItem()
        case "previous":
            player.skipToPreviousItem()
        case "play":
            player.play()
        case "pause":
            player.pause()
        case "repeat":
            switch player.repeatMode {
            case .all: player.repeatMode = .one
            case .one: player.repeatMode = .none
            default: player.repeatMode = .all
            }
        case "shuffle":
            player.shuffleMode = player.shuffleMode == .songs ? .off : .songs
        default:
            return false
        }
        refreshNowPlaying()
        return true
    }

    func updateWidgetPlaylists(payload: String) -> Bool {
        guard let data = payload.data(using: .utf8),
              let decoded = try? JSONDecoder().decode([StatsWidgetPlaylistItem].self, from: data) else {
            return false
        }
        let playlists = Array(decoded.prefix(4)).filter {
            !$0.id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            !$0.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
        guard !playlists.isEmpty else { return true }
        guard let encoded = try? JSONEncoder().encode(playlists) else { return false }
        writeWidgetData(encoded, account: widgetPlaylistsKey)
        writeWidgetData(encoded, account: widgetPlaylistsBackupKey)
        WidgetCenter.shared.reloadTimelines(ofKind: "StatsNowPlayingWidget")
        return true
    }

    func consumeWidgetPlaylistSelection() -> String {
        let value = readWidgetData(account: widgetPlaylistSelectionKey)
            .flatMap { String(data: $0, encoding: .utf8) } ?? ""
        writeWidgetData(nil, account: widgetPlaylistSelectionKey)
        return value
    }

    func seekForward(seconds: Double) -> Bool {
        guard seconds > 0 else { return false }
        let current = player.currentPlaybackTime.isFinite ? player.currentPlaybackTime : 0
        let duration = player.nowPlayingItem?.playbackDuration ?? 0
        let target = duration > 0 ? min(current + seconds, max(duration - 1, 0)) : current + seconds
        player.currentPlaybackTime = max(target, 0)
        refreshNowPlaying()
        return true
    }

    func setFavorite(playlistID: UInt64, enabled: Bool) {
        if enabled {
            favoriteIDs.insert(playlistID)
        } else {
            favoriteIDs.remove(playlistID)
        }
        saveFavorites()
    }

    func markCurrentTrack(action: String) -> Bool {
        guard action == "save" || action == "dislike",
              let item = player.nowPlayingItem,
              let title = item.title?.nonEmpty else { return false }

        refreshNowPlaying()
        let artist = item.artist?.nonEmpty ?? ""
        let trackKey = Self.trackKey(artist: artist, album: item.albumTitle, title: title)
        let inLibrary = isInLibrary(item, key: trackKey)
        let mark = BridgeMarkedTrack(
            id: UUID().uuidString,
            action: action,
            title: title,
            artist: artist,
            album: item.albumTitle?.nonEmpty ?? "",
            year: Self.releaseYear(item),
            statsLine: nowStatsLine,
            persistentID: item.persistentID == 0 ? "" : String(item.persistentID),
            inLibrary: inLibrary,
            createdAt: ISO8601DateFormatter().string(from: Date())
        )

        let key = action == "save" ? savedTracksKey : dislikedTracksKey
        var rows = markedTracks(action: action)
        rows.removeAll { existing in
            if !mark.persistentID.isEmpty, existing.persistentID == mark.persistentID { return true }
            return Self.normalizedKeyPart(existing.artist) == Self.normalizedKeyPart(mark.artist)
                && Self.normalizedKeyPart(existing.title) == Self.normalizedKeyPart(mark.title)
        }
        rows.insert(mark, at: 0)
        if rows.count > 200 {
            rows = Array(rows.prefix(200))
        }
        saveMarkedTracks(rows, key: key)
        if action == "dislike" {
            player.skipToNextItem()
            refreshNowPlaying()
        }
        return true
    }

    func markedTracks(action: String) -> [BridgeMarkedTrack] {
        let key = action == "dislike" ? dislikedTracksKey : savedTracksKey
        guard let data = UserDefaults.standard.data(forKey: key),
              let rows = try? JSONDecoder().decode([BridgeMarkedTrack].self, from: data) else { return [] }
        return rows
    }

    func openMarkedTrack(action: String, id: String) -> Bool {
        guard let track = markedTracks(action: action).first(where: { $0.id == id }) else { return false }
        let query = [track.artist, track.title].filter { !$0.isEmpty }.joined(separator: " ")
        guard !query.isEmpty else { return false }

        var components = URLComponents()
        components.scheme = "music"
        components.host = "music.apple.com"
        components.path = "/search"
        components.queryItems = [URLQueryItem(name: "term", value: query)]

        guard let url = components.url else { return false }
        UIApplication.shared.open(url)
        return true
    }

    private func saveMarkedTracks(_ rows: [BridgeMarkedTrack], key: String) {
        if let data = try? JSONEncoder().encode(rows) {
            UserDefaults.standard.set(data, forKey: key)
        }
    }

    private func requestMediaAccessIfNeeded() {
        switch MPMediaLibrary.authorizationStatus() {
        case .authorized:
            refresh()
        case .notDetermined:
            MPMediaLibrary.requestAuthorization { [weak self] status in
                guard status == .authorized else { return }
                Task { @MainActor in self?.refresh() }
            }
        default:
            break
        }
    }

    private func ensureMediaAccess() async -> Bool {
        switch MPMediaLibrary.authorizationStatus() {
        case .authorized:
            refresh()
            return true
        case .notDetermined:
            return await withCheckedContinuation { continuation in
                MPMediaLibrary.requestAuthorization { [weak self] status in
                    Task { @MainActor in
                        if status == .authorized {
                            self?.refresh()
                            continuation.resume(returning: true)
                        } else {
                            continuation.resume(returning: false)
                        }
                    }
                }
            }
        default:
            return false
        }
    }

    private static func nativeTrack(_ item: MPMediaItem) -> NativeLibraryTrack? {
        guard let title = item.title?.nonEmpty else { return nil }
        let releaseDate = item.releaseDate
        let metadata = NativeLibraryMetadata(
            persistentId: item.persistentID == 0 ? nil : persistentHex(item.persistentID),
            playbackStoreId: cleanStoreID(item.playbackStoreID),
            releaseDate: releaseDate.map(dayString),
            disc: positive(item.discNumber),
            discCount: positive(item.discCount),
            trackCount: positive(item.albumTrackCount),
            trackNumber: positive(item.albumTrackNumber),
            loved: nil,
            disliked: nil,
            albumRating: nil,
            bpm: positive(item.beatsPerMinute),
            composer: item.composer?.nonEmpty,
            artworkCount: item.artwork == nil ? 0 : 1,
            isCloudItem: item.isCloudItem,
            hasProtectedAsset: item.hasProtectedAsset,
            albumPersistentID: item.albumPersistentID == 0 ? nil : persistentHex(item.albumPersistentID),
            artistPersistentID: item.artistPersistentID == 0 ? nil : persistentHex(item.artistPersistentID),
            albumArtistPersistentID: item.albumArtistPersistentID == 0 ? nil : persistentHex(item.albumArtistPersistentID),
            genrePersistentID: item.genrePersistentID == 0 ? nil : persistentHex(item.genrePersistentID)
        )
        let year = releaseDate.map { Calendar.current.component(.year, from: $0) }.flatMap { $0 > 0 ? $0 : nil }
        let duration = item.playbackDuration.isFinite && item.playbackDuration > 0 ? Int(item.playbackDuration.rounded()) : nil
        return NativeLibraryTrack(
            title: title,
            artist: item.artist?.nonEmpty,
            album: item.albumTitle?.nonEmpty,
            albumArtist: item.albumArtist?.nonEmpty,
            genre: item.genre?.nonEmpty,
            duration_s: duration,
            year: year,
            date_added: localMinuteString(item.dateAdded),
            comments: item.comments?.nonEmpty,
            apple_plays: item.playCount,
            apple_skips: item.skipCount,
            my_rating: item.rating == 0 ? nil : item.rating,
            last_played: localMinuteString(item.lastPlayedDate),
            apple_pid: item.persistentID == 0 ? nil : persistentHex(item.persistentID),
            catalog_id: cleanStoreID(item.playbackStoreID),
            metadata: metadata
        )
    }

    private static func nativePlaylistSnapshot(playlists: [MPMediaPlaylist], exportedAt: String) -> NativePlaylistSnapshot {
        var trackMap: [String: NativePlaylistTrack] = [:]
        let rows = playlists
            .filter { !$0.items.isEmpty }
            .map { playlist -> NativePlaylist in
                let items = playlist.items.compactMap { item -> String? in
                    guard item.persistentID != 0 else { return nil }
                    let id = persistentHex(item.persistentID)
                    if trackMap[id] == nil {
                        trackMap[id] = NativePlaylistTrack(
                            title: item.title?.nonEmpty ?? "Untitled Song",
                            artist: item.artist?.nonEmpty,
                            album: item.albumTitle?.nonEmpty,
                            albumArtist: item.albumArtist?.nonEmpty,
                            duration: item.playbackDuration.isFinite && item.playbackDuration > 0 ? Int(item.playbackDuration.rounded()) : nil,
                            year: item.releaseDate.map { Calendar.current.component(.year, from: $0) },
                            persistentId: id,
                            inLibrary: true
                        )
                    }
                    return id
                }
                let name = playlist.name?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty ?? "Untitled Playlist"
                return NativePlaylist(
                    id: playlist.persistentID == 0 ? name : String(playlist.persistentID),
                    name: name,
                    folder: "Apple Music",
                    favourite: favoritePlaylistHint(playlist),
                    path: "Apple Music",
                    items: items
                )
            }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        return NativePlaylistSnapshot(exportedAt: exportedAt, folders: ["Apple Music"], playlists: rows, tracks: trackMap)
    }

    private static func favoritePlaylistHint(_ playlist: MPMediaPlaylist) -> Bool {
        // MediaPlayer does not expose the Music app's folder tree; keep a stable
        // playlist snapshot and let the web UI group these under Apple Music.
        playlist.playlistAttributes.contains(.onTheGo)
    }

    private func configureBackgroundAudio() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default, options: [.mixWithOthers, .allowAirPlay])
            try session.setActive(true)
        } catch {
            // The bridge can still work while foregrounded.
        }
    }

    private static func safeBackgroundTimeRemaining() -> Int {
        let remaining = UIApplication.shared.backgroundTimeRemaining
        guard remaining.isFinite else { return -1 }
        if remaining >= 86_400 {
            return -1
        }
        return max(0, Int(remaining))
    }

    private func startKeepAliveAudio() {
        if let audioEngine {
            if audioEngine.isRunning {
                if audioPlayerNode?.isPlaying != true {
                    audioPlayerNode?.play()
                }
                return
            }
            audioEngine.stop()
            self.audioEngine = nil
            audioPlayerNode = nil
        }
        do {
            try AVAudioSession.sharedInstance().setActive(true)
            let engine = AVAudioEngine()
            let node = AVAudioPlayerNode()
            let format = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 1)!
            let frameCount = AVAudioFrameCount(format.sampleRate)
            guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else { return }
            buffer.frameLength = frameCount
            if let channel = buffer.floatChannelData?[0] {
                for frame in 0..<Int(frameCount) {
                    channel[frame] = 0
                }
            }
            engine.attach(node)
            engine.connect(node, to: engine.mainMixerNode, format: format)
            node.scheduleBuffer(buffer, at: nil, options: [.loops])
            try engine.start()
            node.play()
            audioEngine = engine
            audioPlayerNode = node
        } catch {
            UserDefaults.standard.set(false, forKey: keepAliveKey)
        }
    }

    private func stopKeepAliveAudio() {
        audioPlayerNode?.stop()
        audioEngine?.stop()
        audioPlayerNode = nil
        audioEngine = nil
    }

    private func startServer() {
        if server == nil {
            server = LocalMusicServer(model: self)
        }
        server?.start()
    }

    private func startServerWatchdog() {
        guard serverWatchdog == nil else { return }
        let timer = Timer(timeInterval: 45, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.server?.ensureRunning()
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        serverWatchdog = timer
    }

    private func beginBackgroundBridgeTask() {
        guard backgroundTask == .invalid else { return }
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "PebbleBridgeKeepAlive") { [weak self] in
            Task { @MainActor in
                self?.endBackgroundBridgeTask()
            }
        }
    }

    private func endBackgroundBridgeTask() {
        guard backgroundTask != .invalid else { return }
        let task = backgroundTask
        backgroundTask = .invalid
        UIApplication.shared.endBackgroundTask(task)
    }

    private func setupPlaybackObservers() {
        guard observers.isEmpty else { return }
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: .MPMusicPlayerControllerNowPlayingItemDidChange, object: player, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.refreshNowPlaying() }
        })
        observers.append(center.addObserver(forName: .MPMusicPlayerControllerPlaybackStateDidChange, object: player, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.refreshNowPlaying() }
        })
        player.beginGeneratingPlaybackNotifications()
    }

    private func refreshNowPlaying(refreshQueue: Bool = true) {
        let item = player.nowPlayingItem
        nowTitle = item?.title?.nonEmpty ?? "Nothing playing"
        nowSubtitle = item?.artist?.nonEmpty ?? "Choose playlist"
        nowYear = Self.releaseYear(item)
        refreshNowPlayingStats(for: item)
        let duration = item?.playbackDuration ?? 0
        nowDuration = duration.isFinite ? Int(duration) : 0
        nowElapsed = player.currentPlaybackTime.isFinite ? Int(player.currentPlaybackTime) : 0
        isPlaying = player.playbackState == .playing
        recordRecentPlayStartIfNeeded(item)
        guard refreshQueue else { return }
        if let item,
           !managedQueue.contains(where: { Self.sameMediaItem($0, item) }) {
            refreshSystemQueueIfAvailable()
        }
        syncManagedQueueIndex()
        publishWidgetSnapshot(item: item)
    }

    private func publishWidgetSnapshot(item: MPMediaItem?) {
        let key = item.map {
            Self.trackKey(artist: $0.artist ?? "", album: $0.albumTitle, title: $0.title ?? "")
        } ?? ""
        let metrics = item.map { allTimeMetrics(for: $0, key: key) } ?? (plays: 0, minutes: 0)
        let queuePosition = managedQueueIndex >= 0 ? managedQueueIndex + 1 : 0
        let queueUpcomingDuration = managedQueue.enumerated().reduce(into: 0) { total, pair in
            guard pair.offset > managedQueueIndex else { return }
            let duration = pair.element.playbackDuration
            if duration.isFinite { total += max(0, Int(duration)) }
        }
        let starts = recentPlayStarts()
        let widgetQueue = managedQueue.enumerated().filter { index, _ in
            index > managedQueueIndex
        }.prefix(40).map { _, queueItem in
            let queueKey = Self.trackKey(artist: queueItem.artist ?? "", album: queueItem.albumTitle, title: queueItem.title ?? "")
            let queueMetrics = allTimeMetrics(for: queueItem, key: queueKey)
            let recordedStart = starts[Self.persistentHex(queueItem.persistentID)].flatMap(ISO8601DateFormatter().date)
            let libraryItem = libraryItemsByID[queueItem.persistentID]
            let lastPlayed = [queueItem.lastPlayedDate, libraryItem?.lastPlayedDate, recordedStart]
                .compactMap { $0 }
                .max()
            return StatsWidgetQueueItem(
                title: queueItem.title?.nonEmpty ?? "Untitled Song",
                artist: queueItem.artist?.nonEmpty ?? "",
                year: Self.releaseYear(queueItem),
                statsLine: allTimeRankLine(for: queueItem, key: queueKey) ?? "",
                plays: queueMetrics.plays,
                duration: queueItem.playbackDuration.isFinite ? Int(queueItem.playbackDuration) : 0,
                lastPlayed: lastPlayed.map(Self.isoString)
            )
        }
        let snapshot = StatsWidgetSnapshot(
            title: nowTitle,
            artist: nowSubtitle,
            album: item?.albumTitle?.nonEmpty ?? "",
            year: nowYear,
            statsLine: nowStatsLine,
            plays: metrics.plays,
            minutes: metrics.minutes,
            duration: nowDuration,
            elapsed: nowElapsed,
            playing: isPlaying,
            repeatMode: player.repeatMode == .one ? "one" : player.repeatMode == .all ? "all" : "none",
            queueTitle: managedQueueTitle,
            queuePosition: queuePosition,
            queueCount: managedQueue.count,
            queueUpcomingDuration: queueUpcomingDuration,
            queue: Array(widgetQueue)
        )
        let signature = [
            snapshot.title,
            snapshot.artist,
            snapshot.album,
            snapshot.year,
            snapshot.statsLine,
            String(snapshot.plays),
            String(snapshot.minutes),
            String(snapshot.duration ?? 0),
            snapshot.playing ? "1" : "0",
            snapshot.repeatMode,
            snapshot.queueTitle,
            String(snapshot.queuePosition),
            String(snapshot.queueCount),
            String(snapshot.queueUpcomingDuration),
            snapshot.queue.map { "\($0.title)|\($0.artist)|\($0.year)|\($0.statsLine)|\($0.plays)|\($0.duration)|\($0.lastPlayed ?? "")" }.joined(separator: "\u{1E}"),
        ].joined(separator: "\u{1F}")
        guard signature != lastWidgetSignature else { return }
        lastWidgetSignature = signature

        if queuePosition != lastWidgetQueuePosition {
            lastWidgetQueuePosition = queuePosition
            writeWidgetData(Data("0".utf8), account: widgetQueuePageKey)
        }

        if let data = try? JSONEncoder().encode(snapshot) {
            writeWidgetData(data, account: widgetSnapshotKey)
        }

        let artworkID = item.map { Self.persistentHex($0.persistentID) } ?? ""
        if artworkID != lastWidgetArtworkID {
            lastWidgetArtworkID = artworkID
            if let artwork = item?.artwork?.image(at: CGSize(width: 240, height: 240)),
               let data = artwork.jpegData(compressionQuality: 0.78) {
                writeWidgetData(data, account: widgetArtworkKey)
            } else {
                writeWidgetData(nil, account: widgetArtworkKey)
            }
        }

        WidgetCenter.shared.reloadTimelines(ofKind: "StatsNowPlayingWidget")
    }

    private func recentPlayStarts() -> [String: String] {
        guard let data = readWidgetData(account: widgetRecentPlayStartsKey) else { return [:] }
        return (try? JSONDecoder().decode([String: String].self, from: data)) ?? [:]
    }

    private func recordRecentPlayStartIfNeeded(_ item: MPMediaItem?) {
        guard isPlaying, let item, item.persistentID != 0 else {
            lastRecordedPlayingPersistentID = nil
            return
        }
        guard lastRecordedPlayingPersistentID != item.persistentID else { return }
        lastRecordedPlayingPersistentID = item.persistentID
        var starts = recentPlayStarts()
        starts[Self.persistentHex(item.persistentID)] = ISO8601DateFormatter().string(from: Date())
        starts = starts.sorted { $0.value > $1.value }.prefix(200).reduce(into: [String: String]()) {
            $0[$1.key] = $1.value
        }
        if let data = try? JSONEncoder().encode(starts) {
            writeWidgetData(data, account: widgetRecentPlayStartsKey)
        }
    }

    private func readWidgetData(account: String) -> Data? {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: widgetKeychainService,
            kSecAttrAccount: account,
            kSecAttrAccessGroup: widgetKeychainAccessGroup,
            kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess else { return nil }
        return result as? Data
    }

    private func writeWidgetData(_ data: Data?, account: String) {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: widgetKeychainService,
            kSecAttrAccount: account,
            kSecAttrAccessGroup: widgetKeychainAccessGroup,
        ]
        guard let data else {
            SecItemDelete(query as CFDictionary)
            return
        }

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

    private func setManagedQueue(_ items: [MPMediaItem], startIndex: Int, shouldPlay: Bool = true, resumeAt: Double? = nil, title: String? = nil) {
        guard !items.isEmpty else { return }
        let safeIndex = min(max(startIndex, 0), items.count - 1)
        managedQueue = items
        managedQueueContentItemIDs = []
        managedQueueIndex = safeIndex
        managedQueueEditable = true
        if let title, !title.isEmpty { managedQueueTitle = title }
        lastManagedQueueSetAt = Date()
        saveManagedQueue()
        let descriptor = MPMusicPlayerMediaItemQueueDescriptor(itemCollection: MPMediaItemCollection(items: items))
        descriptor.startItem = items[safeIndex]
        player.setQueue(with: descriptor)
        shouldPlay ? player.play() : player.pause()
        if let resumeAt, resumeAt.isFinite, resumeAt > 0 {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) { [weak self] in
                guard let self,
                      let current = self.player.nowPlayingItem,
                      Self.sameMediaItem(current, items[safeIndex]) else { return }
                self.player.currentPlaybackTime = resumeAt
                if !shouldPlay { self.player.pause() }
                self.refreshNowPlaying()
            }
        }
        refreshNowPlaying()
    }

    private func rebuildManagedQueue(startIndex: Int, shouldPlay: Bool, resumeAt: Double?) async -> Bool {
        guard !managedQueue.isEmpty else { return false }
        let items = managedQueue
        let safeIndex = min(max(startIndex, 0), items.count - 1)
        managedQueueIndex = safeIndex
        managedQueueEditable = true
        managedQueueContentItemIDs = []
        lastManagedQueueSetAt = Date()
        saveManagedQueue()

        let descriptor = MPMusicPlayerMediaItemQueueDescriptor(itemCollection: MPMediaItemCollection(items: items))
        descriptor.startItem = items[safeIndex]
        player.pause()
        player.setQueue(with: descriptor)
        let prepared = await withCheckedContinuation { continuation in
            player.prepareToPlay { error in continuation.resume(returning: error == nil) }
        }
        guard prepared else { return false }
        if let resumeAt, resumeAt.isFinite, resumeAt > 0 {
            player.currentPlaybackTime = resumeAt
        }
        shouldPlay ? player.play() : player.pause()
        refreshNowPlaying()
        return true
    }

    private func insertManagedQueue(_ items: [MPMediaItem], afterCurrent: Bool) {
        guard !items.isEmpty else { return }
        syncManagedQueueIndex()
        if managedQueue.isEmpty {
            managedQueue = items
            managedQueueIndex = 0
        } else if afterCurrent {
            let insertion = min(max(managedQueueIndex + 1, 0), managedQueue.count)
            managedQueue.insert(contentsOf: items, at: insertion)
        } else {
            managedQueue.append(contentsOf: items)
        }
        managedQueueContentItemIDs = []
        lastManagedQueueSetAt = Date()
        saveManagedQueue()
    }

    private func syncManagedQueueIndex() {
        guard let current = player.nowPlayingItem else {
            return
        }
        if let index = managedQueue.firstIndex(where: { Self.sameMediaItem($0, current) }) {
            if managedQueueIndex != index {
                managedQueueIndex = index
                saveManagedQueueIndex()
            }
            return
        }
        if Date().timeIntervalSince(lastManagedQueueSetAt) > 2 {
            managedQueue = [current]
            managedQueueContentItemIDs = []
            managedQueueIndex = 0
            managedQueueTitle = "Apple Music"
            managedQueueEditable = false
            saveManagedQueue()
        }
    }

    private func systemQueuePositionChanged() -> Bool {
        guard cachedSystemQueueIndex == player.indexOfNowPlayingItem else { return true }
        let selector = NSSelectorFromString("numberOfItems")
        guard player.responds(to: selector) else { return false }
        let count = unsafeBitCast(player.method(for: selector), to: QueueItemCountFunction.self)(player, selector)
        return count != cachedSystemQueueCount
    }

    private func refreshSystemQueueIfAvailable() {
        guard let current = player.nowPlayingItem else { return }
        cachedSystemQueueIndex = player.indexOfNowPlayingItem
        beginSystemQueueResponseLoadingIfAvailable()

        let countSelector = NSSelectorFromString("numberOfItems")
        let itemSelector = NSSelectorFromString("nowPlayingItemAtIndex:")
        guard player.responds(to: countSelector), player.responds(to: itemSelector) else {
            setSystemQueueFallback(current)
            return
        }

        let countImplementation = player.method(for: countSelector)
        let itemImplementation = player.method(for: itemSelector)
        let itemCount = unsafeBitCast(countImplementation, to: QueueItemCountFunction.self)(player, countSelector)
        cachedSystemQueueCount = itemCount
        guard itemCount > 0, itemCount <= 10_000 else {
            setSystemQueueFallback(current)
            return
        }

        let rawCurrentIndex = player.indexOfNowPlayingItem
        let sourceCount = Int(itemCount)
        let currentIndex = rawCurrentIndex >= 0 && rawCurrentIndex < sourceCount ? rawCurrentIndex : 0
        let itemAtIndex = unsafeBitCast(itemImplementation, to: QueueItemAtIndexFunction.self)
        let contextSelector = NSSelectorFromString("nowPlayingAtIndex:")
        let contextAtIndex: QueueContextAtIndexFunction? = player.responds(to: contextSelector)
            ? unsafeBitCast(player.method(for: contextSelector), to: QueueContextAtIndexFunction.self)
            : nil
        let contentIdentifierSelector = NSSelectorFromString("itemIdentifier")
        let upperBound = Swift.min(sourceCount, currentIndex + 500)
        var items: [MPMediaItem] = []
        var contentItemIDs: [String] = []
        items.reserveCapacity(upperBound - currentIndex)
        contentItemIDs.reserveCapacity(upperBound - currentIndex)

        for index in currentIndex..<upperBound {
            if let item = itemAtIndex(player, itemSelector, UInt(index))?.takeUnretainedValue() as? MPMediaItem,
               item.title?.nonEmpty != nil {
                items.append(item)
                let contentItemID: String
                if let contextAtIndex,
                   let context = contextAtIndex(player, contextSelector, index)?.takeUnretainedValue() as? NSObject,
                   context.responds(to: contentIdentifierSelector),
                   let identifier = context.perform(contentIdentifierSelector)?.takeUnretainedValue() as? String {
                    contentItemID = identifier
                } else {
                    contentItemID = ""
                }
                contentItemIDs.append(contentItemID)
            } else if index == currentIndex {
                items.append(current)
                contentItemIDs.append("")
            }
        }

        guard items.count > 1 else {
            setSystemQueueFallback(current)
            return
        }

        managedQueue = items
        managedQueueContentItemIDs = contentItemIDs.count == items.count && contentItemIDs.allSatisfy({ !$0.isEmpty })
            ? contentItemIDs
            : []
        managedQueueIndex = items.firstIndex(where: { Self.sameMediaItem($0, current) }) ?? 0
        managedQueueTitle = "Apple Music"
        managedQueueEditable = true
        logSystemQueueIfChanged(sourceCount: itemCount)
    }

    private func beginSystemQueueResponseLoadingIfAvailable() {
        let requestControllerSelector = NSSelectorFromString("requestController")
        let beginLoadingSelector = NSSelectorFromString("beginAutomaticResponseLoading")
        guard player.responds(to: requestControllerSelector),
              let controller = player.perform(requestControllerSelector)?.takeUnretainedValue() as? NSObject,
              controller.responds(to: beginLoadingSelector) else { return }
        _ = controller.perform(beginLoadingSelector)
    }

    private func setSystemQueueFallback(_ current: MPMediaItem) {
        managedQueue = [current]
        managedQueueContentItemIDs = []
        managedQueueIndex = 0
        managedQueueTitle = "Apple Music"
        managedQueueEditable = false
    }

    private func logSystemQueueIfChanged(sourceCount: UInt) {
        let signature = managedQueue.map {
            $0.persistentID == 0
                ? Self.trackKey(artist: $0.artist ?? "", album: $0.albumTitle, title: $0.title ?? "")
                : Self.persistentHex($0.persistentID)
        }.joined(separator: "|")
        guard signature != lastSystemQueueSignature else { return }
        lastSystemQueueSignature = signature
        NSLog("Stats system queue: source=%lu visible=%ld current=%ld context=%ld", sourceCount, managedQueue.count, managedQueueIndex, managedQueueContentItemIDs.count)
    }

    private func reorderSystemQueue(from: Int, to: Int) async -> Bool {
        guard managedQueueContentItemIDs.count == managedQueue.count,
              managedQueueContentItemIDs.indices.contains(from),
              managedQueueContentItemIDs.indices.contains(to),
              to > managedQueueIndex else { return false }
        var expected = managedQueueContentItemIDs
        let movedID = expected.remove(at: from)
        expected.insert(movedID, at: to)
        let predecessorID = expected[to - 1]
        guard sendMediaRemoteQueueCommand(
            commandSelector: "reorderQueueCommand",
            eventSelector: "newCommandEventWithInsertingContentItemID:afterContentItemID:",
            commandType: 0x82,
            contentItemID: movedID,
            referenceContentItemID: predecessorID
        ) else { return false }
        if await waitForSystemQueue(expectedContentItemIDs: expected) {
            NSLog("Stats queue move: in-place from=%ld to=%ld", from, to)
            return true
        }
        NSLog("Stats queue move: in-place command was not applied; rebuilding queue")
        return false
    }

    private func removeSystemQueueItem(at index: Int) async -> Bool {
        guard managedQueueContentItemIDs.count == managedQueue.count,
              managedQueueContentItemIDs.indices.contains(index) else { return false }
        var expected = managedQueueContentItemIDs
        let removedID = expected.remove(at: index)
        guard sendMediaRemoteQueueCommand(
            commandSelector: "removeFromPlaybackQueueCommand",
            eventSelector: "newCommandEventWithContentItemIdentifier:",
            commandType: 0x81,
            contentItemID: removedID
        ) else { return false }
        if await waitForSystemQueue(expectedContentItemIDs: expected) {
            NSLog("Stats queue remove: in-place index=%ld", index)
            return true
        }
        NSLog("Stats queue remove: in-place command was not applied; rebuilding queue")
        return false
    }

    private func waitForSystemQueue(expectedContentItemIDs: [String]) async -> Bool {
        for _ in 0..<10 {
            try? await Task.sleep(nanoseconds: 80_000_000)
            refreshSystemQueueIfAvailable()
            if managedQueueContentItemIDs == expectedContentItemIDs {
                return true
            }
        }
        return false
    }

    private func sendMediaRemoteQueueCommand(
        commandSelector commandSelectorName: String,
        eventSelector eventSelectorName: String,
        commandType: Int,
        contentItemID: String,
        referenceContentItemID: String? = nil
    ) -> Bool {
        let center = MPRemoteCommandCenter.shared()
        let commandSelector = NSSelectorFromString(commandSelectorName)
        guard center.responds(to: commandSelector),
              let command = center.perform(commandSelector)?.takeUnretainedValue() as? NSObject else { return false }
        let eventSelector = NSSelectorFromString(eventSelectorName)
        guard command.responds(to: eventSelector) else { return false }
        let eventValue: Unmanaged<AnyObject>?
        if let referenceContentItemID {
            eventValue = command.perform(eventSelector, with: contentItemID, with: referenceContentItemID)
        } else {
            eventValue = command.perform(eventSelector, with: contentItemID)
        }
        guard let event = eventValue?.takeRetainedValue() as? NSObject else { return false }
        let optionsSelector = NSSelectorFromString("mediaRemoteOptions")
        guard event.responds(to: optionsSelector),
              let options = event.perform(optionsSelector)?.takeUnretainedValue() as? NSDictionary else { return false }
        if mediaRemoteHandle == nil {
            mediaRemoteHandle = dlopen("/System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote", RTLD_NOW)
        }
        guard let mediaRemoteHandle,
              let symbol = dlsym(mediaRemoteHandle, "MRMediaRemoteSendCommand") else { return false }
        let sendCommand = unsafeBitCast(symbol, to: MediaRemoteSendCommandFunction.self)
        return sendCommand(commandType, options as CFDictionary)
    }

    private func saveManagedQueue() {
        guard managedQueueEditable else {
            UserDefaults.standard.removeObject(forKey: managedQueueKey)
            UserDefaults.standard.removeObject(forKey: managedQueueTitleKey)
            UserDefaults.standard.removeObject(forKey: managedQueueIndexKey)
            return
        }
        let ids = managedQueue.compactMap { item in item.persistentID == 0 ? nil : Self.persistentHex(item.persistentID) }
        UserDefaults.standard.set(ids, forKey: managedQueueKey)
        UserDefaults.standard.set(managedQueueTitle, forKey: managedQueueTitleKey)
        saveManagedQueueIndex()
    }

    private func saveManagedQueueIndex() {
        guard managedQueueEditable, managedQueueIndex >= 0 else { return }
        UserDefaults.standard.set(managedQueueIndex, forKey: managedQueueIndexKey)
    }

    private func restoreManagedQueueIfNeeded() {
        guard managedQueue.isEmpty,
              let ids = UserDefaults.standard.stringArray(forKey: managedQueueKey),
              !ids.isEmpty else { return }
        let restored = ids.compactMap(Self.parsePersistentID).compactMap { libraryItem(persistentID: $0) }
        guard restored.count > 1 else {
            UserDefaults.standard.removeObject(forKey: managedQueueKey)
            UserDefaults.standard.removeObject(forKey: managedQueueTitleKey)
            UserDefaults.standard.removeObject(forKey: managedQueueIndexKey)
            return
        }
        managedQueue = restored
        managedQueueContentItemIDs = []
        managedQueueEditable = true
        managedQueueTitle = UserDefaults.standard.string(forKey: managedQueueTitleKey)?.nonEmpty ?? "Hàng chờ"
        let savedIndex = UserDefaults.standard.object(forKey: managedQueueIndexKey) as? Int ?? 0
        managedQueueIndex = min(max(savedIndex, 0), restored.count - 1)
        syncManagedQueueIndex()
    }

    private static func sameMediaItem(_ lhs: MPMediaItem, _ rhs: MPMediaItem) -> Bool {
        if lhs.persistentID != 0, rhs.persistentID != 0 { return lhs.persistentID == rhs.persistentID }
        return normalizedKeyPart(lhs.title ?? "") == normalizedKeyPart(rhs.title ?? "")
            && normalizedKeyPart(lhs.artist ?? "") == normalizedKeyPart(rhs.artist ?? "")
    }

    private func refreshNowPlayingStats(for item: MPMediaItem?) {
        guard let item,
              let title = item.title?.nonEmpty,
              let artist = item.artist?.nonEmpty else {
            nowStatsLine = ""
            nowStatsKey = ""
            nowStatsItemInLibrary = true
            return
        }

        if libraryTrackIDs.isEmpty, MPMediaLibrary.authorizationStatus() == .authorized {
            refreshLibraryTrackIndex()
        }

        let key = Self.trackKey(artist: artist, album: item.albumTitle, title: title)
        let inLibrary = isInLibrary(item, key: key)
        nowStatsKey = key
        nowStatsItemInLibrary = inLibrary

        guard !inLibrary else {
            nowStatsLine = allTimeRankLine(for: item, key: key) ?? ""
            loadAllTimeRanksIfNeeded()
            return
        }

        nowStatsLine = ""
        fetchLastfmStatsIfNeeded(key: key, artist: artist, title: title)
    }

    private func allTimeRankLine(for item: MPMediaItem, key: String) -> String? {
        guard let stats = allTimeStats(for: item, key: key) else { return nil }
        return Self.formatAllTimeRankLine(stats)
    }

    private func allTimeStats(for item: MPMediaItem, key: String) -> AllTimeSongRank? {
        guard let trackID = trackID(for: item, key: key),
              let stats = allTimeRankByTrackID[trackID] else { return nil }
        return stats
    }

    private func trackID(for item: MPMediaItem, key: String) -> String? {
        let trackIDFromPID: String?
        if item.persistentID == 0 {
            trackIDFromPID = nil
        } else {
            trackIDFromPID = allTimeTrackIDByPersistentHex[Self.persistentHex(item.persistentID)]
        }

        let titleKey = Self.artistTitleKey(artist: item.artist ?? "", title: item.title ?? "")
        return trackIDFromPID ?? allTimeTrackIDByKey[key] ?? allTimeTrackIDByArtistTitle[titleKey]
    }

    private func allTimeMetrics(for item: MPMediaItem, key: String) -> (plays: Int, minutes: Int) {
        if let stats = allTimeStats(for: item, key: key), let plays = stats.plays, let minutes = stats.minutes {
            return (max(0, plays), max(0, minutes))
        }
        let plays = max(0, item.playCount)
        let duration = item.playbackDuration.isFinite ? max(0, item.playbackDuration) : 0
        return (plays, Int((Double(plays) * duration / 60).rounded()))
    }

    private func loadAllTimeRanksIfNeeded() {
        guard !allTimeRanksLoaded, !allTimeRanksLoading else { return }
        allTimeRanksLoading = true

        let group = DispatchGroup()
        var charts: SongChartResponse?
        var history: SongHistoryResponse?
        var libraryRows: [LibraryTrackRow]?

        group.enter()
        Self.fetchAPI(path: "/charts/songs?window=at&limit=5000") { (result: Result<SongChartResponse, Error>) in
            if case let .success(value) = result { charts = value }
            group.leave()
        }

        group.enter()
        Self.fetchAPI(path: "/history/songs?top=5000&months=36") { (result: Result<SongHistoryResponse, Error>) in
            if case let .success(value) = result { history = value }
            group.leave()
        }

        group.enter()
        Self.fetchAllLibraryTracks { result in
            if case let .success(value) = result { libraryRows = value }
            group.leave()
        }

        group.notify(queue: .main) { [weak self] in
            Task { @MainActor in
                guard let self else { return }
                defer { self.allTimeRanksLoading = false }
                guard let charts, let history, let libraryRows else { return }

                var changes: [String: Int] = [:]
                let rankRows = charts.rows.compactMap { row -> (String, Int)? in
                    guard let id = row.track_id, let rank = row.rank, rank > 0 else { return nil }
                    return (id, rank)
                }
                let rankByID = Dictionary(uniqueKeysWithValues: rankRows)
                let chartByID = Dictionary(uniqueKeysWithValues: charts.rows.compactMap { row in
                    row.track_id.map { ($0, row) }
                })
                history.rows.forEach { row in
                    guard let id = row.track_id,
                          let rank = rankByID[id],
                          let best = row.best?.rank,
                          best > 0 else { return }
                    changes[id] = best - rank
                }

                self.allTimeRankByTrackID = Dictionary(uniqueKeysWithValues: rankRows.map { id, rank in
                    let row = chartByID[id]
                    return (id, AllTimeSongRank(rank: rank, change: changes[id], plays: row?.plays, minutes: row?.minutes))
                })

                var byPersistentHex: [String: String] = [:]
                var byKey: [String: String] = [:]
                var byArtistTitle: [String: String] = [:]
                libraryRows.forEach { row in
                    if let pid = row.apple_pid?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased(),
                       !pid.isEmpty,
                       byPersistentHex[pid] == nil {
                        byPersistentHex[pid] = row.id
                    }
                    let key = Self.trackKey(artist: row.artist, album: row.album, title: row.title)
                    if byKey[key] == nil {
                        byKey[key] = row.id
                    }
                    let titleKey = Self.artistTitleKey(artist: row.artist, title: row.title)
                    if byArtistTitle[titleKey] == nil {
                        byArtistTitle[titleKey] = row.id
                    }
                }
                self.allTimeTrackIDByPersistentHex = byPersistentHex
                self.allTimeTrackIDByKey = byKey
                self.allTimeTrackIDByArtistTitle = byArtistTitle
                self.allTimeRanksLoaded = true
                self.refreshNowPlaying()
            }
        }
    }

    private func refreshLibraryTrackIndex() {
        let items = MPMediaQuery.songs().items ?? []
        libraryItemsByID = items.reduce(into: [UInt64: MPMediaItem]()) { result, item in
            if item.persistentID != 0 { result[item.persistentID] = item }
        }
        libraryTrackIDs = Set(items.map(\.persistentID).filter { $0 != 0 })
        libraryTrackKeys = Set(items.compactMap { item in
            guard let title = item.title?.nonEmpty, let artist = item.artist?.nonEmpty else { return nil }
            return Self.trackKey(artist: artist, album: item.albumTitle, title: title)
        })
    }

    private func libraryItem(persistentID: UInt64) -> MPMediaItem? {
        if let cached = libraryItemsByID[persistentID] { return cached }
        let query = MPMediaQuery.songs()
        query.addFilterPredicate(MPMediaPropertyPredicate(
            value: NSNumber(value: persistentID),
            forProperty: MPMediaItemPropertyPersistentID
        ))
        return query.items?.first
    }

    private func libraryItem(artist: String?, title: String?, album: String?) -> MPMediaItem? {
        let cleanTitle = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !cleanTitle.isEmpty else { return nil }
        let cleanArtist = artist?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let cleanAlbum = album?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

        func firstExact(_ predicates: [(String, String)]) -> MPMediaItem? {
            let query = MPMediaQuery.songs()
            predicates.forEach { value, property in
                guard !value.isEmpty else { return }
                query.addFilterPredicate(MPMediaPropertyPredicate(value: value, forProperty: property))
            }
            return query.items?.first
        }

        if let item = firstExact([
            (cleanTitle, MPMediaItemPropertyTitle),
            (cleanArtist, MPMediaItemPropertyArtist),
            (cleanAlbum, MPMediaItemPropertyAlbumTitle)
        ]) { return item }

        if let item = firstExact([
            (cleanTitle, MPMediaItemPropertyTitle),
            (cleanArtist, MPMediaItemPropertyArtist)
        ]) { return item }

        let wantedTitle = Self.normalizedKeyPart(cleanTitle)
        let wantedArtist = Self.normalizedKeyPart(cleanArtist)
        let wantedAlbum = Self.normalizedKeyPart(cleanAlbum)
        return (MPMediaQuery.songs().items ?? []).first { item in
            guard Self.normalizedKeyPart(item.title ?? "") == wantedTitle else { return false }
            if !wantedArtist.isEmpty && Self.normalizedKeyPart(item.artist ?? "") != wantedArtist { return false }
            if !wantedAlbum.isEmpty && Self.normalizedKeyPart(item.albumTitle ?? "") != wantedAlbum { return false }
            return true
        }
    }

    private func libraryAlbum(artist: String?, title: String) -> MPMediaItemCollection? {
        let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanTitle.isEmpty else { return nil }
        let wantedTitle = Self.normalizedKeyPart(cleanTitle)
        let wantedArtist = Self.normalizedKeyPart(artist?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "")

        func matches(_ collection: MPMediaItemCollection) -> Bool {
            guard let item = collection.representativeItem,
                  Self.normalizedKeyPart(item.albumTitle ?? "") == wantedTitle else { return false }
            guard !wantedArtist.isEmpty else { return true }
            return Self.normalizedKeyPart(item.albumArtist ?? "") == wantedArtist
                || Self.normalizedKeyPart(item.artist ?? "") == wantedArtist
        }

        let exactQuery = MPMediaQuery.albums()
        exactQuery.addFilterPredicate(MPMediaPropertyPredicate(value: cleanTitle, forProperty: MPMediaItemPropertyAlbumTitle))
        if let collection = exactQuery.collections?.first(where: matches) { return collection }
        return MPMediaQuery.albums().collections?.first(where: matches)
    }

    private func isInLibrary(_ item: MPMediaItem, key: String) -> Bool {
        if item.persistentID != 0, libraryTrackIDs.contains(item.persistentID) {
            return true
        }
        return libraryTrackKeys.contains(key)
    }

    private func fetchLastfmStatsIfNeeded(key: String, artist: String, title: String) {
        guard lastfmStatsCache[key] == nil, !lastfmStatsLoading.contains(key) else { return }
        lastfmStatsLoading.insert(key)

        var components = URLComponents(string: "https://stats.helloween2610.workers.dev/discovery/lastfm")
        components?.queryItems = [
            URLQueryItem(name: "artist", value: artist),
            URLQueryItem(name: "title", value: title)
        ]
        guard let url = components?.url else {
            lastfmStatsLoading.remove(key)
            return
        }

        var request = URLRequest(url: url, timeoutInterval: 8)
        request.setValue("Bearer read_4bME54OBq-6uTgVOi81e9c6WHZNcM1rN", forHTTPHeaderField: "Authorization")

        URLSession.shared.dataTask(with: request) { [weak self] data, _, _ in
            guard let self else { return }
            let stats = data.flatMap { try? JSONDecoder().decode(LastfmTrackStats.self, from: $0) }
            let line = Self.formatStatsLine(stats)
            Task { @MainActor in
                self.lastfmStatsLoading.remove(key)
                self.lastfmStatsCache[key] = line
                if let stats { self.lastfmStatsByKey[key] = stats }
                if self.nowStatsKey == key, !self.nowStatsItemInLibrary {
                    self.nowStatsLine = line
                }
            }
        }.resume()
    }

    private static func trackKey(artist: String, album: String?, title: String) -> String {
        [artist, album ?? "", title].map(normalizedKeyPart).joined(separator: "\u{1f}")
    }

    private static func positive(_ value: Int) -> Int? {
        value > 0 ? value : nil
    }

    private static func localMinuteString(_ date: Date?) -> String? {
        guard let date else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "Asia/Ho_Chi_Minh")
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm"
        return formatter.string(from: date)
    }

    private static func dayString(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "Asia/Ho_Chi_Minh")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    private static func isoString(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: date)
    }

    private static func serverErrorMessage(_ data: Data) -> String? {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return object["message"] as? String ?? object["error"] as? String
    }

    private static func artistTitleKey(artist: String, title: String) -> String {
        [artist, title].map(normalizedKeyPart).joined(separator: "\u{1f}")
    }

    private static func normalizedKeyPart(_ value: String) -> String {
        value.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current)
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
    }

    nonisolated private static func formatStatsLine(_ stats: LastfmTrackStats?) -> String {
        guard let stats,
              stats.status == "found",
              let scrobbles = stats.scrobbles,
              scrobbles >= 0 else { return "" }

        var parts = [groupedCount(scrobbles) + "x"]
        if let listeners = stats.listeners, listeners > 0 {
            let ratio = Double(scrobbles) / Double(listeners)
            if ratio.isFinite {
                parts.append(String(format: "%.1f", ratio))
            }
        }
        return parts.joined(separator: "  ")
    }

    nonisolated private static func groupedCount(_ value: Int) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.groupingSeparator = "."
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }

    nonisolated private static func persistentHex(_ value: UInt64) -> String {
        String(format: "%016llX", value)
    }

    nonisolated static func parsePersistentID(_ value: String) -> UInt64? {
        let raw = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty else { return nil }
        let explicitHex = raw.uppercased().replacingOccurrences(of: "0X", with: "")
        if raw.uppercased().hasPrefix("0X") {
            return UInt64(explicitHex, radix: 16)
        }
        if raw.count == 16, raw.range(of: #"^[0-9A-Fa-f]+$"#, options: .regularExpression) != nil {
            return UInt64(raw, radix: 16)
        }
        if let decimal = UInt64(raw) {
            return decimal
        }
        return UInt64(explicitHex, radix: 16)
    }

    nonisolated private static func cleanStoreID(_ value: String?) -> String? {
        let raw = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard raw.range(of: #"^\d+$"#, options: .regularExpression) != nil else { return nil }
        return raw
    }

    nonisolated private static func formatAllTimeRankLine(_ value: AllTimeSongRank) -> String {
        guard let change = value.change, change != 0 else { return String(value.rank) }
        return "\(value.rank) \(change > 0 ? "+" : "-")\(abs(change))"
    }

    nonisolated private static func fetchAPI<T: Decodable>(path: String, completion: @escaping (Result<T, Error>) -> Void) {
        guard let url = URL(string: "https://stats.helloween2610.workers.dev" + path) else {
            completion(.failure(URLError(.badURL)))
            return
        }

        var request = URLRequest(url: url, timeoutInterval: 12)
        request.setValue("Bearer read_4bME54OBq-6uTgVOi81e9c6WHZNcM1rN", forHTTPHeaderField: "Authorization")
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error {
                completion(.failure(error))
                return
            }
            if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                completion(.failure(URLError(.badServerResponse)))
                return
            }
            guard let data else {
                completion(.failure(URLError(.badServerResponse)))
                return
            }
            do {
                completion(.success(try JSONDecoder().decode(T.self, from: data)))
            } catch {
                completion(.failure(error))
            }
        }.resume()
    }

    nonisolated private static func fetchAllLibraryTracks(
        offset: Int = 0,
        rows: [LibraryTrackRow] = [],
        completion: @escaping (Result<[LibraryTrackRow], Error>) -> Void
    ) {
        let limit = 1000
        fetchAPI(path: "/library/tracks?offset=\(offset)&limit=\(limit)") { (result: Result<LibraryTracksResponse, Error>) in
            switch result {
            case .failure(let error):
                completion(.failure(error))
            case .success(let page):
                let merged = rows + page.rows
                guard page.rows.count >= limit else {
                    completion(.success(merged))
                    return
                }
                fetchAllLibraryTracks(offset: offset + limit, rows: merged, completion: completion)
            }
        }
    }

    private func loadFavorites() {
        let ids = UserDefaults.standard.array(forKey: favoritesKey) as? [NSNumber] ?? []
        favoriteIDs = Set(ids.map { $0.uint64Value })
    }

    private func saveFavorites() {
        UserDefaults.standard.set(favoriteIDs.map(NSNumber.init(value:)), forKey: favoritesKey)
    }

    private static func releaseYear(_ item: MPMediaItem?) -> String {
        guard let date = item?.releaseDate else { return "" }
        let year = Calendar.current.component(.year, from: date)
        return year > 0 ? String(year) : ""
    }
}

private extension String {
    var nonEmpty: String? {
        isEmpty ? nil : self
    }
}
