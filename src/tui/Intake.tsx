// Intake wizard — walks the PM's clarifying questions one at a time. Single-choice
// questions use the menu; multi-choice use checkboxes. Every question offers
// "Something else…" (free text) and can be skipped.

import React, { useState } from "react";
import { Box, Text } from "ink";
import { MultiSelect } from "@inkjs/ui";
import { C, Panel, Menu as SelectInput, KeyHint, TextField as TextInput } from "./components.js";
import type { IntakeQuestion } from "../intake.js";

const OTHER = "__other__";
const SKIP = "__skip__";

export interface Answer { question: string; answer: string }

export function Intake({
  questions,
  onDone,
  onCancel,
}: {
  questions: IntakeQuestion[];
  onDone: (answers: Answer[]) => void;
  onCancel: () => void;
}): React.ReactElement {
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [typingPrefix, setTypingPrefix] = useState<string | null>(null); // non-null = capturing free text
  const [draft, setDraft] = useState("");

  const q = questions[i]!;

  const advance = (answer: string) => {
    const next = [...answers, { question: q.question, answer }];
    if (i + 1 < questions.length) {
      setAnswers(next);
      setI(i + 1);
      setTypingPrefix(null);
      setDraft("");
    } else {
      onDone(next);
    }
  };

  const progress = `Question ${i + 1} of ${questions.length}`;

  // free-text capture (from "Something else…")
  if (typingPrefix !== null) {
    return (
      <Box flexDirection="column">
        <Text color={C.dim}>{progress}</Text>
        <Text bold wrap="truncate-end">{q.question}</Text>
        <Box marginTop={1}>
          <Text color={C.accent}>{"› "}</Text>
          <TextInput
            value={draft}
            onChange={setDraft}
            onSubmit={() => advance([typingPrefix, draft].filter((s) => s.trim()).join(", "))}
          />
        </Box>
        <Box flexDirection="column" marginTop={1}>
          <Text color={C.dim}>Type your answer.</Text>
          <KeyHint hints={[{ keys: "Enter", label: "continue" }]} />
        </Box>
      </Box>
    );
  }

  // multi-choice: checkboxes + then optional free text if "Something else…" picked
  if (q.multi && q.options.length) {
    return (
      <Box flexDirection="column">
        <Text color={C.dim}>{progress}</Text>
        <Panel title={q.question}>
          <Box flexDirection="column">
            <Text color={C.dim}>Pick any that apply.</Text>
            <KeyHint hints={[{ keys: "Space", label: "toggle" }, { keys: "Enter", label: "confirm" }]} />
          </Box>
          <MultiSelect
            options={[...q.options.map((o) => ({ label: o, value: o })), { label: "Something else…", value: OTHER }]}
            onSubmit={(vals: string[]) => {
              const picked = vals.filter((v) => v !== OTHER);
              if (vals.includes(OTHER)) setTypingPrefix(picked.join(", "));
              else advance(picked.join(", "));
            }}
          />
        </Panel>
      </Box>
    );
  }

  // single-choice (or free-text-only when no options)
  const items = [
    ...q.options.map((o) => ({ label: o, value: o })),
    { label: "📝 Something else…", value: OTHER },
    { label: "⏭ Skip", value: SKIP },
  ];
  return (
    <Box flexDirection="column">
      <Text color={C.dim}>{progress}</Text>
      <Panel title={q.question}>
        <SelectInput
          items={items}
          onSelect={(it) => {
            if (it.value === OTHER) setTypingPrefix("");
            else if (it.value === SKIP) advance("");
            else advance(it.value);
          }}
        />
      </Panel>
      <KeyHint hints={[{ keys: "Esc", label: "cancel & go back" }]} />
    </Box>
  );
}
