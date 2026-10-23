import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const bridge = await readFile('ios/App/App/PebbleMusicBridge.swift', 'utf8');
const widgetIntent = await readFile('ios/App/App/WidgetPlaybackIntent.swift', 'utf8');
const widgetView = await readFile('ios/App/StatsWidget/StatsWidget.swift', 'utf8');
const localServer = await readFile('ios/App/App/LocalMusicServer.swift', 'utf8');
const webBridge = await readFile('src/lib/ios-bridge.ts', 'utf8');
const playerSource = await readFile('src/components/native-player.tsx', 'utf8');
const layoutSource = await readFile('src/components/layout.tsx', 'utf8');
const cssSource = await readFile('src/css/app.scss', 'utf8');
const uiSource = await readFile('src/components/ui.tsx', 'utf8');
const mainSource = await readFile('src/screens/main.tsx', 'utf8');
const nativePlayerSource = await readFile('src/components/native-player.tsx', 'utf8');

test('native app background follows the current artwork outside Now Playing', () => {
  assert.match(playerSource, /export function NativeAppBackdrop\(\)/);
  assert.match(playerSource, /className="native-app-backdrop"/);
  assert.match(layoutSource, /<NativeAppBackdrop\/>/);
  assert.match(cssSource, /\.native-app-backdrop img \{[^}]*filter:blur\(56px\) saturate\(1\.12\)/);
  assert.match(cssSource, /\.zaui-page:not\(\.screen-player\)[\s\S]*background:transparent/);
  assert.match(cssSource, /body\.ios-app \.app-header\.zaui-header,[\s\S]*background:rgba\(10,11,14,\.10\)/);
  assert.match(cssSource, /\.chart-surface,[\s\S]*background:rgba\(20,21,25,\.05\)/);
  assert.match(cssSource, /body\.ios-app \.today-month-summary,[\s\S]*background:rgba\(20,21,25,\.05\)/);
  assert.match(cssSource, /\.native-mini-player \{[\s\S]*background: rgba\(25,26,31,\.22\)/);
  assert.match(cssSource, /body\.ios-app \.card\.song-list,[\s\S]*background:transparent/);
  assert.match(mainSource, /export function RecentSongs\(\{rows\}:\{rows:Any\[\]\}\) \{\s*return <div className="card song-list">/);
  assert.match(cssSource, /body\.ios-app \.month-summary-head,[\s\S]*background:rgba\(20,21,25,\.05\)/);
  assert.match(cssSource, /body\.ios-app \.seg,[\s\S]*background:rgba\(20,21,25,\.05\)/);
  assert.match(cssSource, /body\.ios-app \.release-tabs button:not\(\.on\)[\s\S]*background:rgba\(20,21,25,\.10\)/);
  assert.match(uiSource, /className="card pad chart-surface"/);
});

test('mini player has previous control and month summary metrics stay on one line', () => {
  assert.match(nativePlayerSource, /aria-label="Bài trước"[\s\S]*controlNativePlayer\("previous"\)/);
  assert.match(nativePlayerSource, /native-mini-title[\s\S]*<small>\{time\(now\.duration\)\}<\/small>/);
  assert.match(nativePlayerSource, /native-mini-year[\s\S]*native-mini-queue-count/);
  assert.match(cssSource, /\.native-mini-player \{[\s\S]*grid-template-columns: minmax\(0,1fr\) 44px 44px 44px/);
  assert.match(cssSource, /\.native-mini-title \{[^}]*text-overflow:ellipsis/);
  assert.match(cssSource, /\.native-mini-copy strong small \{[^}]*white-space:nowrap/);
  assert.match(cssSource, /\.native-mini-album-line \{[^}]*white-space:nowrap/);
  assert.match(cssSource, /\.month-summary-person > \.ell \{[^}]*white-space:nowrap/);
  assert.match(cssSource, /\.month-summary-person b \{[^}]*white-space:nowrap/);
});

test('native queue restore survives a temporarily unavailable now-playing item', () => {
  const restore = bridge.slice(
    bridge.indexOf('private func restoreManagedQueueIfNeeded()'),
    bridge.indexOf('private static func sameMediaItem')
  );

  assert.match(bridge, /managedQueueIndexKey = "statsManagedQueueIndex"/);
  assert.match(restore, /managedQueueIndex = min\(max\(savedIndex, 0\), restored\.count - 1\)/);
  assert.doesNotMatch(restore, /let current = player\.nowPlayingItem/);
});

test('queue rows omit rank sparklines and playlist last-play lookup avoids full library refresh', () => {
  const tracks = bridge.slice(
    bridge.indexOf('func tracks(playlistID: UInt64)'),
    bridge.indexOf('func bootstrap()')
  );

  assert.doesNotMatch(playerSource, /NativeQueueRankSparkline|native-queue-rank-spark/);
  assert.doesNotMatch(cssSource, /native-queue-rank-spark/);
  assert.doesNotMatch(tracks, /refresh\(\)|refreshLibraryTrackIndex|libraryItemsByID/);
  assert.match(tracks, /playlistObjects\[playlistID\]/);
});

test('native queue position is persisted as playback advances', () => {
  const sync = bridge.slice(
    bridge.indexOf('private func syncManagedQueueIndex()'),
    bridge.indexOf('private func refreshSystemQueueIfAvailable()')
  );

  assert.match(sync, /saveManagedQueueIndex\(\)/);
  assert.match(bridge, /UserDefaults\.standard\.set\(managedQueueIndex, forKey: managedQueueIndexKey\)/);
});

test('large widget queue rows play upcoming items without rebuilding the queue', () => {
  const upcomingIntent = widgetIntent.slice(
    widgetIntent.indexOf('struct PlayStatsUpcomingItemIntent'),
    widgetIntent.indexOf('struct ChangeStatsQueuePageIntent')
  );
  const largeContent = widgetView.slice(
    widgetView.indexOf('private var largeContent'),
    widgetView.indexOf('@ViewBuilder private var playbackButton')
  );
  const queueRowLabel = widgetView.slice(
    widgetView.indexOf('private func queueRowLabel'),
    widgetView.indexOf('private func duration')
  );

  assert.match(upcomingIntent, /struct PlayStatsUpcomingItemIntent: AudioPlaybackIntent/);
  assert.match(upcomingIntent, /player\.skipToNextItem\(\)/);
  assert.match(upcomingIntent, /let safeSteps = min\(max\(steps, 1\), 40\)/);
  assert.doesNotMatch(upcomingIntent, /setQueue/);
  assert.match(widgetView, /Button\(intent: PlayStatsUpcomingItemIntent\(steps: steps\)\)/);
  assert.match(widgetIntent, /struct ChangeStatsQueuePageIntent: AppIntent/);
  assert.match(widgetView, /Button\(intent: ChangeStatsQueuePageIntent\(page: page\)\)/);
  assert.match(bridge, /\.prefix\(40\)\.map/);
  assert.match(largeContent, /snapshot\.queuePosition.*snapshot\.queueCount/);
  assert.doesNotMatch(largeContent, /snapshot\.plays/);
  assert.doesNotMatch(queueRowLabel, /Color\.white\.opacity\(0\.08\)/);
  assert.doesNotMatch(widgetView, /Divider\(\)\.overlay\(Color\.white\.opacity\(0\.08\)\)/);
  assert.doesNotMatch(queueRowLabel, /item\.plays/);
  assert.match(queueRowLabel, /font\(\.system\(size: 10, weight: \.medium/);
  assert.doesNotMatch(queueRowLabel, /item\.duration >= 6 \* 60/);
  assert.match(widgetView, /timerInterval: entry\.date\.addingTimeInterval/);
  assert.match(widgetView, /\.labelsHidden\(\)/);
  assert.match(widgetView, /\.frame\(maxWidth: \.infinity\)/);
  assert.match(widgetView, /snapshot\.duration/);
  assert.match(widgetView, /snapshot\.elapsed/);
  assert.match(widgetView, /snapshot\.queueUpcomingDuration/);
  assert.match(widgetView, /remainingTime\(remainingDuration\)/);
  assert.doesNotMatch(queueRowLabel, /joined\(separator: " · "\)/);
});

test('widget timeline reconciles its saved queue with the live Apple Music item', () => {
  assert.match(widgetView, /import MediaPlayer/);
  assert.match(widgetView, /MPMusicPlayerController\.systemMusicPlayer/);
  assert.match(widgetView, /queue\.firstIndex/);
  assert.match(widgetView, /Array\(queue\.dropFirst\(advancedIndex \+ 1\)\)/);
  assert.match(widgetView, /reuseSavedArtwork/);
  assert.match(widgetView, /addingTimeInterval\(5 \* 60\)/);
});

test('large widget exposes the native repeat control', () => {
  assert.match(widgetIntent, /struct ToggleStatsRepeatIntent: AudioPlaybackIntent/);
  assert.match(widgetIntent, /player\.repeatMode = \.one/);
  assert.match(widgetIntent, /player\.repeatMode = \.none/);
  assert.match(widgetIntent, /player\.repeatMode = \.all/);
  assert.match(widgetView, /Button\(intent: ToggleStatsRepeatIntent\(\)\)/);
  assert.match(widgetView, /entry\.snapshot\.repeatMode == "one"/);
});

test('medium widget has separate open and play actions for each playlist', () => {
  assert.match(widgetIntent, /struct OpenStatsPlaylistIntent: AppIntent/);
  assert.match(widgetIntent, /static var openAppWhenRun = true/);
  assert.match(widgetIntent, /statsWidgetPlaylistSelectionKey/);
  assert.match(widgetIntent, /struct PlayStatsPlaylistIntent: AudioPlaybackIntent/);
  assert.match(widgetIntent, /struct PlayStatsPlaylistNextIntent: AudioPlaybackIntent/);
  assert.match(widgetIntent, /player\.setQueue\(with: playlist\)/);
  assert.match(widgetIntent, /player\.prepend\(MPMusicPlayerMediaItemQueueDescriptor\(itemCollection: playlist\)\)/);
  assert.match(widgetView, /Text\("TOP PLAYLIST · 15 NGÀY"\)/);
  assert.match(widgetView, /LazyVGrid/);
  assert.match(widgetView, /Array\(\$0\.prefix\(4\)\)/);
  assert.match(widgetView, /OpenStatsPlaylistIntent\(playlistID: playlist\.id\)/);
  assert.match(widgetView, /PlayStatsPlaylistIntent\(playlistID: playlist\.id\)/);
  assert.match(widgetView, /accessibilityLabel\("Phát/);
  assert.doesNotMatch(widgetView, /PlayStatsPlaylistNextIntent\(playlistID: playlist\.id\)/);
  assert.doesNotMatch(widgetView, /private func playlistActionLabel/);
  assert.match(widgetView, /Text\(playlistName\(playlist\.name\)\)[\s\S]*?\.lineLimit\(2\)[\s\S]*?\.truncationMode\(\.tail\)/);
  assert.match(widgetView, /Text\(playlistName\(playlist\.name\)\)[\s\S]*?Spacer\(minLength: 0\)[\s\S]*?Text\("\\\(playlist\.trackCount\) bài"\)/);
  assert.ok(widgetView.includes('replacingOccurrences(of: "+", with: " ")'));
  assert.match(widgetView, /\.padding\(\.top, 3\)[\s\S]*?\.padding\(\.bottom, 5\)[\s\S]*?alignment: \.topLeading/);
  assert.match(widgetView, /savedPlaylists\.isEmpty \? backupPlaylists : savedPlaylists/);
  assert.match(bridge, /guard !playlists\.isEmpty else \{ return true \}/);
  assert.match(bridge, /writeWidgetData\(encoded, account: widgetPlaylistsBackupKey\)/);
  assert.match(bridge, /func updateWidgetPlaylists\(payload: String\)/);
  assert.match(bridge, /func consumeWidgetPlaylistSelection\(\)/);
  assert.ok(localServer.includes('rawPath.replacingOccurrences(of: "+", with: "%20")'));
});

test('native playback start overrides delayed Apple Music last-played metadata', () => {
  assert.match(widgetIntent, /statsWidgetRecentPlayStartsKey = "statsRecentPlayStarts"/);
  assert.match(widgetIntent, /recordStatsWidgetPlayStart\(player\.nowPlayingItem\)/);
  assert.match(bridge, /let recentPlayStarts: \[String: String\]/);
  assert.match(bridge, /recordRecentPlayStartIfNeeded\(item\)/);
  assert.match(bridge, /recentPlayStarts: recentPlayStarts\(\)/);
});

test('native playlist tracks expose live Apple Music last-played metadata', () => {
  const tracks = bridge.slice(
    bridge.indexOf('func tracks(playlistID: UInt64)'),
    bridge.indexOf('func bootstrap()')
  );

  assert.match(bridge, /let persistentID: String/);
  assert.match(bridge, /let lastPlayed: String\?/);
  assert.match(tracks, /item\.lastPlayedDate, recordedStart/);
  assert.match(tracks, /lastPlayed: latestPlayed\.map\(Self\.isoString\)/);
  assert.doesNotMatch(tracks, /refresh\(\)|refreshLibraryTrackIndex|libraryItemsByID/);
  assert.match(webBridge, /cache:\s*"no-store"/);
  assert.match(localServer, /Cache-Control: no-store, max-age=0/);
});

test('native queue shows library last-played age and preserves out-of-library metrics', () => {
  assert.match(bridge, /struct BridgeQueueItem: Codable \{[\s\S]*?let lastPlayed: String\?/);
  assert.match(bridge, /let lastPlayed = inLibrary[\s\S]*?\[item\.lastPlayedDate, libraryItem\?\.lastPlayedDate, playedStart\]/);
  assert.match(bridge, /lastPlayed: lastPlayed\.map\(Self\.isoString\)/);
  assert.match(nativePlayerSource, /function NativeQueueListeningStatus\([\s\S]*?if \(track\.inLibrary !== false\)[\s\S]*?return <NativeListeningMetrics track=\{track\} inline \/>/);
  assert.match(nativePlayerSource, /elapsedAgeLabel\(lastPlayed\)/);
});
