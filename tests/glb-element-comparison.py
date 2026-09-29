import gzip
import json
import math
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from lib.glb_triangles import read_glb, triangle_positions


def write_glb(path):
    # Fourth vertex is unused. The advertised accessor box is intentionally huge.
    binary = struct.pack('<12f3H', 0,0,0, 0.3048,0,0, 0,0.3048,0, 100,100,100, 0,1,2)
    binary += b'\0' * (-len(binary) % 4)
    doc = {'asset': {'version': '2.0'}, 'scene': 0, 'scenes': [{'nodes': [0]}],
           'nodes': [{'children': [1,2], 'rotation': [0,0,math.sin(math.pi/8),math.cos(math.pi/8)]},
                     {'mesh': 0, 'extras': {'autodeskDbId': 1}},
                     {'mesh': 0, 'translation': [10,0,0], 'extras': {'autodeskDbId': 2}},
                     {'mesh': 0, 'extras': {'autodeskDbId': 3}}],
           'meshes': [{'primitives': [{'attributes': {'POSITION': 0}, 'indices': 1}]}],
           'buffers': [{'byteLength': len(binary)}],
           'bufferViews': [{'byteOffset': 0, 'byteLength': 48}, {'byteOffset': 48, 'byteLength': 6}],
           'accessors': [{'bufferView': 0, 'componentType': 5126, 'count': 4, 'type': 'VEC3', 'min': [0,0,0], 'max': [100,100,100]},
                         {'bufferView': 1, 'componentType': 5123, 'count': 3, 'type': 'SCALAR'}]}
    j=json.dumps(doc).encode();j+=b' ' * (-len(j)%4)
    path.write_bytes(struct.pack('<5I',0x46546c67,2,28+len(j)+len(binary),len(j),0x4e4f534a)+j+struct.pack('<2I',len(binary),0x004e4942)+binary)


class ComparisonTest(unittest.TestCase):
    def test_triangle_bounds_missing_and_provenance(self):
        with tempfile.TemporaryDirectory() as temp:
            p=Path(temp);(p/'raw').mkdir();write_glb(p/'model.glb')
            raw={'ids': ['', 'guid-00000001','guid-00000002','guid-00000003'],
                 'attrs': [None,['Category','__category__']], 'vals': ['Revit Fixtures'],
                 'avs': [1,0,1,0,1,0], 'offs': [0,0,1,2]}
            for name,data in raw.items():
                (p/'raw'/f'objects_{name}.json.gz').write_bytes(gzip.compress(json.dumps(data).encode()))
            def box(lo,hi):return {'min':dict(zip('xyz',lo)), 'max':dict(zip('xyz',hi))}
            r=math.sqrt(0.5)
            geometry={'drawnBoundsFeet':box([-r,0,0],[r,0,r]),'persistedBoundsFeet':box([0,0,0],[100,100,100]),'source':'native-faceted'}
            audit={'originFeet':dict(x=0,y=0,z=0),'elementManifest':{'elements':[{'elementId':1,'displayed':True,'geometry':geometry}, {'elementId':9,'displayed':True,'geometry':geometry}]}}
            (p/'audit.json').write_text(json.dumps(audit))
            def run(*args):return subprocess.run([sys.executable,str(ROOT/'scripts/compare-glb-elements.py'),str(p/'audit.json'),str(p),'--json',str(p/'result.json'),*args],capture_output=True,text=True)
            result=run();self.assertEqual(result.returncode,0,result.stderr)
            report=json.loads((p/'result.json').read_text())
            self.assertEqual(report['summary']['reference'],2) # inactive third node excluded
            self.assertEqual(report['summary']['matched'],1)
            self.assertEqual(report['summary']['sizeOK'],1)
            self.assertEqual(report['missing'][0]['elementId'],2)
            self.assertEqual(report['outsideReferenceView'][0]['elementId'] if isinstance(report['outsideReferenceView'][0],dict) else report['outsideReferenceView'][0],9)
            self.assertEqual(report['elements'][0]['source'],'native-faceted')
            self.assertFalse(report['elements'][0]['persisted']['sizeOK'])
            self.assertEqual(run('--bounds','persisted').returncode,0)
            self.assertEqual(json.loads((p/'result.json').read_text())['summary']['sizeOK'],0)
            self.assertNotEqual(run('--tolerance-feet','nan').returncode,0)
            audit['elementManifest']['elements']=[];(p/'audit.json').write_text(json.dumps(audit))
            self.assertEqual(run().returncode,0)
            self.assertIsNone(json.loads((p/'result.json').read_text())['translationFeet'])
            audit['elementManifest']['elements']=[{'elementId':1,'displayed':True,'geometry':{'boundsFeet':geometry['persistedBoundsFeet']}}]
            (p/'audit.json').write_text(json.dumps(audit));self.assertNotEqual(run().returncode,0)

    def test_indices_are_validated(self):
        with tempfile.TemporaryDirectory() as temp:
            p=Path(temp)/'model.glb';write_glb(p);doc,binary=read_glb(p)
            primitive=doc['meshes'][0]['primitives'][0]
            points,count=triangle_positions(doc,binary,primitive)
            self.assertEqual((len(points),count),(3,1))
            broken=bytearray(binary);struct.pack_into('<H',broken,48,99)
            with self.assertRaises(ValueError):triangle_positions(doc,broken,primitive)
            self.assertEqual(triangle_positions(doc,binary,dict(primitive,mode=1)),([],0))

if __name__=='__main__':unittest.main()
