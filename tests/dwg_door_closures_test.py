import copy,importlib.util,pathlib,unittest
spec=importlib.util.spec_from_file_location('closures',pathlib.Path(__file__).parents[1]/'tools/dwg-analysis/drawing-door-closures.py');closures=importlib.util.module_from_spec(spec);spec.loader.exec_module(closures)
def fixture():
    return dict(primitives=[dict(sourceHandle='before',type='LINE',pointsMetres=[[0,-2],[0,-.2]]),dict(sourceHandle='after',type='LINE',pointsMetres=[[0,1.1],[0,3]])],doors=[dict(id='door',widthMetres=1,closedLeafMetres=[[0,0],[0,1]],thresholdSegmentsMetres=[[[.00002,-.1],[.00002,1.05]]],arcHandles=['arc'],leafHandles=['leaf'],supportingWallHandles=['before','after'])])
class ClosureTests(unittest.TestCase):
    def test_exact_original_contacts_selection_only_and_nonmutation(self):
        f=fixture();before=copy.deepcopy(f);doors,proofs=closures.recover_selection_closures(f)
        self.assertEqual(f,before);self.assertEqual(doors[0]['thresholdSegmentsMetres'],[[[0,-.2],[0,1.1]]]);self.assertTrue(proofs[0]['selectionOnly']);self.assertEqual(doors[0]['widthMetres'],1)
    def test_missing_wall_support_and_large_face_or_end_gap_reject(self):
        for mode in ['missing','normal','end']:
            f=fixture()
            if mode=='missing':f['primitives'].pop()
            if mode=='normal':f['primitives'][0]['pointsMetres']=[[.002,-2],[.002,-.2]]
            if mode=='end':f['primitives'][0]['pointsMetres']=[[0,-2],[0,-.5]]
            doors,proofs=closures.recover_selection_closures(f);self.assertEqual(proofs,[]);self.assertEqual(doors,f['doors'])
    def test_foreign_middle_barrier_is_not_removed(self):
        f=fixture();f['primitives'].append(dict(sourceHandle='barrier',type='LINE',pointsMetres=[[-.5,.5],[.5,.5]]));self.assertEqual(closures.recover_selection_closures(f)[1],[])
    def test_perpendicular_measured_endpoint_frame_is_recorded(self):
        f=fixture();f['primitives'].append(dict(sourceHandle='frame',type='LINE',pointsMetres=[[-.2,.02],[.2,.02]]));self.assertEqual(closures.recover_selection_closures(f)[1][0]['endpointFrameHandles'],['frame'])
if __name__=='__main__':unittest.main()
