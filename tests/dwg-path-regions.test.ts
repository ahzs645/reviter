import {test} from 'node:test';import assert from 'node:assert/strict';
import {cadPathReviewRegions} from '../lib/reviter/dwg-path-regions.ts';
import type {CadPathFloor} from '../lib/reviter/dwg-drawing-paths.ts';
test('display uses recovered cells with holes and shared identities without changing source or route metadata',()=>{
 const original=[{roomKey:'a',ringsMetres:[],sharedRoomKeys:[],status:'missing',areaSquareMetres:null as number|null},{roomKey:'b',ringsMetres:[],sharedRoomKeys:[],status:'missing',areaSquareMetres:null as number|null}];
 const f:CadPathFloor={id:'f',buildingCode:'X',name:'Floor',graphEdges:[],routingEligible:false,nodes:[],previewEdges:[],doors:[],rooms:[{roomKey:'a',number:'a',name:'A',nodeId:null,cellId:0,status:'missing'},{roomKey:'b',number:'b',name:'B',nodeId:null,cellId:0,status:'missing'}],cells:[{id:0,ringsMetres:[[[0,0],[10,0],[10,10],[0,10],[0,0]],[[2,2],[2,4],[4,4],[4,2],[2,2]]],roomKeys:['a','b'],transit:false,status:'endpoint-only'}]};
 const before=JSON.stringify({original,f}),result=cadPathReviewRegions(original,f);assert.equal(result[0]!.areaSquareMetres,96);assert.equal(result[0]!.ringsMetres.length,2);assert.deepEqual(result[0]!.sharedRoomKeys,['a','b']);assert.equal(JSON.stringify({original,f}),before);
});
