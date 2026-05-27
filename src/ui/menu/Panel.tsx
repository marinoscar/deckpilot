import { Box, Text } from 'ink';
import type React from 'react';

type Props = {
  title: string;
  subtitle?: string;
  footer?: string;
  width?: number;
  children: React.ReactNode;
  accent?: string;
};

/**
 * A bordered panel with a coloured title bar and a dim footer. Used as the
 * outer chrome for every menu / browser screen. Ink renders the border via
 * its built-in `borderStyle="round"`.
 */
export const Panel: React.FC<Props> = ({
  title,
  subtitle,
  footer,
  width = 76,
  children,
  accent = 'cyanBright',
}) => {
  return (
    <Box flexDirection="column" width={width} marginX={1} marginY={1}>
      <Box
        borderStyle="round"
        borderColor={accent}
        flexDirection="column"
        paddingX={2}
        paddingY={1}
      >
        <Box>
          <Text color={accent} bold>
            {title}
          </Text>
          {subtitle ? (
            <>
              <Text dimColor>{'  ·  '}</Text>
              <Text dimColor>{subtitle}</Text>
            </>
          ) : null}
        </Box>
        <Box marginTop={1} flexDirection="column">
          {children}
        </Box>
      </Box>
      {footer ? (
        <Box paddingX={2}>
          <Text dimColor>{footer}</Text>
        </Box>
      ) : null}
    </Box>
  );
};
