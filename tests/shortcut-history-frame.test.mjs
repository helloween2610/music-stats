import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const compiled=await build({
  stdin:{contents:"export {ShortcutHistoryFrame} from './src/components/shortcut-history-frame';",resolveDir:process.cwd()},
  bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',
});
const {ShortcutHistoryFrame}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
test('history body is reserved during loading, success, empty and error states',()=>{
  const chart={type:'svg'};
  for(const props of [{loading:true},{error:true},{},{children:chart}]){
    const frame=ShortcutHistoryFrame(props);
    const body=frame.props.children[1];
    assert.equal(frame.props.className,'shortcut-song-history-chart');
    assert.equal(body.props.className,'shortcut-history-body');
    if(props.children)assert.equal(body.props.children,chart);
    else assert.equal(body.props.children.props.role,'status');
  }
});
test('weekly history preserves the same heading and body while data loads',()=>{
  for(const loading of [true,false]){
    const frame=ShortcutHistoryFrame({weekly:true,heading:'Weekly',loading});
    assert.equal(frame.props.children[0].props.children,'Weekly');
    assert.equal(frame.props.children[1].props.className,'shortcut-history-body weekly');
    assert.equal(frame.props['aria-busy'],loading || undefined);
  }
});
