import { loadConfig } from "./config.mjs";
export function baseUrl(env) {
  const config = loadConfig(env);
  return `http://${config.host}:${config.port}`;
}
