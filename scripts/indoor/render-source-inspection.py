"""Blender source inspection. Does not authorize routes or modify source geometry.
blender -b -t 4 --python render-source-inspection.py -- SCENE-DIRECTORY NEW-OUTPUT [VIEW-ID...]
"""
import bpy
import hashlib
import json
import math
import re
import sys
from pathlib import Path
from mathutils import Vector


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def point3(value):
    if not isinstance(value, list) or len(value) != 3 or not all(isinstance(n, (int, float)) and math.isfinite(n) for n in value):
        raise ValueError('A finite original-model point is required')
    return value


arguments = sys.argv[sys.argv.index('--')+1:]
if len(arguments) < 2:
    raise ValueError('Scene directory and new capture directory are required')
root, output = Path(arguments[0]).resolve(), Path(arguments[1]).resolve()
metadata = json.loads((root/'scene-export.json').read_text())
config = json.loads((root/'render.json').read_text())
scene_path = root/'source-scene.glb'
if metadata.get('format') != 'source-scene-inspection-v1' or digest(scene_path) != metadata['sourceSceneSha256'] or digest(root/'render.json') != metadata['renderConfigSha256']:
    raise ValueError('Source scene or camera recipe checksum mismatch')
if config.get('version') != 1 or not isinstance(config.get('views'), list) or not 1 <= len(config['views']) <= 32:
    raise ValueError('A versioned, bounded camera list is required')
names = [view.get('id', '') for view in config['views']]
if len(names) != len(set(names)) or any(not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}', name) for name in names):
    raise ValueError('Unique safe view identities are required')
selected = arguments[2:] or names
if len(selected) != len(set(selected)) or any(name not in names for name in selected):
    raise ValueError('Selected view identity is absent or repeated')
width, height, samples = config.get('width', 1280), config.get('height', 960), config.get('samples', 64)
if any(not isinstance(n, int) or not 64 <= n <= 4096 for n in [width, height]) or not isinstance(samples, int) or not 1 <= samples <= 2048:
    raise ValueError('Invalid resolution/sample budget')
output.mkdir(exist_ok=False)
frames = output/'frames'
frames.mkdir(exist_ok=False)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(scene_path))
scene = bpy.context.scene
meshes = [obj for obj in scene.objects if obj.type == 'MESH']
triangles = sum(len(obj.data.polygons) for obj in meshes)
if len(meshes) != metadata['nonemptyMeshes'] or triangles != metadata['triangles']:
    raise ValueError('Incomplete or changed source mesh import')
origin = metadata['originFeet']


def model_point(value):
    x, y, z = point3(value)
    return Vector((x-origin['x'], y-origin['y'], z-origin['z']))


scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = samples
scene.cycles.seed = config.get('seed', 0)
scene.cycles.use_denoising = bool(getattr(bpy.app.build_options, 'openimagedenoise', False))
scene.render.resolution_x = width
scene.render.resolution_y = height
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.world = bpy.data.worlds.new('Inspection ambient light')
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.75, .8, .86, 1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = config.get('ambientStrength', .65)
scene.view_settings.view_transform = 'AgX'
if len(config.get('lights', [])) > 64:
    raise ValueError('Inspection lighting budget exceeded')
for i, light in enumerate(config.get('lights', [])):
    source = bpy.data.lights.new('Inspection light '+str(i), 'AREA')
    source.energy = light.get('energy', 1800)
    source.shape = 'DISK'
    source.size = light.get('sizeFeet', 8)
    if not math.isfinite(source.energy) or source.energy < 0 or not math.isfinite(source.size) or source.size <= 0:
        raise ValueError('Invalid inspection light')
    obj = bpy.data.objects.new(source.name, source)
    scene.collection.objects.link(obj)
    obj.location = model_point(light['pointFeet'])
camera_data = bpy.data.cameras.new('Inspection camera')
camera = bpy.data.objects.new('Inspection camera', camera_data)
scene.collection.objects.link(camera)
scene.camera = camera
camera_data.lens = config.get('lensMillimetres', 23)
camera_data.clip_start = config.get('clipStartFeet', .015)
camera_data.clip_end = config.get('clipEndFeet', 5000)
if not 1 <= camera_data.lens <= 300 or not 0 < camera_data.clip_start < camera_data.clip_end:
    raise ValueError('Invalid camera optics/clip range')
receipt = {'format': 'source-scene-render-v1', 'complete': False,
           'sourceSceneSha256': metadata['sourceSceneSha256'],
           'sourceModelSha256': metadata['sourceModelSha256'],
           'modelCacheSha256': metadata['modelCacheSha256'],
           'renderConfigSha256': metadata['renderConfigSha256'],
           'rendererScriptSha256': digest(Path(__file__)),
           'renderer': 'Blender '+bpy.app.version_string+' Cycles CPU',
           'fullSceneMeshCount': len(meshes), 'triangles': triangles,
           'geometryOrSourceMaterialsEdited': False, 'inspectionLightsAdded': True,
           'resolution': [width, height], 'samples': samples,
           'configuredViewCount': len(names), 'selectedViewIds': selected,
           'denoising': scene.cycles.use_denoising,
           'cameraClipFeet': [camera_data.clip_start, camera_data.clip_end],
           'browserScreenshots': False, 'routeOrClearanceAuthorityGranted': False,
           'views': []}


def save_receipt():
    (output/'render-receipt.json').write_text(json.dumps(receipt, indent=2)+'\n')


save_receipt()
try:
    for view in config['views']:
        if view['id'] not in selected:
            continue
        eye, target = point3(view['eyeFeet']), point3(view['targetFeet'])
        camera.location = model_point(eye)
        direction = model_point(target)-camera.location
        if direction.length == 0:
            raise ValueError('A nonzero camera direction is required')
        camera.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
        target_file = frames/(view['id']+'.png')
        scene.render.filepath = str(target_file)
        bpy.ops.render.render(write_still=True)
        receipt['views'].append({'id': view['id'], 'label': view.get('label', view['id']),
                                 'kind': view.get('kind', 'perspective'),
                                 'eyeFeet': eye, 'targetFeet': target,
                                 'referenceElevationFeet': view.get('referenceElevationFeet'),
                                 'image': str(target_file.relative_to(output)), 'sha256': digest(target_file)})
        save_receipt()
    if digest(scene_path) != metadata['sourceSceneSha256']:
        raise ValueError('Source scene changed while rendering')
    receipt['complete'] = True
    save_receipt()
except Exception as error:
    receipt['error'] = str(error)
    save_receipt()
    raise
