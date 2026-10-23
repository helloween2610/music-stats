import { unzipSync } from 'fflate';

export const SYNC_NAMES=['Library.xml','Apple Music Library Tracks.json','Apple Music Library Albums.json','Apple Music Library Artists.json','Apple Music Library Playlists.json'] as const;
export type SyncName=typeof SYNC_NAMES[number];
export type SyncFile={fingerprint:string;read:()=>Promise<Uint8Array>};
const MAX_FILE=50_000_000,MAX_BUNDLE=80_000_000;
export async function readBounded(response:Response,limit=MAX_FILE){
  if(!response.ok||!response.body)throw Error('Không tải được file đồng bộ. Hãy kiểm tra liên kết chia sẻ.');
  const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw Error('Kích thước file đồng bộ vượt giới hạn.');parts.push(value);}}
  finally{await reader.cancel();}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return bytes;
}
export async function checksum(bytes:Uint8Array){
  const hash=await crypto.subtle.digest('SHA-256',bytes as BufferSource);return [...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export async function icloudFile(shareId:string,fetcher:typeof fetch=fetch):Promise<SyncFile>{
  if(!/^[\w-]{15,50}$/.test(shareId))throw Error('Không đọc được mã chia sẻ iCloud.');
  const response=await fetcher('https://ckdatabasews.icloud.com/database/1/com.apple.cloudkit/production/public/records/resolve',{
    method:'POST',headers:{'content-type':'text/plain',origin:'https://www.icloud.com'},body:JSON.stringify({shortGUIDs:[{value:shareId}]}),signal:AbortSignal.timeout(60000),
  });
  if(!response.ok)throw Error('Không đọc được liên kết iCloud. Hãy thử lại.');
  const data:any=await response.json(),record=data.results?.[0]?.rootRecord,asset=record?.fields?.fileContent?.value;
  if(!asset?.downloadURL||!asset.fileChecksum)throw Error('iCloud chưa cung cấp file để tải. Cần link chia sẻ riêng từng file hoặc thư mục Dropbox.');
  if(!Number.isFinite(asset.size)||asset.size<=0||asset.size>MAX_FILE)throw Error('Kích thước file đồng bộ không hợp lệ (tối đa 50 MB).');
  const url=new URL(asset.downloadURL.replace('${f}','sync-data'));
  if(url.protocol!=='https:'||!url.hostname.endsWith('.icloud-content.com'))throw Error('Địa chỉ tải iCloud không hợp lệ.');
  return {fingerprint:`${shareId}:${asset.fileChecksum}:${asset.size}`,async read(){
    const bytes=await readBounded(await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(120000)}));
    if(bytes.length!==asset.size)throw Error('File tải về chưa đầy đủ; chưa nhập dữ liệu.');return bytes;
  }};
}
function dropboxURL(value:string){
  const url=new URL(value);
  if(url.protocol!=='https:'||!['www.dropbox.com','dropbox.com'].includes(url.hostname)||!/^\/(?:s|scl)\//.test(url.pathname)||url.username||url.password||url.port)throw Error('Địa chỉ Dropbox không hợp lệ.');
  url.searchParams.delete('raw');url.searchParams.set('dl','1');url.hash='';return url;
}
export function bundleFiles(bytes:Uint8Array):Map<SyncName,Uint8Array>{
  let total=0;const files=new Map<SyncName,Uint8Array>();
  const entries=unzipSync(bytes,{filter(entry){
    const name=entry.name.split('/').pop() as SyncName;
    if(!SYNC_NAMES.includes(name)||entry.name.startsWith('__MACOSX/'))return false;
    total+=entry.originalSize;
    if(entry.originalSize>MAX_FILE||total>MAX_BUNDLE)throw Error('Kích thước dữ liệu giải nén vượt giới hạn.');return true;
  }});
  for(const [path,data] of Object.entries(entries)){
    const name=path.split('/').pop() as SyncName;
    if(files.has(name))throw Error('Không thể đồng bộ: có nhiều file trùng tên '+name+'.');files.set(name,data);
  }
  for(const name of SYNC_NAMES)if(!files.has(name))throw Error('Không tìm thấy '+name+' trong thư mục đồng bộ.');
  return files;
}
export async function syncFiles(config:{LIBRARY_SHARE_ID:string;SYNC_DATA_URL?:string;SYNC_FILES_JSON?:string},fetcher:typeof fetch=fetch):Promise<Map<SyncName,SyncFile>>{
  const result=new Map<SyncName,SyncFile>();
  if(config.SYNC_DATA_URL){
    const bytes=await readBounded(await fetcher(dropboxURL(config.SYNC_DATA_URL),{signal:AbortSignal.timeout(120000)}),MAX_BUNDLE);
    for(const [name,data] of bundleFiles(bytes))result.set(name,{fingerprint:await checksum(data),read:async()=>data});
  }else if(config.SYNC_FILES_JSON){
    const sources=JSON.parse(config.SYNC_FILES_JSON);
    for(const name of SYNC_NAMES){
      const source=sources[name];if(typeof source!=='string')throw Error('Không tìm thấy liên kết '+name+'.');
      const url=new URL(source);
      if(url.protocol==='https:'&&url.hostname==='www.icloud.com'&&/^\/iclouddrive\/[\w-]+$/.test(url.pathname))result.set(name,await icloudFile(url.pathname.split('/').pop()!,fetcher));
      else{
        const bytes=await readBounded(await fetcher(dropboxURL(source),{signal:AbortSignal.timeout(120000)}));
        result.set(name,{fingerprint:await checksum(bytes),read:async()=>bytes});
      }
    }
  }else result.set('Library.xml',await icloudFile(config.LIBRARY_SHARE_ID,fetcher));
  return result;
}
