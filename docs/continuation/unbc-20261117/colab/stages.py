import sys,re,gzip
def stages(path):
    rows=[]
    for line in gzip.open(path,'rt',errors='replace'):
        m=re.match(r'(\d\d):(\d\d):(\d\d) (.*)',line.rstrip())
        if m: rows.append((int(m[1])*3600+int(m[2])*60+int(m[3]),m[4]))
    t0=rows[0][0]; rows=[((t-t0)%86400,s) for t,s in rows]
    def first(pat):
        for t,s in rows:
            if re.search(pat,s): return t
    def last(pat):
        r=None
        for t,s in rows:
            if re.search(pat,s): r=t
        return r
    marks=[('walls and doors',first('Checking native walls and doors')),('ramps',first('Rebuilding source-bound native ramps')),('landing approaches',first('Checking native landing approaches')),
           ('room presentation',first('Preparing native wall-defined room presentation')),('floor planes',first('Native physical planes')),('cell routes (silent)',last('Native physical planes')),
           ('final replay',first('Replaying final native walking')),('diagnostic+stairs',first('prepared-mathematical-diagnostic-saved')),('export master (silent)',first('source-stepped-stair-finalization-replayed')),
           ('re-import and checks',first('rebuilt-master-import')),('end',rows[-1][0])]
    out=[('import and setup',0)]+marks
    return [(out[i][0],(out[i+1][1]-out[i][1])/60) for i in range(len(out)-1)], rows[-1][0]/60
a,ta=stages(sys.argv[1]); b,tb=stages(sys.argv[2])
print(f"{'stage':28} {'ordinary':>9} {'faster':>9}")
for (n,x),(_,y) in zip(a,b): print(f"{n:28} {x:9.1f} {y:9.1f}")
print(f"{'total':28} {ta:9.1f} {tb:9.1f}")
