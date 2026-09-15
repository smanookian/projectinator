// Target stack — the platform + framework a build should target, and the STACK PROFILE
// behind it: how to install, build, serve-for-test, what to deploy, and whether the
// "runs on double-click" guarantee applies. Every pipeline stage asks the profile instead
// of assuming a static folder; the static profile is a no-op so today's builds are unchanged.
// Design: docs/STACKS.md.

export type Platform = "web" | "mobile" | "desktop" | "backend";

/** Web framework ids. "ai" = let the PM decide; any other string = custom. */
export type Framework = "vanilla" | "react" | "vite-react" | "vite-ts" | "node" | "ai" | (string & {});

export interface StackChoice {
  platform: Platform;
  framework: Framework;
}

export type StackProfileId = "static" | "vite" | "node";

export interface StackProfile {
  id: StackProfileId;
  label: string;
  /** Shell commands, run in the project dir. Empty = nothing to do. */
  install?: string[];
  build?: string[];
  /** Long-running server command (backends). PORT is provided in the environment. */
  serve?: string[];
  /** Folder to serve/deploy after `build` (relative to the project); undefined = the project itself. */
  outDir?: string;
  /** Path the tester opens first. */
  entry: string;
  /** Can the result be deployed as a static site? */
  deployable: boolean;
  /** Does the "must work when index.html is double-clicked" rule apply? */
  doubleClick: boolean;
  /** Folders that must never be committed or shipped. */
  exclude: string[];
  /** Tool the machine needs (checked by doctor). */
  requires: "node" | "python" | null;
}

/** `npm ci --ignore-scripts` by default (decision 1 in STACKS.md); the `allowScripts`
 *  variant is used when a project has opted in after a script-related failure. */
const NPM_CI = ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"];
const NPM_CI_SCRIPTS = ["npm", "ci", "--no-audit", "--no-fund"];

export const PROFILES: Record<StackProfileId, StackProfile> = {
  static: {
    id: "static", label: "Static (no build step)",
    entry: "index.html", deployable: true, doubleClick: true, exclude: [], requires: null,
  },
  vite: {
    id: "vite", label: "Vite (npm build step)",
    install: NPM_CI, build: ["npm", "run", "build"], outDir: "dist", entry: "index.html",
    deployable: true, doubleClick: false, exclude: ["node_modules/", "dist/"], requires: "node",
  },
  node: {
    id: "node", label: "Node server (Express / Hono)",
    install: NPM_CI, serve: ["npm", "start"], entry: "",
    deployable: false, doubleClick: false, exclude: ["node_modules/"], requires: "node",
  },
};

/** The profile with install scripts allowed (a per-project opt-in). */
export function profileWithScripts(p: StackProfile): StackProfile {
  return p.install === NPM_CI ? { ...p, install: NPM_CI_SCRIPTS } : p;
}

/** Which profile a choice implies. Anything unknown/custom/AI is static — the safe default. */
export function profileFor(choice: StackChoice | undefined | null): StackProfile {
  if (!choice) return PROFILES.static;
  if (choice.platform === "backend" || choice.framework === "node") return PROFILES.node;
  if (choice.framework === "vite-react" || choice.framework === "vite-ts") return PROFILES.vite;
  return PROFILES.static;
}

export const WEB_FRAMEWORKS: { id: Framework; label: string }[] = [
  { id: "vanilla", label: "Vanilla HTML / CSS / JS (no framework)" },
  { id: "react", label: "React (via CDN, no build step)" },
  { id: "vite-react", label: "Vite + React + TypeScript (npm build step)" },
  { id: "vite-ts", label: "Vite + vanilla TypeScript (npm build step)" },
  { id: "ai", label: "Let the AI decide" },
];

export const BACKEND_FRAMEWORKS: { id: Framework; label: string }[] = [
  { id: "node", label: "Node server — Express or Hono, plain JavaScript" },
];

const VITE_COMMON =
  "a standard Vite project: package.json with scripts `dev`, `build` (vite build → dist/) and `preview`, " +
  "a lockfile (package-lock.json) so `npm ci` works, index.html at the root, source under src/. " +
  "The app MUST build cleanly with `npm run build`; run it before finishing. Do not commit node_modules or dist. " +
  "Write a README.md with `npm install` and `npm run dev`. The project does NOT need to run when index.html is double-clicked.";

const WEB_DESC: Record<string, string> = {
  vanilla: "vanilla HTML, CSS, and JavaScript — no framework, no build step",
  react:
    "React loaded from a CDN (no build step): a single index.html that imports React and ReactDOM " +
    "from https://esm.sh/react and https://esm.sh/react-dom/client as ES modules, uses function " +
    "components and hooks, and mounts into a <div id=\"root\">. Put styles in styles.css. Do NOT use " +
    "Vite, JSX files, npm, or any build tooling — everything must run by opening index.html.",
  "vite-react": `${VITE_COMMON} Use React 19 with TypeScript (.tsx), @vitejs/plugin-react, and src/main.tsx mounting into #root`,
  "vite-ts": `${VITE_COMMON} Use vanilla TypeScript (no framework) with src/main.ts`,
  node:
    "a Node.js HTTP server in plain JavaScript (ES modules) using Express or Hono: package.json with a `start` script, " +
    "a lockfile so `npm ci` works, the server listening on process.env.PORT (default 3000) and serving its own HTML at `/`. " +
    "Static assets under public/. Write a README.md with `npm install` and `npm start`. Do not commit node_modules",
};

/** The instruction appended to the brief for the chosen stack (empty = AI decides). */
export function stackInstruction(choice: StackChoice): string {
  const { platform, framework } = choice;
  if (platform === "mobile" || platform === "desktop") {
    return `\n\nTarget platform: ${platform}. Native ${platform} toolchains aren't wired up yet — build a responsive web app (single index.html) styled to feel like a ${platform} app.`;
  }
  if (platform === "backend") return `\n\nTarget stack: ${WEB_DESC.node}.`;
  if (!framework || framework === "ai") return ""; // let the PM pick a web approach
  const desc = WEB_DESC[framework] ?? `the ${framework} stack (no build step; must run by opening index.html)`;
  return `\n\nTarget stack: ${desc}.`;
}

/** Human label for a stored choice, for display. */
export function stackLabel(choice: StackChoice): string {
  if (choice.platform === "mobile" || choice.platform === "desktop") return `${choice.platform} (as web)`;
  if (choice.platform === "backend") return BACKEND_FRAMEWORKS.find((f) => f.id === choice.framework)?.label ?? "Node server";
  return WEB_FRAMEWORKS.find((f) => f.id === choice.framework)?.label ?? String(choice.framework);
}
