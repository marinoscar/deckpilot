import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { ChatSession, TranscriptEntry } from '../chat/session.js';
import { parseSlash, HELP_TEXT } from '../chat/slash.js';
import { Transcript } from './Transcript.js';
import { Prompt } from './Prompt.js';
import { StatusBar } from './StatusBar.js';
import { ThinkingIndicator } from './ThinkingIndicator.js';
import { renderSampleDeck } from '../render/renderer.js';

type Status = 'idle' | 'streaming' | 'cancelled' | 'error';

type Props = { session: ChatSession };

export const App: React.FC<Props> = ({ session }) => {
  const { exit } = useApp();
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [model, setModel] = useState<string>(session.getModel());
  const lastCtrlC = useRef<number>(0);

  useEffect(() => session.subscribe(setEntries), [session]);
  useEffect(() => session.onModelChange(setModel), [session]);
  // Drive status from the session's busy flag — `session.send()` returns as
  // soon as the message is queued, so the only authoritative signal that the
  // agent has finished is the SDK's `session.idle` event (mapped to busy=false).
  useEffect(
    () =>
      session.onBusyChange((busy) => {
        setStatus((prev) => {
          if (busy) return 'streaming';
          // Don't clobber 'error' on idle — let the user see the error until
          // they send another message.
          if (prev === 'error') return 'error';
          return 'idle';
        });
      }),
    [session],
  );

  useInput(async (input, key) => {
    if (key.ctrl && (input === 'c' || input === '\x03')) {
      const now = Date.now();
      if (now - lastCtrlC.current < 1200) {
        await session.stop();
        exit();
        return;
      }
      lastCtrlC.current = now;
      if (status === 'streaming') {
        await session.cancel();
        setStatus('cancelled');
        session.addSystemMessage('Generation cancelled. Press Ctrl+C again to exit.');
        setTimeout(() => setStatus('idle'), 600);
      } else {
        session.addSystemMessage('Press Ctrl+C again to exit.');
      }
    }
  });

  async function handleSubmit(text: string) {
    const slash = parseSlash(text);
    if (slash) {
      await handleSlash(slash, text);
      return;
    }
    try {
      // Status transitions are driven by session.onBusyChange.
      await session.sendUserMessage(text);
    } catch (e) {
      setStatus('error');
      session.addSystemMessage(`error: ${(e as Error).message}`);
    }
  }

  async function handleSlash(
    slash: ReturnType<typeof parseSlash>,
    raw: string,
  ): Promise<void> {
    if (!slash) return;
    switch (slash.kind) {
      case 'help':
        session.addSystemMessage(HELP_TEXT);
        return;
      case 'clear':
      case 'new':
        session.clear();
        session.addSystemMessage('Transcript cleared.');
        return;
      case 'render': {
        const path = slash.outputPath ?? 'deckpilot-sample.pptx';
        session.addSystemMessage(`Rendering hardcoded M1 sample deck → ${path} …`);
        try {
          const out = await renderSampleDeck(path);
          session.addSystemMessage(`Wrote ${out}`);
        } catch (e) {
          session.addSystemMessage(`render failed: ${(e as Error).message}`);
        }
        return;
      }
      case 'model': {
        if (!slash.id) {
          session.addSystemMessage(`Current model: ${session.getModel()}`);
          return;
        }
        session.addSystemMessage(`Switching model → ${slash.id} …`);
        await session.switchModel(slash.id);
        return;
      }
      case 'models': {
        session.addSystemMessage('Fetching model list …');
        try {
          const models = await session.listModels();
          const cur = session.getModel();
          const lines = models.map((m) => {
            const marker = m.id === cur ? '* ' : '  ';
            return `${marker}${m.id.padEnd(30)} ${m.name}`;
          });
          session.addSystemMessage(
            `Available models (use /model <id> to switch):\n${lines.join('\n')}`,
          );
        } catch (e) {
          session.addSystemMessage(`Could not list models: ${(e as Error).message}`);
        }
        return;
      }
      case 'quit':
        await session.stop();
        exit();
        return;
      case 'unknown':
        session.addSystemMessage(
          `Unknown slash command: ${raw}. Try /help for the list.`,
        );
        return;
    }
  }

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text color="cyanBright" bold>
          DeckPilot
        </Text>
        <Text dimColor> · conversational PowerPoint via GitHub Copilot</Text>
      </Box>
      <Transcript entries={entries} />
      <Box marginTop={1} flexDirection="column">
        {status === 'streaming' ? (
          <ThinkingIndicator />
        ) : (
          <Prompt disabled={false} onSubmit={handleSubmit} />
        )}
        <StatusBar status={status} model={model} />
      </Box>
    </Box>
  );
};
