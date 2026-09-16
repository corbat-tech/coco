import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

/** Replace a credential file privately and atomically, preserving it on failure. */
export async function saveCredentialFile(filePath: string, value: object): Promise<void> {
  const dir = path.dirname(filePath);

  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  let mayOwnTemporaryFile = true;
  try {
    try {
      await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2), {
        mode: 0o600,
        flag: "wx",
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") mayOwnTemporaryFile = false;
      throw error;
    }
    await fs.rename(temporaryPath, filePath);
    mayOwnTemporaryFile = false;
  } finally {
    if (mayOwnTemporaryFile) await fs.unlink(temporaryPath).catch(() => {});
  }
}
