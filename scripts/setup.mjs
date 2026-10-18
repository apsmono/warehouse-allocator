import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function run(cmd, args) {
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) {
    return 1;
  }
  return result.status ?? 1;
}

function runOrExit(cmd, args) {
  const code = run(cmd, args);
  if (code !== 0) {
    process.exit(code);
  }
}

const nodeVersion = process.versions.node;
console.log(`→ Checking Node.js version (${nodeVersion})...`);
if (!nodeVersion.startsWith("22.")) {
  console.error(
    `Error: Node.js 22.x is required, but found v${nodeVersion}. Run 'nvm use' to switch to Node 22.`,
  );
  process.exit(1);
}

console.log("→ Checking Docker Compose availability...");
if (run("docker", ["compose", "version"]) !== 0) {
  console.error(
    "Error: 'docker compose version' failed. Docker Desktop must be installed and running. On macOS, the CLI may be in ~/.docker/bin and not on PATH.",
  );
  process.exit(1);
}

console.log("→ Installing dependencies (npm ci)...");
runOrExit("npm", ["ci"]);

const envPath = resolve(process.cwd(), ".env");
const envExamplePath = resolve(process.cwd(), ".env.example");
if (existsSync(envPath)) {
  console.log("→ Keeping existing .env (not overwritten).");
} else {
  copyFileSync(envExamplePath, envPath);
  console.log("→ Created .env from .env.example.");
}

console.log("→ Starting local PostgreSQL container (docker compose up -d --wait)...");
runOrExit("docker", ["compose", "up", "-d", "--wait"]);

console.log("→ Running database migrations and seed (npm run db:migrate && npm run db:seed)...");
runOrExit("npm", ["run", "db:migrate"]);
runOrExit("npm", ["run", "db:seed"]);

console.log("→ Setup complete. Next commands: npm test | npm run test:db | npm run dev");
