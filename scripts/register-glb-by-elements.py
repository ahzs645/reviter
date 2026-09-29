#!/usr/bin/env python3
"""Derive a GLB registration from elements both scenes contain.

Usage: python3 scripts/register-glb-by-elements.py <audit.json> <work/autodesk/<capture>-final> [--out registration.json]

`glb-surface-diff.ts` registers a recovered GLB against a reference by the two
scenes' overall bounds, which assumes both span the same building. An Autodesk
view often carries site elements the recovery drops (topography, parking,
entourage far from the building), and then the bounds-derived scale is wrong by
the ratio of the extents. This script instead pairs elements by Revit element
id — the audit's per-element bounds on one side, the Autodesk GLB's per-node
bounds joined through `fragments.json` and `objects_ids.json` on the other —
and uses the known feet-to-metres scale with the median centre offset as
the translation. Both sides use indexed triangle positions. The spread of the per-element offsets is printed so a bad
pairing is visible rather than silently averaged.
"""
import gzip, json, math, sys, collections
from lib.glb_triangles import read_glb, active_nodes, triangle_positions

audit_path, capture = sys.argv[1], sys.argv[2]
out_path = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else None


def load(p):
    b = open(p, 'rb').read()
    if b[:2] == b'\x1f\x8b':
        b = gzip.decompress(b)
    return json.loads(b)


def quat_to_matrix(q):
    x, y, z, w = q
    return [
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ]


def node_matrix(node):
    """Row-major 4x4 from a node's matrix or TRS."""
    if 'matrix' in node:
        m = node['matrix']  # column-major
        return [[m[c * 4 + r] for c in range(4)] for r in range(4)]
    t = node.get('translation', [0, 0, 0])
    r = quat_to_matrix(node.get('rotation', [0, 0, 0, 1]))
    s = node.get('scale', [1, 1, 1])
    return [
        [r[0][0] * s[0], r[0][1] * s[1], r[0][2] * s[2], t[0]],
        [r[1][0] * s[0], r[1][1] * s[1], r[1][2] * s[2], t[1]],
        [r[2][0] * s[0], r[2][1] * s[1], r[2][2] * s[2], t[2]],
        [0, 0, 0, 1],
    ]


def mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def apply(m, p):
    return [m[i][0] * p[0] + m[i][1] * p[1] + m[i][2] * p[2] + m[i][3] for i in range(3)]


# Autodesk side: world-space bounds per node, joined to Revit element ids.
doc, binary = read_glb(capture + '/model.glb')
active = active_nodes(doc)
nodes = doc['nodes']
accessors = doc['accessors']
meshes = doc['meshes']
parent_of = {}
for i, n in enumerate(nodes):
    for c in n.get('children', []):
        parent_of[c] = i


def world(i):
    m = node_matrix(nodes[i])
    while i in parent_of:
        i = parent_of[i]
        m = mul(node_matrix(nodes[i]), m)
    return m


ids = load(capture + '/raw/objects_ids.json.gz')
db_to_eid = {}
for db, ext in enumerate(ids):
    if isinstance(ext, str) and '-' in ext:
        try:
            db_to_eid[db] = int(ext.rsplit('-', 1)[1], 16)
        except ValueError:
            pass
ref = collections.defaultdict(lambda: [[math.inf] * 3, [-math.inf] * 3])
for i, n in enumerate(nodes):
    if i not in active or 'mesh' not in n:
        continue
    db = (n.get('extras') or {}).get('autodeskDbId')
    eid = db_to_eid.get(db)
    if eid is None:
        continue
    m = world(i)
    for prim in meshes[n['mesh']]['primitives']:
        points, _ = triangle_positions(doc, binary, prim)
        if not points:
            continue
        box = ref[eid]
        for point in points:
            p = apply(m, point)
            for k in range(3):
                box[0][k] = min(box[0][k], p[k]); box[1][k] = max(box[1][k], p[k])

# Reviter side: the audit's per-element bounds, in the recovered GLB's local feet.
audit = json.load(open(audit_path))
rec = {}
for e in audit['elementManifest']['elements']:
    g = e.get('geometry') or {}
    if 'drawnBoundsFeet' not in g:
        sys.exit('audit lacks drawnBoundsFeet; regenerate it before registration')
    b = g.get('drawnBoundsFeet')
    if e.get('displayed') and b:
        rec[e['elementId']] = ([b['min'][k] for k in 'xyz'], [b['max'][k] for k in 'xyz'])

# The diff samples both scenes in glTF world space, which is Y-up. The
# reference GLB is written Y-up at the data level; the recovered GLB is Z-up
# feet under a root node rotating -90 degrees about X, so its model-frame box
# (x, y, z) lands at (x, z, -y) in world space. Rotate the audit boxes the same
# way before pairing, so the offsets come out in the frame the diff registers in.
def to_world(lo, hi):
    return [lo[0], lo[2], -hi[1]], [hi[0], hi[2], -lo[1]]
rec = {eid: to_world(lo, hi) for eid, (lo, hi) in rec.items()}
common = sorted(set(rec) & set(ref))
ratios, offsets = [], []
for eid in common:
    rlo, rhi = rec[eid]; alo, ahi = ref[eid]
    for k in range(3):
        rs, as_ = rhi[k] - rlo[k], ahi[k] - alo[k]
        if rs > 0.5 and as_ > 0.5:
            ratios.append(as_ / rs)
ratios.sort()
if not common:
    sys.exit('No matched drawn elements; registration is undefined')
# Exported Reviter coordinates are feet; size defects must not alter scale.
scale = 0.3048
for eid in common:
    rlo, rhi = rec[eid]; alo, ahi = ref[eid]
    offsets.append([(alo[k] + ahi[k]) / 2 - scale * (rlo[k] + rhi[k]) / 2 for k in range(3)])
def median(v):
    v = sorted(v); return v[len(v) // 2]
offset = [median([o[k] for o in offsets]) for k in range(3)]
spread = [median([abs(o[k] - offset[k]) for o in offsets]) for k in range(3)]
# The audit's bounds are in model feet; the recovered GLB is written with the
# scene origin subtracted, so the registration adds it back.
origin = audit.get('originFeet') or {'x': 0, 'y': 0, 'z': 0}
origin = [origin['x'], origin['z'], -origin['y']]  # rotated into world space like the boxes
registration = {"scale": scale, "sourceCenter": [0.0, 0.0, 0.0],
                "referenceCenter": [origin[k] * scale + offset[k] for k in range(3)]}
print(json.dumps({"matchedElements": len(common), "scale": scale, "sizeRatioMedian": median(ratios) if ratios else None,
                  "ratioP10P90": [ratios[len(ratios) // 10], ratios[len(ratios) * 9 // 10]] if ratios else None,
                  "offsetMedianMetres": offset, "offsetMedianAbsDeviationMetres": spread}, indent=1))
if out_path:
    json.dump(registration, open(out_path, 'w'))
    print("wrote", out_path)
