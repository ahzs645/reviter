/** Explicit Autodesk-assisted GLB/Pascal export, using caller-supplied registration and element IDs. */
import {readFileSync,writeFileSync} from 'node:fs';
import {basename,join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {convertRvtBytes} from '../lib/reviter/convert.ts';
import {repairFromAutodesk} from '../lib/reviter/autodesk-reference-repair.ts';
import {makeGlb} from '../lib/reviter/export-glb.ts';
import {makePascalSceneJson} from '../lib/reviter/export-pascal.ts';
import {makeReport} from '../lib/reviter/export-report.ts';
import {isEntryPoint,optionValue,positionals} from './lib/rvt-harness.ts';

if(isEntryPoint(import.meta.url)) {
  const [rvt,capture]=positionals('--ids','--registration','--out');
  const ids=(optionValue('--ids')??'').split(',').map(Number);
  const registrationPath=optionValue('--registration'),out=optionValue('--out');
  if(!rvt||!capture||!registrationPath||!out||ids.some(id=>!Number.isSafeInteger(id)||id<=0))
    throw Error('usage: repair-autodesk-export.ts model.rvt capture-dir --ids 123,456 --registration registration.json --out model.glb|model.pascal.json');
  if(!out.endsWith('.glb')&&!out.endsWith('.pascal.json')) throw Error('Expected .glb or .pascal.json output');
  const decoded=convertRvtBytes(readFileSync(rvt),basename(rvt));
  if(!decoded.ok) throw Error(decoded.error);
  const result=repairFromAutodesk(decoded,readFileSync(join(capture,'model.glb')),
    JSON.parse(gunzipSync(readFileSync(join(capture,'raw/objects_ids.json.gz'))).toString()),ids,
    JSON.parse(readFileSync(registrationPath,'utf8')));
  writeFileSync(out,out.endsWith('.glb')?new Uint8Array(makeGlb(result)):makePascalSceneJson(result,{geometry:'drawn',drawnGrouping:'review'}));
  writeFileSync(out+'.report.json',makeReport(result,null));
  console.log(`Wrote ${out}; ${ids.length} requested reference-assisted repairs`);
}
