bl_info = {
    "name": "Dimetric Sprite Frame Generator",
    "author": "Sprite Magician",
    "version": (0, 1, 4),
    "blender": (4, 0, 0),
    "location": "View3D > Sidebar > SpriteGen",
    "description": "Generate 16-direction dimetric sprite frames + manifest from armature actions.",
    "category": "Render",
}

import json
import math
import os
import re
import shutil
from array import array

import bpy
from bpy.props import BoolProperty, CollectionProperty, EnumProperty, FloatProperty, IntProperty, PointerProperty, StringProperty
from bpy.types import Operator, Panel, PropertyGroup, UIList
from mathutils import Matrix, Vector


DIR_LABELS_16 = [
    "n",
    "nne",
    "ne",
    "ene",
    "e",
    "ese",
    "se",
    "sse",
    "s",
    "ssw",
    "sw",
    "wsw",
    "w",
    "wnw",
    "nw",
    "nnw",
]

FEET_TO_METERS = 0.3048

DIRECTION_ENUM_ITEMS = [(d, d, "") for d in DIR_LABELS_16]


def direction_label_from_vector(scene, world_vec):
    cam_obj = scene.camera
    if not cam_obj:
        return "n"

    cam_q = cam_obj.matrix_world.to_quaternion()
    cam_right = cam_q @ Vector((1.0, 0.0, 0.0))
    cam_up = cam_q @ Vector((0.0, 1.0, 0.0))
    x = world_vec.dot(cam_right)
    y = world_vec.dot(cam_up)
    if abs(x) < 1e-6 and abs(y) < 1e-6:
        return "n"

    clockwise_angle = (math.degrees(math.atan2(x, y)) + 360.0) % 360.0
    index = int(round(clockwise_angle / 22.5)) % len(DIR_LABELS_16)
    return DIR_LABELS_16[index]


def clockwise_angle_from_vector(scene, world_vec):
    cam_obj = scene.camera
    if not cam_obj:
        return 0.0
    cam_q = cam_obj.matrix_world.to_quaternion()
    cam_right = cam_q @ Vector((1.0, 0.0, 0.0))
    cam_up = cam_q @ Vector((0.0, 1.0, 0.0))
    x = world_vec.dot(cam_right)
    y = world_vec.dot(cam_up)
    if abs(x) < 1e-6 and abs(y) < 1e-6:
        return 0.0
    return (math.degrees(math.atan2(x, y)) + 360.0) % 360.0


def _normalize_xy(v):
    out = Vector((v.x, v.y, 0.0))
    if out.length < 1e-6:
        return None
    out.normalize()
    return out


def _signed_angle_deg_xy(from_vec, to_vec):
    # Returns CCW angle around Z in degrees.
    cross_z = from_vec.x * to_vec.y - from_vec.y * to_vec.x
    dot = from_vec.x * to_vec.x + from_vec.y * to_vec.y
    return math.degrees(math.atan2(cross_z, dot))


def compute_north_back_base_angle(scene, armature_obj):
    cam_obj = scene.camera
    if not cam_obj:
        return 0.0

    forward_world = armature_obj.matrix_world.to_quaternion() @ Vector((0.0, 1.0, 0.0))
    forward_xy = _normalize_xy(forward_world)
    char_to_cam_xy = _normalize_xy(cam_obj.location - armature_obj.location)
    if not forward_xy or not char_to_cam_xy:
        return 0.0

    # "North" frame should show character back: character front points toward camera.
    return _signed_angle_deg_xy(forward_xy, char_to_cam_xy)


def direction_specs(props, _scene, _armature_obj):
    # Deterministic canonical mapping: d0 is always "n".
    start_index = 0
    clockwise = getattr(props, "rotation_direction", "CW") == "CW"

    specs = []
    for i in range(len(DIR_LABELS_16)):
        step = i if clockwise else -i
        label = DIR_LABELS_16[(start_index + step) % len(DIR_LABELS_16)]
        angle_deg = -22.5 * i if clockwise else 22.5 * i
        specs.append({"label": label, "cardinal": label, "angle_deg": angle_deg})
    return specs


def ensure_unique_direction_labels(specs):
    labels = [spec.get("label", "") for spec in specs]
    if len(labels) == len(DIR_LABELS_16) and len(set(labels)) == len(DIR_LABELS_16):
        return specs, False

    # Fallback to deterministic canonical ordering in render order.
    start_label = labels[0] if labels and labels[0] in DIR_LABELS_16 else "n"
    start_index = DIR_LABELS_16.index(start_label)

    step = 1
    if len(labels) >= 2 and labels[0] in DIR_LABELS_16 and labels[1] in DIR_LABELS_16:
        i0 = DIR_LABELS_16.index(labels[0])
        i1 = DIR_LABELS_16.index(labels[1])
        delta = (i1 - i0) % len(DIR_LABELS_16)
        if delta == len(DIR_LABELS_16) - 1:
            step = -1
        elif delta == 1:
            step = 1

    fixed = []
    for i, spec in enumerate(specs):
        label = DIR_LABELS_16[(start_index + step * i) % len(DIR_LABELS_16)]
        fixed.append({"angle_deg": spec.get("angle_deg", 22.5 * i), "label": label, "cardinal": label})
    return fixed, True


def sanitize_token(value: str) -> str:
    value = (value or "").strip().lower()
    value = re.sub(r"\s+", "_", value)
    value = re.sub(r"[^a-z0-9_]+", "", value)
    value = re.sub(r"_+", "_", value)
    return value.strip("_") or "unnamed"


def apply_projection_preset(props):
    mode = getattr(props, "projection_mode", "DIMETRIC")
    if mode == "ISOMETRIC":
        # Blender camera X rotation for true isometric elevation (~35.264 deg above horizon).
        props.camera_pitch_degrees = 54.73561032
        props.camera_yaw_degrees = 45.0
    else:
        # Dimetric: lower apparent view (less top-down) than isometric.
        props.camera_pitch_degrees = 65.0
        props.camera_yaw_degrees = 45.0


def on_projection_mode_update(self, _context):
    apply_projection_preset(self)


class SPRITEGEN_OT_apply_projection_preset(Operator):
    bl_idname = "spritegen.apply_projection_preset"
    bl_label = "Apply Projection Preset"
    bl_description = "Apply pitch/yaw values from current projection mode"

    def execute(self, context):
        props = context.scene.spritegen_props
        apply_projection_preset(props)
        self.report({"INFO"}, f"Applied {props.projection_mode.title()} projection preset.")
        return {"FINISHED"}


def find_target_armature(context):
    obj = context.active_object
    if obj and obj.type == "ARMATURE":
        return obj

    for selected in context.selected_objects:
        if selected.type == "ARMATURE":
            return selected

    for scene_obj in context.scene.objects:
        if scene_obj.type == "ARMATURE":
            return scene_obj
    return None


def find_selected_armature_only(context):
    obj = context.active_object
    if obj and obj.type == "ARMATURE":
        return obj
    for selected in context.selected_objects:
        if selected.type == "ARMATURE":
            return selected
    return None


def selected_armatures(context):
    return [obj for obj in context.selected_objects if obj.type == "ARMATURE"]


def scene_armatures_with_active_actions(context):
    out = []
    for obj in context.scene.objects:
        if obj.type != "ARMATURE":
            continue
        if obj.animation_data and obj.animation_data.action:
            out.append(obj)
    return out


def _collect_descendants(root_obj):
    out = []
    stack = list(root_obj.children)
    while stack:
        child = stack.pop()
        out.append(child)
        stack.extend(child.children)
    return out


def iter_character_objects(armature_obj):
    # Strict isolation: armature + its hierarchy only.
    # Avoid pulling unrelated meshes that happen to reference the same armature.
    objects = [armature_obj]
    objects.extend(_collect_descendants(armature_obj))
    return objects


def isolate_render_to_character(scene, armature_obj):
    keep = set(iter_character_objects(armature_obj))
    if scene.camera:
        keep.add(scene.camera)
    for obj in scene.objects:
        if obj.type == "LIGHT":
            keep.add(obj)

    previous_hide_render = {}
    for obj in scene.objects:
        previous_hide_render[obj.name] = obj.hide_render
        obj.hide_render = obj not in keep
    return previous_hide_render


def restore_render_visibility(scene, previous_hide_render):
    for obj in scene.objects:
        if obj.name in previous_hide_render:
            obj.hide_render = previous_hide_render[obj.name]


def set_visible_for_render(obj):
    obj.hide_set(False)
    obj.hide_viewport = False
    obj.hide_render = False


def world_bounds(objects):
    min_v = Vector((float("inf"), float("inf"), float("inf")))
    max_v = Vector((float("-inf"), float("-inf"), float("-inf")))
    found = False
    for obj in objects:
        if obj.type not in {"MESH", "ARMATURE"}:
            continue
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


def auto_setup_character(scene, armature_obj, cam_obj, projection_mode="DIMETRIC"):
    character_objects = iter_character_objects(armature_obj)
    for obj in character_objects:
        set_visible_for_render(obj)

    min_v, max_v = world_bounds(character_objects)
    if not min_v or not max_v:
        set_visible_for_render(armature_obj)
        return

    center = (min_v + max_v) * 0.5
    ground_offset = min_v.z

    # Put character on world ground and center it for deterministic renders.
    armature_obj.location -= Vector((center.x, center.y, ground_offset))
    bpy.context.view_layer.update()

    min_v, max_v = world_bounds(character_objects)
    if not min_v or not max_v:
        return

    center = (min_v + max_v) * 0.5
    size = max_v - min_v

    # Move camera to frame model bounds automatically.
    fit = max(size.x, size.y, size.z, 1.0)
    if projection_mode == "ISOMETRIC":
        z_factor = 1.25
    else:
        # Lower dimetric look: reduce camera height noticeably.
        z_factor = 0.75
    cam_obj.location = center + Vector((fit * 1.8, -fit * 1.8, fit * z_factor))
    cam_obj.data.ortho_scale = max(size.x, size.y) * 2.0 + 0.5


def character_height_meters(armature_obj):
    min_v, max_v = world_bounds(iter_character_objects(armature_obj))
    if not min_v or not max_v:
        return None
    return max(0.0, float(max_v.z - min_v.z))


def iter_world_bbox_points(objects):
    for obj in objects:
        if obj.type not in {"MESH", "ARMATURE"}:
            continue
        for corner in obj.bound_box:
            yield obj.matrix_world @ Vector(corner)


def fit_camera_to_bounds_for_action(scene, armature_obj, action, sampled_frames, margin_ratio, dir_specs):
    cam_obj = scene.camera
    if not cam_obj or cam_obj.type != "CAMERA" or cam_obj.data.type != "ORTHO":
        return

    character_objects = iter_character_objects(armature_obj)
    if not character_objects:
        return

    anim_data = armature_obj.animation_data_create()
    original_action = anim_data.action
    original_rot_mode = armature_obj.rotation_mode
    original_rot = armature_obj.rotation_euler.copy()
    original_frame = scene.frame_current

    cam_inv = cam_obj.matrix_world.inverted()
    min_x = float("inf")
    min_y = float("inf")
    max_x = float("-inf")
    max_y = float("-inf")
    found = False

    try:
        anim_data.action = action
        armature_obj.rotation_mode = "XYZ"

        base_angle = compute_north_back_base_angle(scene, armature_obj)
        for spec in dir_specs:
            armature_obj.rotation_euler.z = math.radians(base_angle + spec["angle_deg"])
            for frame in sampled_frames:
                scene.frame_set(frame)
                for p_world in iter_world_bbox_points(character_objects):
                    p_cam = cam_inv @ p_world
                    min_x = min(min_x, p_cam.x)
                    min_y = min(min_y, p_cam.y)
                    max_x = max(max_x, p_cam.x)
                    max_y = max(max_y, p_cam.y)
                    found = True
    finally:
        scene.frame_set(original_frame)
        armature_obj.rotation_mode = original_rot_mode
        armature_obj.rotation_euler = original_rot
        anim_data.action = original_action

    if not found:
        return

    pad = max(0.0, float(margin_ratio))
    width = max(0.001, max_x - min_x)
    height = max(0.001, max_y - min_y)
    center_x = (min_x + max_x) * 0.5
    center_y = (min_y + max_y) * 0.5

    aspect = scene.render.resolution_x / max(1.0, float(scene.render.resolution_y))
    needed_ortho = max(width, height * aspect) * (1.0 + pad)
    cam_obj.data.ortho_scale = max(0.001, needed_ortho)

    center_offset_world = cam_obj.matrix_world.to_3x3() @ Vector((center_x, center_y, 0.0))
    cam_obj.location += center_offset_world


def iter_action_data_paths(action):
    # Blender 4.x legacy actions.
    fcurves = getattr(action, "fcurves", None)
    if fcurves:
        for fcurve in fcurves:
            path = getattr(fcurve, "data_path", "")
            if path:
                yield path

    # Blender 5.x layered actions.
    layers = getattr(action, "layers", None)
    if not layers:
        return

    for layer in layers:
        for strip in getattr(layer, "strips", []):
            for channelbag in getattr(strip, "channelbags", []):
                for fcurve in getattr(channelbag, "fcurves", []):
                    path = getattr(fcurve, "data_path", "")
                    if path:
                        yield path


def action_matches_armature(action, armature_obj):
    if not action or not armature_obj or armature_obj.type != "ARMATURE":
        return False

    bone_names = {bone.name for bone in armature_obj.data.bones}
    if not bone_names:
        return False

    matched_any_curve = False
    for path in iter_action_data_paths(action):
        matched_any_curve = True
        if not path.startswith('pose.bones["'):
            continue
        bone_name = path.split('"', 2)[1] if '"' in path else ""
        if bone_name in bone_names:
            return True

    # If we could not inspect curves (new/unsupported action internals),
    # fail open so the UI still works and never crashes.
    return not matched_any_curve


def clean_action_display_name(name):
    name = (name or "").strip()
    if "|" in name:
        name = name.split("|")[-1].strip()
    if name.endswith(".001") or name.endswith(".002") or name.endswith(".003"):
        # Keep the display clean while identifier remains unique action datablock name.
        name = name.rsplit(".", 1)[0]
    return name or "unnamed"


def action_options_for_armature(armature_obj):
    # Show only actions currently in use by this armature (active or NLA strips).
    if not armature_obj:
        return []

    options = {}
    anim_data = armature_obj.animation_data
    if not anim_data:
        return []

    has_nla_strips = any(len(track.strips) > 0 for track in anim_data.nla_tracks)

    if anim_data.action:
        action = anim_data.action
        # If this armature is used as a single clip object (Idle/Walk),
        # use the armature object name as friendly display label.
        if has_nla_strips:
            options[action.name] = clean_action_display_name(action.name)
        else:
            options[action.name] = clean_action_display_name(armature_obj.name)

    for track in anim_data.nla_tracks:
        if track.mute:
            continue
        for strip in track.strips:
            action = strip.action
            if not action:
                continue
            display = clean_action_display_name(strip.name if strip.name else action.name)
            if action.name not in options:
                options[action.name] = display

    return sorted([(action_name, display, "") for action_name, display in options.items()], key=lambda i: i[1].lower())


def display_name_for_action_identifier(action_options, action_identifier):
    for item in action_options:
        if item[0] == action_identifier:
            return item[1]
    return action_identifier


def action_items(_self, context):
    # For action picker, use selected/active armature only to avoid cross-character action bleed.
    arm = find_selected_armature_only(context) or find_target_armature(context)
    if not arm:
        return []
    return action_options_for_armature(arm)


def ensure_sprite_camera(scene, pitch_deg=65.0, yaw_deg=45.0):
    cam_obj = scene.objects.get("SPRITE_CAM")
    if cam_obj and cam_obj.type != "CAMERA":
        cam_obj = None

    if cam_obj is None:
        cam_data = bpy.data.cameras.new("SPRITE_CAM")
        cam_obj = bpy.data.objects.new("SPRITE_CAM", cam_data)
        scene.collection.objects.link(cam_obj)

    cam = cam_obj.data
    cam.type = "ORTHO"
    cam.ortho_scale = 8.0

    # Dimetric look: lower pitch than classic isometric.
    cam_obj.location = (8.0, -8.0, 7.0)
    cam_obj.rotation_euler = (
        math.radians(float(pitch_deg)),
        0.0,
        math.radians(float(yaw_deg)),
    )

    scene.camera = cam_obj
    return cam_obj


def ensure_lights(scene):
    for name, light_type, energy, location in [
        ("KEY_LIGHT", "SUN", 3.5, (4.0, -4.0, 6.0)),
        ("FILL_LIGHT", "SUN", 1.6, (-4.0, 4.0, 4.0)),
    ]:
        obj = scene.objects.get(name)
        if obj and obj.type != "LIGHT":
            obj = None

        if obj is None:
            light_data = bpy.data.lights.new(name, light_type)
            obj = bpy.data.objects.new(name, light_data)
            scene.collection.objects.link(obj)

        obj.location = location
        obj.rotation_euler = (
            math.radians(50.0),
            0.0,
            math.radians(35.0 if name == "KEY_LIGHT" else -135.0),
        )
        obj.data.energy = energy


def configure_render(scene):
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100


def sample_action_frames(action, props):
    frame_start = int(math.floor(action.frame_range[0]))
    frame_end = int(math.ceil(action.frame_range[1]))
    if frame_end < frame_start:
        frame_end = frame_start
    trim_end = max(0, int(getattr(props, "trim_end_frames", 0)))
    frame_end = max(frame_start, frame_end - trim_end)

    if props.sampling_mode == "COUNT":
        count = max(1, int(props.frames_per_angle))
        if count == 1:
            return [frame_start]

        span = frame_end - frame_start
        samples = []
        for i in range(count):
            t = i / (count - 1)
            frame = int(round(frame_start + t * span))
            samples.append(frame)
        return samples

    frames = list(range(frame_start, frame_end + 1, props.frame_step))
    return frames or [frame_start]


def build_sheet_image(sheet_path, frame_paths_by_direction, frame_w, frame_h, padding):
    rows = len(frame_paths_by_direction)
    cols = len(frame_paths_by_direction[0]) if rows else 0
    if rows == 0 or cols == 0:
        raise RuntimeError("No rendered frames available for sheet packing.")

    sheet_w = cols * frame_w + (cols + 1) * padding
    sheet_h = rows * frame_h + (rows + 1) * padding
    pixel_count = sheet_w * sheet_h * 4
    sheet_pixels = array("f", [0.0]) * pixel_count

    for row, row_paths in enumerate(frame_paths_by_direction):
        for col, frame_path in enumerate(row_paths):
            image = bpy.data.images.load(frame_path, check_existing=False)
            try:
                if image.size[0] != frame_w or image.size[1] != frame_h:
                    raise RuntimeError(
                        f"Frame size mismatch for sheet packing: {os.path.basename(frame_path)} "
                        f"is {image.size[0]}x{image.size[1]}, expected {frame_w}x{frame_h}"
                    )

                src = array("f", image.pixels[:])
                origin_x = padding + col * (frame_w + padding)
                # Keep direction 0 at top row.
                origin_y = sheet_h - padding - (row + 1) * frame_h - row * padding

                for y in range(frame_h):
                    src_row_start = (y * frame_w) * 4
                    dst_row_start = ((origin_y + y) * sheet_w + origin_x) * 4
                    row_slice = src[src_row_start : src_row_start + frame_w * 4]
                    sheet_pixels[dst_row_start : dst_row_start + frame_w * 4] = array("f", row_slice)
            finally:
                bpy.data.images.remove(image)

    sheet_img = bpy.data.images.new("sprite_sheet_tmp", width=sheet_w, height=sheet_h, alpha=True)
    try:
        sheet_img.pixels = sheet_pixels
        sheet_img.filepath_raw = sheet_path
        sheet_img.file_format = "PNG"
        sheet_img.save()
    finally:
        bpy.data.images.remove(sheet_img)

    return sheet_w, sheet_h, rows, cols


def pack_sheet_pages(
    unit_root,
    action_name,
    frame_paths_by_direction,
    frame_w,
    frame_h,
    padding,
    max_sheet_dimension,
    page_mode,
):
    total_rows = len(frame_paths_by_direction)
    total_cols = len(frame_paths_by_direction[0]) if total_rows else 0
    if total_rows == 0 or total_cols == 0:
        raise RuntimeError("No rendered frames available for sheet packing.")

    if page_mode == "TWO_EVEN":
        max_rows = max(1, math.ceil(total_rows / 2))
        max_cols = total_cols
    else:
        max_rows = max(1, (max_sheet_dimension - padding) // max(1, (frame_h + padding)))
        max_cols = max(1, (max_sheet_dimension - padding) // max(1, (frame_w + padding)))

    pages = []
    page_index = 0
    row_start = 0
    while row_start < total_rows:
        row_end = min(total_rows, row_start + max_rows)
        col_start = 0
        while col_start < total_cols:
            col_end = min(total_cols, col_start + max_cols)
            tile = [row[col_start:col_end] for row in frame_paths_by_direction[row_start:row_end]]
            page_index += 1

            if page_index == 1 and row_start == 0 and col_start == 0 and row_end == total_rows and col_end == total_cols:
                page_file = f"{action_name}.png"
            else:
                page_file = f"{action_name}_p{page_index:02d}.png"

            page_path = os.path.join(unit_root, page_file)
            sheet_w, sheet_h, rows, cols = build_sheet_image(
                sheet_path=page_path,
                frame_paths_by_direction=tile,
                frame_w=frame_w,
                frame_h=frame_h,
                padding=padding,
            )
            pages.append(
                {
                    "file": page_file,
                    "row_range": [row_start, row_end - 1],
                    "col_range": [col_start, col_end - 1],
                    "rows": rows,
                    "cols": cols,
                    "w": sheet_w,
                    "h": sheet_h,
                }
            )
            col_start = col_end
        row_start = row_end

    return pages


class SpriteGenBatchItem(PropertyGroup):
    include: BoolProperty(name="Include", default=True)
    display_name: StringProperty(name="Display Name", default="")
    output_name: StringProperty(name="Output Name", default="")
    action_name: StringProperty(name="Action Name", default="")
    source_type: StringProperty(name="Source Type", default="ACTION")
    source_name: StringProperty(name="Source Name", default="")
    frames_per_direction: IntProperty(name="Frames Per Direction", default=6, min=1, max=256)
    trim_end_frames: IntProperty(name="Trim End Frames", default=0, min=0, max=24)


class SPRITEGEN_UL_batch_items(UIList):
    def draw_item(self, _context, layout, _data, item, _icon, _active_data, _active_propname, _index):
        row = layout.row(align=True)
        row.prop(item, "include", text="")
        row.label(text=item.display_name if item.display_name else item.action_name)
        row.prop(item, "output_name", text="")


class SpriteGenProps(PropertyGroup):
    unit_name: StringProperty(name="Unit Name", default="unit")
    output_dir: StringProperty(name="Output Folder", subtype="DIR_PATH")
    batch_output_dir: StringProperty(
        name="Batch Output Folder",
        description="Optional dedicated output folder for Generate All batch exports",
        subtype="DIR_PATH",
    )
    selected_action: EnumProperty(name="Action", items=action_items)
    start_direction: EnumProperty(name="Start Facing", items=DIRECTION_ENUM_ITEMS, default="n")
    rotation_direction: EnumProperty(
        name="Rotation Direction",
        items=[
            ("CW", "Clockwise", "Rotate clockwise per direction step"),
            ("CCW", "Counter-Clockwise", "Rotate counter-clockwise per direction step"),
        ],
        default="CW",
    )
    output_action_name: StringProperty(
        name="Save As Animation Name",
        description="Optional override for output sheet/action name",
        default="",
    )
    projection_mode: EnumProperty(
        name="Projection",
        items=[
            ("DIMETRIC", "Dimetric", "Lower-angle dimetric projection"),
            ("ISOMETRIC", "Isometric", "Classic isometric projection"),
        ],
        default="DIMETRIC",
        update=on_projection_mode_update,
    )
    camera_pitch_degrees: FloatProperty(
        name="Camera Pitch",
        description="Dimetric camera pitch in degrees (lower than isometric)",
        default=65.0,
        min=10.0,
        max=80.0,
    )
    camera_yaw_degrees: FloatProperty(
        name="Camera Yaw",
        description="Camera yaw in degrees",
        default=45.0,
        min=-180.0,
        max=180.0,
    )
    frame_resolution: IntProperty(name="Frame Size", default=256, min=64, max=2048)
    fps: IntProperty(name="FPS", default=12, min=1, max=240)
    frame_step: IntProperty(name="Frame Step", default=1, min=1, max=24)
    sampling_mode: EnumProperty(
        name="Sampling",
        items=[
            ("STEP", "By Frame Step", "Sample action frame range using Frame Step"),
            ("COUNT", "By Frame Count", "Sample exact number of frames per direction"),
        ],
        default="COUNT",
    )
    frames_per_angle: IntProperty(name="Frames Per Direction", default=6, min=1, max=256)
    trim_end_frames: IntProperty(
        name="Trim End Frames",
        description="Drop trailing action frames to remove loop pause",
        default=0,
        min=0,
        max=24,
    )
    output_mode: EnumProperty(
        name="Output",
        items=[
            ("SHEET", "Sprite Sheet + JSON", "Generate packed sheet and manifest"),
            ("FRAMES", "Frames + JSON", "Generate frame PNGs and manifest"),
            ("BOTH", "Both", "Generate frame PNGs, packed sheet, and manifest"),
        ],
        default="SHEET",
    )
    output_layout: EnumProperty(
        name="Output Layout",
        items=[
            ("ACTION_FOLDER", "Action Folder", "Create an action folder in output directory"),
            ("FLAT", "Flat (One Folder)", "Write all actions directly into output directory"),
        ],
        default="ACTION_FOLDER",
    )
    sheet_padding: IntProperty(name="Sheet Padding", default=2, min=0, max=64)
    sheet_page_mode: EnumProperty(
        name="Sheet Pages",
        items=[
            ("AUTO", "Auto Fit", "Auto-split by max sheet size"),
            ("TWO_EVEN", "2 Even Pages", "Force exactly 2 pages with 8 directions each"),
        ],
        default="AUTO",
    )
    max_sheet_dimension: IntProperty(
        name="Max Sheet Size",
        description="Maximum width/height per sheet page before auto-splitting",
        default=4096,
        min=512,
        max=16384,
    )
    max_total_renders: IntProperty(
        name="Max Renders Per Job",
        description="Safety guard to prevent Blender lockups on extreme jobs",
        default=512,
        min=16,
        max=8192,
    )
    camera_margin_percent: FloatProperty(
        name="Camera Margin %",
        description="Extra empty space around the character after auto-fit",
        default=4.0,
        min=0.0,
        max=50.0,
    )
    auto_fit_per_action: BoolProperty(
        name="Per-Action Auto Fit",
        description="Refit camera to each action bounds (can cause size mismatch between animations)",
        default=False,
    )
    use_export_target_height: BoolProperty(name="Use Target Height (Export-Only)", default=False)
    target_height_feet: FloatProperty(name="Target Height (ft)", default=6.0, min=0.1, max=30.0)
    measured_height_feet: FloatProperty(name="Measured Height (ft)", default=0.0, min=0.0, max=100.0)
    batch_items: CollectionProperty(type=SpriteGenBatchItem)
    batch_index: IntProperty(name="Batch Index", default=0, min=0)
    show_advanced: BoolProperty(name="Show Advanced", default=False)
    progress_text: StringProperty(name="Progress", default="Idle")


class SPRITEGEN_OT_setup_scene(Operator):
    bl_idname = "spritegen.setup_scene"
    bl_label = "Setup Scene"
    bl_description = "Auto-configure camera, lights, render settings, and action list"

    def execute(self, context):
        scene = context.scene
        props = scene.spritegen_props

        arm = find_target_armature(context)
        if not arm:
            self.report({"ERROR"}, "No armature found. Import/select a rigged character first.")
            return {"CANCELLED"}

        if not props.unit_name or props.unit_name == "unit":
            props.unit_name = sanitize_token(arm.name)

        # Always enforce projection preset on setup for predictable behavior.
        apply_projection_preset(props)
        ensure_sprite_camera(
            scene,
            pitch_deg=float(props.camera_pitch_degrees),
            yaw_deg=float(props.camera_yaw_degrees),
        )
        cam_obj = scene.camera
        ensure_lights(scene)
        configure_render(scene)
        scene.render.resolution_x = int(props.frame_resolution)
        scene.render.resolution_y = int(props.frame_resolution)
        auto_setup_character(scene, arm, cam_obj, projection_mode=str(props.projection_mode))
        measured_m = character_height_meters(arm)
        props.measured_height_feet = (measured_m / FEET_TO_METERS) if measured_m else 0.0

        actions = action_items(None, context)
        if actions and (not props.selected_action or props.selected_action not in {a[0] for a in actions}):
            props.selected_action = actions[0][0]
        if actions:
            display = display_name_for_action_identifier(actions, props.selected_action)
            props.output_action_name = sanitize_token(display)

        self.report({"INFO"}, "Sprite scene setup complete.")
        return {"FINISHED"}


class SPRITEGEN_OT_refresh_actions(Operator):
    bl_idname = "spritegen.refresh_actions"
    bl_label = "Refresh Actions"
    bl_description = "Refresh animation actions from the current armature"

    def execute(self, context):
        props = context.scene.spritegen_props
        actions = action_items(None, context)
        if not actions:
            props.selected_action = ""
            self.report({"WARNING"}, "No matching armature actions found.")
            return {"CANCELLED"}

        action_names = {entry[0] for entry in actions}
        if props.selected_action not in action_names:
            props.selected_action = actions[0][0]
        selected_display = display_name_for_action_identifier(actions, props.selected_action)
        props.output_action_name = sanitize_token(selected_display)
        self.report({"INFO"}, f"Found {len(actions)} action(s).")
        return {"FINISHED"}


class SPRITEGEN_OT_refresh_batch(Operator):
    bl_idname = "spritegen.refresh_batch"
    bl_label = "Refresh Batch List"
    bl_description = "Build batch checklist from selected armatures (or current armature actions)"

    def execute(self, context):
        props = context.scene.spritegen_props
        props.batch_items.clear()

        arms = scene_armatures_with_active_actions(context)
        if len(arms) > 0:
            for arm in arms:
                action_name = ""
                if arm.animation_data and arm.animation_data.action:
                    action_name = arm.animation_data.action.name
                if not action_name:
                    continue

                item = props.batch_items.add()
                item.include = True
                item.source_type = "ARMATURE"
                item.source_name = arm.name
                item.action_name = action_name
                item.display_name = clean_action_display_name(arm.name)
                item.output_name = sanitize_token(item.display_name)
                item.frames_per_direction = int(props.frames_per_angle)
                item.trim_end_frames = int(props.trim_end_frames)
        else:
            actions = action_items(None, context)
            for action_id, display_name, _desc in actions:
                item = props.batch_items.add()
                item.include = True
                item.source_type = "ACTION"
                item.source_name = ""
                item.action_name = action_id
                item.display_name = display_name
                item.output_name = sanitize_token(display_name)
                item.frames_per_direction = int(props.frames_per_angle)
                item.trim_end_frames = int(props.trim_end_frames)

        props.batch_index = 0
        if len(props.batch_items) == 0:
            self.report({"WARNING"}, "No batch items found. Make sure armatures have active actions.")
            return {"CANCELLED"}
        self.report({"INFO"}, f"Batch list ready: {len(props.batch_items)} item(s).")
        return {"FINISHED"}


class SPRITEGEN_OT_apply_safe_preset(Operator):
    bl_idname = "spritegen.apply_safe_preset"
    bl_label = "Apply Safe Preset"
    bl_description = "Apply stable export settings to reduce Blender freezing"

    def execute(self, context):
        props = context.scene.spritegen_props
        props.output_mode = "SHEET"
        props.output_layout = "ACTION_FOLDER"
        props.sampling_mode = "COUNT"
        props.frames_per_angle = 6
        props.frame_resolution = 192
        props.projection_mode = "DIMETRIC"
        apply_projection_preset(props)
        props.sheet_padding = 2
        props.sheet_page_mode = "AUTO"
        props.max_sheet_dimension = 2048
        props.max_total_renders = 192
        props.camera_margin_percent = 2.0
        props.auto_fit_per_action = False
        props.fps = 12
        self.report({"INFO"}, "Safe preset applied.")
        return {"FINISHED"}


class SPRITEGEN_OT_generate_selected(Operator):
    bl_idname = "spritegen.generate_selected"
    bl_label = "Generate Selected"
    bl_description = "Generate sprite output and a manifest for the selected action"

    def execute(self, context):
        scene = context.scene
        props = scene.spritegen_props
        wm = context.window_manager
        arm = find_target_armature(context)

        if not arm:
            self.report({"ERROR"}, "No armature found.")
            return {"CANCELLED"}
        if not props.output_dir:
            self.report({"ERROR"}, "Choose an output folder first.")
            return {"CANCELLED"}
        if not props.selected_action:
            self.report({"ERROR"}, "Select an animation action first.")
            return {"CANCELLED"}

        action = bpy.data.actions.get(props.selected_action)
        if not action:
            self.report({"ERROR"}, f"Action not found: {props.selected_action}")
            return {"CANCELLED"}

        unit = sanitize_token(props.unit_name or arm.name)
        output_action_raw = props.output_action_name.strip() if props.output_action_name else ""
        action_name = sanitize_token(output_action_raw or action.name)

        out_root = bpy.path.abspath(props.output_dir)
        action_root = out_root if props.output_layout == "FLAT" else os.path.join(out_root, action_name)
        write_frames = props.output_mode in {"FRAMES", "BOTH"}
        write_sheet = props.output_mode in {"SHEET", "BOTH"}
        frames_dir = os.path.join(action_root, "frames")
        render_frames_dir = frames_dir if write_frames else os.path.join(action_root, "_tmp_frames")
        try:
            os.makedirs(action_root, exist_ok=True)
            # Ensure temp output reflects only the current run.
            if os.path.isdir(render_frames_dir):
                shutil.rmtree(render_frames_dir, ignore_errors=True)
            os.makedirs(render_frames_dir, exist_ok=True)
        except OSError as exc:
            self.report({"ERROR"}, f"Unable to create output directory: {exc}")
            return {"CANCELLED"}

        anim_data = arm.animation_data_create()
        previous_action = anim_data.action
        previous_frame = scene.frame_current
        previous_filepath = scene.render.filepath
        previous_rot_mode = arm.rotation_mode
        previous_rot = arm.rotation_euler.copy()
        previous_scale = arm.scale.copy()
        previous_hide_render = isolate_render_to_character(scene, arm)

        sampled_frames = sample_action_frames(action, props)

        total_renders = len(DIR_LABELS_16) * len(sampled_frames)
        if total_renders > int(props.max_total_renders):
            self.report(
                {"ERROR"},
                (
                    f"Job too large ({total_renders} renders). "
                    "Reduce Frames Per Angle / increase Frame Step or raise Max Renders Per Job."
                ),
            )
            return {"CANCELLED"}
        props.progress_text = f"Rendering 0/{total_renders}"
        wm.progress_begin(0, total_renders)

        rendered_count = 0
        success = False
        sheet_w = 0
        sheet_h = 0
        sheet_file = f"{action_name}.png"
        sheet_pages = []
        frame_paths_by_direction = []
        dir_specs = direction_specs(props, scene, arm)
        dir_specs, relabeled = ensure_unique_direction_labels(dir_specs)
        dir_labels = [spec["label"] for spec in dir_specs]
        dir_cardinals = [spec.get("cardinal", "n") for spec in dir_specs]
        base_north_back_angle = compute_north_back_base_angle(scene, arm)
        if len(dir_labels) != len(DIR_LABELS_16) or len(set(dir_labels)) != len(DIR_LABELS_16):
            self.report({"ERROR"}, "Direction labeling failed: expected 16 unique labels.")
            return {"CANCELLED"}
        if relabeled:
            self.report({"WARNING"}, "Auto direction labels were unstable; using deterministic 16-direction ordering.")

        direction_debug_name = f"{action_name}_direction_debug.json" if props.output_layout == "FLAT" else "_direction_debug.json"
        direction_debug_path = os.path.join(action_root, direction_debug_name)
        with open(direction_debug_path, "w", encoding="utf-8") as handle:
            json.dump({"base_north_back_angle_degrees": base_north_back_angle, "dir_specs": dir_specs}, handle, indent=2)
        measured_height_m = character_height_meters(arm)
        measured_height_ft = (measured_height_m / FEET_TO_METERS) if measured_height_m else 0.0
        applied_scale_factor = 1.0
        try:
            anim_data.action = action
            arm.rotation_mode = "XYZ"

            if props.use_export_target_height and measured_height_m and measured_height_m > 0.0:
                target_height_m = props.target_height_feet * FEET_TO_METERS
                if target_height_m > 0.0:
                    applied_scale_factor = target_height_m / measured_height_m
                    arm.scale = previous_scale * applied_scale_factor
                    context.view_layer.update()

            if props.auto_fit_per_action:
                props.progress_text = "Analyzing bounds..."
                fit_camera_to_bounds_for_action(
                    scene,
                    arm,
                    action,
                    sampled_frames,
                    margin_ratio=(float(props.camera_margin_percent) / 100.0),
                    dir_specs=dir_specs,
                )
                context.view_layer.update()

            for spec in dir_specs:
                dir_label = spec["label"]
                arm.rotation_euler.z = math.radians(base_north_back_angle + spec["angle_deg"])
                row_paths = []

                for frame_number, frame in enumerate(sampled_frames, start=1):
                    scene.frame_set(frame)
                    filename = f"{unit}_{action_name}_{dir_label}_{frame_number}.png"
                    frame_path = os.path.join(render_frames_dir, filename)
                    scene.render.filepath = frame_path
                    bpy.ops.render.render(write_still=True)
                    row_paths.append(frame_path)

                    rendered_count += 1
                    wm.progress_update(rendered_count)
                    props.progress_text = f"Rendering {rendered_count}/{total_renders}"
                    bpy.ops.wm.redraw_timer(type="DRAW_WIN_SWAP", iterations=1)

                frame_paths_by_direction.append(row_paths)

            if write_sheet:
                props.progress_text = "Packing sprite sheet..."
                sheet_pages = pack_sheet_pages(
                    unit_root=action_root,
                    action_name=action_name,
                    frame_paths_by_direction=frame_paths_by_direction,
                    frame_w=int(scene.render.resolution_x),
                    frame_h=int(scene.render.resolution_y),
                    padding=int(props.sheet_padding),
                    max_sheet_dimension=int(props.max_sheet_dimension),
                    page_mode=str(props.sheet_page_mode),
                )
                first_page = sheet_pages[0]
                sheet_file = first_page["file"]
                sheet_w = first_page["w"]
                sheet_h = first_page["h"]

            manifest = {
                "unit": unit,
                "camera_mode": "isometric" if props.projection_mode == "ISOMETRIC" else "dimetric",
                "projection_mode": str(props.projection_mode).lower(),
                "directions": 16,
                "dir_step_degrees": 22.5,
                "start_direction": str(dir_labels[0] if dir_labels else props.start_direction),
                "rotation_order": str(props.rotation_direction).lower(),
                "direction_label_mode": "canonical_manual",
                "base_north_back_angle_degrees": base_north_back_angle,
                "frame": {
                    "w": int(scene.render.resolution_x),
                    "h": int(scene.render.resolution_y),
                    "pivot": [0.5, 1.0],
                },
                "sampling": {
                    "mode": str(props.sampling_mode).lower(),
                    "frame_step": int(props.frame_step),
                    "frames_per_angle": len(sampled_frames),
                },
                "output": {
                    "mode": str(props.output_mode).lower(),
                    "frames_dir": "frames" if write_frames else None,
                    "spritesheets_dir": "." if write_sheet else None,
                    "sheet": sheet_file if write_sheet else None,
                    "sheets": [page["file"] for page in sheet_pages] if write_sheet else [],
                    "sheet_pages": sheet_pages if write_sheet else [],
                    "sheet_layout": {
                        "rows": "directions",
                        "cols": "frames",
                        "padding": int(props.sheet_padding),
                        "page_mode": str(props.sheet_page_mode).lower(),
                        "w": sheet_w if write_sheet else None,
                        "h": sheet_h if write_sheet else None,
                        "max_sheet_dimension": int(props.max_sheet_dimension),
                    },
                },
                "scale": {
                    "mode": "target_height_export_only" if props.use_export_target_height else "none",
                    "measured_height_feet": measured_height_ft,
                    "target_height_feet": float(props.target_height_feet) if props.use_export_target_height else None,
                    "applied_scale_factor": applied_scale_factor if props.use_export_target_height else 1.0,
                },
                "actions": {
                    action_name: {
                        "fps": int(props.fps),
                        "frames": len(sampled_frames),
                        "pattern": f"{unit}_{action_name}" + "_{dir}_{frame}.png",
                        "directory": "frames" if write_frames else None,
                        "sheet": sheet_file if write_sheet else None,
                        "sheets": [page["file"] for page in sheet_pages] if write_sheet else [],
                        "sheet_pages": sheet_pages if write_sheet else [],
                    }
                },
                "dirs": dir_labels,
                "dir_cardinals": dir_cardinals,
            }

            manifest_name = f"{action_name}_manifest.json" if props.output_layout == "FLAT" else "manifest.json"
            manifest_path = os.path.join(action_root, manifest_name)
            with open(manifest_path, "w", encoding="utf-8") as handle:
                json.dump(manifest, handle, indent=2)
            if not write_frames and os.path.isdir(render_frames_dir):
                shutil.rmtree(render_frames_dir, ignore_errors=True)
            success = True
            return {"FINISHED"}
        except Exception as exc:
            self.report({"ERROR"}, f"Export failed: {exc}")
            return {"CANCELLED"}
        finally:
            scene.render.filepath = previous_filepath
            scene.frame_set(previous_frame)
            arm.rotation_mode = previous_rot_mode
            arm.rotation_euler = previous_rot
            arm.scale = previous_scale
            anim_data.action = previous_action
            restore_render_visibility(scene, previous_hide_render)
            wm.progress_end()
            props.progress_text = "Done" if success else "Failed"
            if success:
                self.report({"INFO"}, f"Export complete: {frames_dir}")


class SPRITEGEN_OT_generate_all(Operator):
    bl_idname = "spritegen.generate_all"
    bl_label = "Generate All Animations"
    bl_description = "Batch generate sprite sheets for all detected actions"

    def execute(self, context):
        props = context.scene.spritegen_props
        batch_output = bpy.path.abspath(props.batch_output_dir) if props.batch_output_dir else bpy.path.abspath(props.output_dir)
        if not batch_output:
            self.report({"ERROR"}, "Choose Batch Output Folder (or Output Folder) first.")
            return {"CANCELLED"}

        batch_items = [item for item in props.batch_items if item.include]
        if not batch_items:
            self.report({"ERROR"}, "No checked batch items. Click Refresh Batch List and tick animations to export.")
            return {"CANCELLED"}

        previous_selected = props.selected_action
        previous_output_name = props.output_action_name
        previous_output_dir = props.output_dir
        previous_layout = props.output_layout
        previous_frames = props.frames_per_angle
        previous_trim = props.trim_end_frames
        previous_active = context.view_layer.objects.active
        previously_selected = [obj for obj in context.selected_objects]
        succeeded = []
        failed = []

        props.output_dir = batch_output
        # Batch always writes all action artifacts into one chosen folder.
        props.output_layout = "FLAT"

        try:
            for item in batch_items:
                if item.source_type == "ARMATURE":
                    arm = bpy.data.objects.get(item.source_name)
                    if not arm or arm.type != "ARMATURE":
                        failed.append(item.display_name or item.source_name)
                        continue
                    for obj in context.selected_objects:
                        obj.select_set(False)
                    arm.select_set(True)
                    context.view_layer.objects.active = arm

                props.selected_action = item.action_name
                props.output_action_name = sanitize_token(item.output_name or item.display_name or item.action_name)
                props.frames_per_angle = int(item.frames_per_direction)
                props.trim_end_frames = int(item.trim_end_frames)

                result = bpy.ops.spritegen.generate_selected()
                if "FINISHED" in result:
                    succeeded.append(item.display_name or item.action_name)
                else:
                    failed.append(item.display_name or item.action_name)
                bpy.ops.wm.redraw_timer(type="DRAW_WIN_SWAP", iterations=1)
        finally:
            for obj in context.selected_objects:
                obj.select_set(False)
            for obj in previously_selected:
                obj.select_set(True)
            if previous_active:
                context.view_layer.objects.active = previous_active

        props.selected_action = previous_selected
        props.output_action_name = previous_output_name
        props.output_dir = previous_output_dir
        props.output_layout = previous_layout
        props.frames_per_angle = previous_frames
        props.trim_end_frames = previous_trim

        if failed and not succeeded:
            self.report({"ERROR"}, f"Batch failed for all actions: {', '.join(failed)}")
            return {"CANCELLED"}
        if failed:
            self.report(
                {"WARNING"},
                f"Batch done. Success: {len(succeeded)}, Failed: {len(failed)} ({', '.join(failed)})",
            )
        else:
            self.report({"INFO"}, f"Batch complete: {len(succeeded)} actions exported.")
        return {"FINISHED"}


class SPRITEGEN_PT_main(Panel):
    bl_label = "SpriteGen"
    bl_idname = "SPRITEGEN_PT_main"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Tool"

    def draw(self, context):
        layout = self.layout
        props = context.scene.spritegen_props

        step1 = layout.box()
        step1.label(text="Step 1: Character", icon="OUTLINER_OB_ARMATURE")
        step1.prop(props, "unit_name", text="Character Name")
        step1.operator("spritegen.setup_scene", icon="TOOL_SETTINGS", text="Auto Setup Character + Scene")
        step1.label(text=f"Detected Height: {props.measured_height_feet:.2f} ft")
        step1.prop(props, "use_export_target_height", text="Set Target Height For Export")
        if props.use_export_target_height:
            step1.prop(props, "target_height_feet", text="Target Height (ft)")

        step2 = layout.box()
        step2.label(text="Step 2: Output", icon="OUTPUT")
        step2.prop(props, "output_dir", text="Output Folder")
        step2.prop(props, "output_mode", text="Export Type")
        step2.prop(props, "output_layout", text="Output Layout")
        step2.prop(props, "frame_resolution", text="Frame Size")
        step2.prop(props, "projection_mode", text="Projection")
        step2.operator("spritegen.apply_projection_preset", icon="FILE_REFRESH", text="Apply Projection Preset")
        step2.prop(props, "camera_pitch_degrees", text="Camera Pitch")
        step2.prop(props, "camera_yaw_degrees", text="Camera Yaw")
        step2.prop(props, "sheet_page_mode", text="Sheet Pages")
        step2.prop(props, "camera_margin_percent", text="Character Margin %")
        step2.operator("spritegen.apply_safe_preset", icon="CHECKMARK", text="Apply Safe Preset (Recommended)")

        step3 = layout.box()
        step3.label(text="Step 3: Animation", icon="ANIM")
        step3.operator("spritegen.refresh_actions", icon="FILE_REFRESH", text="Find Animations")
        step3.prop(props, "selected_action", text="Animation")
        step3.prop(props, "output_action_name", text="Save As Name")
        step3.prop(props, "start_direction", text="Start Facing")
        step3.prop(props, "rotation_direction", text="Rotate")
        step3.prop(props, "frames_per_angle", text="Frames Per Direction")
        step3.prop(props, "trim_end_frames", text="Trim End Frames")
        step3.label(text="Tip: Direction filenames are canonical (n..nnw).")

        step4 = layout.box()
        step4.label(text="Step 4: Generate", icon="RENDER_STILL")
        step4.operator("spritegen.generate_selected", icon="RENDER_STILL", text="Generate Sprite Sheet")
        step4.label(text=f"Progress: {props.progress_text}")

        box = layout.box()
        box.prop(props, "show_advanced", text="Advanced (Expert)", emboss=False, icon="PREFERENCES")
        if props.show_advanced:
            col = box.column(align=True)
            col.label(text="Directions: 16 (fixed)")
            col.label(text="Direction labels follow Start Facing + Rotate.")
            col.prop(props, "sampling_mode")
            if props.sampling_mode == "STEP":
                col.prop(props, "frame_step")
            col.prop(props, "fps")
            col.prop(props, "sheet_padding")
            col.prop(props, "camera_pitch_degrees")
            col.prop(props, "camera_yaw_degrees")
            col.prop(props, "sheet_page_mode")
            col.prop(props, "max_sheet_dimension")
            col.prop(props, "max_total_renders")
            col.prop(props, "auto_fit_per_action")


class SPRITEGEN_PT_batch(Panel):
    bl_label = "SpriteBatch"
    bl_idname = "SPRITEGEN_PT_batch"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "SpriteBatch"

    def draw(self, context):
        layout = self.layout
        props = context.scene.spritegen_props

        layout.label(text="Batch Export", icon="RENDER_ANIMATION")
        layout.prop(props, "batch_output_dir", text="Batch Output Folder")
        row = layout.row(align=True)
        row.operator("spritegen.refresh_batch", icon="FILE_REFRESH", text="Refresh Batch List")
        row.operator("spritegen.generate_all", icon="RENDER_ANIMATION", text="Export Checked")

        layout.template_list(
            "SPRITEGEN_UL_batch_items",
            "",
            props,
            "batch_items",
            props,
            "batch_index",
            rows=7,
        )

        if len(props.batch_items) > 0 and props.batch_index < len(props.batch_items):
            item = props.batch_items[props.batch_index]
            box = layout.box()
            box.prop(item, "include")
            box.label(text=f"Source: {item.source_type} {item.source_name}".strip())
            box.prop(item, "display_name", text="Display Name")
            box.prop(item, "output_name", text="Export Name")
            box.prop(item, "frames_per_direction")
            box.prop(item, "trim_end_frames")


CLASSES = (
    SpriteGenBatchItem,
    SPRITEGEN_UL_batch_items,
    SpriteGenProps,
    SPRITEGEN_OT_apply_projection_preset,
    SPRITEGEN_OT_setup_scene,
    SPRITEGEN_OT_refresh_actions,
    SPRITEGEN_OT_refresh_batch,
    SPRITEGEN_OT_apply_safe_preset,
    SPRITEGEN_OT_generate_selected,
    SPRITEGEN_OT_generate_all,
    SPRITEGEN_PT_main,
    SPRITEGEN_PT_batch,
)


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)
    bpy.types.Scene.spritegen_props = PointerProperty(type=SpriteGenProps)


def unregister():
    del bpy.types.Scene.spritegen_props
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)


if __name__ == "__main__":
    register()
