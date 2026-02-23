@tool
class_name SpriteMagicianImporter
extends RefCounted


static func import_manifest_to_spriteframes(manifest_path: String, save_dir: String = "res://spriteframes") -> Dictionary:
	var text := FileAccess.get_file_as_string(manifest_path)
	var data = JSON.parse_string(text)
	if typeof(data) != TYPE_DICTIONARY:
		push_error("SpriteMagicianImporter: Invalid JSON manifest: %s" % manifest_path)
		return {}

	var frame_info: Dictionary = data.get("frame", {})
	var frame_w := int(frame_info.get("w", 0))
	var frame_h := int(frame_info.get("h", 0))
	if frame_w <= 0 or frame_h <= 0:
		push_error("SpriteMagicianImporter: Invalid frame size in manifest.")
		return {}

	var dirs: Array = data.get("dirs", [])
	var dir_cardinals: Array = data.get("dir_cardinals", [])
	var dir_names: Array = _resolve_direction_names(dirs, dir_cardinals)
	var actions: Dictionary = data.get("actions", {})
	var output: Dictionary = data.get("output", {})
	var layout: Dictionary = output.get("sheet_layout", {})
	var padding := int(layout.get("padding", 0))
	var manifest_dir := manifest_path.get_base_dir()
	var unit := str(data.get("unit", "unit"))

	_ensure_dir(save_dir)

	var result := {}
	for action_name in actions.keys():
		var action_data: Dictionary = actions[action_name]
		var fps := int(action_data.get("fps", 12))
		var expected_frames := int(action_data.get("frames", 0))

		var page_defs: Array = action_data.get("sheet_pages", [])
		if page_defs.is_empty():
			# Fallback for older manifests (single page only).
			var single_sheet := str(action_data.get("sheet", ""))
			if single_sheet != "":
				page_defs = [{
					"file": single_sheet,
					"row_range": [0, max(0, dirs.size() - 1)],
					"col_range": [0, max(0, expected_frames - 1)]
				}]

		var sprite_frames := SpriteFrames.new()
		for dir_label in dir_names:
			var anim_name := "%s_%s" % [str(action_name), str(dir_label)]
			sprite_frames.add_animation(anim_name)
			sprite_frames.set_animation_speed(anim_name, fps)
			sprite_frames.set_animation_loop(anim_name, true)

		for page in page_defs:
			var page_info: Dictionary = page
			var file_name := str(page_info.get("file", ""))
			if file_name == "":
				continue

			var sheet_tex := _load_texture(manifest_dir.path_join(file_name))
			if sheet_tex == null:
				push_warning("SpriteMagicianImporter: Missing sheet: %s" % file_name)
				continue

			var row_range: Array = page_info.get("row_range", [0, 0])
			var col_range: Array = page_info.get("col_range", [0, 0])
			var row_start := int(row_range[0])
			var row_end := int(row_range[1])
			var col_start := int(col_range[0])
			var col_end := int(col_range[1])

			for row in range(row_start, row_end + 1):
				if row < 0 or row >= dir_names.size():
					continue
				var dir_label := str(dir_names[row])
				var anim_name := "%s_%s" % [str(action_name), dir_label]
				var local_row := row - row_start
				for col in range(col_start, col_end + 1):
					var local_col := col - col_start
					var region := Rect2(
						padding + local_col * (frame_w + padding),
						padding + local_row * (frame_h + padding),
						frame_w,
						frame_h
					)

					var atlas := AtlasTexture.new()
					atlas.atlas = sheet_tex
					atlas.region = region
					sprite_frames.add_frame(anim_name, atlas)

		var save_path := save_dir.path_join("%s_%s.spriteframes.tres" % [unit, str(action_name)])
		var err := ResourceSaver.save(sprite_frames, save_path)
		if err != OK:
			push_error("SpriteMagicianImporter: Failed saving %s (err=%s)" % [save_path, str(err)])
			continue

		result[action_name] = save_path

	return result


static func _ensure_dir(path: String) -> void:
	var abs_path := ProjectSettings.globalize_path(path)
	DirAccess.make_dir_recursive_absolute(abs_path)


static func _load_texture(path: String) -> Texture2D:
	# Supports both res:// and absolute paths.
	var res_path := path
	if not path.begins_with("res://"):
		res_path = ProjectSettings.localize_path(path)
	var tex := load(res_path)
	if tex is Texture2D:
		return tex
	return null


static func _resolve_direction_names(dirs: Array, dir_cardinals: Array) -> Array:
	var count := dirs.size()
	if count == 0:
		return []

	var candidate := []
	if dir_cardinals.size() == count:
		candidate = dir_cardinals.duplicate()
	else:
		candidate = dirs.duplicate()

	var names := []
	var seen := {}
	for i in range(count):
		var raw_name := str(candidate[i]).strip_edges().to_lower()
		var fallback := str(dirs[i]).strip_edges().to_lower()
		var base := raw_name if raw_name != "" else fallback
		if base == "":
			base = "d%02d" % i
		var unique := base
		var suffix := 1
		while seen.has(unique):
			unique = "%s_%d" % [base, suffix]
			suffix += 1
		seen[unique] = true
		names.append(unique)
	return names
