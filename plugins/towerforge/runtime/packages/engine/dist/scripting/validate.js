import { TOWER_SCRIPT_ACTION_SCHEMA, TOWER_SCRIPT_EVENTS, TOWER_SCRIPT_LIMITS, TOWER_SCRIPT_OPERATORS, TOWER_SCRIPT_SCOPES, TOWER_SCRIPT_TARGETS } from "./schema-descriptor.js";
const SCOPES = new Set(TOWER_SCRIPT_SCOPES);
const EVENTS = new Set(TOWER_SCRIPT_EVENTS);
const OPERATORS = new Set(TOWER_SCRIPT_OPERATORS);
const TARGETS = new Set(TOWER_SCRIPT_TARGETS.entity);
const ENEMY_TARGETS = new Set(TOWER_SCRIPT_TARGETS.enemy);
const TOWER_TARGETS = new Set(TOWER_SCRIPT_TARGETS.tower);
const ACTIONS = new Set(Object.keys(TOWER_SCRIPT_ACTION_SCHEMA));
const ID_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
export function validateTowerScriptDefinitions(scripts, refs = {}) {
    const issues = [];
    const report = (scriptId, fieldPath, message) => issues.push({ scriptId, fieldPath, message });
    if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) {
        return [{ scriptId: "?", fieldPath: "root", message: "scripts must be an object keyed by script id." }];
    }
    if (Object.keys(scripts).length > TOWER_SCRIPT_LIMITS.scriptsPerProject)
        report("?", "root", `A project may define at most ${TOWER_SCRIPT_LIMITS.scriptsPerProject} TowerScripts.`);
    for (const [key, script] of Object.entries(scripts))
        validateScript(key, script, refs, report);
    return issues;
}
function validateScript(key, script, refs, report) {
    const scriptId = typeof script?.id === "string" ? script.id : key;
    if (!script || typeof script !== "object" || Array.isArray(script)) {
        report(key, "root", "TowerScript must be an object.");
        return;
    }
    if (script.schemaVersion !== 1 && script.schemaVersion !== 2)
        report(scriptId, "schemaVersion", "TowerScript schemaVersion must be 1 or 2.");
    if (!ID_RE.test(scriptId))
        report(scriptId, "id", "Script id must use letters, digits, underscore, dot, or hyphen.");
    if (script.id !== key)
        report(scriptId, "id", `Script key "${key}" must match id "${script.id}".`);
    if (script.enabled !== undefined && typeof script.enabled !== "boolean")
        report(scriptId, "enabled", "enabled must be boolean.");
    if (!Array.isArray(script.bindings) || script.bindings.length === 0)
        report(scriptId, "bindings", "At least one binding is required.");
    else
        script.bindings.forEach((binding, index) => validateBinding(scriptId, binding, index, refs, report));
    if (script.initialState !== undefined) {
        if (!script.initialState || typeof script.initialState !== "object" || Array.isArray(script.initialState))
            report(scriptId, "initialState", "initialState must be an object.");
        else {
            const encoded = JSON.stringify(script.initialState);
            if (encoded.length > TOWER_SCRIPT_LIMITS.initialStateBytes)
                report(scriptId, "initialState", "initialState exceeds the 16 KiB limit.");
            for (const keyName of Object.keys(script.initialState))
                if (!ID_RE.test(keyName))
                    report(scriptId, `initialState.${keyName}`, "State keys must be safe identifiers.");
        }
    }
    if (!script.handlers || typeof script.handlers !== "object" || Array.isArray(script.handlers)) {
        report(scriptId, "handlers", "handlers must be an object keyed by lifecycle event.");
        return;
    }
    for (const [event, handlers] of Object.entries(script.handlers)) {
        if (!EVENTS.has(event)) {
            report(scriptId, `handlers.${event}`, `Unknown TowerScript event "${event}".`);
            continue;
        }
        if (!Array.isArray(handlers) || handlers.length === 0) {
            report(scriptId, `handlers.${event}`, "An event needs at least one handler.");
            continue;
        }
        if (handlers.length > TOWER_SCRIPT_LIMITS.handlersPerEvent)
            report(scriptId, `handlers.${event}`, `An event may define at most ${TOWER_SCRIPT_LIMITS.handlersPerEvent} handlers.`);
        handlers.forEach((handler, index) => {
            const base = `handlers.${event}[${index}]`;
            if (!handler || typeof handler !== "object" || Array.isArray(handler)) {
                report(scriptId, base, "Handler must be an object.");
                return;
            }
            if (handler.id !== undefined && (typeof handler.id !== "string" || !ID_RE.test(handler.id)))
                report(scriptId, `${base}.id`, "Handler id must be a safe identifier.");
            if (handler.every !== undefined && (event !== "tick" || typeof handler.every !== "number" || !Number.isFinite(handler.every) || handler.every <= 0)) {
                report(scriptId, `${base}.every`, "every is only valid for tick handlers and must be > 0.");
            }
            if (handler.when !== undefined)
                validateExpression(scriptId, `${base}.when`, handler.when, 0, report);
            if (!Array.isArray(handler.actions) || handler.actions.length === 0)
                report(scriptId, `${base}.actions`, "Handler needs at least one action.");
            else {
                if (handler.actions.length > TOWER_SCRIPT_LIMITS.actionsPerHandler)
                    report(scriptId, `${base}.actions`, `A handler may define at most ${TOWER_SCRIPT_LIMITS.actionsPerHandler} actions.`);
                handler.actions.forEach((action, actionIndex) => validateAction(scriptId, `${base}.actions[${actionIndex}]`, action, refs, report));
            }
        });
    }
}
function validateBinding(scriptId, binding, index, refs, report) {
    const base = `bindings[${index}]`;
    if (!binding || typeof binding !== "object" || Array.isArray(binding) || !SCOPES.has(binding.scope)) {
        report(scriptId, base, "Binding needs a supported scope.");
        return;
    }
    if (binding.scope === "global" && binding.ids !== undefined)
        report(scriptId, `${base}.ids`, "global binding does not accept ids.");
    if (binding.ids !== undefined && (!Array.isArray(binding.ids) || binding.ids.length === 0 || binding.ids.some((id) => typeof id !== "string" || !ID_RE.test(id)))) {
        report(scriptId, `${base}.ids`, "ids must be a non-empty array of safe ids.");
        return;
    }
    const sets = {
        mission: refs.missionIds,
        map: refs.mapIds,
        wave: refs.waveSetIds,
        tower: refs.towerIds,
        enemy: refs.enemyIds,
        ability: refs.abilityIds,
        terrain: refs.terrainIds
    };
    for (const id of binding.ids ?? [])
        if (sets[binding.scope] && !sets[binding.scope].has(id))
            report(scriptId, `${base}.ids`, `Unknown ${binding.scope} id "${id}".`);
}
function validateAction(scriptId, path, action, refs, report) {
    if (!action || typeof action !== "object" || Array.isArray(action) || !ACTIONS.has(action.action)) {
        report(scriptId, path, `Unknown TowerScript action "${String(action?.action)}".`);
        return;
    }
    const expressionFields = ["amount", "value", "count", "pathProgress", "payload", "duration"];
    for (const field of expressionFields)
        if (Object.hasOwn(action, field) && action[field] !== undefined)
            validateExpression(scriptId, `${path}.${field}`, action[field], 0, report);
    if (["damageEnemy", "healEnemy", "applyStatus", "setTowerCooldown", "addTowerStacks"].includes(action.action) && !TARGETS.has(action.target))
        report(scriptId, `${path}.target`, "Action needs a supported entity target.");
    if (["damageEnemy", "healEnemy", "applyStatus"].includes(action.action) && !ENEMY_TARGETS.has(action.target))
        report(scriptId, `${path}.target`, "Enemy actions require self, eventEnemy, or allEnemies.");
    if (["setTowerCooldown", "addTowerStacks"].includes(action.action) && !TOWER_TARGETS.has(action.target))
        report(scriptId, `${path}.target`, "Tower actions require self, eventTower, or allTowers.");
    if (action.action === "applyStatus")
        validateStatus(scriptId, `${path}.status`, action.status, report);
    if (["setState", "incrementState"].includes(action.action) && !ID_RE.test(action.key ?? ""))
        report(scriptId, `${path}.key`, "State key must be a safe identifier.");
    if (action.action === "emitSignal" && !ID_RE.test(action.signal ?? ""))
        report(scriptId, `${path}.signal`, "Signal must be a safe identifier.");
    if (action.action === "grantResource" && refs.currencyIds && !refs.currencyIds.has(action.resourceId))
        report(scriptId, `${path}.resourceId`, `Unknown currency "${action.resourceId}".`);
    if (action.action === "spawnEnemy" && refs.enemyIds && !refs.enemyIds.has(action.enemyTypeId))
        report(scriptId, `${path}.enemyTypeId`, `Unknown enemy "${action.enemyTypeId}".`);
    if (action.action === "setTileTerrain" || action.action === "restoreTileTerrain") {
        validateTileTarget(scriptId, `${path}.target`, action.target, report);
    }
    if (action.action === "setTileTerrain" && refs.terrainIds && !refs.terrainIds.has(action.terrainId)) {
        report(scriptId, `${path}.terrainId`, `Unknown terrain "${action.terrainId}".`);
    }
}
function validateTileTarget(scriptId, path, target, report) {
    if (target === "eventTile")
        return;
    if (!target || typeof target !== "object" || Array.isArray(target)) {
        report(scriptId, path, 'Tile target must be "eventTile" or {q, r} expressions.');
        return;
    }
    const coord = target;
    if (coord.q === undefined || coord.r === undefined) {
        report(scriptId, path, "Tile target needs q and r expressions.");
        return;
    }
    validateExpression(scriptId, `${path}.q`, coord.q, 0, report);
    validateExpression(scriptId, `${path}.r`, coord.r, 0, report);
}
function validateStatus(scriptId, path, status, report) {
    if (!status || typeof status !== "object" || Array.isArray(status)) {
        report(scriptId, path, "Status must be an object.");
        return;
    }
    const value = status;
    if (value.stun === undefined && value.slow === undefined && value.poison === undefined)
        report(scriptId, path, "Status needs stun, slow, or poison.");
    if (value.stun !== undefined && !positiveFinite(value.stun))
        report(scriptId, `${path}.stun`, "stun must be a finite number > 0.");
    if (value.slow !== undefined) {
        if (!value.slow || typeof value.slow !== "object" || Array.isArray(value.slow))
            report(scriptId, `${path}.slow`, "slow must be an object.");
        else {
            const slow = value.slow;
            if (!positiveFinite(slow.factor) || slow.factor >= 1)
                report(scriptId, `${path}.slow.factor`, "slow.factor must be > 0 and < 1.");
            if (!positiveFinite(slow.duration))
                report(scriptId, `${path}.slow.duration`, "slow.duration must be a finite number > 0.");
        }
    }
    if (value.poison !== undefined) {
        if (!value.poison || typeof value.poison !== "object" || Array.isArray(value.poison))
            report(scriptId, `${path}.poison`, "poison must be an object.");
        else {
            const poison = value.poison;
            if (!positiveFinite(poison.dps))
                report(scriptId, `${path}.poison.dps`, "poison.dps must be a finite number > 0.");
            if (!positiveFinite(poison.duration))
                report(scriptId, `${path}.poison.duration`, "poison.duration must be a finite number > 0.");
        }
    }
    if (value.slowAffectsClasses !== undefined && (!Array.isArray(value.slowAffectsClasses) || value.slowAffectsClasses.length === 0 || value.slowAffectsClasses.some((item) => item !== "ground" && item !== "flying"))) {
        report(scriptId, `${path}.slowAffectsClasses`, "slowAffectsClasses must contain ground and/or flying.");
    }
}
function positiveFinite(value) {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}
function validateExpression(scriptId, path, expression, depth, report) {
    if (depth > TOWER_SCRIPT_LIMITS.expressionDepth) {
        report(scriptId, path, `Expression nesting exceeds ${TOWER_SCRIPT_LIMITS.expressionDepth} levels.`);
        return;
    }
    if (expression === null || typeof expression === "string" || typeof expression === "boolean")
        return;
    if (typeof expression === "number") {
        if (!Number.isFinite(expression))
            report(scriptId, path, "Expression numbers must be finite.");
        return;
    }
    if (Array.isArray(expression)) {
        expression.forEach((item, index) => validateExpression(scriptId, `${path}[${index}]`, item, depth + 1, report));
        return;
    }
    if (!expression || typeof expression !== "object") {
        report(scriptId, path, "Expression must be JSON-compatible.");
        return;
    }
    if (Object.hasOwn(expression, "$get")) {
        const value = expression.$get;
        if (typeof value !== "string" || !value || value.split(".").some((segment) => !segment || ["__proto__", "prototype", "constructor"].includes(segment)))
            report(scriptId, `${path}.$get`, "$get needs a safe context path.");
        return;
    }
    if (Object.hasOwn(expression, "$op")) {
        const op = expression.$op;
        const args = expression.args;
        if (typeof op !== "string" || !OPERATORS.has(op))
            report(scriptId, `${path}.$op`, `Unsupported expression operator "${String(op)}".`);
        if (!Array.isArray(args))
            report(scriptId, `${path}.args`, "Operator args must be an array.");
        else
            args.forEach((item, index) => validateExpression(scriptId, `${path}.args[${index}]`, item, depth + 1, report));
        return;
    }
    for (const [key, value] of Object.entries(expression)) {
        if (["__proto__", "prototype", "constructor"].includes(key))
            report(scriptId, `${path}.${key}`, "Unsafe expression key.");
        else
            validateExpression(scriptId, `${path}.${key}`, value, depth + 1, report);
    }
}
