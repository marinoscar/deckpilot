import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Box, Text, useApp, useInput } from 'ink';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import type { ChatSession, TranscriptEntry } from '../chat/session.js';
import { HELP_TEXT, parseSlash } from '../chat/slash.js';
import { summarizeBrief } from '../deck/brief.js';
import { renderDeck } from '../render/renderer.js';
import { summarizeTemplate } from '../template/profile.js';
import { Prompt } from './Prompt.js';
import { StatusBar } from './StatusBar.js';
import { ThinkingIndicator } from './ThinkingIndicator.js';
import { Transcript } from './Transcript.js';

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
  useEffect(
    () =>
      session.onBusyChange((busy) => {
        setStatus((prev) => {
          if (busy) return 'streaming';
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
      await session.sendUserMessage(text);
    } catch (e) {
      setStatus('error');
      session.addSystemMessage(`error: ${(e as Error).message}`);
    }
  }

  async function handleSlash(slash: ReturnType<typeof parseSlash>, raw: string): Promise<void> {
    if (!slash) return;
    switch (slash.kind) {
      case 'help':
        session.addSystemMessage(HELP_TEXT);
        return;
      case 'clear':
        session.clear();
        session.addSystemMessage(
          'Transcript cleared. (Deck preserved — use /new to also reset the deck.)',
        );
        return;
      case 'new':
        session.clear();
        session.addSystemMessage(
          'Transcript cleared. Next propose_deck_brief will replace the current deck.',
        );
        return;
      case 'render': {
        const brief = session.getBrief();
        if (!brief) {
          session.addSystemMessage(
            'No deck yet. Ask the agent first (e.g. "make me a 6-slide intro to vector databases for a CTO audience").',
          );
          return;
        }
        const out = slash.outputPath ?? session.defaultOutputPath();
        session.addSystemMessage(`Rendering ${brief.slides.length}-slide deck → ${out} …`);
        try {
          const abs = await renderDeck(brief, session.getAllSlideCode(), out, {
            template: session.getTemplate() ?? undefined,
          });
          session.addSystemMessage(`Wrote ${abs}`);
        } catch (e) {
          session.addSystemMessage(`render failed: ${(e as Error).message}`);
        }
        return;
      }
      case 'save': {
        const brief = session.getBrief();
        if (!brief) {
          session.addSystemMessage(
            'No deck yet. Use /save only after the agent has proposed and built one.',
          );
          return;
        }
        const out = slash.outputPath ?? session.defaultOutputPath();
        session.addSystemMessage(`Saving deck + sources → ${out} …`);
        try {
          const abs = await renderDeck(brief, session.getAllSlideCode(), out, {
            template: session.getTemplate() ?? undefined,
          });
          const base = abs.replace(/\.pptx$/i, '');
          const briefPath = `${base}.brief.json`;
          await mkdir(dirname(briefPath), { recursive: true });
          await writeFile(briefPath, JSON.stringify(brief, null, 2));
          const slidePaths: string[] = [];
          for (const slide of brief.slides) {
            const code = session.getSlideCode(slide.id);
            if (!code) continue;
            const sp = `${base}.${slide.id}.slide.ts`;
            await writeFile(sp, code);
            slidePaths.push(sp);
          }
          session.addSystemMessage(
            `Wrote ${abs}\n     ${briefPath}\n     ${slidePaths.length} slide source files`,
          );
        } catch (e) {
          session.addSystemMessage(`save failed: ${(e as Error).message}`);
        }
        return;
      }
      case 'template': {
        if (!slash.path) {
          const cur = session.getTemplate();
          session.addSystemMessage(
            cur ? summarizeTemplate(cur) : 'No template loaded. Try /template ./brand.pptx',
          );
          return;
        }
        session.addSystemMessage(`Loading template ${slash.path} …`);
        try {
          const profile = await session.loadTemplate(slash.path);
          session.addSystemMessage(summarizeTemplate(profile));
        } catch (e) {
          session.addSystemMessage(`Template load failed: ${(e as Error).message}`);
        }
        return;
      }
      case 'load': {
        if (!slash.path) {
          session.addSystemMessage('Usage: /load <path-to-brief.json>');
          return;
        }
        session.addSystemMessage(`Loading brief ${slash.path} …`);
        try {
          const brief = await session.loadBriefFromFile(slash.path);
          session.addSystemMessage(
            `Loaded ${brief.slides.length}-slide brief "${brief.meta.title}". Slide code (if saved alongside) is NOT auto-loaded — ask the agent to rewrite or hand-paste it.`,
          );
        } catch (e) {
          session.addSystemMessage(`Brief load failed: ${(e as Error).message}`);
        }
        return;
      }
      case 'outline': {
        const brief = session.getBrief();
        if (!brief) {
          session.addSystemMessage('No deck yet.');
          return;
        }
        session.addSystemMessage(summarizeBrief(brief));
        return;
      }
      case 'show': {
        const brief = session.getBrief();
        if (!brief) {
          session.addSystemMessage('No deck yet.');
          return;
        }
        session.addSystemMessage(JSON.stringify(brief, null, 2));
        return;
      }
      case 'undo': {
        const undone = session.undo();
        session.addSystemMessage(undone ? 'Reverted the last deck change.' : 'Nothing to undo.');
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
      case 'critique': {
        if (!slash.slideId) {
          session.addSystemMessage(
            `Critique passes per slide: ${session.getCritiquePasses()}. Usage: /critique <slide-id> to force a fresh preview pass on a specific slide.`,
          );
          return;
        }
        session.resetCritiqueUsage(slash.slideId);
        session.addSystemMessage(
          `Critique budget reset for "${slash.slideId}". Ask the agent to re-preview it.`,
        );
        return;
      }
      case 'critique-passes': {
        if (typeof slash.n !== 'number') {
          session.addSystemMessage(
            `Critique passes per slide: ${session.getCritiquePasses()} (max 5).`,
          );
          return;
        }
        const next = session.setCritiquePasses(slash.n);
        session.addSystemMessage(`Critique passes per slide set to ${next}.`);
        return;
      }
      case 'style-guide': {
        const guide = session.getStyleGuide();
        if (!guide) {
          session.addSystemMessage(
            'No DECKPILOT.md found in this directory (or any ancestor). Create one to set persistent style/instruction rules for the agent.',
          );
          return;
        }
        session.addSystemMessage(
          `Active style guide: ${guide.path} (${guide.bytes} bytes). Its rules are binding for this deck.`,
        );
        return;
      }
      case 'quit':
        await session.stop();
        exit();
        return;
      case 'unknown':
        session.addSystemMessage(`Unknown slash command: ${raw}. Try /help for the list.`);
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
