"""
Headless Blender rig-from-markers runner (prototype contract).

Usage:
  blender -b -P runpod/blender_rig_from_markers.py -- --spec C:\path\to\rig_payload.json --out C:\tmp\rig_job
"""

import argparse
import json
import os
import pathlib
import urllib.request

import bpy
from mathutils import Vector


def _download(url: str, dest: str):
    pathlib.Path(dest).parent.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(url, dest)


def _import_model(path: str):
    lower = path.lower()
    if lower.endswith(".glb") or lower.endswith(".gltf"):
        bpy.ops.import_scene.gltf(filepath=path)
    elif lower.endswith(".fbx"):
        bpy.ops.import_scene.fbx(filepath=path)
    elif lower.endswith(".obj"):
        bpy.ops.wm.obj_import(filepath=path)
    else:
        raise RuntimeError(f"Unsupported model format: {path}")


def _all_meshes():
    return [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]


def _bounds_world(objects):
    min_v = Vector((float("inf"), float("inf"), float("inf")))
    max_v = Vector((float("-inf"), float("-inf"), float("-inf")))
    found = False
    for obj in objects:
        for corner in obj.bound_box:
            p = obj.matrix_world @ Vector(corner)
            min_v.x = min(min_v.x, p.x)
            min_v.y = min(min_v.y, p.y)
            min_v.z = min(min_v.z, p.z)
            max_v.x = max(max_v.x, p.x)
            max_v.y = max(max_v.y, p.y)
            max_v.z = max(max_v.z, p.z)
            found = True
    return (min_v, max_v) if found else (None, None)


def _normalize_meshes(meshes, target_height=1.8):
    min_v, max_v = _bounds_world(meshes)
    if not min_v or not max_v:
        return
    center = (min_v + max_v) * 0.5
    ground = min_v.z
    for obj in meshes:
        obj.location -= Vector((center.x, center.y, ground))
    bpy.context.view_layer.update()

    min_v, max_v = _bounds_world(meshes)
    if not min_v or not max_v:
        return
    h = max(1e-6, max_v.z - min_v.z)
    scale = target_height / h
    for obj in meshes:
        obj.scale *= scale
    bpy.context.view_layer.update()
    for obj in meshes:
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        obj.select_set(False)


def _create_armature_from_markers(markers: dict, hierarchy: list):
    bpy.ops.object.armature_add(enter_editmode=True, location=(0.0, 0.0, 0.0))
    arm = bpy.context.active_object
    arm.name = "SM_Rig"
    eb = arm.data.edit_bones
    eb.remove(eb[0])

    created = {}
    for item in hierarchy:
        name = item["name"]
        parent = item.get("parent")
        head_m = markers.get(parent) if parent else markers.get(name)
        tail_m = markers.get(name)
        if not tail_m:
            continue
        head = Vector((head_m["x"], head_m["y"], head_m["z"])) if head_m else Vector((tail_m["x"], tail_m["y"], tail_m["z"]))
        tail = Vector((tail_m["x"], tail_m["y"], tail_m["z"]))
        if (tail - head).length < 1e-4:
            tail = tail + Vector((0.0, 0.05, 0.0))

        bone = eb.new(name)
        bone.head = head
        bone.tail = tail
        if parent and parent in created:
            bone.parent = created[parent]
            bone.use_connect = False
        created[name] = bone

    bpy.ops.object.mode_set(mode="OBJECT")
    return arm


def _parent_with_auto_weights(meshes, armature_obj):
    bpy.ops.object.select_all(action="DESELECT")
    for mesh in meshes:
        mesh.select_set(True)
    armature_obj.select_set(True)
    bpy.context.view_layer.objects.active = armature_obj
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--spec", required=True)
    parser.add_argument("--out", required=True)
    args, _unknown = parser.parse_known_args()

    out_dir = pathlib.Path(args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    with open(args.spec, "r", encoding="utf-8") as handle:
        spec = json.load(handle)

    model_url = spec["input"]["modelUrl"]
    markers = spec["input"]["markers"]
    hierarchy = spec["rig"]["boneHierarchy"]
    target_height = float(spec.get("normalize", {}).get("targetHeightMeters", 1.8))

    model_ext = spec.get("input", {}).get("modelFormatHint", "glb")
    model_path = str(out_dir / f"input_model.{model_ext}")
    _download(model_url, model_path)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    _import_model(model_path)
    meshes = _all_meshes()
    if not meshes:
        raise RuntimeError("No meshes imported from model")

    _normalize_meshes(meshes, target_height=target_height)
    armature_obj = _create_armature_from_markers(markers, hierarchy)
    _parent_with_auto_weights(meshes, armature_obj)

    blend_path = str(out_dir / "rigged.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)

    glb_path = str(out_dir / "rig_preview.glb")
    bpy.ops.export_scene.gltf(filepath=glb_path, export_format="GLB")

    with open(out_dir / "result.json", "w", encoding="utf-8") as handle:
        json.dump(
            {
                "status": "ok",
                "blendPath": blend_path,
                "previewGlbPath": glb_path,
                "meshCount": len(meshes),
            },
            handle,
            indent=2,
        )


if __name__ == "__main__":
    main()
