let reading: Set<string> | undefined;

/** A view only needs to redraw for requests it actually consumed. */
export function recordApiRead(path: string) { reading?.add(path); }

export function collectApiReads<T>(read: () => T): {value:T;paths:Set<string>} {
  const previous=reading;
  const paths=new Set<string>();
  reading=paths;
  try { return {value:read(),paths}; }
  finally {
    reading=previous;
    paths.forEach(path=>previous?.add(path));
  }
}

export function affectsApiReads(paths:Set<string>|undefined,path?:string) {
  return path===undefined || paths===undefined || paths.has(path);
}
