import importlib.util, pathlib, unittest
from shapely.geometry import Polygon, Point
from shapely.ops import triangulate
spec=importlib.util.spec_from_file_location('surfaces',pathlib.Path(__file__).parents[1]/'tools/dwg-analysis/drawing-floor-surfaces.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class SurfaceTests(unittest.TestCase):
    def fixture(self):
        outer=[[0,0],[10,0],[10,10],[0,10],[0,0]];inner=[[2,2],[8,2],[8,8],[2,8],[2,2]]
        f={'id':'a','primitives':[{'sourceHandle':h,'pointsMetres':[list(p) for p in pts]} for h,pts in [('o1',outer[:3]),('o2',outer[2:]),('i1',inner[:3]),('i2',inner[2:])]]}
        chains=[[{'handle':h,'reverse':False} for h in c] for c in [['o1','o2'],['i1','i2']]]
        return f,chains
    def test_protected_void_removed_from_all_cells_and_track_mesh(self):
        f,c=self.fixture();rings=m.source_rings(f,c,.002);s={'floorId':'a','ringsMetres':rings}
        polys=m.reviewed_polygons(f,[Polygon(rings[0]),Polygon([[4,4],[6,4],[6,6],[4,6]])],[s])
        self.assertEqual(len(polys),1);self.assertEqual(polys[0].area,64)
        ts=[t for t in triangulate(polys[0]) if polys[0].covers(t)]
        self.assertEqual(sum(t.area for t in ts),64);self.assertTrue(all(t.intersection(Polygon(rings[1])).area==0 for t in ts))
    def test_source_join_bound_preserves_original_vertices(self):
        f,c=self.fixture();f['primitives'][1]['pointsMetres'][0][0]=10.001
        rings=m.source_rings(f,c,.002);self.assertIn([10,10],rings[0]);self.assertEqual(f['primitives'][1]['pointsMetres'][0],[10.001,10]);f['primitives'][1]['pointsMetres'][0][0]=10.003
        with self.assertRaisesRegex(ValueError,'Unsupported'):m.source_rings(f,c,.002)
if __name__=='__main__':unittest.main()
