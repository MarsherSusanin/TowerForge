export function coordKey(coord) {
    return `${coord.q},${coord.r}`;
}
export function sameCoord(a, b) {
    return a.q === b.q && a.r === b.r;
}
export function offsetToCube(coord) {
    const x = coord.q - (coord.r - (coord.r & 1)) / 2;
    const z = coord.r;
    const y = -x - z;
    return { x, y, z };
}
export function cubeToOffset(cube) {
    const r = cube.z;
    const q = cube.x + (r - (r & 1)) / 2;
    return { q, r };
}
export function hexDistance(a, b) {
    const ac = offsetToCube(a);
    const bc = offsetToCube(b);
    return Math.max(Math.abs(ac.x - bc.x), Math.abs(ac.y - bc.y), Math.abs(ac.z - bc.z));
}
export function neighbors(coord) {
    const even = coord.r % 2 === 0;
    const deltas = even
        ? [
            [-1, -1],
            [0, -1],
            [-1, 0],
            [1, 0],
            [-1, 1],
            [0, 1]
        ]
        : [
            [0, -1],
            [1, -1],
            [-1, 0],
            [1, 0],
            [0, 1],
            [1, 1]
        ];
    return deltas.map(([dq, dr]) => ({ q: coord.q + (dq ?? 0), r: coord.r + (dr ?? 0) }));
}
function cubeRound(cube) {
    let rx = Math.round(cube.x);
    let ry = Math.round(cube.y);
    let rz = Math.round(cube.z);
    const xDiff = Math.abs(rx - cube.x);
    const yDiff = Math.abs(ry - cube.y);
    const zDiff = Math.abs(rz - cube.z);
    if (xDiff > yDiff && xDiff > zDiff) {
        rx = -ry - rz;
    }
    else if (yDiff > zDiff) {
        ry = -rx - rz;
    }
    else {
        rz = -rx - ry;
    }
    return { x: rx, y: ry, z: rz };
}
function cubeLerp(a, b, t) {
    return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t
    };
}
export function hexLine(a, b) {
    const start = offsetToCube(a);
    const end = offsetToCube(b);
    const steps = hexDistance(a, b);
    const results = [];
    for (let i = 0; i <= steps; i += 1) {
        const t = steps === 0 ? 0 : i / steps;
        results.push(cubeToOffset(cubeRound(cubeLerp(start, end, t))));
    }
    return results;
}
