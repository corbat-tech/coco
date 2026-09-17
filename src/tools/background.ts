import { z } from "zod";
import { defineTool } from "./registry.js";
import type { ToolExecutionContext } from "./execution-context.js";

function owner(context?: ToolExecutionContext) {
  if (!context?.backgroundJobs) throw new Error("Background unavailable: no lifecycle owner");
  return context.backgroundJobs;
}
const job = z.object({ jobId: z.string().min(1) });
export const backgroundListTool = defineTool({
  name: "background_list",
  description: "List background jobs owned by the current session.",
  category: "bash",
  parameters: z.object({}),
  async execute(_input, context) {
    return owner(context).list();
  },
});
export const backgroundStatusTool = defineTool({
  name: "background_status",
  description: "Get status of a background job owned by this session.",
  category: "bash",
  parameters: job,
  async execute(input: z.infer<typeof job>, context) {
    return owner(context).status(input.jobId);
  },
});
export const backgroundReadTool = defineTool({
  name: "background_read",
  description:
    "Read a bounded page of output from a session-owned background job. Offsets and totalBytes are bytes. base64 contains exact page bytes; decode concatenated pages for lossless Unicode. output is a UTF-8 preview.",
  category: "bash",
  parameters: job.extend({
    channel: z.enum(["stdout", "stderr"]).default("stdout"),
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(65536).default(65536),
  }),
  async execute(
    input: { jobId: string; channel: "stdout" | "stderr"; offset: number; limit: number },
    context,
  ) {
    return owner(context).read(input.jobId, input.channel, input.offset, input.limit);
  },
});
export const backgroundCancelTool = defineTool({
  name: "background_cancel",
  description: "Cancel a session-owned background job and await process group cleanup.",
  category: "bash",
  parameters: job,
  async execute(input: z.infer<typeof job>, context) {
    return owner(context).cancel(input.jobId);
  },
});
export const backgroundTools = [
  backgroundListTool,
  backgroundStatusTool,
  backgroundReadTool,
  backgroundCancelTool,
];
