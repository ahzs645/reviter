#!/usr/bin/env python3
"""Compare drawn element bounds with an Autodesk capture, with missing IDs and provenance.

Usage: python3 scripts/compare-glb-elements.py audit.json capture-dir [--json report.json]
Defaults to geometry.drawnBoundsFeet; old audits must be regenerated, or explicitly
examined with --bounds persisted. Boxes measure extents, not surface fidelity.
Reference indexed triangle positions are transformed to model feet. Registration is translation
only; the offset and the tolerance are included in the report.
"""
import argparse, gzip, json, math, sys, collections, hashlib
from lib.glb_triangles import read_glb, active_nodes, triangle_positions

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('audit')
parser.add_argument('capture')
parser.add_argument('--tolerance-feet', type=float, default=0.5)
parser.add_argument('--bounds', choices=['drawn', 'persisted'], default='drawn')
parser.add_argument('--json', dest='json_path')
args = parser.parse_args()
audit_path, capture, tolerance = args.audit, args.capture, args.tolerance_feet
if not math.isfinite(tolerance) or tolerance <= 0:
    parser.error('--tolerance-feet must be finite and positive')
FEET_PER_METRE = 1 / 0.3048


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
    if 'matrix' in node:
        m = node['matrix']
        return [[m[c * 4 + r] for c in range(4)] for r in range(4)]
    t = node.get('translation', [0, 0, 0])
    r = quat_to_matrix(node.get('rotation', [0, 0, 0, 1]))
    s = node.get('scale', [1, 1, 1])
    return [[r[i][0] * s[0], r[i][1] * s[1], r[i][2] * s[2], t[i]] for i in range(3)] + [[0, 0, 0, 1]]


def mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def apply(m, p):
    return [m[i][0] * p[0] + m[i][1] * p[1] + m[i][2] * p[2] + m[i][3] for i in range(3)]


# Autodesk side: world boxes per element, then back to model feet (x, -z, y).
doc, binary = read_glb(capture + '/model.glb')
active = active_nodes(doc)
nodes, accessors, meshes = doc['nodes'], doc['accessors'], doc['meshes']
parent_of = {c: i for i, n in enumerate(nodes) for c in n.get('children', [])}


def world(i):
    m = node_matrix(nodes[i])
    while i in parent_of:
        i = parent_of[i]
        m = mul(node_matrix(nodes[i]), m)
    return m


raw = capture + '/raw/'
ids = load(raw + 'objects_ids.json.gz')
db_to_eid = {}
for db, ext in enumerate(ids):
    if isinstance(ext, str) and '-' in ext:
        try:
            db_to_eid[db] = int(ext.rsplit('-', 1)[1], 16)
        except ValueError:
            pass
attrs = load(raw + 'objects_attrs.json.gz'); vals = load(raw + 'objects_vals.json.gz'); avs = load(raw + 'objects_avs.json.gz'); offs = load(raw + 'objects_offs.json.gz')
n = len(offs)
cat_i = {i for i, a in enumerate(attrs) if a and a[0] == 'Category' and a[1] == '__category__'}
parent_i = {i for i, a in enumerate(attrs) if a and a[0] == 'parent'}
cat, parent = {}, {}
for db in range(1, n):
    s = offs[db] * 2; e = offs[db + 1] * 2 if db + 1 < n else len(avs)
    for k in range(s, e, 2):
        a, v = avs[k], avs[k + 1]
        if a in cat_i: cat[db] = vals[v]
        elif a in parent_i: parent[db] = vals[v]


def category_of(db):
    d = db
    while d is not None and d not in cat: d = parent.get(d)
    return cat.get(d, '(none)') if d is not None else '(none)'


ref = collections.defaultdict(lambda: [[math.inf] * 3, [-math.inf] * 3])
ref_cat = {}
ref_tris = collections.Counter()
reference_node_ids = set()
for i, node in enumerate(nodes):
    if i not in active or 'mesh' not in node:
        continue
    db = (node.get('extras') or {}).get('autodeskDbId')
    eid = db_to_eid.get(db)
    if eid is None:
        continue
    reference_node_ids.add(eid)
    m = world(i)
    for prim in meshes[node['mesh']]['primitives']:
        points, triangles = triangle_positions(doc, binary, prim)
        if not points:
            continue
        ref_cat.setdefault(eid, category_of(db))
        ref_tris[eid] += triangles
        box = ref[eid]
        for point in points:
            p = apply(m, point)
            q = [p[0] * FEET_PER_METRE, -p[2] * FEET_PER_METRE, p[1] * FEET_PER_METRE]
            for k in range(3):
                box[0][k] = min(box[0][k], q[k]); box[1][k] = max(box[1][k], q[k])

# Reviter side: never silently substitute a stored envelope for drawn geometry.
audit = json.load(open(audit_path))
elements = {e['elementId']: e for e in audit['elementManifest']['elements']}
if args.bounds == 'drawn' and any('drawnBoundsFeet' not in (e.get('geometry') or {}) for e in elements.values()):
    sys.exit('audit lacks drawnBoundsFeet; regenerate it, or use --bounds persisted for envelope diagnostics')

def box_from_json(b):
    if not b:
        return None
    box = ([b['min'][k] for k in 'xyz'], [b['max'][k] for k in 'xyz'])
    return box if all(math.isfinite(x) for side in box for x in side) else None

rec, persisted, src = {}, {}, {}
for eid, e in elements.items():
    g = e.get('geometry') or {}
    p = box_from_json(g.get('persistedBoundsFeet', g.get('boundsFeet')))
    if p:
        persisted[eid] = p
    b = p if args.bounds == 'persisted' else box_from_json(g.get('drawnBoundsFeet'))
    if e.get('displayed') and b:
        rec[eid] = b
        src[eid] = g.get('source') or g.get('finalProvenance') or 'unknown'

common = sorted(set(rec) & set(ref))
def median(v):
    v = sorted(v)
    return (v[(len(v)-1)//2] + v[len(v)//2]) / 2 if v else None

offset = [median([(ref[e][0][k] + ref[e][1][k]) / 2 - (rec[e][0][k] + rec[e][1][k]) / 2 for e in common]) for k in range(3)] if common else None

def errors(box, reference):
    if box is None or offset is None:
        return None
    sizes = [box[1][k] - box[0][k] for k in range(3)]
    reference_sizes = [reference[1][k] - reference[0][k] for k in range(3)]
    dc = max(abs((reference[0][k] + reference[1][k]) / 2 - offset[k] - (box[0][k] + box[1][k]) / 2) for k in range(3))
    ds = max(abs(reference_sizes[k] - sizes[k]) for k in range(3))
    return dict(centreErrorFeet=dc, sizeErrorFeet=ds, centreOK=dc <= tolerance,
                sizeOK=ds <= tolerance, sizeFeet=sizes, referenceSizeFeet=reference_sizes)

rows = collections.defaultdict(lambda: dict(reference=0, matched=0, missing=0, centreOK=0, sizeOK=0, sources=collections.Counter()))
measurements = []
missing = []
for eid in sorted(ref):
    category = ref_cat[eid]
    row = rows[category]
    row['reference'] += 1
    if eid not in rec:
        row['missing'] += 1
        missing.append(dict(elementId=eid, category=category, status='not-drawn' if eid in elements else 'absent-from-manifest'))
        continue
    m = errors(rec[eid], ref[eid])
    row['matched'] += 1
    row['centreOK'] += m['centreOK']
    row['sizeOK'] += m['sizeOK']
    row['sources'][src[eid]] += 1
    measurements.append(dict(elementId=eid, category=category, family=(elements[eid].get('type') or {}).get('familyName'),
                             source=src[eid], measured=m, persisted=errors(persisted.get(eid), ref[eid])))

def percent(n, total):
    return f'{100*n/total:.1f}%' if total else 'n/a'

print(f'{args.bounds} bounds; matched {len(common)} / {len(ref)} reference elements; {len(missing)} missing/not drawn')
print(f'frame offset: {offset} ft; tolerance {tolerance} ft on every axis; bounds agreement is not surface agreement')
print(f"{'Autodesk category':34} {'drawn/ref':>11} {'centre OK':>10} {'size OK':>10} {'missing':>8}  final source")
for category, row in sorted(rows.items(), key=lambda item: (-item[1]['reference'], item[0])):
    routes = ', '.join(f'{k} {v}' for k, v in row['sources'].most_common())
    print(f"{category[:34]:34} {str(row['matched'])+'/'+str(row['reference']):>11} {percent(row['centreOK'],row['matched']):>10} {percent(row['sizeOK'],row['matched']):>10} {row['missing']:8}  {routes}")
centre_ok = sum(r['centreOK'] for r in rows.values())
size_ok = sum(r['sizeOK'] for r in rows.values())
print(f'TOTAL centre {percent(centre_ok,len(common))}; size {percent(size_ok,len(common))}; reference element coverage {percent(len(common),len(ref))}')
non_surface = sorted(reference_node_ids - set(ref))
print(f'{len(non_surface)} mapped reference IDs contain no triangle surface and are excluded from the surface population')
extra = sorted(set(rec) - reference_node_ids)
print(f'{len(extra)} displayed IDs outside reference view; these are not automatically geometry defects')
print('Largest drawn-size disagreements:' if args.bounds == 'drawn' else 'Largest envelope-size disagreements:')
for m in sorted(measurements, key=lambda m: -m['measured']['sizeErrorFeet'])[:12]:
    print(f"  {m['elementId']} {m['category']} {m['family'] or ''}: {m['measured']['sizeErrorFeet']:.3f} ft; {m['source']}")
report = dict(schemaVersion=1, measurement=args.bounds, toleranceFeet=tolerance, translationFeet=offset,
              caveat='Triangle-surface elements only; matched bounds are not surface fidelity. IDs outside the reference view are not automatically defects.',
              inputHashes={p: hashlib.sha256(open(p, 'rb').read()).hexdigest() for p in [audit_path, capture+'/model.glb', *[raw+'objects_'+name+'.json.gz' for name in ['ids','attrs','vals','avs','offs']]]},
              summary=dict(reference=len(ref), matched=len(common), missing=len(missing), outsideReferenceView=len(extra), centreOK=centre_ok, sizeOK=size_ok),
              categories=dict(rows), elements=measurements, missing=missing, outsideReferenceView=extra, nonSurfaceReferenceElements=non_surface)
if args.json_path:
    with open(args.json_path, 'w') as f:
        json.dump(report, f, indent=2, allow_nan=False)
