// Starter templates — curated, detailed idea prompts. Picking one skips the blank
// page and gives the PM a strong brief to decompose. Users can also save their own
// (persisted in ~/.projectinator/templates.json) and share them as portable files.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Template {
  name: string;
  blurb: string;
  idea: string;
}

export const TEMPLATES: Template[] = [
  {
    name: "Product landing page",
    blurb: "Hero, features, pricing, CTA",
    idea: "A single-page product landing site: a hero with headline + subheadline + call-to-action button, a 3-column features section, a simple pricing table, a short testimonials row, and a footer. Clean modern design, responsive, self-contained HTML with embedded CSS.",
  },
  {
    name: "Personal portfolio",
    blurb: "About, projects, contact",
    idea: "A personal portfolio site: a hero with my name and one-line intro, an about section, a projects grid with 3 sample cards (image, title, short description, link), and a contact section with a simple form. Tasteful typography, responsive, single self-contained HTML file.",
  },
  {
    name: "Link-in-bio page",
    blurb: "Avatar, bio, link buttons",
    idea: "A centered link-in-bio page: a round avatar, a name, a one-line bio, and a vertical stack of 4 link buttons (Twitter, GitHub, Email, Website). Soft gradient background, mobile-first, single self-contained HTML file.",
  },
  {
    name: "Coming-soon / waitlist",
    blurb: "Countdown + email signup",
    idea: "A coming-soon page: a big headline, a short pitch, a live countdown timer to a launch date, and an email signup form with inline validation and a success message. Bold, centered, single self-contained HTML file.",
  },
  {
    name: "Restaurant / cafe site",
    blurb: "Hero, menu, hours, contact",
    idea: "A cafe website: a hero with the cafe name and a photo-style gradient banner, a menu section grouped into Coffee / Food / Pastries with prices, an opening-hours block, a location + contact section with a simple form. Warm, inviting design, responsive, single self-contained HTML file.",
  },
  {
    name: "Blog home page",
    blurb: "Header, post list, sidebar",
    idea: "A blog home page: a header with the blog title and nav, a main column listing 4 post previews (title, date, excerpt, read-more link), a sidebar with an about box and a tag list, and a footer. Readable editorial typography, responsive, single self-contained HTML file.",
  },
  {
    name: "SaaS dashboard UI",
    blurb: "Sidebar, stat cards, table",
    idea: "A SaaS dashboard UI (front-end only, mock data): a left sidebar nav, a top bar, a row of 4 stat cards, a simple line-chart placeholder, and a recent-activity table. Clean product design, responsive, single self-contained HTML file with embedded CSS/JS.",
  },
];

// ---- user templates (saved + shared) ----

function homeDir(): string {
  const d = join(homedir(), ".projectinator");
  mkdirSync(d, { recursive: true });
  return d;
}
function userTemplatesPath(): string {
  return join(homeDir(), "templates.json");
}
function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "template";
}

export function loadUserTemplates(): Template[] {
  try {
    const raw = JSON.parse(readFileSync(userTemplatesPath(), "utf8")) as Template[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}
function writeUserTemplates(list: Template[]): void {
  writeFileSync(userTemplatesPath(), JSON.stringify(list, null, 2) + "\n");
}

/** Built-in + user templates, tagged. */
export function allTemplates(): (Template & { builtin: boolean })[] {
  return [
    ...TEMPLATES.map((t) => ({ ...t, builtin: true })),
    ...loadUserTemplates().map((t) => ({ ...t, builtin: false })),
  ];
}

/** Save (or overwrite by name) a user template. */
export function saveUserTemplate(t: Template): void {
  const list = loadUserTemplates().filter((x) => x.name !== t.name);
  list.push(t);
  writeUserTemplates(list);
}

export function deleteUserTemplate(name: string): void {
  writeUserTemplates(loadUserTemplates().filter((x) => x.name !== name));
}

/** Write a template to a portable file others can import. Returns the path. */
export function exportTemplate(t: Template): string {
  const dir = join(homeDir(), "exports");
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `${slug(t.name)}.pitemplate.json`);
  writeFileSync(p, JSON.stringify(t, null, 2) + "\n");
  return p;
}

/** Import a template from a shared file. Adds it to the user's templates. */
export function importTemplate(filePath: string): Template {
  const clean = filePath.trim().replace(/^['"]|['"]$/g, "").replace(/\\(.)/g, "$1");
  const abs = clean.startsWith("~") ? homedir() + clean.slice(1) : clean;
  if (!existsSync(abs)) throw new Error(`File not found: ${abs}`);
  const raw = JSON.parse(readFileSync(abs, "utf8")) as Partial<Template>;
  if (!raw || typeof raw.name !== "string" || typeof raw.idea !== "string") {
    throw new Error("Not a valid template file (needs name + idea).");
  }
  const t: Template = { name: raw.name, blurb: String(raw.blurb ?? ""), idea: raw.idea };
  saveUserTemplate(t);
  return t;
}
