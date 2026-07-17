// Stack picker — platform first, then (for web) the framework. Non-web platforms
// fall back to a web build for now. Returns the chosen StackChoice.

import React, { useState } from "react";
import { Box, Text } from "ink";
import { C, Panel, Menu as SelectInput, TextField as TextInput } from "./components.js";
import { WEB_FRAMEWORKS, type Platform, type StackChoice } from "../stack.js";

const OTHER = "__other__";

export function StackPick({ onDone }: { onDone: (choice: StackChoice) => void }): React.ReactElement {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");

  // step 1 — platform
  if (!platform) {
    return (
      <Box flexDirection="column">
        <Panel title="Target platform">
          <SelectInput
            items={[
              { label: "🌐 Web", value: "web" },
              { label: "📱 Mobile  (builds as a web app for now)", value: "mobile" },
              { label: "🖥 Desktop  (builds as a web app for now)", value: "desktop" },
            ]}
            onSelect={(i) => {
              const p = i.value as Platform;
              if (p === "web") setPlatform("web");
              else onDone({ platform: p, framework: "ai" }); // web fallback, let PM decide
            }}
          />
        </Panel>
        <Text color={C.dim}>Esc to go back.</Text>
      </Box>
    );
  }

  // step 2 — framework (web only)
  if (typing) {
    return (
      <Box flexDirection="column">
        <Text bold>Which framework?</Text>
        <Box marginTop={1}>
          <Text color={C.accent}>{"› "}</Text>
          <TextInput
            value={draft}
            onChange={setDraft}
            onSubmit={() => onDone({ platform: "web", framework: draft.trim() || "ai" })}
          />
        </Box>
        <Text color={C.dim}>{"\n"}Name it (must run with no build step), Enter to continue.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Panel title="Web framework">
        <SelectInput
          items={[
            ...WEB_FRAMEWORKS.map((f) => ({ label: f.label, value: String(f.id) })),
            { label: "✍️ Something else…", value: OTHER },
          ]}
          onSelect={(i) => {
            if (i.value === OTHER) setTyping(true);
            else onDone({ platform: "web", framework: i.value });
          }}
        />
      </Panel>
      <Text color={C.dim}>Esc to go back.</Text>
    </Box>
  );
}
