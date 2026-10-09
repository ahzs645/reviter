import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {initialize, resolve} from '../scripts/local-typescript-resolver.mjs';

const missing = () => Object.assign(new Error('original resolution failed'), {code:'ERR_MODULE_NOT_FOUND'});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(),'reviter-local-loader-'));
  const root = join(directory,'root'); await mkdir(root);
  initialize({root:pathToFileURL(root+'/').href});
  return {directory,root,context:{parentURL:pathToFileURL(join(root,'entry.ts')).href},close:()=>rm(directory,{recursive:true,force:true})};
}
test('extensionless relative imports use existing local TS candidates in declared priority',async()=>{
  const f=await fixture();try {
    for(const ext of ['.ts','.mts','.cts'])await writeFile(join(f.root,'local'+ext),'export const value=1;');
    const seen=[],error=missing();
    const next=async(s)=>{seen.push(s);if(s==='./local')throw error;return {url:s};};
    assert.deepEqual(await resolve('./local',f.context,next),{url:pathToFileURL(join(f.root,'local.ts')).href});
    await rm(join(f.root,'local.ts'));
    assert.deepEqual(await resolve('./local',f.context,next),{url:pathToFileURL(join(f.root,'local.mts')).href});
    await rm(join(f.root,'local.mts'));
    assert.deepEqual(await resolve('./local',f.context,next),{url:pathToFileURL(join(f.root,'local.cts')).href});
    assert.equal(seen.length,6);
  }finally{await f.close();}
});
test('ordinary resolver successes and errors other than missing modules remain untouched',async()=>{
  const f=await fixture();try {
    const success={url:'original-success'};
    assert.equal(await resolve('./local',f.context,async()=>success),success);
    const error=Object.assign(new Error('syntax or loader error'),{code:'ERR_UNSUPPORTED_DIR_IMPORT'});
    await assert.rejects(resolve('./local',f.context,async()=>{throw error;}),e=>e===error);
  }finally{await f.close();}
});
test('explicit extensions, outside-root paths, packages, URLs and missing files receive no fallback',async()=>{
  const f=await fixture();try {
    await writeFile(join(f.root,'explicit.js.ts'),'export const ignored=1;');
    await writeFile(join(f.directory,'outside.ts'),'export const ignored=1;');
    for(const specifier of ['./explicit.js','../outside','some-package',pathToFileURL(join(f.root,'local')).href,'./missing']){
      const error=missing(),calls=[];
      await assert.rejects(resolve(specifier,f.context,async(s)=>{calls.push(s);throw error;}),e=>e===error);
      assert.deepEqual(calls,[specifier]);
    }
    const error=missing(),calls=[];
    await assert.rejects(resolve('./local',{parentURL:'https://example.org/entry.js'},async(s)=>{calls.push(s);throw error;}),e=>e===error);
    assert.deepEqual(calls,['./local']);
  }finally{await f.close();}
});
test('repository-only extension fallback rejects a symlink to an outside file',async()=>{
  const f=await fixture();try{
    const outside=join(f.directory,'outside.ts');await writeFile(outside,'export const value=1;');
    await symlink(outside,join(f.root,'local.ts'));
    const error=missing(),calls=[];
    await assert.rejects(resolve('./local',f.context,async(s)=>{calls.push(s);throw error;}),e=>e===error);
    assert.deepEqual(calls,['./local']);
    await writeFile(join(f.root,'local.mts'),'export const value=2;');
    assert.deepEqual(await resolve('./local',f.context,async(s)=>{if(s==='./local')throw error;return {url:s};}),{url:pathToFileURL(join(f.root,'local.mts')).href});
  }finally{await f.close();}
});
