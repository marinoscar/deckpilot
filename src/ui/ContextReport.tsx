import { Box, Text } from 'ink';
import type React from 'react';
import type { ContextUsage } from '../chat/session.js';
import { Theme } from './theme.js';
import { fillColor, fillFraction, fmtFull, gauge, pct } from './usage-format.js';

const LABEL_W = 17;
const VALUE_W = 11;
const BAR_W = 30;

/** One aligned `label …… value  note` line. */
const Row: React.FC<{
  label: string;
  value: string;
  color?: string;
  note?: string;
}> = ({ label, value, color, note }) => (
  <Box>
    <Text dimColor>{label.padEnd(LABEL_W)}</Text>
    <Text color={color}>{value.padStart(VALUE_W)}</Text>
    {note ? (
      <Text dimColor>
        {'   '}
        {note}
      </Text>
    ) : null}
  </Box>
);

const SectionTitle: React.FC<{ children: string }> = ({ children }) => (
  <Box marginTop={1}>
    <Text color={Theme.accent} bold>
      {children}
    </Text>
  </Box>
);

/**
 * The `/context` report: a bordered panel showing the current Copilot context
 * window (a colour-coded gauge + per-bucket breakdown) and this session's
 * cumulative token spend. Rendered as a `context` transcript entry.
 */
export const ContextReport: React.FC<{ usage: ContextUsage; model: string }> = ({
  usage,
  model,
}) => {
  const { context, totals } = usage;
  const frac = context ? fillFraction(context.currentTokens, context.tokenLimit) : 0;
  const barColor = fillColor(frac);
  const free = context ? Math.max(0, context.tokenLimit - context.currentTokens) : 0;

  const cacheDenom = totals.cacheReadTokens + totals.inputTokens;
  const cacheHit = cacheDenom > 0 ? totals.cacheReadTokens / cacheDenom : null;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={Theme.primary}
      paddingX={1}
      marginBottom={1}
    >
      <Box>
        <Text color={Theme.primary} bold>
          Context window
        </Text>
        <Text dimColor>{'  ·  '}</Text>
        <Text dimColor>{model}</Text>
      </Box>

      {context ? (
        <>
          <Box marginTop={1}>
            <Text color={barColor}>{gauge(frac, BAR_W)}</Text>
            <Text color={barColor} bold>
              {'  '}
              {pct(frac)}
            </Text>
          </Box>
          <Box>
            <Text>{fmtFull(context.currentTokens)}</Text>
            <Text dimColor>
              {' / '}
              {fmtFull(context.tokenLimit)} tokens{'  ·  '}
            </Text>
            <Text color={Theme.success}>{fmtFull(free)}</Text>
            <Text dimColor> free</Text>
          </Box>

          <SectionTitle>Breakdown</SectionTitle>
          {typeof context.systemTokens === 'number' ? (
            <Row label="System prompt" value={fmtFull(context.systemTokens)} />
          ) : null}
          {typeof context.toolDefinitionsTokens === 'number' ? (
            <Row label="Tool definitions" value={fmtFull(context.toolDefinitionsTokens)} />
          ) : null}
          {typeof context.conversationTokens === 'number' ? (
            <Row label="Conversation" value={fmtFull(context.conversationTokens)} />
          ) : null}
          <Row label="Messages" value={fmtFull(context.messagesLength)} note="turns in window" />
        </>
      ) : (
        <Box marginTop={1}>
          <Text dimColor>
            Context-window snapshot not reported yet — it lands after the next model turn.
          </Text>
        </Box>
      )}

      <SectionTitle>Session totals</SectionTitle>
      <Row label="Model API calls" value={fmtFull(totals.apiCalls)} />
      <Row label="Input tokens" value={fmtFull(totals.inputTokens)} />
      <Row label="Output tokens" value={fmtFull(totals.outputTokens)} />
      {totals.reasoningTokens > 0 ? (
        <Row label="Reasoning tokens" value={fmtFull(totals.reasoningTokens)} />
      ) : null}
      <Row
        label="Cache read"
        value={fmtFull(totals.cacheReadTokens)}
        color={Theme.success}
        note={cacheHit !== null ? `${pct(cacheHit)} of input served from cache` : undefined}
      />
      <Row label="Cache write" value={fmtFull(totals.cacheWriteTokens)} />
    </Box>
  );
};
