// The `q` dialog, as in Musinator: quitting asks first. Keys live in App.tsx (y / Enter quit,
// n / Esc stay) because they must work over any screen.

import React from "react";
import { Box, Text } from "ink";
import { C, Panel } from "./components.js";

export function Quit({ building }: { building: boolean }): React.ReactElement {
  return (
    <Panel title="Quit">
      <Text bold color={C.text}>Quit Projectinator?</Text>
      {building ? <Text color={C.warn}>A build is running — quitting stops it. Resume it later from its project.</Text> : null}
      <Box marginTop={1}><Text color={C.textMuted}>y quit · Esc cancel</Text></Box>
    </Panel>
  );
}
