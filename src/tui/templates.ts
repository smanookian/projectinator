// Starter templates — curated, detailed idea prompts. Picking one skips the blank
// page and gives the PM a strong brief to decompose.

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
