// Regression: the live-build screen renders a spinner glyph, the compact board,
// and the standup — with a RUNNING task. A <Box> nested in <Text> (e.g. the
// @inkjs/ui Spinner, which is a Box, placed inside a <Text>) crashes Ink at
// render time, and none of the other tests exercise this screen. Render the
// building-screen children with a running task and assert they don't throw.

import { render } from "ink-testing-library";
import React from "react";
import { Box, Text } from "ink";
import InkSpinner from "ink-spinner";
import { describe, it, expect } from "vitest";
import { Kanban, type BoardTask } from "../src/tui/Kanban.js";
import { Standup } from "../src/tui/panels.js";

const tasks: BoardTask[] = [
  { id: "T-1", capability: "design", title: "spec the UI", status: "done", cost: 0.1 },
  { id: "T-2", capability: "code", title: "write it", status: "running" },
  { id: "T-3", capability: "test", title: "verify", status: "pending", dependsOn: ["T-2"] },
];

describe("building screen renders with a running task", () => {
  it("inline spinner glyph is a Text (not a Box) inside <Text>", () => {
    const { lastFrame } = render(<Box><Text color="cyan"><InkSpinner type="dots" /></Text><Text bold>  Building</Text></Box>);
    expect(lastFrame()).toContain("Building");
  });

  it("compact Kanban with a running task does not crash", () => {
    const { lastFrame } = render(<Kanban tasks={tasks} compact maxPerCol={4} />);
    expect(lastFrame()).toContain("IN PROGRESS");
  });

  it("Standup with a running task renders chips", () => {
    const { lastFrame } = render(<Standup tasks={tasks} spent={0.1} />);
    expect(lastFrame()).toContain("running");
  });
});
