#!/usr/bin/env python3
"""Compare a Reviter JSON audit with the Autodesk SVF capture of the same model, both ways.

Usage: python3 scripts/compare-svf-elements.py <audit.json> <work/autodesk/<capture>-final>

Forward: of the Revit elements the Autodesk viewer draws, which does Reviter draw, per Autodesk category.
Back:    of the elements Reviter draws, which the viewer does not, per Reviter category.
"""
import json, gzip, collections, sys, re
audit, capture = sys.argv[1], sys.argv[2]
def load(p):
    b = open(p, 'rb').read()
    if b[:2] == b'\x1f\x8b': b = gzip.decompress(b)
    return json.loads(b)
raw = capture + '/raw/'
attrs = load(raw + 'objects_attrs.json.gz'); vals = load(raw + 'objects_vals.json.gz'); avs = load(raw + 'objects_avs.json.gz')
offs = load(raw + 'objects_offs.json.gz'); ids = load(raw + 'objects_ids.json.gz')
n = len(offs)
cat_i = {i for i, a in enumerate(attrs) if a and a[0] == 'Category' and a[1] == '__category__'}
parent_i = {i for i, a in enumerate(attrs) if a and a[0] == 'parent'}
name_i = {i for i, a in enumerate(attrs) if a and a[0] == 'name'}
cat, parent, name = {}, {}, {}
for db in range(1, n):
    s = offs[db] * 2; e = offs[db + 1] * 2 if db + 1 < n else len(avs)
    for k in range(s, e, 2):
        a, v = avs[k], avs[k + 1]
        if a in cat_i: cat[db] = vals[v]
        elif a in parent_i: parent[db] = vals[v]
        elif a in name_i: name[db] = vals[v]
def category_of(db):
    d = db
    while d is not None and d not in cat: d = parent.get(d)
    return cat.get(d, '(none)') if d is not None else '(none)'
frags = json.load(open(capture + '/fragments.json'))
drawn = {}
for f in frags:
    ext = ids[f['dbId']]
    if isinstance(ext, str) and '-' in ext:
        try: eid = int(ext.rsplit('-', 1)[1], 16)
        except ValueError: continue
        drawn.setdefault(eid, category_of(f['dbId']))
a = json.load(open(audit))
manifest = {e['elementId']: e for e in a['elementManifest']['elements']}
displayed = {eid for eid, e in manifest.items() if e.get('displayed')}
print(f"Autodesk draws {len(drawn)} elements; Reviter manifest {len(manifest)} elements, {len(displayed)} displayed")
print(f"stats: {json.dumps({k: a['stats'][k] for k in ('boundsRecordsFound','solidBoundsRecords','elementObjects','triangleCount','fittedLimitsReached') if k in a['stats']})}")
print(f"categories: tokens {a['nativeCategories']['tokensFound']} direct {a['nativeCategories']['directElements']} inherited {a['nativeCategories']['inheritedElements']}")
print(f"levels: {[(l.get('elevation'), l.get('elementId', l.get('source'))) for l in a['levels']][:14]}")
print(f"decoders: {a['decoderCoverage']['activeDecoders']}")
print(f"geometry fidelity: {a['decoderCoverage'].get('geometryFidelity')} nativeMeshes {a['decoderCoverage'].get('nativeMeshes')} nativeMeshElements {a['decoderCoverage'].get('nativeMeshElements')}")
print("\nFORWARD: Autodesk-drawn elements, by Autodesk category -> Reviter displayed / in manifest / missing")
per = collections.defaultdict(lambda: [0, 0, 0])
for eid, c in drawn.items():
    row = per[c]; row[0] += 1
    if eid in displayed: row[1] += 1
    elif eid in manifest: row[2] += 1
tot = [0, 0, 0]
for c, (d, s, m) in sorted(per.items(), key=lambda x: -x[1][0]):
    tot[0] += d; tot[1] += s; tot[2] += m
    print(f"  {d:6} drawn  {s:6} displayed ({100*s/d:5.1f}%)  {m:5} manifest-only  {d-s-m:5} absent   {c}")
print(f"  {tot[0]:6} drawn  {tot[1]:6} displayed ({100*tot[1]/tot[0]:5.1f}%)  {tot[2]:5} manifest-only  {tot[0]-tot[1]-tot[2]:5} absent   TOTAL")
print("\nBACK: Reviter-displayed elements the viewer does not draw, by Reviter category")
extra = collections.Counter()
for eid in displayed - set(drawn):
    c = manifest[eid].get('category'); c = (c.get('name') or c.get('label') or str(c)) if isinstance(c, dict) else (c or '(none)')
    extra[c] += 1
for c, k in extra.most_common(25): print(f"  {k:6}  {c}")
print(f"  {sum(extra.values()):6}  TOTAL ({100*sum(extra.values())/max(1,len(displayed)):.1f}% of displayed)")
prov = collections.Counter((manifest[e]['geometry'] or {}).get('source') for e in displayed)
print("\ndisplayed geometry sources:", dict(prov.most_common(12)))
