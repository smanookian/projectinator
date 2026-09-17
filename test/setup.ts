// Tests must never read or write the real user data directory. Projects now default to
// ~/.projectinator/projects, so without this a test fixture would land among the user's real
// builds (and the project-list walkers would pick whichever project happened to be there).
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const home = join(process.cwd(), ".workspace", "test-home");
mkdirSync(home, { recursive: true });
process.env.PROJECTINATOR_HOME = home;
