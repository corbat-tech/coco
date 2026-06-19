import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { InMemoryKnowledgeDocument } from "@corbat-tech/coco/runtime";

function titleFromMarkdown(fileName: string, content: string): string {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  return path.basename(fileName, path.extname(fileName)).replace(/[-_]+/g, " ");
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listMarkdownFiles(entryPath)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(entryPath);
    }
  }

  return files.sort();
}

export async function loadMarkdownKnowledge(
  knowledgeDir: string,
): Promise<InMemoryKnowledgeDocument[]> {
  const files = await listMarkdownFiles(knowledgeDir);
  const documents = await Promise.all(
    files.map(async (filePath) => {
      const content = await readFile(filePath, "utf-8");
      const relativePath = path.relative(knowledgeDir, filePath);
      return {
        id: relativePath.replace(/\\/g, "/"),
        title: titleFromMarkdown(relativePath, content),
        content,
        metadata: {
          source: "markdown",
          path: relativePath,
        },
      };
    }),
  );

  return documents;
}

export function createFallbackKnowledge(): InMemoryKnowledgeDocument[] {
  return [
    {
      id: "support-hours",
      title: "Support Hours",
      content:
        "Standard support hours are Monday to Friday, 09:00-18:00 CET. Urgent production incidents should be escalated to the on-call support queue.",
    },
    {
      id: "billing",
      title: "Billing Escalation",
      content:
        "Billing disputes require account ID, invoice number, contact email, and a concise summary. Urgent billing-impacting outages should be escalated with high priority.",
    },
    {
      id: "security",
      title: "Security Cases",
      content:
        "Security-sensitive cases must not be resolved by the assistant. Prepare a concise escalation summary and route to a human reviewer.",
    },
  ];
}
