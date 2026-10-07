import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const {cadDoorDisplayStrokes}=await import(pathToFileURL(resolve(process.argv[2],'lib/reviter/dwg-door-display.ts')));
process.stdout.write('const cadDoorDisplayStrokes='+cadDoorDisplayStrokes.toString()+';');
