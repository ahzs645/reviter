// Run in the Autodesk Viewer DevTools Console after a 3D view finishes loading.
// Tested against viewer 7.126.1. Uses the existing session; saves no credentials.
(async () => {
  const exportName = 'autodesk-model'; // Optionally change the download name.
  const model = globalThis.NOP_VIEWER?.model;
  if (!model) throw new Error('Run this in an Autodesk Viewer tab with a loaded model');
  const data = model.getData();
  if (model.is2d() || !model.isLoadDone() || model.loader.failedToLoadPacksCount)
    throw new Error('3D geometry is not fully loaded');
  const endpoint = Autodesk.Viewing.endpoint;
  const context = endpoint.initLoadContext({ api: endpoint.ENDPOINT_API_DERIVATIVE_SERVICE_V2, queryParams: model.loader.queryParams });
  const root = model.getDocumentNode().data.children.find(x => x.mime === 'application/autodesk-svf');
  if (!root) throw new Error('This view does not expose an SVF derivative');
  const rootUrl = endpoint.getItemApi(undefined, root.urn, endpoint.ENDPOINT_API_DERIVATIVE_SERVICE_V2);
  const baseUrl = rootUrl.slice(0, rootUrl.lastIndexOf('/') + 1);
  const download = url => new Promise((resolve, reject) =>
    Autodesk.Viewing.Private.ViewingService.getItem(context, url, resolve,
      code => reject(new Error(`Asset download failed (${code})`)), { responseType: 'arraybuffer' }));
  const rootResponse = await download(rootUrl);
  const rootBytes = rootResponse instanceof Uint8Array ? rootResponse : new Uint8Array(rootResponse);
  // Streaming viewers use a different in-memory manifest. Read the legacy SVF's
  // own ZIP manifest with native browser decompression; no external script needed.
  async function zipJson(bytes, filename) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = bytes.length - 22;
    for (; end >= Math.max(0, bytes.length - 65557); end--) if (view.getUint32(end, true) === 0x06054b50) break;
    if (end < 0 || view.getUint32(end, true) !== 0x06054b50) throw new Error('Invalid SVF ZIP directory');
    const count = view.getUint16(end + 10, true);
    let cursor = view.getUint32(end + 16, true);
    for (let i = 0; i < count; i++) {
      if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error('Invalid SVF ZIP entry');
      const method = view.getUint16(cursor + 10, true), size = view.getUint32(cursor + 20, true);
      const nameLength = view.getUint16(cursor + 28, true);
      const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
      if (name === filename) {
        const local = view.getUint32(cursor + 42, true);
        if (view.getUint32(local, true) !== 0x04034b50) throw new Error('Invalid SVF ZIP local entry');
        const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
        if (start + size > bytes.length) throw new Error('Truncated SVF ZIP entry');
        let payload = bytes.subarray(start, start + size);
        if (method === 8) payload = new Uint8Array(await new Response(new Blob([payload]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
        else if (method !== 0) throw new Error('Unsupported SVF ZIP compression');
        return JSON.parse(new TextDecoder().decode(payload));
      }
      cursor += 46 + nameLength + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
    }
    throw new Error(`SVF ZIP is missing ${filename}`);
  }
  const manifest = Array.isArray(data.manifest?.assets) ? data.manifest : await zipJson(rootBytes, 'manifest.json');
  const assetPath = uri => {
    if (/^[a-z][a-z0-9+.-]*:|^\/|[?#\\]/i.test(uri))
      throw new Error('Expected a relative asset URI within this Autodesk derivative');
    const segments = ['model', 'view'];
    for (const part of decodeURIComponent(uri).split('/')) {
      if (part === '..') { if (!segments.length) throw new Error('Asset exceeds archive root'); segments.pop(); }
      else if (part !== '.') segments.push(part);
    }
    return segments.join('/');
  };
  const entries = [
    { path: 'model/view/model.svf', bytes: rootBytes },
    ...manifest.assets.filter(x => !x.URI.startsWith('embed:')).map(x => ({
      path: assetPath(x.URI),
      url: new URL(x.URI, baseUrl).href,
    })),
  ];
  if (new Set(entries.map(x => x.path)).size !== entries.length) throw new Error('Duplicate asset paths');
  const result = [];
  let next = 0;
  async function worker() {
    while (next < entries.length) {
      const entry = entries[next++];
      const response = entry.bytes ?? await download(entry.url);
      let bytes = response instanceof Uint8Array ? response : new Uint8Array(response);
      if (entry.path.endsWith('.gz') && !(bytes[0] === 31 && bytes[1] === 139)) {
        const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
        bytes = new Uint8Array(await new Response(stream).arrayBuffer());
      }
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const sha256 = Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('');
      result.push({ path: entry.path, bytes, sha256 });
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  if (globalThis.NOP_VIEWER.model !== model) throw new Error('The active model changed during capture; run again');
  const counts = { triangles: 0, lineSegments: 0, points: 0 };
  const fragments = model.getFragmentList();
  for (let i = 0; i < fragments.getCount(); i++) {
    const geometry = fragments.getGeometry(i);
    if (!geometry) throw new Error(`Fragment ${i} has no loaded geometry`);
    const indexCount = geometry.ib?.length ?? geometry.index?.array?.length ?? geometry.attributes?.index?.array?.length;
    const count = indexCount ?? (geometry.vb?.length / geometry.vbstride || geometry.attributes?.position?.array?.length / 3);
    if (!Number.isFinite(count)) throw new Error(`Cannot count geometry for fragment ${i}`);
    if (geometry.isPoints) counts.points += count;
    else if (geometry.isLines) counts.lineSegments += count / 2;
    else counts.triangles += count / 3;
  }
  const capture = {
    format: 'reviter-autodesk-svf', version: 1, name: exportName, sourceFormat: data.isOTG ? 'streaming' : 'svf', ...counts,
    view: model.getDocumentNode().data.name, viewerVersion: LMV_VIEWER_VERSION,
    capturedAt: new Date().toISOString(), fragments: model.getFragmentList().getCount(),
    geometryDefinitions: model.getGeometryList().geoms.filter(Boolean).length,
    materialDefinitions: data.numMaterials ?? Object.keys(data.materials?.materials ?? {}).length,
    units: data.metadata['distance unit'].value,
    failedGeometryPacks: model.loader.failedToLoadPacksCount,
    assets: result.map(x => ({ path: x.path, bytes: x.bytes.length, sha256: x.sha256 })),
  };
  const encoder = new TextEncoder();
  result.push({ path: 'capture.json', bytes: encoder.encode(JSON.stringify(capture, null, 2)) });
  const parts = [];
  function put(header, offset, length, text) {
    const bytes = encoder.encode(text);
    if (bytes.length > length) throw new Error('Archive field too long');
    header.set(bytes, offset);
  }
  const octal = (n, length) => n.toString(8).padStart(length - 1, '0') + '\0';
  for (const entry of result) {
    if (entry.path.startsWith('/') || entry.path.split('/').includes('..')) throw new Error('Unsafe archive path');
    const header = new Uint8Array(512);
    if (encoder.encode(entry.path).length <= 100) put(header, 0, 100, entry.path);
    else {
      const split = entry.path.lastIndexOf('/');
      if (split < 0) throw new Error('Archive filename too long');
      put(header, 0, 100, entry.path.slice(split + 1));
      put(header, 345, 155, entry.path.slice(0, split));
    }
    put(header, 100, 8, octal(420, 8));
    put(header, 108, 8, octal(0, 8));
    put(header, 116, 8, octal(0, 8));
    put(header, 124, 12, octal(entry.bytes.length, 12));
    put(header, 136, 12, octal(Math.floor(Date.now() / 1000), 12));
    header.fill(32, 148, 156);
    header[156] = 48;
    put(header, 257, 6, 'ustar\0');
    put(header, 263, 2, '00');
    const checksum = header.reduce((a, b) => a + b, 0);
    put(header, 148, 8, checksum.toString(8).padStart(6, '0') + '\0 ');
    parts.push(header, entry.bytes, new Uint8Array((512 - entry.bytes.length % 512) % 512));
  }
  parts.push(new Uint8Array(1024));
  const blob = new Blob(parts, { type: 'application/x-tar' });
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = exportName.replace(/[^a-zA-Z0-9._-]/g, '-') + '-svf.tar';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return { download: anchor.download, bytes: blob.size, files: result.length, capture };
})();
