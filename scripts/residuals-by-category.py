#!/usr/bin/env python3
"""Attribute a glb-surface-diff report's residuals to categories, both ways.

Usage: python3 scripts/residuals-by-category.py <diff.json> <work/autodesk/<capture>-final>

Reference-only voxels are grouped by the Autodesk category of the node (dbId)
that owns them; recovered-only voxels by the recovered GLB's mesh name, which
Reviter writes per category batch.
"""
import json, gzip, sys, collections
diff, capture = json.load(open(sys.argv[1])), sys.argv[2]
def load(p):
    b = open(p, 'rb').read()
    if b[:2] == b'\x1f\x8b': b = gzip.decompress(b)
    return json.loads(b)
raw = capture + '/raw/'
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
d = diff['diff']
print(f"recovered coverage {d['recoveredCoverage']:.4f}  reference coverage {d['referenceCoverage']:.4f}  recovered-only {d['recoveredOnly']}  reference-only {d['referenceOnly']}")
ref_only = collections.Counter(); ref_total = collections.Counter()
for m in diff.get('referenceOnlyByMesh', []):
    try: c = category_of(int(m['mesh']))
    except (ValueError, TypeError): c = '(unnamed)'
    ref_only[c] += m['referenceOnly']; ref_total[c] += m['voxels']
print("\nREFERENCE-ONLY voxels by Autodesk category (voxel-cells missing from the recovery; per-mesh sums overlap where meshes share cells):")
for c, k in ref_only.most_common(15): print(f"  {k:8} of {ref_total[c]:8} ({100*k/max(1,ref_total[c]):5.1f}%)  {c}")
rec_only = collections.Counter(); rec_total = collections.Counter()
for m in diff.get('recoveredOnlyByMesh', []):
    name = str(m.get('mesh')).rsplit(' ', 1)[0]
    rec_only[name] += m.get('recoveredOnly', 0); rec_total[name] += m.get('voxels', 0)
print("\nRECOVERED-ONLY voxels by Reviter category batch (cells the reference does not have):")
for c, k in rec_only.most_common(15): print(f"  {k:8} of {rec_total[c]:8} ({100*k/max(1,rec_total[c]):5.1f}%)  {c}")
