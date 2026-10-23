import type { Env } from "./index";
import { importLibrary, librarySyncRequest, libraryTracks, setLibraryRequest } from "./libraryImport";
import { syncFiles } from "./syncFiles";
import { prepareCatalog, commitCatalog } from "./catalogSync";
import { parseLibraryXml, planLibraryImport } from "./libraryXml";
import { parsePlaylistSnapshot, savePlaylistSnapshot } from "./playlistSnapshot";

export async function runLibrarySync(env: Env, jobId: string) {
  const request = await librarySyncRequest(env);
  if (request.job_id !== jobId || request.status !== "pending") return;
  const phase = (message: string) => setLibraryRequest(env, { ...request, phase: message });
  await phase("Đang kiểm tra XML và các file ID…");
  const files=await syncFiles(env),xml=files.get('Library.xml')!;
  const previous=await env.DB.prepare("SELECT value FROM sync_state WHERE key='library_cloud_source'").first<{value:string}>();
  const saved=previous?JSON.parse(previous.value):null;
  const hasPlaylistSnapshot=!!(await env.DB.prepare("SELECT 1 FROM sync_state WHERE key='playlist_snapshot'").first());
  let summary:any={...saved?.summary,added:0,changed:0,missing:0,metadata_changed:0,unchanged:true,downloaded_bytes:0};
  let plan:ReturnType<typeof planLibraryImport>|undefined;
  let playlistsSaved=false, playlistCount=0, playlistEntries=0;
  const xmlChanged=saved?.fingerprint!==xml.fingerprint;
  if(xmlChanged||!hasPlaylistSnapshot){
    await phase("Đang tải và đọc Library.xml…");
    const bytes=await xml.read();
    if(xmlChanged){
      const parsed=await parseLibraryXml(new ReadableStream<Uint8Array>({start(c){c.enqueue(bytes);c.close();}}));
      const tracks=await libraryTracks(env,0,100_000);
      plan=planLibraryImport(parsed.rows,tracks);
      summary={source:'Library.xml',tracks:parsed.rows.length,added:plan.added,changed:plan.changed,missing:plan.missing,
        metadata_changed:plan.metadataChanged,file_modified:parsed.exportedAt,downloaded_bytes:parsed.bytes,playlist_only_excluded:parsed.playlistOnly};
    }
    const playlistSnapshot=parsePlaylistSnapshot(bytes);
    playlistsSaved=await savePlaylistSnapshot(env,playlistSnapshot);
    playlistCount=playlistSnapshot.playlists.length;
    playlistEntries=playlistSnapshot.playlists.reduce((n,p)=>n+p.items.length,0);
  }
  await phase("Đang đọc và kiểm tra ID Apple Music…");
  const catalog=await prepareCatalog(env.DB,jobId,files);
  if(plan)for(let i=0;i<plan.upserts.length;i+=200){
    await phase(`Đang cập nhật thư viện… ${Math.min(i+200,plan.upserts.length)}/${plan.upserts.length}`);
    const result=await importLibrary(env,{upserts:plan.upserts.slice(i,i+200) as any});
    if('error' in result)throw Error('Không nhập được dữ liệu thư viện.');
  }
  await phase("Đang lưu ID Apple Music…");
  await commitCatalog(env.DB,jobId,catalog);
  summary.catalog_files=catalog.files;summary.catalog_keys=catalog.keys;summary.catalog_changed=catalog.changed;
  summary.catalog_configured=files.size>1;
  if(playlistsSaved){summary.playlists=playlistCount;summary.playlist_entries=playlistEntries;}
  await env.DB.prepare("INSERT OR REPLACE INTO sync_state(key,value,updated_at) VALUES ('library_cloud_source',?1,datetime('now'))")
    .bind(JSON.stringify({fingerprint:xml.fingerprint,summary})).run();
  await importLibrary(env,{finish:{changed:!!plan?.upserts.length||catalog.changed,reset_match:plan?.resetMatch,summary}});
}

export async function consumeLibrarySyncMessage(message: Message<{ jobId: string }>, env: Env) {
    try { await runLibrarySync(env, message.body.jobId); message.ack(); }
    catch (error) {
      const state = await librarySyncRequest(env);
      if (state.job_id !== message.body.jobId) { message.ack(); return; }
      // Never expose signed Apple URLs or raw parser/SQL errors to the client.
      const raw = error instanceof Error ? error.message : "";
      console.warn("library sync failed", { phase: state.phase, attempt: message.attempts, error: raw.replace(/https?:\/\/\S+/g, "[URL]").slice(0, 250) });
      const reason = /^(Không |iCloud |Kích thước |Địa chỉ |File tải |Library.xml )/.test(raw) && !raw.includes("https:")
        ? raw : "Đồng bộ gặp lỗi. Hãy thử lại sau.";
      if (message.attempts < 3) {
        await setLibraryRequest(env, { ...state, status: "pending", phase: "Đang thử lại tải dữ liệu đồng bộ…" });
        message.retry({ delaySeconds: 30 });
      } else {
        await setLibraryRequest(env, { ...state, status: "failed", done_at: new Date().toISOString(), error: reason });
        message.ack();
      }
    }
}

export async function consumeLibrarySync(batch: MessageBatch<{ jobId: string }>, env: Env) {
  for (const message of batch.messages) {
    await consumeLibrarySyncMessage(message,env);
  }
}
