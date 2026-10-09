import {stat,realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
let root;
export function initialize(data){root=fileURLToPath(data.root);}
export async function resolve(specifier,context,nextResolve){
 try{return await nextResolve(specifier,context);}catch(error){
  if(error.code!=='ERR_MODULE_NOT_FOUND'||!context.parentURL?.startsWith('file:')||!/^\.{1,2}\//.test(specifier))throw error;
  const original=new URL(specifier,context.parentURL),p=fileURLToPath(original),relative=path.relative(root,p);
  if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)||path.extname(p))throw error;
  const actualRoot=await realpath(root);
  for(const extension of ['.ts','.mts','.cts']){
   const candidate=new URL(original);candidate.pathname+=extension;
   try{
    if(!(await stat(candidate)).isFile())continue;
    const actual=path.relative(actualRoot,await realpath(candidate));
    if(actual==='..'||actual.startsWith('..'+path.sep)||path.isAbsolute(actual))continue;
   }catch{continue;}
   return nextResolve(candidate.href,context);
  }
  throw error;
 }
}
