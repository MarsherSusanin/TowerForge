import { describe, expect, it } from "vitest";
import {
  attachmentPromptSuffix,
  formatAiContext,
  normalizeAiAttachments,
  normalizeAiContext,
  normalizeAiReasoning
} from "./ai-input.mjs";

const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("AI input validation", () => {
  it("normalizes supported reasoning levels and rejects unknown values", () => {
    expect(normalizeAiReasoning("default")).toBeNull();
    expect(normalizeAiReasoning(" XHIGH ")).toBe("xhigh");
    expect(() => normalizeAiReasoning("ultra")).toThrow(/Unsupported/);
  });

  it("accepts image bytes, strips path-like names, and preserves video frame metadata", () => {
    const [attachment] = normalizeAiAttachments([{
      name: "../../capture.png frame 2.5s",
      mimeType: "image/png",
      data: PNG_1PX,
      sourceKind: "video-frame",
      timestampSeconds: 2.46
    }]);
    expect(attachment).toMatchObject({
      name: "capture.png frame 2.5s",
      mimeType: "image/png",
      sourceKind: "video-frame",
      timestampSeconds: 2.5
    });
    expect(attachment.bytes).toBeGreaterThan(0);
    expect(attachmentPromptSuffix([attachment])).toContain("sampled 1 frame locally");
    expect(attachmentPromptSuffix([attachment])).not.toContain("capture.png");
  });

  it("rejects spoofed MIME types and oversized attachment sets", () => {
    expect(() => normalizeAiAttachments([{ name: "fake.png", mimeType: "image/png", data: Buffer.from("not an image").toString("base64") }]))
      .toThrow(/does not match/);
    expect(() => normalizeAiAttachments(new Array(9).fill({ name: "a.png", mimeType: "image/png", data: PNG_1PX })))
      .toThrow(/at most 8/);
  });

  it("normalizes a bounded path-free editor context", () => {
    const context = normalizeAiContext({
      activeTab: "enemies",
      project: { name: "Starter", defaultMissionId: "tutorial_01", dirty: true, projectDir: "/secret/path" },
      selection: { collection: "enemies", id: "basic_grunt", path: "/secret/path" },
      validation: {
        errorCount: 1,
        warningCount: 2,
        issues: [{ severity: "warning", kind: "enemy", entityId: "basic_grunt", code: "HP_LOW", message: "Low HP", file: "/secret/path" }]
      },
      lastRun: { kind: "simulation", missionId: "tutorial_01", summary: "victory after 60 ticks", raw: { projectDir: "/secret/path" } },
      apiKey: "must-not-survive"
    });

    expect(context).toEqual({
      schemaVersion: 1,
      activeTab: "enemies",
      project: { name: "Starter", defaultMissionId: "tutorial_01", dirty: true },
      selection: { collection: "enemies", id: "basic_grunt" },
      validation: {
        errorCount: 1,
        warningCount: 2,
        issues: [{ severity: "warning", kind: "enemy", entityId: "basic_grunt", code: "HP_LOW", message: "Low HP" }]
      },
      lastRun: { kind: "simulation", missionId: "tutorial_01", summary: "victory after 60 ticks" }
    });
    const formatted = formatAiContext(context);
    expect(formatted).toContain("TOWERFORGE_EDITOR_CONTEXT");
    expect(formatted).toContain("basic_grunt");
    expect(formatted).not.toContain("/secret/path");
    expect(formatted).not.toContain("must-not-survive");
  });

  it("drops unsupported context tabs, selections, and run kinds", () => {
    const context = normalizeAiContext({
      activeTab: "filesystem",
      selection: { collection: "secrets", id: "token" },
      lastRun: { kind: "shell", summary: "do something" }
    });
    expect(context.activeTab).toBeNull();
    expect(context.selection).toBeNull();
    expect(context.lastRun).toBeNull();
  });
});
