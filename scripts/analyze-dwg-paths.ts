/** Add a source-bound path/door comparison to a new separate CAD package. */
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,copyFile,access} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {readCadReviewPackage} from '../lib/reviter/dwg-review-package.ts';
import {cadFloorReviewDocument} from '../lib/reviter/dwg-floor-analysis-view.ts';
const root=fileURLToPath(new URL('../',import.meta.url));
const run=(command:string,args:string[])=>new Promise<void>((done,fail)=>{const child=spawn(command,args,{cwd:root,stdio:'inherit'});child.on('error',fail);child.on('close',c=>c===0?done():fail(new Error('CAD path analysis exited '+c)));});
async function main(){
 const args=process.argv.slice(2),options=new Map<string,string>();
 if(args.includes('--help')){console.log('npm run cad:paths -- --package /absolute/CAD-folder --out /new/separate-folder --python /venv/bin/python [--interpret-building CODE|all]\nDrawing comparisons only; no native route edges, access changes or stair service inferred.');return;}
 for(let i=0;i<args.length;i+=2){if(!['--package','--out','--python','--surface-recipe','--interpret-building'].includes(args[i]!)||!args[i+1]||options.has(args[i]!))throw new Error('Unknown, duplicate or incomplete option.');options.set(args[i]!,args[i+1]!);}
 if(!options.has('--package')||!options.has('--out'))throw new Error('--package and --out are required.');
 const input=resolve(options.get('--package')!),out=resolve(options.get('--out')!),python=options.get('--python')??'python3';
 try{await access(out);throw new Error('Output already exists; choose a new separate folder.');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 const before=await readCadReviewPackage(new Uint8Array(await readFile(resolve(input,'UNBC.cad-geometry.zip'))));
 const geometryHash=createHash('sha256').update(await readFile(resolve(input,'geometry.json'))).digest('hex');
 await run(python,[resolve(root,'tools/dwg-analysis/build-drawing-paths.py'),'--package',input,'--out',out,...options.has('--surface-recipe')?['--surface-recipe',resolve(options.get('--surface-recipe')!)]:[],...options.has('--interpret-building')?['--interpret-building',options.get('--interpret-building')!]:[]]);
 const result=await readCadReviewPackage(new Uint8Array(await readFile(resolve(out,'UNBC.cad-geometry.zip'))));
 if(!result.paths||result.paths.geometrySha256!==geometryHash||result.analysis.geometrySha256!==before.analysis.geometrySha256)throw new Error('Path report changed geometry.');
 const template=await readFile(resolve(root,'tools/dwg-analysis/building-geometry.html'),'utf8');
 await writeFile(resolve(out,'index.html'),cadFloorReviewDocument(template,result.geometry,result.analysis,result.paths,result.assumptions,result.surfaces,result.circulation));
 for(const file of ['scripts/analyze-dwg-paths.ts','lib/reviter/dwg-drawing-paths.ts','lib/reviter/dwg-review-package.ts','lib/reviter/dwg-floor-analysis-view.ts','tools/dwg-analysis/build-drawing-paths.py','tools/dwg-analysis/drawing-door-closures.py','lib/reviter/dwg-door-display.ts','lib/reviter/dwg-path-regions.ts','lib/reviter/dwg-building-scene.ts','lib/reviter/dwg-stair-assumptions.ts','tools/dwg-analysis/assume-dwg-stairs.py','tests/dwg-path-regions.test.ts','tests/dwg-stair-assumptions.test.ts','tools/dwg-analysis/emit-door-display.mjs','tools/dwg-analysis/building-geometry.html','tests/dwg-door-display.test.ts','tests/dwg_door_closures_test.py','docs/dwg-floor-analysis.md','tests/dwg-drawing-paths.test.ts','tests/dwg_drawing_paths_test.py','app/studio/cad-review.worker.ts','app/studio/DwgFloorReview.tsx','app/studio/DwgBuildingModel.tsx']){const destination=resolve(out,'pipeline/reviter',file);await mkdir(dirname(destination),{recursive:true});await copyFile(resolve(root,file),destination);}
 for(const file of ['AGENTS.md','lib/reviter/dwg-circulation-review.ts','tools/dwg-analysis/drawing-circulation-repairs.py','tests/dwg-circulation-review.test.ts','tests/dwg_circulation_repairs_test.py','lib/reviter/dwg-floor-surfaces.ts','tools/dwg-analysis/drawing-floor-surfaces.py','tests/dwg-floor-surfaces.test.ts','tests/dwg_floor_surfaces_test.py']){const destination=resolve(out,'pipeline/reviter',file);await mkdir(dirname(destination),{recursive:true});await copyFile(resolve(root,file),destination);}
 const snapshotMetaPath=resolve(out,'pipeline/reviter/package.json'),snapshotMeta=JSON.parse(await readFile(snapshotMetaPath,'utf8'));snapshotMeta.scripts['cad:paths']='node --experimental-strip-types scripts/analyze-dwg-paths.ts';snapshotMeta.dependencies.fflate='0.8.2';await writeFile(snapshotMetaPath,JSON.stringify(snapshotMeta,null,2)+'\n');
 await run(python,['-c',"import importlib.util,sys;from pathlib import Path;s=importlib.util.spec_from_file_location('cad',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);m.package(Path(sys.argv[2]))",resolve(root,'tools/dwg-analysis/abstract-building-geometry.py'),out]);
 console.log('Saved separate path and door comparison: '+out);
}
main().catch(e=>{console.error(e instanceof Error?e.message:e);process.exitCode=1;});
