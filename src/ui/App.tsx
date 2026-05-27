import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { ChatSession, TranscriptEntry } from '../chat/session.js';
import { parseSlash, HELP_TEXT } from '../chat/slash.js';
import { Transcript } from './Transcript.js';
import { Prompt } from './Prompt.js';
import { StatusBar } from './StatusBar.js';
import { renderSampleDeck } from '../render/renderer.js';

type Status = 'idle' | 'streaming' | 'cancelled' | 'error';

type Props = { session: ChatSession };

export const App: React.FC<Props> = ({ session }) => {
  const { exit } = useApp();
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const lastCtrlC = useRef<number>(0);

  useEffect(() => session.subscribe(setEntries), [session]);

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
    setStatus('streaming');
    try {
      await session.sendUserMessage(text);
      setStatus('idle');
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
        <Prompt disabled={status === 'streaming'} onSubmit={handleSubmit} />
        <StatusBar status={status} />
      </Box>
    </Box>
  );
};
