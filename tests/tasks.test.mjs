import assert from 'node:assert/strict';
import test from 'node:test';
import { mediaExtension, services, taskResult } from '../src/services.ts';
const id='example-task', url='https://cdn.acedata.cloud/example';
for (const [service,{field}] of Object.entries(services)) {
  test(`${service} reads its native result shape`, () => {
    const row={ [field]:url };
    const response=service==='kling'?row:service==='seedance'?{data:{content:row}}:{data:[row]};
    assert.equal(taskResult(service,id,{id,response}).assets[0].url,url);
  });
}
test('requires matching IDs and uncredentialed HTTPS files',()=>{
  assert.throws(()=>taskResult('suno',id,{id:'different'}));
  assert.throws(()=>taskResult('suno',id,{id,response:{task_id:'other'}}));
  for(const unsafe of ['http://example.test/x.mp3','https://user:pass@example.test/x','javascript:alert(1)']) {
    assert.deepEqual(taskResult('suno',id,{id,response:{data:[{audio_url:unsafe}]}}).assets,[]);
  }
  assert.equal(taskResult('suno',id,{id,response:{state:'processing'}}).state,'processing');
});
test('detects supported formats from file bytes',()=>{
  assert.equal(mediaExtension('image',new Uint8Array([137,80,78,71,13,10,26,10])),'png');
  assert.equal(mediaExtension('audio',Buffer.from('RIFF0000WAVE')),'wav');
  assert.equal(mediaExtension('video',Buffer.from('0000ftypisom')),'mp4');
  assert.throws(()=>mediaExtension('image',Buffer.from('<html>')));
});
