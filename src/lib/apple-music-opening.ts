type Device = { userAgent: string; platform?: string; maxTouchPoints?: number };

function appleMusicHttpsUrl(link: string): URL {
  const url = new URL(link);
  if (url.protocol !== 'https:' || url.hostname !== 'music.apple.com' || url.username || url.password || url.port
    || !/^\/[a-z]{2}\/(?:album|song|artist)\/(?:[^/]+\/)?\d+\/?$/.test(url.pathname)) throw Error('Invalid Apple Music link');
  return url;
}

// Confirmed working by the user in Zalo on iOS (2026-10-03). Keep the
// navigator receiver and invoke share in the tap, without an async lookup first.
export function shareAppleMusicLink(link: string, target: {share(data: {url: string}): Promise<void>}): Promise<void> {
  const url = appleMusicHttpsUrl(link);
  return target.share({url:url.href});
}

export function appleMusicNativeUrl(link: string): string {
  const url = appleMusicHttpsUrl(link);
  return url.href.replace(/^https:/, 'musics:');
}

export function appleMusicStoreId(link: string): string | undefined {
  const url = appleMusicHttpsUrl(link);
  const trackID = url.searchParams.get('i');
  if (trackID && /^\d+$/.test(trackID)) return trackID;
  const pathID = url.pathname.match(/\/(\d+)\/?$/)?.[1];
  return pathID && /^\d+$/.test(pathID) ? pathID : undefined;
}

// Report only a numeric SDK code, never native payloads or access tokens.
export function appleMusicOpenError(error: unknown): string {
  if (error instanceof Error && error.message === 'external_open_timeout') return 'AM5:TIMEOUT';
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  return /^-?\d+$/.test(code) ? `AM5:ERR:${code}` : 'AM5:ERR';
}

export function appleMusicTarget(link: string, device: Device): string {
  const url = new URL(link);
  if (url.protocol !== 'https:' || url.hostname !== 'music.apple.com' || url.username || url.password || url.port
    || !/^\/[a-z]{2}\/(?:album\/[^?#]+|search)$/.test(url.pathname)) throw Error('Invalid Apple Music link');
  const ios = /iPhone|iPad|iPod|\biOS\b/i.test(device.userAgent)
    || device.platform === 'MacIntel' && (device.maxTouchPoints || 0) > 1;
  // HTTPS may stay inside Zalo's browser. Address Music directly on iOS.
  // Do not fall back to openWebview if Zalo rejects the external-app request.
  return ios ? url.href.replace(/^https:/, 'musics:') : url.href;
}

export function requestAppleMusicOpen(
  link: string, device: Device, openExternal: (args: {url: string}) => Promise<void>, timeoutMs = 6000,
): Promise<void> {
  const url = appleMusicTarget(link, device);
  // Invoke the bridge immediately in the tap handler, not in a timer/effect.
  // A missing native callback must not leave the controls disabled indefinitely.
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(()=>reject(new Error('external_open_timeout')), timeoutMs);
    try {
      Promise.resolve(openExternal({url})).then(
        ()=>{clearTimeout(timer);resolve();},
        error=>{clearTimeout(timer);reject(error);},
      );
    } catch(error) { clearTimeout(timer);reject(error); }
  });
}
