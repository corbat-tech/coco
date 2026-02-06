/**
 * Web tools for Corbat-Coco
 * Web search and fetch capabilities
 */

export { webSearchTool, type WebSearchOutput, type WebSearchResultItem } from "./web-search.js";
export { webFetchTool, type WebFetchOutput } from "./web-fetch.js";

import { webSearchTool } from "./web-search.js";
import { webFetchTool } from "./web-fetch.js";

/**
 * All web tools
 */
export const webTools = [webSearchTool, webFetchTool];
