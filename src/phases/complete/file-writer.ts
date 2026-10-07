import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { resolvePathSecurely } from "../../tools/file-path-policy.js";
import type { GeneratedFile } from "./types.js";

const generatedFilesSchema = z.array(
  z.object({
    path: z.string().min(1),
    content: z.string(),
    action: z.enum(["create", "modify", "delete"]),
  }),
);

/** Validate the whole generated batch before applying any of its effects. */
export async function saveGeneratedFiles(
  projectRoot: string,
  files: GeneratedFile[],
): Promise<void> {
  const batch = generatedFilesSchema.parse(files);
  const validated = [];
  for (const file of batch) {
    const target = await resolvePathSecurely(
      file.path,
      file.action === "delete" ? "delete" : "write",
      {
        projectRoot,
        allowedPaths: [],
        allowHomeConfigReads: false,
      },
    );
    validated.push({ ...file, target });
  }
  // This is prevalidation, not a transaction: genuine I/O failures propagate.
  for (const file of validated) {
    if (file.action === "delete") {
      try {
        await fs.unlink(file.target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    } else {
      await fs.mkdir(path.dirname(file.target), { recursive: true });
      await fs.writeFile(file.target, file.content, "utf-8");
    }
  }
}
