const CLAUDE_LINUX_RUNTIME = /^node_modules\/@anthropic-ai\/claude-agent-sdk-linux-(?:x64|arm64)(-musl)?$/;

function packageLibc(packagePath, meta) {
  if (Array.isArray(meta.libc)) return meta.libc;
  const claudeRuntime = packagePath.match(CLAUDE_LINUX_RUNTIME);
  if (!claudeRuntime) return null;
  return [claudeRuntime[1] ? "musl" : "gnu"];
}

export function packageMatchesTargets(packagePath, meta, targets) {
  const osList = Array.isArray(meta.os) ? meta.os : null;
  const cpuList = Array.isArray(meta.cpu) ? meta.cpu : null;
  const libcList = packageLibc(packagePath, meta);
  return targets.some((target) => {
    const osAllowed = !osList || osList.includes(target.os);
    const cpuAllowed = !cpuList || cpuList.includes(target.cpu);
    const libcAllowed = !libcList || !target.libc || libcList.includes(target.libc);
    return osAllowed && cpuAllowed && libcAllowed;
  });
}
