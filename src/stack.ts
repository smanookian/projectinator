// Target stack — the platform + framework a build should target. The choice is
// turned into a short instruction appended to the brief, so the PM and dev build
// the right thing. Kept build-free on purpose (CDN React, no Vite/npm) so the
// existing static test/preview/deploy pipeline works unchanged.

export type Platform = "web" | "mobile" | "desktop";

/** Web framework ids. "ai" = let the PM decide; any other string = custom. */
export type Framework = "vanilla" | "react" | "ai" | (string & {});

export interface StackChoice {
  platform: Platform;
  framework: Framework;
}

export const WEB_FRAMEWORKS: { id: Framework; label: string }[] = [
  { id: "vanilla", label: "Vanilla HTML / CSS / JS (no framework)" },
  { id: "react", label: "React (via CDN, no build step)" },
  { id: "ai", label: "Let the AI decide" },
];

const WEB_DESC: Record<string, string> = {
  vanilla: "vanilla HTML, CSS, and JavaScript — no framework, no build step",
  react:
    "React loaded from a CDN (no build step): a single index.html that imports React and ReactDOM " +
    "from https://esm.sh/react and https://esm.sh/react-dom/client as ES modules, uses function " +
    "components and hooks, and mounts into a <div id=\"root\">. Put styles in styles.css. Do NOT use " +
    "Vite, JSX files, npm, or any build tooling — everything must run by opening index.html.",
};

/** The instruction appended to the brief for the chosen stack (empty = AI decides). */
export function stackInstruction(choice: StackChoice): string {
  const { platform, framework } = choice;
  if (platform !== "web") {
    return `\n\nTarget platform: ${platform}. Native ${platform} toolchains aren't wired up yet — build a responsive web app (single index.html) styled to feel like a ${platform} app.`;
  }
  if (!framework || framework === "ai") return ""; // let the PM pick a web approach
  const desc = WEB_DESC[framework] ?? `the ${framework} stack (no build step; must run by opening index.html)`;
  return `\n\nTarget stack: ${desc}.`;
}

/** Human label for a stored choice, for display. */
export function stackLabel(choice: StackChoice): string {
  if (choice.platform !== "web") return `${choice.platform} (as web)`;
  return WEB_FRAMEWORKS.find((f) => f.id === choice.framework)?.label ?? String(choice.framework);
}
