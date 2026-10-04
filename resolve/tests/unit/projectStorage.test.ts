import { describe, expect, test } from "bun:test";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { ProjectStorage, projectDirectoryName, sanitizeProjectName } from "../../src/main/services/projectStorage";

describe("project storage identity", () => {
  test("uses project ID so duplicate names remain separate", () => {
    expect(projectDirectoryName({ projectName: "Film", projectId: "ABC-123456789" })).not.toBe(
      projectDirectoryName({ projectName: "Film", projectId: "XYZ-123456789" }),
    );
  });

  test("sanitizes names without removing Unicode letters", () => {
    expect(sanitizeProjectName("  বাংলা / Film:*?  ")).toBe("বাংলা - Film-");
  });

  test("creates every prepared-audio destination including segments", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sounddesigner-storage-"));
    try {
      const locations = await new ProjectStorage(root).ensure({ projectName: "Film", projectId: "project-1" });
      expect(locations.segments).toEndWith(path.join("Segments"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
