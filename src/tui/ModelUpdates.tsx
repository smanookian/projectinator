// The `M` dialog: newer versions of the models your team runs. Enter switches every role on the
// old model to the new one; s skips it (no notice for it again); Esc closes.

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { C, Panel, useInputActive } from "./components.js";
import { getModel } from "../models.js";
import { modelLabel } from "./engine.js";
import type { ModelUpgrade } from "../model-updates.js";

const price = (id: string): string => {
  try {
    const c = getModel(id).cost;
    return `$${c.input}/$${c.output}`;
  } catch { return "price unknown"; }
};

export function ModelUpdates({
  upgrades,
  onSwitch,
  onSkip,
}: {
  upgrades: ModelUpgrade[];
  onSwitch: (u: ModelUpgrade) => void;
  onSkip: (u: ModelUpgrade) => void;
}): React.ReactElement {
  const active = useInputActive();
  const [ix, setIx] = useState(0);
  const cur = Math.min(ix, Math.max(0, upgrades.length - 1));
  const sel = upgrades[cur];

  useInput((input, key) => {
    if (key.upArrow || input === "k") setIx(Math.max(0, cur - 1));
    else if (key.downArrow || input === "j") setIx(Math.min(upgrades.length - 1, cur + 1));
    else if (sel && key.return) onSwitch(sel);
    else if (sel && input === "s") onSkip(sel);
  }, { isActive: active });

  return (
    <Panel title="Newer models">
      {upgrades.length === 0 ? (
        <Text color={C.textMuted}>Your team runs the newest version of every model it uses.</Text>
      ) : (
        <>
          <Text color={C.textMuted}>A newer version of a model on your team is out. Switching moves every role on it.</Text>
          <Box flexDirection="column" marginTop={1}>
            {upgrades.map((u, i) => {
              const on = i === cur && active;
              return (
                <Box key={u.from} flexDirection="column" backgroundColor={on ? C.selection : undefined} marginBottom={i < upgrades.length - 1 ? 1 : 0}>
                  <Text bold={on} color={on ? C.selectionFg : C.text} wrap="truncate-end">
                    <Text color={C.marker}>{on ? "→ " : "  "}</Text>
                    {modelLabel(u.from)}<Text color={C.textMuted}> → </Text><Text color={C.accent}>{modelLabel(u.to.id)}</Text>
                  </Text>
                  <Text color={C.textMuted} wrap="truncate-end">
                    {`    ${u.roles.join(", ")} · ${price(u.from)} → ${price(u.to.id)} per 1M tokens (in/out)`}
                  </Text>
                </Box>
              );
            })}
          </Box>
          <Box marginTop={1} flexDirection="column">
            <Text color={C.textMuted}>Try it first: Home → Compare models (bake-off). Settings → Model assignments changes a role back.</Text>
            <Text color={C.textMuted}>Enter switch · s skip this one · ↑↓ pick · Esc later</Text>
          </Box>
        </>
      )}
    </Panel>
  );
}
