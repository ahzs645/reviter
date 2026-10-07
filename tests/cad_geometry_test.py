import importlib.util,json,math,subprocess,tempfile,unittest,struct
from pathlib import Path
HERE=Path(__file__).resolve().parents[1]/'tools/dwg-analysis'
spec=importlib.util.spec_from_file_location('abstract',HERE/'abstract-building-geometry.py');cad=importlib.util.module_from_spec(spec);spec.loader.exec_module(cad)
def line(h,ps,kind='LINE'):return dict(sourceHandle=h,type=kind,pointsMetres=ps)
def room(key,point):return dict(key=key,number=key,name='Test room',anchorMetres=point)
class CadGeometryTest(unittest.TestCase):
 def test_analytic_door_uses_finite_jambs_and_preserves_closed_leaf(self):
  arc=dict(sourceHandle='arc',type='ARC',centreMetres=[0,0],radiusMetres=.9,sweepRadians=math.pi/2,pointsMetres=[[.9,0],[0,.9]])
  support=[line('leaf',[[0,0],[0,.9]]),line('before',[[-1,0],[0,0]]),line('after',[[.9,0],[2,0]])]
  found=cad.analytic_doors.detect_analytic_doors([arc,*support],'f',[])
  self.assertEqual(len(found),1);self.assertFalse(found[0]['routingEligible']);self.assertEqual(found[0]['thresholdSegmentsMetres'],[[[0.,0.],[.9,0.]]])
  closed=[arc,line('leaf',[[0,0],[.9,0]]),*support[1:]]
  door=cad.analytic_doors.detect_analytic_doors(closed,'f',[])[0]
  self.assertEqual(door['leafDrawingState'],'closed');self.assertEqual(door['leafSegmentsMetres'],[])
 def test_analytic_door_rejects_missing_leaf_floating_caps_and_wall_crossing(self):
  arc=dict(sourceHandle='arc',type='ARC',centreMetres=[0,0],radiusMetres=.9,sweepRadians=math.pi/2,pointsMetres=[[.9,0],[0,.9]])
  before=line('before',[[-1,0],[0,0]]);after=line('after',[[.9,0],[2,0]]);leaf=line('leaf',[[0,0],[0,.9]])
  for rows in ([arc,before,after],[arc,before,leaf],[arc,line('cap',[[-.08,0],[0,0]]),after,leaf],[arc,before,after,leaf,line('solid',[[-1,0],[2,0]])]):
   self.assertEqual(cad.analytic_doors.detect_analytic_doors(rows,'f',[]),[])
 def test_analytic_short_cap_requires_original_perpendicular_contact(self):
  arc=dict(sourceHandle='arc',type='ARC',centreMetres=[0,0],radiusMetres=.9,sweepRadians=math.pi/2,pointsMetres=[[.9,0],[0,.9]])
  rows=[arc,line('leaf',[[0,0],[0,.9]]),line('cap',[[-.08,0],[0,0]]),line('wall',[[-.08,-1],[-.08,0]]),line('after',[[.9,0],[2,0]])]
  self.assertEqual(len(cad.analytic_doors.detect_analytic_doors(rows,'f',[])),1)
 def test_stair_area_requires_source_cell_and_keeps_holes(self):
  stair=dict(id='s',ringsMetres=[[[0,0],[1,0],[1,2],[0,2]]],widthMetres=1,treads=[dict(pointsMetres=[[0,y],[1,y]]) for y in [0,.4,.8,1.2,1.6,2]])
  floor=dict(id='f',stairs=[stair],rooms=[],primitives=[line('outside',[[-1,-1],[2,-1],[2,3],[-1,3],[-1,-1]])])
  p=cad.Polygon([[-1,-1],[2,-1],[2,3],[-1,3]],[[[1.2,1],[1.8,1],[1.8,2],[1.2,2]]])
  areas,review=cad.stair_footprints.recover_stair_areas(floor,[p]);self.assertEqual(len(areas),1)
  self.assertEqual(len(areas[0]['ringsMetres']),2);self.assertFalse(areas[0]['floorSupportVerified']);self.assertFalse(areas[0]['routingEligible']);self.assertEqual(review,[])
  floor['rooms']=[room('office',[1.5,0])]
  self.assertEqual(cad.stair_footprints.recover_stair_areas(floor,[p])[0],[])
 def test_unbounded_treads_do_not_get_a_hull_or_fabricated_landing(self):
  stair=dict(id='s',ringsMetres=[[[0,0],[1,0],[1,2],[0,2]]],widthMetres=1,treads=[dict(pointsMetres=[[0,y],[1,y]]) for y in [0,.4,.8,1.2,1.6,2]])
  floor=dict(id='f',stairs=[stair],rooms=[],primitives=[])
  areas,review=cad.stair_footprints.recover_stair_areas(floor,[]);self.assertEqual(areas,[]);self.assertEqual(review[0]['id'],'s')
 def test_aligned_stair_links_remain_provisional_and_ambiguous_links_are_omitted(self):
  area=dict(id='a',ringsMetres=[[[0,0],[2,0],[2,2],[0,2]]]);floor=dict(id='f',buildingCode='01',stairAreas=[area])
  upper=dict(floor,id='g',stairAreas=[dict(area,id='b')]);links=cad.stair_footprints.propose_floor_links([floor,upper])
  self.assertEqual(len(links),1);self.assertFalse(links[0]['servedFloorsVerified']);self.assertFalse(links[0]['routingEligible'])
  upper['stairAreas'].append(dict(area,id='c'));self.assertEqual(cad.stair_footprints.propose_floor_links([floor,upper]),[])
 def test_landing_candidate_uses_only_the_adjacent_closed_source_cell(self):
  stair=dict(id='s',ringsMetres=[[[0,0],[1,0],[1,2],[0,2]]],widthMetres=1,treads=[dict(pointsMetres=[[0,y],[1,y]]) for y in [0,.4,.8,1.2,1.6,2]])
  floor=dict(id='f',stairs=[stair],rooms=[],primitives=[])
  flight=cad.Polygon(stair['ringsMetres'][0]);landing=cad.Polygon([[0,2],[1,2],[1,3],[0,3]])
  areas,_=cad.stair_footprints.recover_stair_areas(floor,[],[flight,landing]);self.assertEqual(areas[0]['areaSquareMetres'],3)
  self.assertEqual(len(areas[0]['landingCandidatePartsMetres']),1);self.assertFalse(areas[0]['landingVerified'])
  floor['rooms']=[room('office',[.5,2.5])]
  areas,_=cad.stair_footprints.recover_stair_areas(floor,[],[flight,landing]);self.assertEqual(areas[0]['areaSquareMetres'],2)
 def test_source_faces_trim_a_tread_through_a_rail_without_growing_the_outline(self):
  stair=dict(id='s',ringsMetres=[[[0,0],[1,0],[1,2],[0,2]]],widthMetres=1,treads=[dict(pointsMetres=[[0,y],[1,y]]) for y in [0,.4,.8,1.2,1.6,2]])
  floor=dict(id='f',stairs=[stair],rooms=[],primitives=[]);inside=cad.Polygon([[.1,0],[1,0],[1,2],[.1,2]])
  areas,_=cad.stair_footprints.recover_stair_areas(floor,[],[inside]);self.assertEqual(areas[0]['ringsMetres'],cad.rings(inside))
 def test_finite_side_faces_require_both_real_riser_contacts_and_keep_label_conflicts(self):
  treads=[dict(sourceHandle=str(i),sourceSegmentIndex=0,pointsMetres=[[0,y],[1,y]]) for i,y in enumerate([0,.4,.8,1.2,1.6,2])]
  stair=dict(id='s',ringsMetres=[[[0,0],[1,0],[1,2],[0,2]]],widthMetres=1,treads=treads)
  floor=dict(id='f',stairs=[stair],rooms=[room('corridor',[.5,1])],primitives=[line('left',[[0,-1],[0,3]]),line('right',[[1,-1],[1,3]])])
  p,proof=cad.stair_footprints.finite_face_flight(floor,stair);self.assertEqual(p.area,2);self.assertIn('left',proof)
  areas,review=cad.stair_footprints.recover_stair_areas(floor,[]);self.assertEqual(areas[0]['conflictingRoomKeys'],['corridor']);self.assertEqual(review[0]['kind'],'stair-area')
  floor['primitives'][1]=line('right',[[1,.1],[1,3]])
  self.assertIsNone(cad.stair_footprints.finite_face_flight(floor,stair)[0])
  floor['primitives'][1]=line('right',[[1.00001,-1],[1.00001,3]])
  self.assertIsNotNone(cad.stair_footprints.finite_face_flight(floor,stair)[0])
  floor['primitives'][1]=line('right',[[1.001,-1],[1.001,3]])
  self.assertIsNone(cad.stair_footprints.finite_face_flight(floor,stair)[0])
 def test_wall_pair_measures_original_faces_without_classifying_material(self):
  rows=[line('a',[[0,0],[4,0]]),line('b',[[0,.25],[4,.25]]),line('c',[[0,3],[4,3]])]
  found=cad.wall_pairs(rows,set());self.assertEqual(len(found),1);self.assertEqual(found[0]['widthMetres'],.25);self.assertFalse(found[0]['physicalWallVerified']);self.assertFalse(found[0]['routingEligible'])
  self.assertEqual(cad.wall_pairs(rows,{'b'}),[])
 def test_regions_preserve_holes(self):
  rows=[line('outer',[[0,0],[10,0],[10,10],[0,10],[0,0]]),line('void',[[4,4],[6,4],[6,6],[4,6],[4,4]])]
  r=cad.regions(rows,[],[],[room('a',[1,1])])[0];self.assertEqual(r['areaSquareMetres'],96);self.assertEqual(len(r['ringsMetres']),2);self.assertFalse(r['enclosureVerified'])
 def test_shared_area_never_claims_separate_rooms(self):
  rows=[line('outer',[[0,0],[10,0],[10,10],[0,10],[0,0]])]
  r=cad.regions(rows,[],[],[room('a',[1,1]),room('b',[7,7])]);self.assertTrue(all(x['status']=='shared-drawing-region' for x in r))
 def test_small_gap_is_not_automatically_patched(self):
  rows=[line('outer',[[0,0],[10,0],[10,10],[0,10],[0,.01]])]
  self.assertEqual(cad.regions(rows,[],[],[room('a',[1,1])])[0]['status'],'not-recovered')
 def test_removing_a_tread_keeps_other_segments_of_the_same_polyline(self):
  rows=[line('poly',[[0,0],[10,0],[10,10],[0,10],[0,0],[0,5],[10,5]],'LWPOLYLINE')]
  stair=dict(sourceHandles=['poly'],treads=[dict(sourceHandle='poly',pointsMetres=[[0,5],[10,5]])])
  r=cad.regions(rows,[],[stair],[room('a',[1,1])])[0];self.assertEqual(r['areaSquareMetres'],100)
 def test_schematic_glb_keeps_holes_and_marks_unknown_native_heights(self):
  spec=importlib.util.spec_from_file_location('glb',HERE/'schematic-glb.py');glb=importlib.util.module_from_spec(spec);spec.loader.exec_module(glb)
  region=dict(roomKey='a',sharedRoomKeys=['a'],status='test',ringsMetres=[[[0,0],[10,0],[10,10],[0,10],[0,0]],[[4,4],[6,4],[6,6],[4,6],[4,4]]])
  with tempfile.TemporaryDirectory() as d:
   path=Path(d)/'a.glb';glb.export_floor(path,dict(id='f',regions=[region],wallCandidates=[],doors=[],stairs=[]),'a'*64)
   buf=path.read_bytes();magic,version,size=struct.unpack('<4sII',buf[:12]);self.assertEqual((magic,version,size),(b'glTF',2,len(buf)))
   n=struct.unpack('<I',buf[12:16])[0];meta=json.loads(buf[20:20+n]);self.assertTrue(meta['extras']['heightsAreIllustrative']);self.assertIsNone(meta['extras']['physicalElevationMetres']);self.assertFalse(meta['extras']['routingEligible'])
   raw=buf[20+n+8:];vertices=list(struct.iter_unpack('<fff',raw));p=cad.Polygon(region['ringsMetres'][0],region['ringsMetres'][1:]);area=0
   for i in range(0,len(vertices),3):
    triangle=cad.Polygon([(v[0],-v[2]) for v in vertices[i:i+3]]);self.assertTrue(p.covers(triangle));area+=triangle.area
   self.assertEqual(area,96)
 def test_door_bridge_requires_leaf_and_both_jambs_and_retains_provenance(self):
  r=.9144;arc=[line('arc',[[r*math.cos(math.pi*i/48),r*math.sin(math.pi*i/48)],[r*math.cos(math.pi*(i+1)/48),r*math.sin(math.pi*(i+1)/48)]]) for i in range(24)]
  support=[line('leaf',[[0,0],[0,r]]),line('left',[[-1.2,0],[-.03,0]]),line('right',[[r+.03,0],[2.1,0]]),line('leftface',[[-1.2,-.12],[-.03,-.12]]),line('rightface',[[r+.03,-.12],[2.1,-.12]])]
  groups=[dict(id='valid',floorId='f',arcHandle='arc',segments=arc+support),dict(id='isolated',floorId='f',arcHandle='arc',segments=arc),dict(id='missing-leaf',floorId='f',arcHandle='arc',segments=arc+support[1:]),dict(id='one-jamb',floorId='f',arcHandle='arc',segments=arc+support[:2])]
  with tempfile.TemporaryDirectory() as d:
   a=Path(d)/'a.json';b=Path(d)/'b.json';a.write_text(json.dumps(groups));before=a.read_bytes()
   subprocess.run(['node','--experimental-strip-types',str(HERE/'abstract-door-symbols.mjs'),str(a),str(b),str(HERE.parents[1])],check=True)
   result=json.loads(b.read_text());self.assertEqual(len(result),1);self.assertEqual(result[0]['id'],'valid');self.assertAlmostEqual(result[0]['widthMetres'],r);self.assertFalse(result[0]['routingEligible']);self.assertEqual(result[0]['leafHandles'],['leaf']);self.assertEqual(a.read_bytes(),before)
if __name__=='__main__':unittest.main()
