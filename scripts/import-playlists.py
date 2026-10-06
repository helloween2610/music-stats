#!/usr/bin/env python3
"""Read an Apple Music XML snapshot; never sync or alter library membership."""
import argparse
import json
import plistlib
from pathlib import Path

FOLDERS = ('_New Music', '00_COLLECTION')

def extract(data):
    playlists = data.get('Playlists', [])
    by_id = {p.get('Playlist Persistent ID'): p for p in playlists}
    def path(p):
        names, seen = [], set()
        while p:
            pid = p.get('Playlist Persistent ID')
            if not pid or pid in seen:
                return None
            seen.add(pid)
            if p.get('Folder'):
                if not p.get('Parent Persistent ID'):
                    return [p.get('Name', '')] + list(reversed(names))
            if p.get('Folder'):
                names.append(p.get('Name', ''))
            p = by_id.get(p.get('Parent Persistent ID'))
        return None
    selected, tracks = [], {}
    source = data.get('Tracks', {})
    for p in playlists:
        folder_path = path(p) or ['Apple Music']
        favourite = bool(p.get('Favorited') or p.get('Loved'))
        if p.get('Folder') or (folder_path[0] not in FOLDERS and not favourite):
            continue
        items = []
        for item in p.get('Playlist Items', []):
            tid = str(item['Track ID'])
            row = source.get(tid)
            items.append(tid)  # Keep original order and repetitions, including unresolved IDs.
            if tid in tracks:
                continue
            if not row:
                tracks[tid] = {'title': 'Bài chưa có thông tin trong XML', 'missing': True}
                continue
            tracks[tid] = {
                'title': row.get('Name', ''), 'artist': row.get('Artist') or row.get('Album Artist', ''),
                'album': row.get('Album', ''), 'albumArtist': row.get('Album Artist', ''),
                'duration': int(row.get('Total Time', 0) / 1000), 'year': row.get('Year', 0),
                'persistentId': row.get('Persistent ID', ''), 'inLibrary': not row.get('Playlist Only', False),
            }
        selected.append({'id': p['Playlist Persistent ID'], 'name': p['Name'],
                         'favourite': favourite, 'folder': folder_path[0], 'path': ' / '.join(folder_path), 'items': items})
    selected.sort(key=lambda p: (FOLDERS.index(p['folder']) if p['folder'] in FOLDERS else len(FOLDERS), p['path'].casefold(), p['name'].casefold()))
    date = data.get('Date')
    return {'exportedAt': date.isoformat() + 'Z' if date else None, 'folders': list(FOLDERS),
            'playlists': selected, 'tracks': tracks}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('xml', type=Path)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'src/data/playlists.json')
    args = parser.parse_args()
    with args.xml.open('rb') as f:
        result = extract(plistlib.load(f))
    if not result['playlists']:
        raise SystemExit('Không tìm thấy playlist trong các nhóm yêu cầu; giữ nguyên bản hiện có.')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(f"{len(result['playlists'])} playlists; {sum(len(p['items']) for p in result['playlists'])} entries; {len(result['tracks'])} distinct XML tracks")
