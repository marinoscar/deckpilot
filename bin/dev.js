#!/usr/bin/env node
import { execute } from '@oclif/core';

if (process.argv.length <= 2) {
  process.argv.push('menu');
}

await execute({ development: true, dir: import.meta.url });
