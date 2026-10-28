import { loadConfig } from "./config.mjs";
export function baseUrl(env) {
  const { server } = loadConfig(env);
  return `http://${server.host}:${server.port}`;
}
