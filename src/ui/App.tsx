import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { ChatSession, TranscriptEntry } from '../chat/session.js';
import { parseSlash, HELP_TEXT } from '../chat/slash.js';
import { Transcript } from './Transcript.js';
import { Prompt } from './Prompt.js';
import { StatusBar } from './StatusBar.js';
import { ThinkingIndicator } from './ThinkingIndicator.js';
import { renderPlan } from '../render/renderer.js';
import { summarizePlan } from '../deck/revise.js';
import { summarizeTemplate } from '../template/profile.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

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
        session.clear();
        session.addSystemMessage('Transcript cleared. (Deck plan preserved — use /new to also reset the deck.)');
        return;
      case 'new':
        session.clear();
        // Force a fresh plan slot by setting plan via setPlan is wrong (it
        // requires a SlidePlan). For a true reset we just clear history;
        // the next propose_outline replaces everything anyway.
        session.addSystemMessage('Transcript cleared. Next propose_outline will replace the current deck.');
        return;
      case 'render': {
        const plan = session.getPlan();
        if (!plan) {
          session.addSystemMessage(
            'No deck plan yet. Ask the agent first (e.g. "make me a 6-slide intro to vector databases for a CTO audience").',
          );
          return;
        }
        const out = slash.outputPath ?? session.defaultOutputPath();
        session.addSystemMessage(`Rendering ${plan.slides.length}-slide deck → ${out} …`);
        try {
          const abs = await renderPlan(plan, out, {
            template: session.getTemplate() ?? undefined,
          });
          session.addSystemMessage(`Wrote ${abs}`);
        } catch (e) {
          session.addSystemMessage(`render failed: ${(e as Error).message}`);
        }
        return;
      }
      case 'save': {
        const plan = session.getPlan();
        if (!plan) {
          session.addSystemMessage('No deck plan yet. Use /render only after the agent has proposed one.');
          return;
        }
        const out = slash.outputPath ?? session.defaultOutputPath();
        session.addSystemMessage(`Saving deck + plan.json → ${out} …`);
        try {
          const abs = await renderPlan(plan, out, {
            template: session.getTemplate() ?? undefined,
          });
          const jsonPath = resolve(dirname(abs), `${abs.replace(/\.pptx$/i, '')}.plan.json`);
          await mkdir(dirname(jsonPath), { recursive: true });
          await writeFile(jsonPath, JSON.stringify(plan, null, 2));
          session.addSystemMessage(`Wrote ${abs}\n     and ${jsonPath}`);
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
          session.addSystemMessage('Usage: /load <path-to-plan.json>');
          return;
        }
        session.addSystemMessage(`Loading plan ${slash.path} …`);
        try {
          const plan = await session.loadPlanFromFile(slash.path);
          session.addSystemMessage(
            `Loaded ${plan.slides.length}-slide plan "${plan.meta.title}". You can edit it via chat or render it with /render.`,
          );
        } catch (e) {
          session.addSystemMessage(`Plan load failed: ${(e as Error).message}`);
        }
        return;
      }
      case 'outline': {
        const plan = session.getPlan();
        if (!plan) {
          session.addSystemMessage('No deck plan yet.');
          return;
        }
        session.addSystemMessage(summarizePlan(plan));
        return;
      }
      case 'show': {
        const plan = session.getPlan();
        if (!plan) {
          session.addSystemMessage('No deck plan yet.');
          return;
        }
        session.addSystemMessage(JSON.stringify(plan, null, 2));
        return;
      }
      case 'undo': {
        const undone = session.undo();
        session.addSystemMessage(
          undone ? 'Reverted the last plan change.' : 'Nothing to undo.',
        );
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
        // Reset usage for this slide so the LLM gets one more pass even if it
        // had already exhausted the budget on it.
        session.resetCritiqueUsage(slash.slideId);
        session.addSystemMessage(
          `Critique budget reset for "${slash.slideId}". Ask the agent to re-preview it (e.g. "preview slide ${slash.slideId} and refine if needed").`,
        );
        return;
      }
      case 'critique-passes': {
        if (typeof slash.n !== 'number') {
          session.addSystemMessage(`Critique passes per slide: ${session.getCritiquePasses()} (max 5).`);
          return;
        }
        const next = session.setCritiquePasses(slash.n);
        session.addSystemMessage(`Critique passes per slide set to ${next}.`);
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
