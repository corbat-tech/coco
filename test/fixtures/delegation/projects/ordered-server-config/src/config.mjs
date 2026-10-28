export function loadConfig(env) {
  return { host: env.HOST || "localhost", port: Number(env.PORT || 3000) };
}
