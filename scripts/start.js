// Startup wrapper: prep /data volume if present, then exec next start.
// Logs filesystem state up-front so deploy failures are diagnosable.
const fs = require("fs");
const { spawn } = require("child_process");

const dataDir = "/data";
try {
  if (fs.existsSync(dataDir)) {
    const st = fs.statSync(dataDir);
    console.log(`[start] /data exists, mode=${(st.mode & 0o777).toString(8)}, uid=${st.uid}, gid=${st.gid}, my-uid=${process.getuid?.()}, my-gid=${process.getgid?.()}`);
    try { fs.chmodSync(dataDir, 0o777); console.log("[start] chmod 777 /data ok"); } catch (e) { console.log("[start] chmod /data failed (non-fatal):", e.message); }
    const probe = `${dataDir}/.write-probe`;
    try { fs.writeFileSync(probe, "ok"); fs.unlinkSync(probe); console.log("[start] /data write probe ok"); }
    catch (e) { console.log("[start] /data write probe FAILED:", e.message); }
  } else {
    console.log("[start] /data does NOT exist on this container");
  }
} catch (e) { console.log("[start] /data prep error:", e.message); }

const child = spawn("node_modules/.bin/next", ["start"], { stdio: "inherit", env: process.env });
child.on("exit", (code) => process.exit(code ?? 0));
