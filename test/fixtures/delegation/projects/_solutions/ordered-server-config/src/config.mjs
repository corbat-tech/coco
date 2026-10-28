export function loadConfig(env) {
  return { server: { host: env.HOST || "localhost", port: Number(env.PORT || 3000) } };
}
