import { loadApplePlaylistSong, loadApplePlaylistSongLine, type ApplePlaylistSong } from '@/lib/discovery';

export type PastedPlaylistSong = {
  line: number;
  raw: string;
  title: string;
  artist: string;
};

export type PlaylistImportRow = PastedPlaylistSong & {
  status: 'ready' | 'finding' | 'found' | 'adding' | 'added' | 'exists' | 'error';
  match?: ApplePlaylistSong;
  message?: string;
};

function decodeEntities(value: string) {
  const named: Record<string, string> = { amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"' };
  return value.replace(/&(?:#(x[\da-f]+|\d+)|([a-z]+));/gi, (entity, numeric: string | undefined, name: string | undefined) => {
    if (numeric) {
      const hex = numeric[0]?.toLowerCase() === 'x';
      const code = Number.parseInt(hex ? numeric.slice(1) : numeric, hex ? 16 : 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }
    return named[String(name || '').toLowerCase()] ?? entity;
  });
}

const clean = (value: string) => decodeEntities(value)
  .replace(/<br\s*\/?>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\\([*_`])/g, '$1')
  .replace(/\s+/g, ' ')
  .trim();

function parseLine(raw: string, line: number): PastedPlaylistSong | null {
  const source = raw.replace(/\\+\s*$/, '');
  const htmlEmphasis = /(?:<strong\b[^>]*>([\s\S]*?)<\/strong>|<b\b[^>]*>([\s\S]*?)<\/b>)([\s\S]*)/i.exec(source);
  if (htmlEmphasis) {
    const title = clean(htmlEmphasis[1] || htmlEmphasis[2] || '');
    const artist = clean((htmlEmphasis[3] || '').replace(/^\s*(?:[-–—|:\t]+)\s*/, ''));
    return title && artist ? { line, raw, title, artist } : null;
  }
  const markdown = /^\s*(?:[-*+]\s+|\d+[.)]\s+)?\*\*(.+?)\*\*(.*)\s*$/.exec(source);
  if (markdown) {
    const title = clean(markdown[1]);
    const artist = clean(markdown[2].replace(/^\s*(?:[-–—|:\t]+)\s*/, ''));
    return title && artist ? { line, raw, title, artist } : null;
  }
  const unnumbered=decodeEntities(source.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, ''));
  const tabParts=unnumbered.split(/\t+/);
  if(tabParts.length>=2){
    const title=clean(tabParts.shift() || ''),artist=clean(tabParts.join(' '));
    if(title&&artist)return {line,raw,title,artist};
  }
  const text = clean(unnumbered);
  for (const separator of [/\s+[–—]\s+/, /\s+\|\s+/]) {
    const parts = text.split(separator);
    if (parts.length >= 2) {
      const title = parts.shift()?.trim() || '';
      const artist = parts.join(' ').trim();
      if (title && artist) return { line, raw, title, artist };
    }
  }
  return null;
}

export function parsePastedPlaylistSongs(value: string): PastedPlaylistSong[] {
  const seen = new Set<string>();
  const rows = value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:div|p|li|tr|h[1-6])\s*>/gi, '\n');
  return rows.split(/\r?\n/).flatMap((raw, index) => {
    const row = parseLine(raw, index + 1);
    if (!row) return [];
    const key = `${row.title}\u001f${row.artist}`.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    return [row];
  });
}

export function parsePastedPlaylistSongCandidates(value:string):PastedPlaylistSong[] {
  const seen=new Set<string>();
  const rows=value.replace(/<br\s*\/?>/gi,'\n').replace(/<\/(?:div|p|li|tr|h[1-6])\s*>/gi,'\n');
  return rows.split(/\r?\n/).flatMap((raw,index)=>{
    const parsed=parseLine(raw,index+1);
    const fallback=clean(raw.replace(/\\+\s*$/,''));
    const row=parsed || (fallback ? {line:index+1,raw,title:fallback,artist:''} : null);
    if(!row)return [];
    const key=(row.artist ? `${row.title}\u001f${row.artist}` : row.raw).normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().trim();
    if(!key || seen.has(key))return [];
    seen.add(key);return [row];
  });
}

export function formatPastedPlaylistSongs(rows: PastedPlaylistSong[]) {
  return rows.map(row => `${row.title}\t${row.artist}`).join('\n');
}

export async function findPastedPlaylistSong(row: PastedPlaylistSong): Promise<ApplePlaylistSong> {
  return row.artist ? loadApplePlaylistSong(row.artist, row.title) : loadApplePlaylistSongLine(row.raw);
}
