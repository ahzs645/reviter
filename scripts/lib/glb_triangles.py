"""Strict triangle-position access for local, uncompressed GLB audit captures."""
import json
import math
import struct


def read_glb(path):
    data = open(path, 'rb').read()
    magic, version, length = struct.unpack_from('<III', data)
    if magic != 0x46546c67 or version != 2 or length != len(data):
        raise ValueError('Invalid GLB header')
    document, binary, offset = None, None, 12
    while offset < length:
        size, kind = struct.unpack_from('<II', data, offset)
        offset += 8
        if offset + size > length:
            raise ValueError('Truncated GLB chunk')
        chunk = data[offset:offset + size]
        if kind == 0x4e4f534a:
            document = json.loads(chunk)
        elif kind == 0x004e4942:
            binary = chunk
        offset += size
    if document is None or binary is None:
        raise ValueError('GLB needs JSON and binary chunks')
    return document, binary


def active_nodes(document):
    nodes = document.get('nodes', [])
    selected = set()
    def visit(index, ancestors):
        if index in ancestors:
            raise ValueError('GLB node cycle')
        if nodes[index].get('extensions', {}).get('EXT_mesh_gpu_instancing'):
            raise ValueError('GPU instancing is not supported by this element audit')
        selected.add(index)
        for child in nodes[index].get('children', []):
            visit(child, ancestors | {index})
    for root in document['scenes'][document.get('scene', 0)].get('nodes', []):
        visit(root, set())
    return selected


def accessor(document, binary, index):
    a = document['accessors'][index]
    if 'sparse' in a or a.get('normalized'):
        raise ValueError('Sparse/normalized accessors are not supported by this audit')
    view = document['bufferViews'][a['bufferView']]
    if view.get('buffer', 0) != 0:
        raise ValueError('External GLB buffers are not supported')
    fmt = {5121: 'B', 5123: 'H', 5125: 'I', 5126: 'f'}[a['componentType']]
    components = {'SCALAR': 1, 'VEC3': 3}[a['type']]
    item = struct.Struct('<' + fmt * components)
    stride = view.get('byteStride', item.size)
    base = view.get('byteOffset', 0)
    start = base + a.get('byteOffset', 0)
    end = start + (a['count'] - 1) * stride + item.size if a['count'] else start
    if stride < item.size or end > min(base + view['byteLength'], len(binary)):
        raise ValueError('Accessor exceeds its buffer view')
    return [item.unpack_from(binary, start + i * stride) for i in range(a['count'])]


def triangle_positions(document, binary, primitive):
    if primitive.get('mode', 4) != 4:
        return [], 0
    if primitive.get('extensions', {}).get('KHR_draco_mesh_compression'):
        raise ValueError('Compressed geometry is not supported by this audit')
    positions = accessor(document, binary, primitive['attributes']['POSITION'])
    indices = [v[0] for v in accessor(document, binary, primitive['indices'])] if 'indices' in primitive else list(range(len(positions)))
    if len(indices) % 3:
        raise ValueError('Incomplete triangle index list')
    used = []
    for i in set(indices):
        if not isinstance(i, int) or i < 0 or i >= len(positions):
            raise ValueError('Triangle index outside POSITION accessor')
        point = positions[i]
        if len(point) != 3 or not all(math.isfinite(v) for v in point):
            raise ValueError('Invalid triangle position')
        used.append(point)
    return used, len(indices) // 3
