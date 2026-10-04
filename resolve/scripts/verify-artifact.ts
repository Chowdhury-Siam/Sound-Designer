import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditPayload } from "../../scripts/artifact-audit";
import { PLUGIN_ID } from "../src/shared/types";

await auditPayload(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/plugin", PLUGIN_ID), "resolve", process.platform, process.env.RESOLVE_TARGET_ARCH || process.arch, process.env.ALLOW_MISSING_NATIVE === "1");
