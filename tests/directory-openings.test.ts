import test from 'node:test';import assert from 'node:assert/strict';
import {directoryOpenPassages,type ReviewedOpenLink}from '../lib/reviter/directory-openings.ts';
import {findDirectoryRoute,type DirectoryRoom}from '../lib/reviter/room-directory.ts';
import type {ArchitecturalPlanGeometry}from '../lib/reviter/architectural-plan.ts';import type {BoundaryReference}from '../lib/reviter/room-boundaries.ts';
const rs:DirectoryRoom[]=[{key:'hall',number:'03-1',name:'Corridor',levelId:1,confidence:1,polygonFeet:[[0,0],[5,0],[5,10],[0,10]],labelPointFeet:[2,5],dwg:{sectionId:'03 floor'}},{key:'copy',number:'03-2',name:'Copy',levelId:1,confidence:1,polygonFeet:[[6,0],[11,0],[11,10],[6,10]],labelPointFeet:[8,5],dwg:{sectionId:'03 floor'}}];
const link:ReviewedOpenLink={id:'open-1',levelId:1,rooms:['hall','copy'],from:[5,5],to:[6,5],widthFeet:2,evidence:'registered-opening',sourceSha256:'hash'};
const reference:BoundaryReference={format:'reviter-boundary-reference',version:1,coordinateSystem:'revit-model-feet',sourceSha256:'hash',sections:[{sectionId:'03 floor',levelId:1,registrationErrorFeet:0,wallSegments:[],doorSegments:[]}]};
const geometry:ArchitecturalPlanGeometry={walls:[],doors:[],columns:[],floors:[],cutElevation:4};
test('a checked open boundary enables a Copy destination route without inventing a native door',()=>{
 assert.equal(findDirectoryRoute(rs,[],'hall','copy'),null);const passages=directoryOpenPassages(rs,[link],reference,geometry);assert.equal(passages.length,1);assert.ok(!('doorId' in passages[0]!));assert.ok(findDirectoryRoute(rs,passages,'hall','copy'));
});
test('open boundary recovery rejects walls across its width, columns, voids and stale geometry or registration',()=>{
 assert.equal(directoryOpenPassages(rs,[link],{...reference,sourceSha256:'changed'},geometry).length,0);
 assert.equal(directoryOpenPassages(rs,[link],reference,{...geometry,walls:[{elementId:1,polygon:[[5.4,4],[5.6,4],[5.6,6],[5.4,6]],approximate:false}]}).length,0);
 assert.equal(directoryOpenPassages(rs,[link],{...reference,sections:[{...reference.sections[0]!,wallSegments:[[[5.4,5.8],[5.6,5.8]]]}]},geometry).length,0);
 assert.equal(directoryOpenPassages(rs,[link],reference,{...geometry,columns:[{elementId:1,polygon:[[5.4,4],[5.6,4],[5.6,6],[5.4,6]],approximate:false}]}).length,0);
 assert.equal(directoryOpenPassages([rs[0]!,{...rs[1]!,walkability:'void'}],[link],reference,geometry).length,0);
 assert.equal(directoryOpenPassages(rs,[{...link,from:[3,15]}],reference,geometry).length,0);
});
