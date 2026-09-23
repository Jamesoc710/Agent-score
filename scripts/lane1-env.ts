import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import os from "os";
import path from "path";

// The Lane 1 instrument: which Lighthouse and which Chrome (design S2-7 §2, S2-6 §6).
//
// Chrome is Playwright 1.62.0's pinned Chromium, reached through CHROME_PATH, which
// chrome-launcher honours before any system Chrome. Lighthouse is the exact version in the
// root package.json; a companion version is its own npm project under
// scripts/lighthouse-companions/<version>/ with a committed lockfile, installed with `npm ci`,
// so its whole dependency tree (axe-core included, which decides the accessibility-tree
// audit) is as pinned as the root one and never shares node_modules with it.

export const EXPECTED_CHROME_VERSION = "151.0.7922.34";
export const CHROMIUM_BUILD = "chromium-1234";

// v1's flags, unchanged (scripts/lane1-lighthouse.ts at 174f603).
export const CHROME_FLAGS = "--headless --no-sandbox --disable-gpu";

export const COMPANIONS_DIR = path.join(process.cwd(), "scripts", "lighthouse-companions");

export type Lane1Preset = "desktop" | null;

export function defaultChromePath(): string {
  return path.join(
    os.homedir(),
    "Library/Caches/ms-playwright",
    CHROMIUM_BUILD,
    "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
  );
}

export function resolveChromePath(): string {
  return process.env.CHROME_PATH || defaultChromePath();
}

/** The binary's own full version, e.g. "151.0.7922.34". The LHR's user agent reduces it to 151.0.0.0. */
export function chromeBinaryVersion(chromePath: string): string {
  if (!existsSync(chromePath)) throw new Error(`CHROME_PATH does not exist: ${chromePath}`);
  const out = execFileSync(chromePath, ["--version"], { encoding: "utf8" }).trim();
  const match = out.match(/(\d+\.\d+\.\d+\.\d+)/);
  if (!match) throw new Error(`Could not read a version from "${out}"`);
  return match[1];
}

export function chromeMajor(version: string): string {
  return version.split(".")[0];
}

/** The root pin. Refuses a range: the x-axis must not float (S2-6 §6). */
export function pinnedLighthouseVersion(): string {
  const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
  const declared: string | undefined = pkg.devDependencies?.lighthouse ?? pkg.dependencies?.lighthouse;
  if (!declared || !/^\d+\.\d+\.\d+$/.test(declared)) {
    throw new Error(`package.json must pin lighthouse to an exact version; found "${declared}"`);
  }
  return declared;
}

export interface LighthouseInstall {
  version: string;
  /** Repo-relative directory holding package.json and package-lock.json. */
  project_dir: string;
  bin: string;
  lockfile: string;
  /** What node_modules actually holds; null when not installed. */
  installed_version: string | null;
  install_hint: string;
}

export function lighthouseInstall(version: string): LighthouseInstall {
  const root = process.cwd();
  const dir = version === pinnedLighthouseVersion() ? root : path.join(COMPANIONS_DIR, version);
  const pkgJson = path.join(dir, "node_modules", "lighthouse", "package.json");
  const installed = existsSync(pkgJson)
    ? (JSON.parse(readFileSync(pkgJson, "utf8")).version as string)
    : null;
  const rel = path.relative(root, dir) || ".";
  return {
    version,
    project_dir: rel,
    bin: path.join(dir, "node_modules", ".bin", "lighthouse"),
    lockfile: path.join(dir, "package-lock.json"),
    installed_version: installed,
    install_hint: rel === "." ? "npm ci" : `npm ci --prefix ${rel}`,
  };
}

/** Throws unless the requested version is installed exactly, from a committed lockfile. */
export function assertLighthouseInstalled(version: string): LighthouseInstall {
  const install = lighthouseInstall(version);
  if (!existsSync(install.lockfile)) {
    throw new Error(
      `No lockfile for Lighthouse ${version} at ${path.relative(process.cwd(), install.lockfile)}. ` +
        `A companion version needs scripts/lighthouse-companions/${version}/ with package.json and package-lock.json.`
    );
  }
  if (install.installed_version !== version) {
    throw new Error(
      `Lighthouse ${version} is not installed (found ${install.installed_version ?? "nothing"}). ` +
        `Run: ${install.install_hint}`
    );
  }
  return install;
}

/** The v1 invocation, with the retained output path and, for the desktop companion, one preset flag. */
export function lighthouseArgs(url: string, outputPath: string, preset: Lane1Preset): string[] {
  return [
    url,
    "--output=json",
    `--output-path=${outputPath}`,
    "--quiet",
    "--only-categories=agentic-browsing",
    `--chrome-flags=${CHROME_FLAGS}`,
    ...(preset === "desktop" ? ["--preset=desktop"] : []),
  ];
}

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function sha256File(file: string): string {
  return sha256Hex(readFileSync(file));
}

export function repoRelative(file: string): string {
  return path.relative(process.cwd(), file).split(path.sep).join("/");
}
