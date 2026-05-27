import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

type Props = {
  disabled: boolean;
  onSubmit: (text: string) => void;
};

export const Prompt: React.FC<Props> = ({ disabled, onSubmit }) => {
  const [value, setValue] = useState('');

  useInput((input, key) => {
    if (disabled) return;
    if (key.return) {
      const text = value.trim();
      if (text.length > 0) {
        setValue('');
        onSubmit(text);
      }
      return;
    }
    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      return;
    }
    if (key.ctrl || key.meta || key.escape || key.tab) return;
    if (input && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow) {
      setValue((v) => v + input);
    }
  });

  return (
    <Box>
      <Text color="green">{disabled ? '… ' : '› '}</Text>
      <Text>{value}</Text>
      <Text color="gray">{disabled ? '' : '▌'}</Text>
    </Box>
  );
};
