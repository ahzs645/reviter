#!/usr/bin/env python3
"""Extend a preserved separate intake to every DWG building, without moving the master.
Registered multi-panel floors keep their per-panel transforms. Ambiguous composite
sheets remain explicit pending panels, never merged in sheet coordinates.
"""
import argparse, copy, importlib.util, json, math, shutil, re
from pathlib import Path
from collections import defaultdict
import ezdxf
import numpy as np
from shapely.geometry import LineString, box
from shapely.strtree import STRtree
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('intake',HERE/'build-building-intake.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def registration_alignment(r,origin):
    return dict(originDrawing=r['raw'],rotationDegrees=math.degrees(math.atan2(r['im'],r['re'])),
                translationMetres=[r['model'][i]*.3048-origin[i] for i in (0,1)],
                status='saved-source-registration',method='preserved per-panel native drawing registration',
                registrationEvidence=copy.deepcopy(r),overlapScore=None,alternativeScore=None)

def attributed_registered_panels(s,ls,review,scale):
    parts=m.split_panels(ls,s['candidates'],[],scale)
    attributed=[]
    for part in parts:
        levels=set()
        for room in part['rooms']:
            keys=room.get('existingKeys',[])
            ids={int(match[1]) for key in keys if (match:=re.match(r'^rm-(\d+)-',key))}
            if len(ids)!=1:levels.add(None)
            else:levels.update(ids)
        candidates=[v for k,v in review['registrations'].items() if k.startswith(s['id']+' #') and v['levelId'] in levels]
        ordinals={r['roomNumberFloor'] for r in part['rooms']}
        if len(levels)!=1 or None in levels or len(candidates)!=1 or len(ordinals)!=1:break
        panel_sheet=dict(s,bounds=part['bounds'],candidates=part['rooms'],drawingFloors=list(ordinals),
            attributionEvidence='disconnected source panel; unanimous original native room identities and unique saved registration')
        attributed.append(dict(sheet=panel_sheet,ordinal=next(iter(ordinals)),lines=part['linework'],registration=candidates[0]))
    return attributed if len(attributed)==len(parts) else []


def build(args):
    if args.out.exists():raise ValueError('Use a new candidate output directory')
    review=json.loads((args.review/'review.json').read_text());data=json.loads((args.existing_intake/'intake.json').read_text())
    if data['sourceSha256']!=review['sourceSha256']:raise ValueError('Intake and review source mismatch')
    if m.sha(args.review/'stage/floorplans.dxf')!=data['conversionEvidence']['floorDxfSha256']:raise ValueError('Stale DXF')
    for item in data['sourceFiles']:
        if m.sha(args.review/'source'/item['name'])!=item['sha256']:raise ValueError('Stale original drawing')
    scale=data['unitEvidence']['metresPerDrawingUnit'];doc=ezdxf.readfile(args.review/'stage/floorplans.dxf')
    lines=[]
    for e in doc.modelspace():
        if 'wall' not in e.dxf.layer.lower():continue
        ps=m.recovery.flatten_entity_points(e,100)
        if len(ps)>1:lines.append(dict(handle=e.dxf.handle,type=e.dxftype(),layer=e.dxf.layer,points=ps))
    tree=STRtree([LineString(l['points']) for l in lines]);existing={b['code'] for b in data['buildings']}
    config=json.loads((HERE/'config.unbc.json').read_text());audit=[];pending=[]
    for code in sorted(set(s['building'] for s in review['sheets'])-existing):
        sheets=[s for s in review['sheets'] if s['building']==code];registered=[];provisional=[]
        for s in sheets:
            crop=box(*s['bounds']);ls=[lines[int(i)] for i in tree.query(crop,predicate='intersects')]
            sections=set(r.get('registrationSection') for r in s['candidates']);sections.discard(None)
            reg=review['registrations'].get(next(iter(sections))) if len(sections)==1 else None
            floors=s['drawingFloors']
            if len(floors)!=1 or len(sections)>1 or (s['status']=='registered' and not reg):
                # Some composite sheets already have independent native-bound
                # panel registrations. Require a disconnected source panel and
                # unanimous native identity and room-number floor evidence.
                attributed=attributed_registered_panels(s,ls,review,scale)
                if attributed:
                    registered.extend(attributed);continue
                pending.append(dict(buildingCode=code,sheetId=s['id'],drawingFloors=floors,
                    reason='Composite sheet or multiple registration sections require explicit panel attribution',
                    rooms=s['candidates'],sourceHandles=[l['handle'] for l in ls],boundsDrawing=s['bounds'],
                    routingEligible=False));continue
            (registered if reg else provisional).append(dict(sheet=s,ordinal=floors[0],lines=ls,registration=reg))
        if not registered:
            raise ValueError('No registered reference for additional building '+code)
        origin=np.mean([r['model'] for r in (p['registration'] for p in registered)],axis=0)*.3048
        groups=defaultdict(list)
        for p in registered:
            p['alignment']=registration_alignment(p['registration'],origin);groups[p['ordinal']].append(p)
        # A single unregistered panel can be compared to the lowest registered
        # floor, but its transform stays provisional, with original source bound.
        reference=min(groups);base_rooms=[];base_lines=[]
        for p in groups[reference]:
            a=p['alignment']
            base_rooms += [dict(anchor=m.local_point(r['anchor'],a,scale)) for r in p['sheet']['candidates']]
            base_lines += [dict(type=l['type'],points=[m.local_point(q,a,scale) for q in l['points']]) for l in p['lines']]
        base=dict(rooms=base_rooms,linework=base_lines)
        for p in provisional:
            if p['ordinal'] in groups:
                pending.append(dict(buildingCode=code,sheetId=p['sheet']['id'],drawingFloors=[p['ordinal']],
                    reason='Unregistered companion panel cannot be joined to a registered floor',rooms=p['sheet']['candidates'],
                    sourceHandles=[l['handle'] for l in p['lines']],boundsDrawing=p['sheet']['bounds'],routingEligible=False));continue
            centre=np.mean([r['anchor'] for r in p['sheet']['candidates']],axis=0)
            target=dict(rooms=[dict(anchor=(np.array(r['anchor'])-centre)*scale) for r in p['sheet']['candidates']],
                        linework=[dict(type=l['type'],points=[(np.array(q)-centre)*scale for q in l['points']]) for l in p['lines']])
            fit=m.fit_stack(base,target,1)
            fit['originDrawing']=centre.tolist()
            fit['translationMetres']=(np.array(fit['translationMetres'])+np.mean([r['anchor'] for r in base_rooms],axis=0)).tolist()
            p['alignment']=fit;groups[p['ordinal']].append(p)
        fs=[]
        for ordinal,panels in sorted(groups.items()):
            rooms=[];linework=[];metadata=[];seen=set()
            for p in panels:
                a=p['alignment'];s=p['sheet'];metadata.append(dict(sheet=s['name'],bounds=s['bounds'],floorEvidence=s.get('attributionEvidence','named drawing sheet'),alignment=a))
                for r in s['candidates']:
                    rooms.append(dict(key=r['id'],number=r['number'],name=r['name'],anchorMetres=m.local_point(r['anchor'],a,scale),
                        ringsMetres=[[m.local_point(q,a,scale) for q in ring] for ring in r['rings']],matchMode=r['matchMode'],
                        enclosureVerified=False,routingEligible=False,source=dict(handle=r['sourceHandle'],sheet=r['sheet'],anchorDrawing=r['anchor'],roomNumberFloor=r['roomNumberFloor'])))
                for l in p['lines']:
                    if l['handle'] in seen:continue
                    seen.add(l['handle']);linework.append(dict(sourceHandle=l['handle'],type=l['type'],layer=l['layer'],
                        pointsMetres=[m.local_point(q,a,scale) for q in l['points']],sourceAlignment=a))
            alignment=dict(panels[0]['alignment']) if len(panels)==1 else dict(status='saved-source-registration',method='multiple preserved per-panel registrations',overlapScore=None,alternativeScore=None)
            fs.append(dict(id=f'cad-{code}-{ordinal}',ordinal=ordinal,name=f'Drawing level {ordinal}',elevationMetres=None,nativeLevelId=None,
                alignment=alignment,panels=metadata,rooms=rooms,linework=linework,stairSymbols=m.stair_symbols.detect_tread_runs(linework),
                issues=['Drawing-only analysis; source floor support and served stairs unverified'],numberFloorHints=sorted(set(r['roomNumberFloor'] for p in panels for r in p['sheet']['candidates']))))
        data['buildings'].append(dict(id='cad-building-'+code,code=code,name=config['buildings']['codeMap'].get(code,{}).get('name','Building '+code),
            placement=None,coordinateSystem='building-local-metres',floors=fs,connectors=[],issues=['Existing saved registration reused for comparison only; no native mutation']))
    data['buildings'].sort(key=lambda b:b['code']);data['pendingPanels']=pending
    all_room_keys={r['key'] for b in data['buildings'] for f in b['floors'] for r in f['rooms']}
    pending_keys={r['id'] for p in pending for r in p['rooms']}
    for s in review['sheets']:
        keys={r['id'] for r in s['candidates']}
        audit.append(dict(buildingCode=s['building'],sheetId=s['id'],drawingFloors=s['drawingFloors'],sourceRoomLabels=len(keys),
            analyzedRoomLabels=len(keys & all_room_keys),pendingRoomLabels=len(keys & pending_keys),
            missingKeys=sorted(keys-all_room_keys-pending_keys),originalReviewStatus=s['status']))
    if any(s['missingKeys'] for s in audit):raise ValueError('Coverage audit found unaccounted source labels')
    data['coverageAudit']=dict(sheets=audit,unassignedAnchors=review.get('unassignedAnchors',[]),pendingPanelCount=len(pending),
        sourceReviewSha256=m.sha(args.review/'review.json'),preservedMissingBuildingIntakeSha256=m.sha(args.existing_intake/'intake.json'))
    data['evidenceSha256']=m.hashlib.sha256(json.dumps({k:v for k,v in data.items() if k not in ['createdAt','evidenceSha256']},sort_keys=True,separators=(',',':')).encode()).hexdigest()
    args.out.mkdir(parents=True);m.write(args.out/'intake.json',data);m.write(args.out/'coverage-audit.json',data['coverageAudit'])
    shutil.copytree(args.review/'source',args.out/'source');shutil.copytree(args.review/'stage',args.out/'stage')
    shutil.copy2(args.review/'review.json',args.out/'source-review.json')
    if (args.review/'plans').is_dir():shutil.copytree(args.review/'plans',args.out/'plans')
    print(json.dumps(dict(buildings=len(data['buildings']),floors=sum(len(b['floors']) for b in data['buildings']),
        roomRecords=len(all_room_keys),pendingRoomLabels=len(pending_keys),pendingPanels=len(pending),sheets=len(audit))))
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--review',type=Path,required=True);p.add_argument('--existing-intake',type=Path,required=True);p.add_argument('--out',type=Path,required=True);build(p.parse_args())
