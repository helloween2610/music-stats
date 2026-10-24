import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';

test('iPhone keeps motion when the system requests reduction; web still respects it',async()=>{
  for(const ios of [true,false]){
    const result=await build({entryPoints:['src/lib/motion-preference.ts'],bundle:true,write:false,format:'esm',platform:'node',alias:{'@':'./src'},define:{'import.meta.env':'{}','import.meta.env.VITE_IOS_APP':JSON.stringify(String(ios))}});
    const {shouldReduceMotion}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
    globalThis.window={matchMedia:()=>({matches:true})};
    assert.equal(shouldReduceMotion(),!ios);
    globalThis.window={matchMedia:()=>({matches:false})};
    assert.equal(shouldReduceMotion(),false);
  }
  delete globalThis.window;
});

test('native lightweight response returns before queue enumeration and widget publishing',async()=>{
  const source=await readFile('ios/App/App/PebbleMusicBridge.swift','utf8');
  const state=source.slice(source.indexOf('func playerState('),source.indexOf('func artworkData('));
  const fast=state.slice(state.indexOf('if !includeQueue'),state.indexOf('refreshSystemQueueIfAvailable()'));
  assert.match(fast,/!systemQueuePositionChanged\(\)/);
  assert.match(fast,/cached.nowPlaying.persistentID == now.persistentID/);
  assert.match(fast,/return BridgePlayerState/);
  assert.match(fast,/queue: cached.queue/);
  assert.doesNotMatch(fast,/publishWidgetSnapshot|recentPlayStarts\(\)|managedQueue.enumerated/);
  assert.match(state,/nowPlaying\(refreshQueue: false\)/);
  assert.match(source,/guard refreshQueue else \{ return \}/);
});
