// Every test file gets its own data directory.
//
// All user state — config.json, projects/, calibration.json, openrouter-models.json,
// templates.json — resolves through dataHome(), i.e. $PROJECTINATOR_HOME. Without this, tests
// would read and write the developer's real ~/.projectinator (including the stored API key), and
// state written by one file would change what another file measures: calibration samples in
// particular feed token estimates, so a stray recordActual() silently moves other tests' numbers.
//
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

const home = mkdtempSync(join(tmpdir(), "pi-test-home-"));
process.env.PROJECTINATOR_HOME = home;

// configPath() copies a $HOME-pinned config into a fresh data dir, so a bare temp home would
// still pull in the developer's real config and API key. An existing file blocks that copy.
writeFileSync(join(home, "config.json"), JSON.stringify({ keys: {} }) + "\n");

afterAll(() => rmSync(home, { recursive: true, force: true }));
