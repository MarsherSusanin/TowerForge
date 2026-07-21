import { describe, expect, it } from "vitest";
import { previewTiledTilesetImport, TILESET_IMPORT_LIMITS } from "./tileset-importer.mjs";

const tiledProperties = [
  { name: "towerforge.terrainId", type: "string", value: "path" },
  { name: "buildable", type: "bool", value: false },
  { name: "walkable", type: "bool", value: true },
  { name: "groundSpeedMultiplier", type: "float", value: 0.75 },
  { name: "tags", type: "string", value: "road,stone" },
  { name: "connectGroup", type: "string", value: "road" },
  { name: "connectionSource", type: "string", value: "pathRoutes" }
];

describe("Tiled tileset importer", () => {
  it("imports TSJ Wang masks, weights, transforms, atlas frames, and typed terrain", () => {
    const result = previewTiledTilesetImport({
      sourceName: "road.tsj",
      topology: "square",
      descriptor: JSON.stringify({
        type: "tileset", name: "road", image: "road.png", tilewidth: 32, tileheight: 32, tilecount: 2, columns: 2, margin: 1, spacing: 2,
        transformations: { hflip: true, vflip: false, rotate: true, preferuntransformed: false },
        tiles: [{ id: 1, probability: 3 }],
        wangsets: [{ type: "edge", colors: [{ name: "Path", properties: tiledProperties }], wangtiles: [{ tileid: 1, wangid: [1, 0, 0, 0, 1, 0, 0, 0] }] }]
      })
    });
    expect(result.atlas).toEqual({ id: "road_atlas", src: "road.png" });
    expect(result.sprites.road_tile_1.frame).toEqual({ x: 35, y: 1, w: 32, h: 32 });
    expect(result.tileSet).toMatchObject({ topology: "square", ruleKind: "edge", transformations: { hflip: true, rotate: true, preferUntransformed: false } });
    expect(result.tileSet.materials.path).toMatchObject({ connectGroup: "road", connectionSource: "pathRoutes" });
    expect(result.tileSet.materials.path.signatures["edge:5"]).toEqual([{ spriteId: "road_tile_1", weight: 3 }]);
    expect(result.terrainTypes.path).toEqual({ id: "path", label: "Path", buildable: false, walkable: true, groundSpeedMultiplier: 0.75, tags: ["road", "stone"] });
  });

  it("imports equivalent TSX through a structured parser", () => {
    const descriptor = `<?xml version="1.0" encoding="UTF-8"?>
      <tileset version="1.10" name="road" tilewidth="32" tileheight="32" tilecount="1" columns="1">
        <image source="road.png" width="32" height="32"/>
        <transformations hflip="1" vflip="0" rotate="1" preferuntransformed="0"/>
        <wangsets><wangset name="Road" type="edge">
          <wangcolor name="Path" color="#808080" tile="0" probability="1">
            <properties>
              <property name="towerforge.terrainId" value="path"/>
              <property name="walkable" type="bool" value="true"/>
              <property name="connectGroup" value="road"/>
              <property name="connectionSource" value="pathRoutes"/>
            </properties>
          </wangcolor>
          <wangtile tileid="0" wangid="1,0,1,0,0,0,0,0"/>
        </wangset></wangsets>
      </tileset>`;
    const result = previewTiledTilesetImport({ descriptor, sourceName: "road.tsx", topology: "square" });
    expect(result.tileSet.materials.path.signatures["edge:3"]).toEqual([{ spriteId: "road_tile_0", weight: 1 }]);
    expect(result.tileSet.transformations).toMatchObject({ hflip: true, vflip: false, rotate: true, preferUntransformed: false });
  });

  it("combines compatible Wang sets and applies validated workbench overrides", () => {
    const base = {
      type: "tileset", name: "terrain", image: "terrain.png", tilewidth: 32, tileheight: 32, tilecount: 2, columns: 2,
      wangsets: [
        { type: "edge", colors: [{ name: "Path", properties: [{ name: "towerforge.terrainId", value: "path" }] }], wangtiles: [{ tileid: 0, wangid: [1, 0, 0, 0, 0, 0, 0, 0] }] },
        { type: "edge", colors: [{ name: "Water", properties: [{ name: "towerforge.terrainId", value: "water" }] }], wangtiles: [{ tileid: 1, wangid: [0, 0, 1, 0, 0, 0, 0, 0] }] }
      ]
    };
    const result = previewTiledTilesetImport({
      descriptor: JSON.stringify(base), sourceName: "terrain.tsj", topology: "square",
      slicing: { tileWidth: 16, tileHeight: 16, columns: 2, margin: 1, spacing: 1 },
      materialOverrides: {
        path: { connectGroup: "road", connectionSource: "pathRoutes", signatures: { "edge:1": [{ spriteId: "terrain_tile_0", weight: 2, transform: { flipX: true, rotate: 90 } }] } }
      },
      terrainTypeOverrides: { path: { label: "Road", buildable: false, walkable: true, groundSpeedMultiplier: 0.8, tags: ["road"] } }
    });
    expect(result.source).toMatchObject({ columns: 2, expectedWidth: 35, expectedHeight: 18 });
    expect(result.tileSet.materials.path.signatures["edge:1"][0]).toMatchObject({ weight: 2, transform: { flipX: true, rotate: 90 } });
    expect(result.tileSet.materials.water).toBeUndefined();
    expect(result.terrainTypes.path).toMatchObject({ label: "Road", groundSpeedMultiplier: 0.8, tags: ["road"] });

    const combined = previewTiledTilesetImport({ descriptor: JSON.stringify(base), sourceName: "terrain.tsj", topology: "square" });
    expect(Object.keys(combined.tileSet.materials)).toEqual(["path", "water"]);
  });

  it("rejects traversal, remote images, entities, unsupported properties, oversized descriptors, and unsafe ids", () => {
    const base = { type: "tileset", name: "safe", image: "tiles.png", tilewidth: 16, tileheight: 16, tilecount: 1, columns: 1 };
    for (const image of ["../tiles.png", "https://example.com/tiles.png", "/tmp/tiles.png", "tiles.jpg"]) {
      expect(() => previewTiledTilesetImport({ descriptor: JSON.stringify({ ...base, image }), sourceName: "safe.tsj" })).toThrow();
    }
    expect(() => previewTiledTilesetImport({ descriptor: '<!DOCTYPE x [<!ENTITY ext SYSTEM "file:///etc/passwd">]><tileset/>', sourceName: "bad.tsx" })).toThrow(/DTD and entity/);
    expect(() => previewTiledTilesetImport({ descriptor: JSON.stringify({ ...base, properties: [{ name: "secret", value: true }] }), sourceName: "safe.tsj" })).toThrow(/unsupported property/);
    expect(() => previewTiledTilesetImport({ descriptor: JSON.stringify(base), sourceName: "safe.tsj", tileSetId: "../unsafe" })).toThrow(/Unsafe tileset id/);
    expect(() => previewTiledTilesetImport({ descriptor: JSON.stringify(base), sourceName: "safe.tsj", materialOverrides: { path: { signatures: { random: [{ spriteId: "missing" }] } } } })).toThrow(/unknown imported sprite/);
    expect(() => previewTiledTilesetImport({ descriptor: "x".repeat(TILESET_IMPORT_LIMITS.descriptorBytes + 1), sourceName: "safe.tsj" })).toThrow(/2 MB/);
  });
});
