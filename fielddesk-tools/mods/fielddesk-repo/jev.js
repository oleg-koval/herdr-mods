export async function checkJevDashboard(exec) {
  try {
    const result = await exec("/usr/bin/curl", [
      "-q", "--noproxy", "*", "--silent", "--fail", "--max-time", "2",
      "http://127.0.0.1:8791/api/health",
    ], { timeout: 3_000 });
    if (result.code === 7 || result.code === 28) return "unreachable";
    if (result.code !== 0) return "unknown";

    const health = JSON.parse(result.stdout);
    return health?.ok === true && typeof health.hermes_home === "string"
      && typeof health.auth_required === "boolean" ? "connected" : "unknown";
  } catch {
    return "unknown";
  }
}
