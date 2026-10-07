import {test} from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,strToU8,unzipSync,strFromU8} from 'fflate';
import {createHash} from 'node:crypto';
import {isCadReviewArchive,readCadReviewPackage} from '../lib/reviter/dwg-review-package.ts';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
function fixture(change?:string){
 const intake=JSON.stringify({format:'openindoormaps-cad-intake',version:1,sourceSha256:'source',sourceFiles:[{name:'source.dwg',sha256:hash('original dwg')}],graphEdges:[],appliedToNativeGeometry:false});
 const geometry=JSON.stringify({format:'openindoormaps-cad-geometry',version:1,sourceSha256:'source',graphEdges:[],appliedToNativeGeometry:false,floors:[{id:'a'}]});
 const analysis=JSON.stringify({format:'reviter-cad-floor-analysis',version:1,sourceSha256:'source',geometrySha256:hash(geometry),intakeSha256:hash(intake),graphEdges:[],appliedToNativeGeometry:false,floors:[{id:change==='identity'?'wrong':'a'}]});
 const files={'intake.json':intake,'geometry.json':geometry,'floor-analysis.json':analysis};
 const manifest=Object.fromEntries(Object.entries(files).map(([k,v])=>[k,hash(v)]));
 return zipSync(Object.fromEntries(Object.entries({...files,'checksums.json':JSON.stringify(manifest),'source/source.dwg':change==='source'?'changed dwg':'original dwg','index.html':'<script>untrustedPackageCode()</script>'}).map(([k,v])=>[k,strToU8(k==='geometry.json'&&change==='tamper'?v+' ':v)])));
}
test('CAD importer validates JSON hashes and excludes executable package HTML',async()=>{
 const result=await readCadReviewPackage(fixture());assert.equal(result.geometry.floors[0].id,'a');assert.deepEqual(Object.keys(result).sort(),['analysis','assumptions','circulation','coverage','evidence','geometry','originalGeometry','paths','surfaces']);assert.equal(result.evidence,null);
});
test('CAD importer refuses stale geometry and mismatched floor identities',async()=>{
 await assert.rejects(readCadReviewPackage(fixture('tamper')),/checksum changed/);
 await assert.rejects(readCadReviewPackage(fixture('identity')),/floor identities/);
 await assert.rejects(readCadReviewPackage(fixture('source')),/Original drawing checksum changed/);
});
test('normal Open recognizes CAD review content without trusting it or a filename',async()=>{
 assert.equal(isCadReviewArchive(fixture()),true);
 assert.equal(isCadReviewArchive(fixture('tamper')),true);
 await assert.rejects(readCadReviewPackage(fixture('tamper')),/checksum changed/);
 const entries=Object.fromEntries(['checksums.json','geometry.json','floor-analysis.json','intake.json'].map(name=>[name,strToU8('{}')]));
 assert.equal(isCadReviewArchive(zipSync({...entries,'manifest.json':strToU8('{}')})),false);
 delete entries['floor-analysis.json'];
 assert.equal(isCadReviewArchive(zipSync(entries)),false);
 assert.equal(isCadReviewArchive(zipSync({'manifest.json':strToU8('{}'),'model/test.rvt':strToU8('model')})),false);
});
test('supporting brochures bind to these floors, geometry and exact document bytes',async()=>{
 const files=unzipSync(fixture());const geometry=JSON.parse(strFromU8(files['geometry.json']!));geometry.floors[0].buildingCode='B';
 const geometryText=JSON.stringify(geometry);files['geometry.json']=strToU8(geometryText);
 const analysis=JSON.parse(strFromU8(files['floor-analysis.json']!));analysis.geometrySha256=hash(geometryText);files['floor-analysis.json']=strToU8(JSON.stringify(analysis));
 const evidence={format:'reviter-cad-building-evidence',version:1,sourceSha256:'source',geometrySha256:hash(geometryText),documents:[{path:'evidence/brochure.pdf',sha256:hash('original pdf'),title:'Brochure'}],buildings:[{code:'B',notes:['Ground floor is partial.'],floorLabels:[{floorId:'a',label:'Ground'}]}]};
 files['building-evidence.json']=strToU8(JSON.stringify(evidence));files['evidence/brochure.pdf']=strToU8('original pdf');
 const pack=()=>{files['checksums.json']=strToU8(JSON.stringify(Object.fromEntries(Object.entries(files).filter(([key])=>key!=='checksums.json').map(([key,bytes])=>[key,hash(strFromU8(bytes))]))));return zipSync(files);};
 assert.equal((await readCadReviewPackage(pack())).evidence?.buildings[0]?.notes[0],'Ground floor is partial.');
 files['evidence/brochure.pdf']=strToU8('edited pdf');await assert.rejects(readCadReviewPackage(pack()),/Supporting document checksum changed/);
 evidence.geometrySha256='stale';files['building-evidence.json']=strToU8(JSON.stringify(evidence));await assert.rejects(readCadReviewPackage(pack()),/does not match/);
});
