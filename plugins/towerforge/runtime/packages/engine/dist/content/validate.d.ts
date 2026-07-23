import type { GameContentRegistry } from "./registry.js";
/**
 * `code` is a STABLE, machine-branchable identifier — derived automatically from
 * `entityKind`+`fieldPath` (see `deriveValidationCode`) unless a call site overrides it, so every
 * issue gets one for free. `hint`/`expected`/`got` are populated where cheap/curated (not every
 * call site); the MCP `explain_validation` tool looks a `code` up against a small curated map and
 * falls back to the issue's own `message` when no curated hint exists yet.
 *
 * CAVEAT: `code` is a COARSE grouping key, not a guaranteed-unique one. It upper-cases the whole
 * derivation input, so two field paths that differ only by case in an author-defined id segment
 * (e.g. a currency cost bag for currencies "gem_shards" vs "GEM_SHARDS") derive the SAME code. A
 * caller that needs to distinguish two issues precisely should key on `fieldPath` (which embeds
 * the literal id and is always distinct), not `code` alone.
 */
export interface ValidationIssue {
    severity: "error" | "warning";
    entityKind: string;
    entityId: string;
    fieldPath: string;
    message: string;
    code: string;
    hint?: string;
    expected?: string;
    got?: string;
}
export interface ValidationResult {
    ok: boolean;
    issues: ValidationIssue[];
}
/** Derives a stable code like "TOWER_ATTACK_SLOWFACTOR" from entityKind + fieldPath. See the
 *  ValidationIssue.code caveat above — this is a coarse key, not a unique one. */
export declare function deriveValidationCode(entityKind: string, fieldPath: string): string;
export declare function validateGameContentRegistry(content: GameContentRegistry): ValidationResult;
/** Alias of validateGameContentRegistry — validates all cross-references and numeric guards in a content registry. */
export declare function validateProject(content: GameContentRegistry): ValidationResult;
