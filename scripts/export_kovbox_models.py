"""Export the six game meshes from the KovBoxes Blender collection.

blender --background --disable-autoexec KovBoxes_Collection.blend \
  --python scripts/export_kovbox_models.py -- static/releases/<release>/media/kovboxes

All coordinates and split normals come from the evaluated Blender meshes. Each
batch uses 16-bit indices so the viewer can also run on older WebGL devices.
"""
import gzip
import shutil
import struct
import sys
from array import array
from pathlib import Path

import bpy
from mathutils import Vector

VARIANTS = ("bronze", "silver", "gold", "rainbow", "ice", "festive")
POSITION_SCALE = 8192
VERTEX = struct.Struct("<3h3b9B")


def clamp(value):
    return min(1.0, max(0.0, value))


def mix(first, second, amount):
    return tuple(a + (b - a) * amount for a, b in zip(first, second))


def srgb(linear):
    return 12.92 * linear if linear < 0.0031308 else 1.055 * linear ** (1 / 2.4) - 0.055


def byte(value):
    return round(clamp(value) * 255)


def rainbow_color(ramps, point):
    x, y, z = point
    diagonal = clamp((x + y + 2.06) / 4.12)
    low, middle, high = [ramp.evaluate(diagonal)[:3] for ramp in ramps]
    lower_blend = clamp((z + 0.91) / 1.03)
    upper_blend = clamp((z - 0.10) / 0.87)
    return mix(mix(low, middle, lower_blend), high, upper_blend)


class Material:
    def __init__(self, material, variant):
        shader = next(n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        inputs = shader.inputs
        self.base = tuple(inputs["Base Color"].default_value[:3])
        self.roughness = inputs["Roughness"].default_value if not inputs["Roughness"].is_linked else 0.22
        self.metallic = inputs["Metallic"].default_value
        self.emission = tuple(inputs["Emission Color"].default_value[:3])
        self.intensity = min(inputs["Emission Strength"].default_value, 3.0)
        self.kind = 0
        self.ramps = ()
        if variant == "rainbow" and inputs["Base Color"].is_linked:
            self.ramps = tuple(n.color_ramp for n in material.node_tree.nodes if n.type == "VALTORGB")
        if variant == "ice" and inputs["Base Color"].is_linked:
            self.base = (0.068, 0.29, 0.66)
            self.emission = (0.025, 0.18, 1.0)
            self.intensity = 0.22
            self.kind = 1

    def packed(self, point):
        color = rainbow_color(self.ramps, point) if self.ramps else self.base
        glow = color if self.ramps else self.emission
        return (*[byte(srgb(v)) for v in color],
                *[byte(srgb(clamp(v * self.intensity / 3))) for v in glow],
                byte(self.roughness), byte(self.metallic), self.kind)


class Batch:
    def __init__(self):
        self.lookup = {}
        self.vertices = bytearray()
        self.indices = array("H")

    def write(self, stream):
        stream.write(struct.pack("<II", len(self.lookup), len(self.indices)))
        stream.write(self.vertices)
        if sys.byteorder != "little":
            self.indices.byteswap()
        self.indices.tofile(stream)

    def add_triangle(self, corners):
        for corner in corners:
            index = self.lookup.get(corner)
            if index is None:
                index = len(self.lookup)
                self.lookup[corner] = index
                self.vertices.extend(corner)
            self.indices.append(index)


def export(scene, variant, destination):
    bpy.context.window.scene = scene
    objects = [o for o in scene.objects if o.type in {"MESH", "CURVE"} and not o.hide_render]
    for obj in objects:
        for modifier in obj.modifiers:
            if modifier.type == "BEVEL":
                modifier.segments = min(modifier.segments, 2)
        if variant == "festive" and obj.type == "MESH" and len(obj.data.polygons) >= 600:
            if "иголк" not in obj.name:
                modifier = obj.modifiers.new("Web mesh", "DECIMATE")
                modifier.ratio = 0.36
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = [o.evaluated_get(depsgraph) for o in objects]
    bounds = [obj.matrix_world @ Vector(co) for obj in evaluated for co in obj.bound_box]
    center = Vector([(min(p[i] for p in bounds) + max(p[i] for p in bounds)) / 2 for i in range(3)])

    batches = [Batch()]
    materials = {}
    radius = 0
    for obj in evaluated:
        mesh = obj.to_mesh()
        mesh.calc_loop_triangles()
        slots = []
        for material in mesh.materials:
            if material not in materials:
                materials[material] = Material(material, variant)
            slots.append(materials[material])
        normal_transform = obj.matrix_world.to_3x3().inverted_safe().transposed()
        points = [obj.matrix_world @ v.co for v in mesh.vertices]
        positions = [p - center for p in points]
        radius = max(radius, max((p.length for p in positions), default=0))
        coordinates = [tuple(round(value * POSITION_SCALE) for value in (p.x, p.z, -p.y)) for p in positions]
        normals = []
        for corner in mesh.corner_normals:
            n = (normal_transform @ corner.vector).normalized()
            normals.append(tuple(round(value * 127) for value in (n.x, n.z, -n.y)))

        # Separate subpixel needles contribute texture. Keep their distribution
        # along each branch with a deterministic half-density sample.
        needles = variant == "festive" and "иголк" in obj.name
        for tri in mesh.loop_triangles:
            if needles and tri.index % 2:
                continue
            appearance = slots[tri.material_index]
            corners = [VERTEX.pack(*coordinates[v], *normals[loop], *appearance.packed(points[v]))
                       for loop, v in zip(tri.loops, tri.vertices)]
            if len(batches[-1].lookup) > 65533:
                batches.append(Batch())
            batches[-1].add_triangle(corners)
        obj.to_mesh_clear()

    with destination.open("wb") as stream:
        stream.write(struct.pack("<4sHHf", b"KBOX", 1, len(batches), radius))
        for batch in batches:
            batch.write(stream)
    with destination.open("rb") as source, destination.with_suffix(".bin.gz").open("wb") as packed:
        with gzip.GzipFile(fileobj=packed, filename="", mtime=0) as compressed:
            shutil.copyfileobj(source, compressed)
    print(variant, sum(len(b.indices) // 3 for b in batches), "triangles,", len(batches),
          "batches,", destination.stat().st_size, "bytes", flush=True)


if __name__ == "__main__":
    output = Path(sys.argv[sys.argv.index("--") + 1])
    output.mkdir(parents=True, exist_ok=True)
    for index, variant in enumerate(VARIANTS, 1):
        scene = next(s for s in bpy.data.scenes if s.name.startswith(f"{index:02}"))
        export(scene, variant, output / f"{variant}.bin")
