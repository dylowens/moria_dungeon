import { cpSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const dist = resolve(root, "dist");
const source = resolve(root, "web");

rmSync(dist, { force: true, recursive: true });
mkdirSync(dist, { recursive: true });
cpSync(source, dist, { recursive: true });

console.log(`Built web app into ${dist}`);
