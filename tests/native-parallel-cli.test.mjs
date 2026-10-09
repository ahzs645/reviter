import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const run=(args)=>spawnSync(process.execPath,['--experimental-strip-types','--import','./scripts/register-local-typescript.mjs','scripts/prepare-indoor-project.ts',...args],{cwd:root,encoding:'utf8',timeout:20000});
test('native worker CLI rejects invalid options before reading or rewriting any source',()=>{
 const baseline=['--input','/nonexistent/reviter-cli-test.reviter.zip','--out','/nonexistent/reviter-cli-output.reviter.zip'];
 for(const [flags,expected] of [
  [['--native-workers'],/--native-workers requires a value/],
  [['--native-workers','3'],/--native-workers must be 1 or 2/],
  [['--native-workers','0'],/--native-workers must be 1 or 2/],
  [['--checkpoint-dir','/nonexistent/checkpoints'],/--checkpoint-dir requires --native-workers/],
  [['--native-workers','2','--checkpoint-dir'],/--checkpoint-dir requires a value/],
 ]){const output=run([...baseline,...flags]);assert.equal(output.status,1);assert.match(output.stderr,expected);assert.doesNotMatch(output.stderr,/ENOENT/);}
 const same=run(['--input','/nonexistent/same.reviter.zip','--out','/nonexistent/same.reviter.zip','--native-workers','2']);
 assert.equal(same.status,1);assert.match(same.stderr,/new output path/);
 for(const count of ['1','2']){const output=run([...baseline,'--native-workers',count]);assert.equal(output.status,1);assert.match(output.stderr,/ENOENT/);assert.doesNotMatch(output.stderr,/requires a value|must be 1 or 2/);}
});
