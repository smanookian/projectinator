// Every test file gets its own data directory.
//
// All user state — config.json, projects/, calibration.json, openrouter-models.json,
// templates.json — resolves through dataHome(), i.e. $PROJECTINATOR_HOME. Without this, tests
// would read and write the developer's real ~/.projectinator (including the stored API key), and
// state written by one file would change what another file measures: calibration samples in
// particular feed token estimates, so a stray recordActual() silently moves other tests' numbers.
//
// setupFiles runs once per test file, so mkdtemp here means per-file isolation.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

const home = mkdtempSync(join(tmpdir(), "pi-test-home-"));
process.env.PROJECTINATOR_HOME = home;

afterAll(() => rmSync(home, { recursive: true, force: true }));
