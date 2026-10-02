import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {architecturalPlanGeometry} from '../lib/reviter/architectural-plan.ts';
const [input,cachePath,output]=process.argv.slice(2);if(!input||!cachePath||!output)throw new Error('Provide input ZIP, its native conversion cache and output ZIP.');
const zip=unzipSync(new Uint8Array(await readFile(input))),d=JSON.parse(strFromU8(zip['viewer/indoor.json'])),m=JSON.parse(await readFile(cachePath,'utf8'));
const shape=(rings:number[][][])=>JSON.stringify(rings.map(r=>[...new Set(r.map(p=>p.map(n=>Math.round(n*100000)/100000).join(',')))].sort()).sort());
const geometries=new Map<number,ReturnType<typeof architecturalPlanGeometry>>();let marked=0;
for(const w of d.walls){if(w.kind==='column')continue;let g=geometries.get(w.levelId);if(!g){g=architecturalPlanGeometry(m,w.levelId);geometries.set(w.levelId,g);}const source=g.walls.find(p=>p.elementId===w.nativeElementId&&shape([p.polygon])===shape(w.ringsFeet));if(source){w.approximate=source.approximate;if(source.approximate)marked++;}}
const manifest=JSON.parse(strFromU8(zip['manifest.json']));const bytes=strToU8(JSON.stringify(d));zip['viewer/indoor.json']=bytes;manifest.indoor.bytes=bytes.length;manifest.indoor.sha256=createHash('sha256').update(bytes).digest('hex');zip['manifest.json']=strToU8(JSON.stringify(manifest));await writeFile(output,zipSync(zip,{level:6}));console.log(JSON.stringify({marked,wall948595:d.walls.find((w:{nativeElementId:number;levelId:number})=>w.nativeElementId===948595&&w.levelId===311),nodes:d.nodes.length,output}));
