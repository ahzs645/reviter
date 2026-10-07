import importlib.util, pathlib, unittest
from unittest.mock import patch
from shapely.geometry import Polygon, LineString, Point
spec=importlib.util.spec_from_file_location('paths',pathlib.Path(__file__).parents[1]/'tools/dwg-analysis/build-drawing-paths.py')
paths=importlib.util.module_from_spec(spec);spec.loader.exec_module(paths)
def fixture():
    door=dict(id='door',arcHandle='arc',arcHandles=['arc'],leafHandles=['leaf'],supportingWallHandles=['wall'],widthMetres=1,closedLeafMetres=[[2,.5],[2,1.5]],thresholdSegmentsMetres=[[[2,.5],[2,1.5]]])
    return dict(id='floor',buildingCode='X',name='Floor',primitives=[],doors=[door],stairs=[],regions=[dict(roomKey='a',number='1',name='Office',anchorMetres=[1,1]),dict(roomKey='b',number='2',name='Corridor',anchorMetres=[3,1])],unresolvedDoorArcHandles=[])
class PathTests(unittest.TestCase):
    def analyse(self,f,ps):
        with patch.object(paths.abstract,'drawing_polygons',return_value=ps):return paths.analyse_floor(f)
    def test_measured_door_connects_both_areas_without_native_access(self):
        r=self.analyse(fixture(),[Polygon([(0,0),(2,0),(2,2),(0,2)]),Polygon([(2,0),(4,0),(4,2),(2,2)])])
        self.assertEqual(r['doors'][0]['status'],'two-sided-drawing-door');self.assertEqual(r['graphEdges'],[])
        self.assertFalse(r['routingEligible']);self.assertIsNone(r['doors'][0]['access']);self.assertEqual(sum(e['kind']=='door' for e in r['previewEdges']),1)
    def test_hole_is_never_crossed_by_interior_path(self):
        f=fixture();f['doors']=[]
        p=Polygon([(0,0),(10,0),(10,10),(0,10)],holes=[[(4,4),(6,4),(6,6),(4,6)]])
        r=self.analyse(f,[p]);self.assertTrue(r['previewEdges'])
        for e in r['previewEdges']:
            a,b=[r['nodes'][e[k]]['pointMetres'] for k in ['a','b']];line=LineString([a,b]);self.assertTrue(p.covers(line if line.length else Point(a)))
    def test_same_cell_bypass_is_not_a_portal(self):
        r=self.analyse(fixture(),[Polygon([(0,0),(4,0),(4,2),(0,2)])]);self.assertEqual(r['doors'][0]['status'],'same-area-bypass');self.assertFalse(any(e['kind']=='door' for e in r['previewEdges']))
    def test_other_source_stroke_blocks_threshold(self):
        f=fixture();f['primitives']=[dict(sourceHandle='foreign',pointsMetres=[[2,0],[2,2]])]
        r=self.analyse(f,[Polygon([(0,0),(2,0),(2,2),(0,2)]),Polygon([(2,0),(4,0),(4,2),(2,2)])]);self.assertEqual(r['doors'][0]['status'],'source-obstacle')
    def test_dangling_partition_inside_closed_outer_cell_blocks_path_legs(self):
        f=fixture();f['doors']=[];f['primitives']=[dict(sourceHandle='partition',pointsMetres=[[2,.2],[2,1.8]])]
        r=self.analyse(f,[Polygon([(0,0),(4,0),(4,2),(0,2)])]);self.assertGreater(r['rejectedInteriorEdges'],0)
        barrier=LineString([[2,.2],[2,1.8]])
        for e in r['previewEdges']:
            a,b=[r['nodes'][e[k]]['pointMetres'] for k in ['a','b']];line=LineString([a,b]);self.assertFalse(line.crosses(barrier))
    def test_missing_side_stays_unmatched(self):
        r=self.analyse(fixture(),[Polygon([(0,0),(2,0),(2,2),(0,2)])]);self.assertEqual(r['doors'][0]['status'],'unmatched-area')
if __name__=='__main__':unittest.main()
