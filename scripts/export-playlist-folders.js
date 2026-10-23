const Music = Application('Music');
const playlists = Music.userPlaylists();

function safe(read, fallback = null) {
  try { return read(); } catch { return fallback; }
}

function folderPath(playlist) {
  const names = [];
  const seen = new Set();
  let current = safe(() => playlist.parent());
  while (current) {
    const id = safe(() => current.persistentID(), '');
    if (!id || seen.has(id)) break;
    seen.add(id);
    const name = safe(() => current.name(), '');
    if (name) names.unshift(name);
    current = safe(() => current.parent());
  }
  return names.join(' / ');
}

const rows = playlists.map(playlist => {
  const path = folderPath(playlist) || 'Apple Music';
  return {
    id: safe(() => playlist.persistentID(), ''),
    name: safe(() => playlist.name(), 'Untitled Playlist'),
    folder: path,
    path,
  };
});

const folders = [...new Set(rows.map(row => row.folder))];
JSON.stringify({ generatedAt: new Date().toISOString(), folders, playlists: rows });
