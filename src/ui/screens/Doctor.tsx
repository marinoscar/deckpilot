import { Box, Text, useInput } from 'ink';
import type React from 'react';
import { useEffect, useState } from 'react';
import { type Check, allHardChecksOk, runDoctorChecks } from '../../cli/doctor-checks.js';
import { Panel } from '../menu/Panel.js';

type Props = {
  /** Explicit GitHub token forwarded from the CLI flag, if any. */
  token?: string;
  onBack: () => void;
};

type Phase = { kind: 'checking' } | { kind: 'done'; checks: Check[] };

/**
 * TUI Doctor screen — runs the same preflight diagnostics as the
 * `deckpilot doctor` command (Node version, GitHub auth, cwd write access,
 * Copilot SDK, visual critique pipeline) without leaving the menu.
 */
export const Doctor: React.FC<Props> = ({ token, onBack }) => {
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' });
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is a recheck nonce — bumping it re-runs the diagnostics on demand.
  useEffect(() => {
    let cancelled = false;
    setPhase({ kind: 'checking' });
    void (async () => {
      const checks = await runDoctorChecks(token);
      if (cancelled) return;
      setPhase({ kind: 'done', checks });
    })();
    return () => {
      cancelled = true;
    };
  }, [token, attempt]);

  useInput((input, key) => {
    if (key.escape || input === 'b' || input === 'B') {
      onBack();
      return;
    }
    if (phase.kind === 'done' && (input === 'r' || input === 'R')) {
      setAttempt((n) => n + 1);
    }
  });

  if (phase.kind === 'checking') {
    return (
      <Panel title="Doctor" subtitle="preflight diagnostics" footer="Running checks…">
        <Text>
          <Text color="cyanBright">⠿</Text> Running diagnostics…
        </Text>
      </Panel>
    );
  }

  const { checks } = phase;
  const ok = allHardChecksOk(checks);

  return (
    <Panel
      title="Doctor"
      subtitle="preflight diagnostics"
      footer="r recheck · b back · esc back"
      accent={ok ? undefined : 'red'}
    >
      <Box flexDirection="column">
        {checks.map((c) => (
          <CheckLine key={c.name} check={c} />
        ))}
        <Box marginTop={1}>
          <Text color={ok ? 'green' : 'red'}>
            {ok ? '✓ All required checks passed.' : '✗ Some required checks failed.'}
          </Text>
        </Box>
      </Box>
    </Panel>
  );
};

const CheckLine: React.FC<{ check: Check }> = ({ check }) => {
  const color = check.ok ? 'green' : check.soft ? 'yellow' : 'red';
  const mark = check.ok ? '✓' : check.soft ? '!' : '✗';
  return (
    <Box flexDirection="column">
      <Text>
        <Text color={color}>{mark}</Text> {check.name} — <Text dimColor>{check.detail}</Text>
      </Text>
      {!check.ok && check.hint ? (
        <Box marginLeft={2}>
          <Text dimColor>hint: {check.hint}</Text>
        </Box>
      ) : null}
    </Box>
  );
};
