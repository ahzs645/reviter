import importlib.util
from pathlib import Path
import unittest

HERE=Path(__file__).resolve().parents[1]/'tools/dwg-analysis'
def load(name):
 spec=importlib.util.spec_from_file_location(name,HERE/(name+'.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
intake=load('build-building-intake');stairs=load('stair-symbols');campus=load('build-campus-floor-intake')

class CadIntakeTest(unittest.TestCase):
 def test_saved_panel_registration_preserves_rotation_and_local_translation(self):
  import copy
  r={'raw':[100,200],'model':[10,20],'re':0,'im':.001/.3048,'scale':.001/.3048}
  before=copy.deepcopy(r);a=campus.registration_alignment(r,[1,2])
  self.assertEqual(intake.local_point([1100,200],a,.001),[2.048,5.096])
  self.assertEqual(r,before);self.assertEqual(a['status'],'saved-source-registration')
 def test_composite_panel_requires_unanimous_native_id_and_unique_registration(self):
  import copy
  lines=[{'handle':'a','layer':'wall','points':[[0,0],[10000,0],[10000,10000],[0,10000],[0,0]],'type':'LINE'},
         {'handle':'b','layer':'wall','points':[[0,20000],[10000,20000],[10000,30000],[0,30000],[0,20000]],'type':'LINE'}]
  sheet={'id':'Composite','candidates':[{'anchor':[5000,5000],'roomNumberFloor':0,'existingKeys':['rm-100-one']},{'anchor':[5000,25000],'roomNumberFloor':1,'existingKeys':['rm-200-two']}]}
  review={'registrations':{'Composite #1':{'levelId':100},'Composite #2':{'levelId':200}}}
  self.assertEqual([p['ordinal'] for p in campus.attributed_registered_panels(sheet,lines,review,.001)],[0,1])
  stale=copy.deepcopy(sheet);stale['candidates'][0]['existingKeys']=[]
  self.assertEqual(campus.attributed_registered_panels(stale,lines,review,.001),[])
  review['registrations']['Composite #3']={'levelId':100}
  self.assertEqual(campus.attributed_registered_panels(sheet,lines,review,.001),[])
 def test_scale_requires_consistent_saved_evidence(self):
  fit={str(i):{'scale':.001/.3048} for i in range(3)}
  self.assertAlmostEqual(intake.unit_scale(fit),.001)
  fit['3']={'scale':.1}
  with self.assertRaises(ValueError):intake.unit_scale(fit)
 def test_full_sheet_without_main_title_does_not_assign_everything_upstairs(self):
  lines=[{'points':[[0,0],[10000,0],[10000,10000],[0,10000],[0,0]],'type':'LINE'},
         {'points':[[0,20000],[10000,20000],[10000,30000],[0,30000],[0,20000]],'type':'LINE'}]
  rooms=[{'anchor':[5000,5000],'roomNumberFloor':1},{'anchor':[5000,25000],'roomNumberFloor':2}]
  panels=intake.split_panels(lines,rooms,[{'point':[5000,31000],'floor':2,'name':'Level 2'}],.001)
  self.assertEqual(sorted(p['floor'] for p in panels),[1,2])
  self.assertEqual(sum(len(p['rooms']) for p in panels),2)
 def test_drawing_titles_win_over_bioenergy_numbering(self):
  lines=[{'points':[[0,0],[10000,0],[10000,10000],[0,10000],[0,0]],'type':'LINE'},
         {'points':[[0,20000],[10000,20000],[10000,30000],[0,30000],[0,20000]],'type':'LINE'}]
  rooms=[{'anchor':[5000,5000],'roomNumberFloor':0},{'anchor':[5000,25000],'roomNumberFloor':2}]
  panels=intake.split_panels(lines,rooms,[{'point':[5000,-1000],'floor':0,'name':'Lower floor'},{'point':[5000,31000],'floor':1,'name':'Upper floor'}],.001)
  self.assertEqual(sorted(p['floor'] for p in panels),[0,1])
  self.assertEqual(panels[1]['rooms'][0]['roomNumberFloor'],2)
 def test_local_transform_retains_hole_coordinates_without_global_placement(self):
  a={'originDrawing':[100,200],'translationMetres':[1,2],'rotationDegrees':90}
  p=intake.local_point([1100,200],a,.001)
  self.assertEqual(p,[1,3])
 def test_regular_treads_are_only_hints_and_sparse_dividers_are_not_stairs(self):
  lines=[{'pointsMetres':[[0,i*.25],[2,i*.25]],'sourceHandle':str(i),'type':'LINE'} for i in range(10)]
  hints=stairs.detect_tread_runs(lines)
  self.assertEqual(len(hints),1)
  self.assertEqual(hints[0]['treadCount'],10)
  self.assertFalse(hints[0]['routingEligible'])
  for i,l in enumerate(lines):l['pointsMetres']=[[0,i],[2,i]]
  self.assertEqual(stairs.detect_tread_runs(lines),[])
 def test_terminal_tread_cap_variation_keeps_measured_stroke(self):
  rows=[{'pointsMetres':[[0,i*.28],[1.012,i*.28]],'sourceHandle':str(i),'type':'LINE'} for i in range(6)]
  cap={'pointsMetres':[[-.088,1.68],[1.012,1.68]],'sourceHandle':'cap','type':'LINE'}
  found=stairs.detect_tread_runs(rows+[cap]);self.assertEqual(len(found),1)
  self.assertEqual(found[0]['treadCount'],7);self.assertIn('cap',found[0]['sourceHandles'])
  self.assertEqual(found[0]['treads'][-1]['pointsMetres'],cap['pointsMetres']);self.assertFalse(found[0]['routingEligible'])
 def test_terminal_extension_rejects_landing_offset_and_ambiguous_strokes(self):
  rows=[{'pointsMetres':[[0,i*.28],[1.012,i*.28]],'sourceHandle':str(i),'type':'LINE'} for i in range(6)]
  for points in ([[-.088,1.82],[1.012,1.82]],[[.1,1.68],[1.2,1.68]],[[-1,1.68],[1.012,1.68]]):
   self.assertEqual(stairs.detect_tread_runs(rows+[{'pointsMetres':points,'sourceHandle':'other','type':'LINE'}])[0]['treadCount'],6)
  cap={'pointsMetres':[[-.088,1.68],[1.012,1.68]],'sourceHandle':'cap','type':'LINE'}
  duplicate=dict(cap,sourceHandle='duplicate')
  self.assertEqual(stairs.detect_tread_runs(rows+[cap,duplicate])[0]['treadCount'],6)
 def test_short_run_is_not_a_default_stair_detection(self):
  rows=[{'pointsMetres':[[0,i*.28],[1,i*.28]],'sourceHandle':str(i),'type':'LINE'} for i in range(5)]
  self.assertEqual(stairs.detect_tread_runs(rows),[])
  self.assertEqual(stairs.detect_tread_runs(rows,min_treads=4)[0]['treadCount'],5)

if __name__=='__main__':unittest.main()
