const BLOCKED_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);
const OPERATORS = new Set([
    "eq", "ne", "gt", "gte", "lt", "lte", "and", "or", "not",
    "add", "sub", "mul", "div", "min", "max", "coalesce"
]);
export function evaluateTowerScriptExpression(expression, context, budget) {
    consume(budget);
    if (expression === null || typeof expression === "string" || typeof expression === "boolean" || typeof expression === "number") {
        return finiteJson(expression);
    }
    if (Array.isArray(expression)) {
        return expression.map((item) => evaluateTowerScriptExpression(item, context, budget));
    }
    if (!expression || typeof expression !== "object")
        throw new Error("Expression must be JSON-compatible.");
    if (Object.hasOwn(expression, "$get")) {
        const path = expression.$get;
        if (typeof path !== "string" || !path)
            throw new Error("$get needs a non-empty path.");
        return toJson(readSafePath(context, path));
    }
    if (Object.hasOwn(expression, "$op")) {
        const operator = expression.$op;
        const args = expression.args;
        if (typeof operator !== "string" || !OPERATORS.has(operator) || !Array.isArray(args)) {
            throw new Error("$op needs a supported operator and args array.");
        }
        const result = applyOperator(operator, args.map((arg) => evaluateTowerScriptExpression(arg, context, budget)));
        return typeof result === "number" && !Number.isFinite(result) ? 0 : result;
    }
    const output = {};
    for (const [key, value] of Object.entries(expression)) {
        if (BLOCKED_PATH_SEGMENTS.has(key))
            throw new Error(`Unsafe expression key "${key}".`);
        output[key] = evaluateTowerScriptExpression(value, context, budget);
    }
    return output;
}
export function readSafePath(root, path) {
    const segments = path.split(".");
    if (segments.some((segment) => !segment || BLOCKED_PATH_SEGMENTS.has(segment)))
        throw new Error(`Unsafe context path "${path}".`);
    let value = root;
    for (const segment of segments) {
        if (!value || typeof value !== "object" || !Object.hasOwn(value, segment))
            return null;
        value = value[segment];
    }
    return value;
}
function consume(budget) {
    budget.remaining -= 1;
    if (budget.remaining < 0)
        throw new Error("TowerScript expression budget exceeded.");
}
function finiteJson(value) {
    if (typeof value === "number" && !Number.isFinite(value))
        return 0;
    return value;
}
function toJson(value, depth = 0) {
    if (depth > 12)
        return null;
    if (value === null || typeof value === "string" || typeof value === "boolean")
        return value;
    if (typeof value === "number")
        return Number.isFinite(value) ? value : 0;
    if (Array.isArray(value))
        return value.slice(0, 128).map((item) => toJson(item, depth + 1));
    if (!value || typeof value !== "object")
        return null;
    const output = {};
    for (const [key, child] of Object.entries(value).slice(0, 128)) {
        if (!BLOCKED_PATH_SEGMENTS.has(key))
            output[key] = toJson(child, depth + 1);
    }
    return output;
}
function applyOperator(operator, args) {
    const number = (value, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
    switch (operator) {
        case "eq": return args[0] === args[1];
        case "ne": return args[0] !== args[1];
        case "gt": return number(args[0] ?? null) > number(args[1] ?? null);
        case "gte": return number(args[0] ?? null) >= number(args[1] ?? null);
        case "lt": return number(args[0] ?? null) < number(args[1] ?? null);
        case "lte": return number(args[0] ?? null) <= number(args[1] ?? null);
        case "and": return args.every(Boolean);
        case "or": return args.some(Boolean);
        case "not": return !args[0];
        case "add": return args.reduce((total, value) => total + number(value), 0);
        case "sub": return number(args[0] ?? null) - number(args[1] ?? null);
        case "mul": return args.reduce((total, value) => total * number(value, 1), 1);
        case "div": {
            const divisor = number(args[1] ?? null);
            return divisor === 0 ? 0 : number(args[0] ?? null) / divisor;
        }
        case "min": return args.length ? Math.min(...args.map((value) => number(value))) : 0;
        case "max": return args.length ? Math.max(...args.map((value) => number(value))) : 0;
        case "coalesce": return args.find((value) => value !== null) ?? null;
    }
}
