export const DEFAULT_TERRAIN_TYPES = Object.freeze({
    buildable: terrain("buildable", "Buildable", true, true, 1, ["ground"]),
    path: terrain("path", "Path", false, true, 1, ["path"]),
    blocked: terrain("blocked", "Blocked", false, false, 1, ["blocked"]),
    core: terrain("core", "Core", false, true, 1, ["objective"]),
    spawn: terrain("spawn", "Spawn", false, true, 1, ["spawn"]),
    water: terrain("water", "Water", false, true, 0.6, ["water"])
});
export function normalizeTerrainTypes(authored, waterGroundSpeedFactor = DEFAULT_TERRAIN_TYPES.water.groundSpeedMultiplier) {
    const defaults = Object.fromEntries(Object.entries(DEFAULT_TERRAIN_TYPES).map(([id, value]) => [
        id,
        { ...value, tags: [...value.tags], ...(id === "water" ? { groundSpeedMultiplier: waterGroundSpeedFactor } : {}) }
    ]));
    for (const [id, value] of Object.entries(authored ?? {})) {
        const fallback = defaults[id] ?? terrain(id, id, false, false, 1, []);
        defaults[id] = {
            id,
            label: typeof value.label === "string" && value.label.trim() ? value.label : fallback.label,
            buildable: typeof value.buildable === "boolean" ? value.buildable : fallback.buildable,
            walkable: typeof value.walkable === "boolean" ? value.walkable : fallback.walkable,
            groundSpeedMultiplier: Number.isFinite(value.groundSpeedMultiplier)
                ? Math.max(0, Number(value.groundSpeedMultiplier))
                : fallback.groundSpeedMultiplier,
            tags: Array.isArray(value.tags) ? [...new Set(value.tags.filter((tag) => typeof tag === "string"))] : [...fallback.tags]
        };
    }
    return defaults;
}
function terrain(id, label, buildable, walkable, groundSpeedMultiplier, tags) {
    return { id, label, buildable, walkable, groundSpeedMultiplier, tags };
}
