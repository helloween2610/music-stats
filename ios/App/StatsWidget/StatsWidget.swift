import AppIntents
import MediaPlayer
import SwiftUI
import Security
import UIKit
import WidgetKit

private let widgetKind = "StatsNowPlayingWidget"
private let keychainService = "com.minlab.musicstats.widget"
private let keychainAccessGroup = "AK73F5WL6J.com.minlab.musicstats.shared"
private let snapshotKey = "statsWidgetSnapshot"
private let artworkKey = "statsWidgetArtwork"
private let queuePageKey = "statsWidgetQueuePage"
private let playlistsKey = "statsWidgetPlaylists"
private let playlistsBackupKey = "statsWidgetPlaylistsBackup"

private struct StatsWidgetQueueItem: Codable {
    let title: String
    let artist: String
    let year: String
    let statsLine: String
    let plays: Int
    let duration: Int
    let lastPlayed: String?
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
    let repeatMode: String?
    let queueTitle: String
    let queuePosition: Int
    let queueCount: Int
    let queueUpcomingDuration: Int?
    let queue: [StatsWidgetQueueItem]?

    static let placeholder = StatsWidgetSnapshot(
        title: "Ride the White Storm",
        artist: "Atavistia",
        album: "Old Gods Awaken",
        year: "2026",
        statsLine: "#63 ▲2",
        plays: 18,
        minutes: 126,
        duration: 421,
        elapsed: 85,
        playing: true,
        repeatMode: "all",
        queueTitle: "M01 In Flames Plt",
        queuePosition: 3,
        queueCount: 4,
        queueUpcomingDuration: 1_274,
        queue: [
            StatsWidgetQueueItem(title: "Stand Ablaze", artist: "In Flames", year: "1994", statsLine: "#88 ▲86", plays: 41, duration: 275, lastPlayed: ISO8601DateFormatter().string(from: Date().addingTimeInterval(-5 * 3600))),
            StatsWidgetQueueItem(title: "Memento Mori 2.0", artist: "Aephanemer", year: "2026", statsLine: "#185 ▼6", plays: 26, duration: 453, lastPlayed: ISO8601DateFormatter().string(from: Date().addingTimeInterval(-26 * 3600))),
            StatsWidgetQueueItem(title: "Sleeping Sun", artist: "Nightwish", year: "1998", statsLine: "#102 ▲14", plays: 33, duration: 244, lastPlayed: ISO8601DateFormatter().string(from: Date().addingTimeInterval(-30 * 3600))),
            StatsWidgetQueueItem(title: "Moonshield", artist: "In Flames", year: "1996", statsLine: "#82 ▲88", plays: 17, duration: 302, lastPlayed: ISO8601DateFormatter().string(from: Date().addingTimeInterval(-42 * 3600))),
        ]
    )

    static let empty = StatsWidgetSnapshot(
        title: "Mở Stats để cập nhật",
        artist: "Apple Music",
        album: "",
        year: "",
        statsLine: "",
        plays: 0,
        minutes: 0,
        duration: nil,
        elapsed: nil,
        playing: false,
        repeatMode: "none",
        queueTitle: "",
        queuePosition: 0,
        queueCount: 0,
        queueUpcomingDuration: 0,
        queue: []
    )
}

private struct StatsWidgetPlaylistItem: Codable, Identifiable {
    let id: String
    let name: String
    let path: String
    let rank: Int
    let plays: Int
    let trackCount: Int
    let hue: Double

    static let placeholder = [
        StatsWidgetPlaylistItem(id: "1", name: "M01 In Flames Plt", path: "03_SCREAM", rank: 1, plays: 24, trackCount: 12, hue: 252),
        StatsWidgetPlaylistItem(id: "2", name: "N_Instrumental Melodic Death Metal", path: "_New Music", rank: 2, plays: 18, trackCount: 9, hue: 164),
        StatsWidgetPlaylistItem(id: "3", name: "01.2 INSTRU. MELODEATH METAL", path: "10_INSTRUMENTAL", rank: 3, plays: 14, trackCount: 7, hue: 38),
        StatsWidgetPlaylistItem(id: "4", name: "M02 Nightwish", path: "07_HAPPY", rank: 4, plays: 11, trackCount: 6, hue: 332),
    ]
}

private struct StatsWidgetEntry: TimelineEntry {
    let date: Date
    let snapshot: StatsWidgetSnapshot
    let artworkData: Data?
    let queuePage: Int
    let topPlaylists: [StatsWidgetPlaylistItem]
}

private struct StatsWidgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> StatsWidgetEntry {
        StatsWidgetEntry(date: Date(), snapshot: .placeholder, artworkData: nil, queuePage: 0, topPlaylists: StatsWidgetPlaylistItem.placeholder)
    }

    func getSnapshot(in context: Context, completion: @escaping (StatsWidgetEntry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : currentEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<StatsWidgetEntry>) -> Void) {
        let entry = currentEntry()
        completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(5 * 60))))
    }

    private func currentEntry() -> StatsWidgetEntry {
        let savedSnapshot = sharedData(account: snapshotKey)
            .flatMap { try? JSONDecoder().decode(StatsWidgetSnapshot.self, from: $0) } ?? .empty
        let live = liveSnapshot(from: savedSnapshot)
        let snapshot = live.snapshot
        let artworkData = live.reuseSavedArtwork
            ? (live.artworkData ?? sharedData(account: artworkKey))
            : live.artworkData
        let savedPage = sharedData(account: queuePageKey)
            .flatMap { String(data: $0, encoding: .utf8) }
            .flatMap(Int.init) ?? 0
        let queueCount = snapshot.queue?.count ?? 0
        let maxPage = max(0, (queueCount - 1) / 4)
        let savedPlaylists = sharedData(account: playlistsKey)
            .flatMap { try? JSONDecoder().decode([StatsWidgetPlaylistItem].self, from: $0) }
            .map { Array($0.prefix(4)).filter { !$0.id.isEmpty && !$0.name.isEmpty } } ?? []
        let backupPlaylists = sharedData(account: playlistsBackupKey)
            .flatMap { try? JSONDecoder().decode([StatsWidgetPlaylistItem].self, from: $0) }
            .map { Array($0.prefix(4)).filter { !$0.id.isEmpty && !$0.name.isEmpty } } ?? []
        let topPlaylists = savedPlaylists.isEmpty ? backupPlaylists : savedPlaylists
        return StatsWidgetEntry(
            date: Date(),
            snapshot: snapshot,
            artworkData: artworkData,
            queuePage: min(max(0, savedPage), maxPage),
            topPlaylists: topPlaylists
        )
    }

    private func liveSnapshot(
        from saved: StatsWidgetSnapshot
    ) -> (snapshot: StatsWidgetSnapshot, artworkData: Data?, reuseSavedArtwork: Bool) {
        let player = MPMusicPlayerController.systemMusicPlayer
        let liveRepeatMode = repeatMode(player)
        guard let item = player.nowPlayingItem else {
            return (copy(saved, playing: false, repeatMode: liveRepeatMode), nil, true)
        }

        let title = item.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let artist = item.artist?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !title.isEmpty else {
            return (copy(saved, playing: player.playbackState == .playing, repeatMode: liveRepeatMode), nil, true)
        }

        let isSavedCurrent = sameTrack(title: title, artist: artist, otherTitle: saved.title, otherArtist: saved.artist)
        let queue = saved.queue ?? []
        let advancedIndex = isSavedCurrent ? nil : queue.firstIndex {
            sameTrack(title: title, artist: artist, otherTitle: $0.title, otherArtist: $0.artist)
        }
        let artworkData = item.artwork?.image(at: CGSize(width: 240, height: 240))?.jpegData(compressionQuality: 0.78)
        let liveDuration = item.playbackDuration.isFinite ? max(0, Int(item.playbackDuration)) : 0
        let liveElapsed = player.currentPlaybackTime.isFinite ? max(0, Int(player.currentPlaybackTime)) : 0

        if isSavedCurrent {
            return (copy(
                saved,
                playing: player.playbackState == .playing,
                repeatMode: liveRepeatMode,
                duration: liveDuration,
                elapsed: liveElapsed
            ), artworkData, true)
        }
        if let advancedIndex {
            let matched = queue[advancedIndex]
            return (StatsWidgetSnapshot(
                title: title,
                artist: artist,
                album: item.albumTitle?.trimmingCharacters(in: .whitespacesAndNewlines) ?? saved.album,
                year: matched.year,
                statsLine: matched.statsLine,
                plays: matched.plays,
                minutes: matched.duration > 0 ? matched.plays * matched.duration / 60 : 0,
                duration: liveDuration,
                elapsed: liveElapsed,
                playing: player.playbackState == .playing,
                repeatMode: liveRepeatMode,
                queueTitle: saved.queueTitle,
                queuePosition: min(saved.queueCount, saved.queuePosition + advancedIndex + 1),
                queueCount: saved.queueCount,
                queueUpcomingDuration: queue.dropFirst(advancedIndex + 1).reduce(0) { $0 + max(0, $1.duration) },
                queue: Array(queue.dropFirst(advancedIndex + 1))
            ), artworkData, false)
        }

        return (StatsWidgetSnapshot(
            title: title,
            artist: artist,
            album: item.albumTitle?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
            year: releaseYear(item),
            statsLine: "",
            plays: 0,
            minutes: 0,
            duration: liveDuration,
            elapsed: liveElapsed,
            playing: player.playbackState == .playing,
            repeatMode: liveRepeatMode,
            queueTitle: "",
            queuePosition: 0,
            queueCount: 0,
            queueUpcomingDuration: 0,
            queue: []
        ), artworkData, false)
    }

    private func copy(_ snapshot: StatsWidgetSnapshot, playing: Bool, repeatMode: String, duration: Int? = nil, elapsed: Int? = nil) -> StatsWidgetSnapshot {
        StatsWidgetSnapshot(
            title: snapshot.title,
            artist: snapshot.artist,
            album: snapshot.album,
            year: snapshot.year,
            statsLine: snapshot.statsLine,
            plays: snapshot.plays,
            minutes: snapshot.minutes,
            duration: duration ?? snapshot.duration,
            elapsed: elapsed ?? snapshot.elapsed,
            playing: playing,
            repeatMode: repeatMode,
            queueTitle: snapshot.queueTitle,
            queuePosition: snapshot.queuePosition,
            queueCount: snapshot.queueCount,
            queueUpcomingDuration: snapshot.queueUpcomingDuration,
            queue: snapshot.queue
        )
    }

    private func repeatMode(_ player: MPMusicPlayerController) -> String {
        if player.repeatMode == .one { return "one" }
        if player.repeatMode == .all { return "all" }
        return "none"
    }

    private func sameTrack(title: String, artist: String, otherTitle: String, otherArtist: String) -> Bool {
        normalized(title) == normalized(otherTitle) && normalized(artist) == normalized(otherArtist)
    }

    private func normalized(_ value: String) -> String {
        value.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func releaseYear(_ item: MPMediaItem) -> String {
        guard let date = item.releaseDate else { return "" }
        let year = Calendar.current.component(.year, from: date)
        return year > 0 ? String(year) : ""
    }

    private func sharedData(account: String) -> Data? {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: keychainService,
            kSecAttrAccount: account,
            kSecAttrAccessGroup: keychainAccessGroup,
            kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess else { return nil }
        return result as? Data
    }
}

private struct WidgetArtwork: View {
    let data: Data?
    let size: CGFloat

    var body: some View {
        Group {
            if let data, let image = UIImage(data: data) {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                ZStack {
                    Color(red: 0.12, green: 0.13, blue: 0.15)
                    Image(systemName: "waveform")
                        .font(.system(size: size * 0.3, weight: .semibold))
                        .foregroundColor(Color(red: 0.98, green: 0.73, blue: 0.04))
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
    }
}

private struct StatsMetric: View {
    let value: String
    let color: Color

    var body: some View {
        Text(value)
            .font(.system(size: 11, weight: .semibold, design: .rounded))
            .foregroundColor(color)
            .lineLimit(1)
    }
}

private struct WidgetRankBadge: View {
    let value: String

    private var parts: (rank: String, change: String) {
        let tokens = value.replacingOccurrences(of: "#", with: "").split(separator: " ").map(String.init)
        return (tokens.first ?? "", tokens.dropFirst().joined(separator: " "))
    }

    var body: some View {
        if !parts.rank.isEmpty {
            HStack(spacing: 2) {
                Text(parts.rank).foregroundColor(.white)
                if !parts.change.isEmpty {
                    Text(parts.change)
                        .font(.system(size: 8, weight: .bold, design: .rounded))
                        .foregroundColor(parts.change.hasPrefix("▼") ? Color(red: 0.98, green: 0.47, blue: 0.49) : Color(red: 0.27, green: 0.81, blue: 0.45))
                }
            }
            .font(.system(size: 10, weight: .semibold, design: .rounded))
            .padding(.horizontal, 5)
            .frame(height: 19)
            .background(Color.black.opacity(0.84))
            .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
        }
    }
}

private struct StatsWidgetContent: View {
    @Environment(\.widgetFamily) private var family
    let entry: StatsWidgetEntry

    private let accent = Color(red: 1.0, green: 0.74, blue: 0.0)
    private let cyan = Color(red: 0.26, green: 0.76, blue: 0.86)
    private let green = Color(red: 0.42, green: 0.82, blue: 0.48)

    var body: some View {
        Group {
            if family == .systemLarge { largeContent }
            else if family == .systemMedium { mediumContent }
            else { smallContent }
        }
        .padding(14)
    }

    private var smallContent: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 9) {
                WidgetArtwork(data: entry.artworkData, size: 54)
                VStack(alignment: .trailing, spacing: 3) {
                    Image(systemName: entry.snapshot.playing ? "pause.fill" : "play.fill")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundColor(accent)
                    if !entry.snapshot.statsLine.isEmpty {
                        Text(entry.snapshot.statsLine)
                            .font(.system(size: 11, weight: .bold, design: .rounded))
                            .foregroundColor(green)
                            .lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .trailing)
            }
            Spacer(minLength: 0)
            Text(entry.snapshot.title)
                .font(.system(size: 14, weight: .bold))
                .foregroundColor(.white)
                .lineLimit(2)
            Text(entry.snapshot.artist)
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(Color.white.opacity(0.68))
                .lineLimit(1)
            HStack(spacing: 8) {
                StatsMetric(value: "\(entry.snapshot.plays)x", color: accent)
                StatsMetric(value: duration(entry.snapshot.minutes), color: cyan)
                Spacer(minLength: 0)
                if entry.snapshot.queueCount > 0 {
                    StatsMetric(value: "\(entry.snapshot.queuePosition)/\(entry.snapshot.queueCount)", color: Color.white.opacity(0.62))
                }
            }
        }
    }

    private var mediumContent: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("TOP PLAYLIST · 15 NGÀY")
                .font(.system(size: 9, weight: .bold))
                .foregroundColor(accent)
            if entry.topPlaylists.isEmpty {
                Spacer()
                Text("Mở Stats để cập nhật playlist")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(Color.white.opacity(0.5))
                    .frame(maxWidth: .infinity)
                Spacer()
            } else {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible())], spacing: 8) {
                    ForEach(entry.topPlaylists) { playlist in
                        playlistButton(playlist)
                    }
                }
            }
        }
    }

    private var largeContent: some View {
        let allQueue = entry.snapshot.queue ?? []
        let maxPage = max(0, (allQueue.count - 1) / 4)
        let page = min(max(0, entry.queuePage), maxPage)
        let pageStart = page * 4
        let queue = Array(allQueue.dropFirst(pageStart).prefix(4))
        let currentDuration = max(0, entry.snapshot.duration ?? 0)
        let currentElapsed = min(currentDuration, max(0, entry.snapshot.elapsed ?? 0))
        let upcomingDuration = entry.snapshot.queueUpcomingDuration
            ?? allQueue.reduce(0) { $0 + max(0, $1.duration) }
        let remainingDuration = max(0, currentDuration - currentElapsed) + max(0, upcomingDuration)

        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                ZStack(alignment: .bottomLeading) {
                    WidgetArtwork(data: entry.artworkData, size: 96)
                    if !entry.snapshot.statsLine.isEmpty {
                        WidgetRankBadge(value: entry.snapshot.statsLine)
                            .padding(5)
                    }
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text(entry.snapshot.title)
                        .font(.system(size: 17, weight: .bold))
                        .foregroundColor(.white)
                        .lineLimit(2)
                    Text([entry.snapshot.artist, entry.snapshot.year].filter { !$0.isEmpty }.joined(separator: " "))
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(Color.white.opacity(0.68))
                        .lineLimit(1)
                    if entry.snapshot.queueCount > 0 {
                        HStack(spacing: 6) {
                            Text("\(entry.snapshot.queuePosition)/\(entry.snapshot.queueCount)♪")
                                .foregroundColor(accent)
                            Text(remainingTime(remainingDuration))
                                .foregroundColor(.cyan)
                        }
                        .font(.system(size: 11, weight: .semibold, design: .rounded))
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .offset(y: -4)
                VStack(spacing: 0) {
                    HStack(spacing: 6) {
                        repeatButton
                        playbackButton
                    }
                    if maxPage > 0 {
                        HStack(spacing: 12) {
                            queuePageButton(systemName: "chevron.up", page: page - 1, disabled: page == 0)
                            queuePageButton(systemName: "chevron.down", page: page + 1, disabled: page == maxPage)
                        }
                    }
                }
                .frame(width: 68)
            }
            .frame(height: 108)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .bottom) { playbackProgress }

            if queue.isEmpty {
                Spacer()
                Text("Đã hết queue")
                    .frame(maxWidth: .infinity)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(Color.white.opacity(0.48))
                Spacer()
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(queue.enumerated()), id: \.offset) { offset, item in
                        let steps = pageStart + offset + 1
                        queueRow(item, position: entry.snapshot.queuePosition + steps, steps: steps)
                    }
                }
                .padding(.top, 8)
                .frame(maxWidth: .infinity, alignment: .top)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    @ViewBuilder private func playlistButton(_ playlist: StatsWidgetPlaylistItem) -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            ZStack(alignment: .trailing) {
                Button(intent: OpenStatsPlaylistIntent(playlistID: playlist.id)) {
                    playlistButtonLabel(playlist, reservesPlayButton: true)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Mở \(playlistName(playlist.name))")
                Button(intent: PlayStatsPlaylistIntent(playlistID: playlist.id)) {
                    Image(systemName: "play.fill")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(accent)
                        .frame(width: 30, height: 34)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Phát \(playlistName(playlist.name))")
            }
            .frame(height: 52)
        } else {
            playlistButtonLabel(playlist)
        }
    }

    private func playlistName(_ value: String) -> String {
        value
            .replacingOccurrences(of: "+", with: " ")
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func playlistButtonLabel(_ playlist: StatsWidgetPlaylistItem, reservesPlayButton: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(playlistName(playlist.name))
                .font(.system(size: 10, weight: .semibold))
                .foregroundColor(.white)
                .lineLimit(2)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
            Spacer(minLength: 0)
            Text("\(playlist.trackCount) bài")
                .font(.system(size: 9, weight: .semibold))
                .foregroundColor(Color.white.opacity(0.58))
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.leading, 8)
        .padding(.trailing, reservesPlayButton ? 36 : 8)
        .padding(.top, 3)
        .padding(.bottom, 5)
        .frame(maxWidth: .infinity, minHeight: 52, maxHeight: 52, alignment: .topLeading)
        .background(Color(hue: playlist.hue / 360, saturation: 0.26, brightness: 0.20))
        .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
        .contentShape(Rectangle())
    }

    @ViewBuilder private var repeatButton: some View {
        if #available(iOSApplicationExtension 17.0, *) {
            Button(intent: ToggleStatsRepeatIntent()) { repeatButtonLabel }
                .buttonStyle(.plain)
        } else {
            repeatButtonLabel
        }
    }

    private var repeatButtonLabel: some View {
        ZStack(alignment: .bottomTrailing) {
            Image(systemName: "repeat")
                .font(.system(size: 16, weight: .semibold))
            if entry.snapshot.repeatMode == "one" {
                Text("1")
                    .font(.system(size: 7, weight: .bold))
                    .offset(x: 3, y: 2)
            }
        }
        .foregroundColor(entry.snapshot.repeatMode == "none" ? Color.white.opacity(0.46) : accent)
        .frame(width: 30, height: 40)
        .offset(y: -4)
    }

    @ViewBuilder private var playbackButton: some View {
        if #available(iOSApplicationExtension 17.0, *) {
            Button(intent: ToggleStatsPlaybackIntent()) { playbackButtonLabel }
                .buttonStyle(.plain)
        } else {
            playbackButtonLabel
        }
    }

    private var playbackButtonLabel: some View {
        Image(systemName: entry.snapshot.playing ? "pause.fill" : "play.fill")
            .font(.system(size: 17, weight: .bold))
            .foregroundColor(accent)
            .frame(width: 36, height: 44)
            .offset(y: -4)
    }

    @ViewBuilder private func queuePageButton(systemName: String, page: Int, disabled: Bool) -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            Button(intent: ChangeStatsQueuePageIntent(page: page)) {
                Image(systemName: systemName)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundColor(Color.white.opacity(disabled ? 0.2 : 0.7))
                    .frame(width: 28, height: 30)
            }
            .buttonStyle(.plain)
            .disabled(disabled)
        }
    }

    @ViewBuilder private func queueRow(_ item: StatsWidgetQueueItem, position: Int, steps: Int) -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            Button(intent: PlayStatsUpcomingItemIntent(steps: steps)) {
                queueRowLabel(item, position: position)
            }
            .buttonStyle(.plain)
        } else {
            queueRowLabel(item, position: position)
        }
    }

    private func queueRowLabel(_ item: StatsWidgetQueueItem, position: Int) -> some View {
        return HStack(spacing: 8) {
            Text("\(position)")
                .font(.system(size: 11, weight: .semibold, design: .rounded))
                .foregroundColor(Color.white.opacity(0.38))
                .frame(width: 20, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(item.title)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(.white)
                        .lineLimit(1)
                        .layoutPriority(1)
                    Text(trackDuration(item.duration))
                        .font(.system(size: 10, weight: .medium, design: .rounded))
                        .foregroundColor(Color.white.opacity(0.5))
                        .lineLimit(1)
                        .fixedSize(horizontal: true, vertical: false)
                }
                Text([item.artist, item.year].filter { !$0.isEmpty }.joined(separator: " "))
                    .font(.system(size: 10, weight: .medium))
                    .foregroundColor(Color.white.opacity(0.5))
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Text(lastPlayedLabel(item.lastPlayed))
                .font(.system(size: 10, weight: .medium, design: .rounded))
                .foregroundColor(lastPlayedColor(item.lastPlayed))
                .lineLimit(1)
                .frame(maxWidth: 54, alignment: .trailing)
        }
        .frame(height: 50)
        .frame(maxWidth: .infinity)
        .contentShape(Rectangle())
    }

    private func lastPlayedDate(_ value: String?) -> Date? {
        guard let value, !value.isEmpty else { return nil }
        return ISO8601DateFormatter().date(from: value)
    }

    private func lastPlayedLabel(_ value: String?) -> String {
        guard let date = lastPlayedDate(value) else { return "—" }
        let seconds = max(0, Date().timeIntervalSince(date))
        let days = Int(seconds / 86_400)
        if days >= 365 { return "▷\(days / 365)y" }
        if days >= 30 { return "▷\(days / 30)mo" }
        if days >= 7 { return "▷\(days / 7)w" }
        if days >= 1 { return "▷\(days)d" }
        return "▷\(Int(seconds / 3_600))h"
    }

    private func lastPlayedColor(_ value: String?) -> Color {
        guard let date = lastPlayedDate(value) else { return Color.white.opacity(0.5) }
        let hours = max(0, Date().timeIntervalSince(date)) / 3_600
        if hours < 12 { return Color(red: 0.20, green: 0.78, blue: 0.35) }
        if hours < 24 { return Color(red: 0.80, green: 0.91, blue: 0.71) }
        if hours >= 24 * 365 { return Color(red: 0.37, green: 0.19, blue: 0.92) }
        if hours >= 24 * 182 { return Color(red: 1.0, green: 0.23, blue: 0.19) }
        if hours >= 24 * 91 { return Color(red: 1.0, green: 0.91, blue: 0.0) }
        return Color.white.opacity(0.5)
    }

    @ViewBuilder private var playbackProgress: some View {
        let duration = max(0, entry.snapshot.duration ?? 0)
        let elapsed = min(duration, max(0, entry.snapshot.elapsed ?? 0))
        if duration > 0 {
            if #available(iOSApplicationExtension 16.0, *) {
                Group {
                    if entry.snapshot.playing {
                        ProgressView(
                            timerInterval: entry.date.addingTimeInterval(-Double(elapsed))...entry.date.addingTimeInterval(Double(duration - elapsed)),
                            countsDown: false
                        )
                    } else {
                        ProgressView(value: Double(elapsed), total: Double(duration))
                    }
                }
                .progressViewStyle(.linear)
                .labelsHidden()
                .tint(accent)
                .frame(maxWidth: .infinity)
                .frame(height: 2)
                .background(Color.white.opacity(0.16))
                .clipped()
            } else {
                ProgressView(value: Double(elapsed), total: Double(duration))
                    .progressViewStyle(.linear)
                    .labelsHidden()
                    .accentColor(accent)
                    .frame(maxWidth: .infinity)
                    .frame(height: 2)
                    .background(Color.white.opacity(0.16))
                    .clipped()
            }
        }
    }

    private func duration(_ minutes: Int) -> String {
        if minutes >= 60 { return "\(minutes / 60)h \(minutes % 60)m" }
        return "\(minutes)m"
    }

    private func remainingTime(_ seconds: Int) -> String {
        duration((max(0, seconds) + 59) / 60)
    }

    private func trackDuration(_ seconds: Int) -> String {
        "\(max(0, seconds) / 60):\(String(format: "%02d", max(0, seconds) % 60))"
    }
}

private struct StatsWidgetEntryView: View {
    let entry: StatsWidgetEntry

    private var blendedBackground: some View {
        ZStack {
            Rectangle().fill(.ultraThinMaterial)
            Color.black.opacity(0.30)
        }
    }

    @ViewBuilder var body: some View {
        if #available(iOSApplicationExtension 17.0, *) {
            StatsWidgetContent(entry: entry)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .containerBackground(for: .widget) { blendedBackground }
        } else {
            StatsWidgetContent(entry: entry)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(blendedBackground)
        }
    }
}

private struct StatsNowPlayingWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: widgetKind, provider: StatsWidgetProvider()) { entry in
            StatsWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Stats đang phát")
        .description("Bài đang phát, hạng và thống kê nghe gần nhất.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
        .contentMarginsDisabled()
    }
}

@main
struct StatsWidgetBundle: WidgetBundle {
    var body: some Widget {
        StatsNowPlayingWidget()
    }
}
