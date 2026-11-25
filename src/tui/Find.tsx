// The `/` dialog: type to narrow your projects, ↑↓ to pick, Enter opens. Arrow keys only for
// the list — letters belong to the search field.

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { C, Panel, SelRow, TextField, useInputActive } from "./components.js";
import type { ProjectInfo } from "./engine.js";

export function Find({
  projects,
  maxRows,
  onOpen,
}: {
  projects: ProjectInfo[];
  maxRows: number;
  onOpen: (dir: string) => void;
}): React.ReactElement {
  const active = useInputActive();
  const [query, setQuery] = useState("");
  const [ix, setIx] = useState(0);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = projects.filter((p) => words.every((w) => p.idea.toLowerCase().includes(w)));
  const cur = Math.min(ix, Math.max(0, hits.length - 1));

  // Enter is the search field's submit; this only moves the highlight.
  useInput((_input, key) => {
    if (key.upArrow) setIx(Math.max(0, cur - 1));
    else if (key.downArrow) setIx(Math.min(hits.length - 1, cur + 1));
  }, { isActive: active });

  const rows = Math.max(3, maxRows);
  const start = Math.max(0, Math.min(cur - rows + 1, hits.length - rows));
  return (
    <Panel title="Find a project">
      <Box>
        <Text color={C.accent}>/ </Text>
        <TextField value={query} onChange={(v) => { setQuery(v); setIx(0); }} onSubmit={() => { if (hits[cur]) onOpen(hits[cur]!.dir); }} placeholder="type part of a project's name" />
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {hits.length === 0 ? <Text color={C.textMuted}>No project matches.</Text> : null}
        {hits.slice(start, start + rows).map((p, i) => (
          <SelRow key={p.dir} sel={start + i === cur}>
            {p.idea}<Text color={C.textMuted}>{`  $${p.totalCost.toFixed(2)}`}</Text>
          </SelRow>
        ))}
      </Box>
      <Box marginTop={1}><Text color={C.textMuted}>{`${hits.length} of ${projects.length} · ↑↓ pick · Enter open · Esc close`}</Text></Box>
    </Panel>
  );
}
