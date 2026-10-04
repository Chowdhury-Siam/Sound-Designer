import path from "node:path";
import { mkdir } from "node:fs/promises";
import type { ResolveContext } from "../../shared/types";

const SAFE_NAME = /[^\p{L}\p{M}\p{N}._ -]+/gu;

export const sanitizeProjectName = (name: string): string => {
  const sanitized = name.normalize("NFC").replace(SAFE_NAME, "-").replace(/\s+/g, " ").trim();
  return sanitized.slice(0, 80) || "Untitled Project";
};

export const projectDirectoryName = (context: Pick<ResolveContext, "projectId" | "projectName">): string => {
  const idPrefix = context.projectId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) || "unknown";
  return `${sanitizeProjectName(context.projectName)}--${idPrefix}`;
};

export class ProjectStorage {
  constructor(private readonly root: string) {}

  async ensure(context: Pick<ResolveContext, "projectId" | "projectName">): Promise<Record<string, string>> {
    const projectRoot = path.join(this.root, "Projects", "resolve", projectDirectoryName(context));
    const names = ["Downloads", "Converted", "Processed", "Segments", "Waveforms", "Metadata", "Temp"] as const;
    const locations: Record<string, string> = { root: projectRoot };
    await Promise.all(names.map(async (name) => {
      const location = path.join(projectRoot, name);
      await mkdir(location, { recursive: true });
      locations[name.toLowerCase()] = location;
    }));
    return locations;
  }
}
