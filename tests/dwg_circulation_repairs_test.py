import importlib.util,unittest,math
from pathlib import Path
s=importlib.util.spec_from_file_location('repairs',Path(__file__).parents[1]/'tools/dwg-analysis/drawing-circulation-repairs.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
def line(handle,a,b):return dict(sourceHandle=handle,type='LINE',pointsMetres=[a,b])
class Repairs(unittest.TestCase):
 def test_contact_is_original_finite_projection_not_global_snapping(self):
  f=dict(id='f',doors=[],stairs=[],primitives=[line('a',[0,0],[1,0]),line('b',[1.001,-1],[1.001,1])]);original=repr(f)
  found=m.contact_repairs(f,[]);self.assertEqual(len(found),1);self.assertAlmostEqual(found[0]['toFraction'],.5);self.assertEqual(repr(f),original)
  f['primitives'][1]=line('b',[1.01,-1],[1.01,1]);self.assertEqual(m.contact_repairs(f,[]),[])
 def test_equal_distance_ambiguous_contacts_are_not_applied(self):
  f=dict(id='f',doors=[],stairs=[],primitives=[line('a',[0,0],[1,0]),line('b',[1.001,-1],[1.001,1]),line('c',[1,-1.001],[1,-.001])]);self.assertFalse(any(c['fromHandle']=='a' and c['fromEndpointIndex']==1 for c in m.contact_repairs(f,[])))
 def test_stair_and_door_handles_never_become_contact_repairs(self):
  f=dict(id='f',doors=[],stairs=[dict(sourceHandles=['b'])],primitives=[line('a',[0,0],[1,0]),line('b',[1.001,-1],[1.001,1])]);self.assertEqual(m.contact_repairs(f,[]),[])
 def test_original_leaf_and_jambs_required_for_displaced_quarter_symbol(self):
  arc=dict(sourceHandle='swing',type='ARC',centreMetres=[0,.052],radiusMetres=1.00135,sweepRadians=math.pi/2,pointsMetres=[[math.cos(i*math.pi/32),math.sin(i*math.pi/32)] for i in range(17)])
  f=dict(id='f',doors=[],stairs=[],primitives=[arc,line('leaf',[0,0],[0,1]),line('left',[-1,0],[0,0]),line('right',[1,0],[2,0])]);original=repr(f);ds=m.detect_leaf_doors(f);self.assertEqual(len(ds),1);self.assertEqual(ds[0]['thresholdSegmentsMetres'],[[[0,0],[1,0]]]);self.assertEqual(repr(f),original)
  f['primitives']=[p for p in f['primitives'] if p['sourceHandle']!='leaf'];self.assertEqual(m.detect_leaf_doors(f),[])
 def test_recovered_polygon_keeps_real_inner_hole(self):
  ps=[]
  for prefix,ring in [('o',[[0,0],[4,0],[4,4],[0,4],[0,0]]),('h',[[1,1],[2,1],[2,2],[1,2],[1,1]])]:
   ps.extend(line(prefix+str(i),a,b) for i,(a,b) in enumerate(zip(ring,ring[1:])))
  f=dict(primitives=ps,stairs=[]);cells=m.repaired_polygons(f,[],[]);self.assertTrue(any(len(p.interiors)==1 and p.area==15 for p in cells))
class EntranceProposals(unittest.TestCase):
 def test_cap_proposal_requires_real_shared_area_division_and_stays_unapplied(self):
  from shapely.geometry import Polygon,box
  region=box(0,0,10,4).difference(box(4.9,0,5.1,1).union(box(4.9,2,5.1,4)))
  f=dict(id='f',primitives=[line('a',[4.9,1],[5.1,1]),line('b',[4.9,2],[5.1,2])],regions=[dict(roomKey='left',anchorMetres=[2,2]),dict(roomKey='right',anchorMetres=[7,2])])
  cs=m.open_entrance_candidates(f,[],[region]);self.assertEqual(len(cs),1);self.assertEqual(sorted(cs[0]['roomGroups']),[['left'],['right']]);self.assertFalse(cs[0]['applied']);self.assertFalse(cs[0]['routingEligible']);self.assertIsNone(cs[0]['physicalDoorId'])
  f['primitives'].append(line('glass',[5,1],[5,2]));self.assertEqual(m.open_entrance_candidates(f,[],[region]),[])
if __name__=='__main__':unittest.main()
class StairSymbols(unittest.TestCase):
 def test_only_exact_paired_risers_are_abstracted_not_railings_or_extended_spans(self):
  f=dict(stairs=[dict(id='s',treads=[dict(pointsMetres=[[0,0],[1,0]])])],primitives=[line('tread',[0,0],[1,0]),line('paired',[0,.02],[1,.02]),line('railing',[0,0],[0,1]),line('extended',[-.1,.02],[1,.02]),line('far',[0,.03],[1,.03])])
  original=repr(f);proofs=m.stair_riser_witnesses(f);self.assertEqual([p['handle'] for p in proofs],['paired']);self.assertEqual(repr(f),original);self.assertFalse(proofs[0]['routingEligible'])
