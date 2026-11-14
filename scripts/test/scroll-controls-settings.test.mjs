import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const settings=createRequire(import.meta.url)('../scroll-controls-settings.cjs');

test('older settings with a boolean per action keep their original keys', () => {
  const value=settings.validate({enabled:true,thinking:true,model:false,mode:true});
  assert.deepEqual(value.thinking,{on:true,key:'none',zone:'any'});
  assert.deepEqual(value.model,{on:false,key:'shift',zone:'any'});
  assert.deepEqual(value.mode,{on:true,key:'ctrl',zone:'any'});
  assert.deepEqual(value.fast,{on:true,key:'alt',zone:'any'});
});

test('a model-name scroll binding without a key is stored as written', () => {
  const next={enabled:true,thinking:{on:true,key:'none',zone:'thinking'},model:{on:true,key:'none',zone:'model'},mode:{on:true,key:'none',zone:'mode'},fast:{on:true,key:'none',zone:'fast'}};
  assert.deepEqual(settings.validate(next),next);
});

test('unknown keys, zones and extra fields are rejected', () => {
  const base=settings.validate({enabled:true});
  assert.throws(()=>settings.validate({...base,model:{on:true,key:'meta',zone:'any'}}));
  assert.throws(()=>settings.validate({...base,model:{on:true,key:'shift',zone:'footer'}}));
  assert.throws(()=>settings.validate({...base,model:{on:true,key:'shift',zone:'any',extra:1}}));
  assert.throws(()=>settings.validate({...base,unknown:true}));
  assert.throws(()=>settings.validate({thinking:true}));
});

test('settings round-trip through the file and an old file is read as migrated', () => {
  const dir=mkdtempSync(join(tmpdir(),'scroll-controls-'));
  try{
    writeFileSync(join(dir,'scroll-controls.json'),JSON.stringify({enabled:false,thinking:true,model:true,mode:false,revision:1}));
    const old=settings.read(dir,dir);
    assert.equal(old.enabled,false);assert.deepEqual(old.mode,{on:false,key:'ctrl',zone:'any'});assert.equal(old.fast.on,true);
    const written=settings.write(dir,{...settings.validate({enabled:true}),fast:{on:true,key:'alt',zone:'model'}});
    assert.deepEqual(settings.read(dir,dir).fast,written.fast);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
