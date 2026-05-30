import { existsSync } from 'node:fs';
import { Args, Flags } from '@oclif/core';
import { render } from 'ink';
import React from 'react';
import { ChatSession } from '../chat/session.js';
import { BaseCommand } from '../cli/base-command.js';
import { createClient } from '../copilot/client.js';
import { loadConfig } from '../store/config.js';
import { listSkills, skillExists } from '../store/skills.js';
import { listTemplates, templateExists } from '../store/templates.js';
import { App } from '../ui/App.js';
import { SkillPicker } from '../ui/SkillPicker.js';
import { TemplatePicker } from '../ui/TemplatePicker.js';

/**
 * `deckpilot start` — the primary entry point for creating a new deck (or
 * resuming an existing project by name). Formerly `deckpilot chat`; the
 * `chat` command is preserved as a deprecated alias.
 */
export default class Start extends BaseCommand {
  static override description =
    'Start building a deck: a chat-driven session that produces PowerPoint, with autosaved project state.';

  static override examples = [
    '<%= config.bin %> start',
    '<%= config.bin %> start my-pitch',
    '<%= config.bin %> start my-pitch --template acme-corp',
    '<%= config.bin %> start --model gpt-5',
  ];

  static override args = {
    project: Args.string({
      required: false,
      description:
        "Project name (lower-case kebab). Resumes if it exists, creates if it doesn't. Omit to auto-name project-N.",
    }),
  };

  static override flags = {
    model: Flags.string({
      description: 'LLM model to use (e.g. claude-sonnet-4.5, gpt-5)',
      required: false,
    }),
    token: Flags.string({
      description: 'GitHub token to pass to the Copilot SDK (overrides env)',
      required: false,
      env: 'COPILOT_GITHUB_TOKEN',
    }),
    template: Flags.string({
      description:
        'Named template (from ~/.deckpilot/templates/) OR path to a .pptx to inherit theme/fonts from one-shot.',
      required: false,
    }),
    'no-picker': Flags.boolean({
      description:
        'Skip the startup template picker even when templates are saved and no --template flag is set.',
      default: false,
    }),
    skill: Flags.string({
      description:
        'Skill to apply (staged AI instructions, from ~/.deckpilot/skills/ or a built-in like story-arc).',
      required: false,
    }),
    'no-skill-picker': Flags.boolean({
      description:
        'Skip the startup skill picker even when skills exist and no --skill flag is set.',
      default: false,
    }),
    'critique-passes': Flags.integer({
      description:
        'How many render_slide_preview passes the model is allowed per slide (0 disables the visual critique loop). Default 3 unless overridden by `deckpilot config set critique-passes <n>`; max 5.',
      required: false,
      min: 0,
      max: 5,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Start);

    const cfg = await loadConfig();

    let templateName: string | undefined;
    let templatePath: string | undefined;
    if (flags.template) {
      if (/^[a-z0-9-]+$/.test(flags.template) && !existsSync(flags.template)) {
        templateName = flags.template;
      } else {
        templatePath = flags.template;
      }
    } else if (cfg.defaults.template) {
      // Config default applies when the user passed no --template. Verify the
      // template still exists on disk; if not, fall through to the picker.
      if (await templateExists(cfg.defaults.template)) {
        templateName = cfg.defaults.template;
      }
    }

    if (!templateName && !templatePath && !flags['no-picker']) {
      const saved = await listTemplates();
      if (saved.length > 0) {
        templateName = await TemplatePicker.pickInteractive(saved);
      }
    }

    let skillName: string | undefined;
    if (flags.skill) {
      skillName = flags.skill;
    } else if (cfg.defaults.skill) {
      if (await skillExists(cfg.defaults.skill)) {
        skillName = cfg.defaults.skill;
      }
    }

    if (!skillName && !flags['no-skill-picker']) {
      const skills = await listSkills();
      if (skills.length > 0) {
        skillName = await SkillPicker.pickInteractive(skills);
      }
    }

    const critiquePasses = flags['critique-passes'] ?? cfg.defaults.critiquePassesPerSlide ?? 3;
    const model = flags.model ?? cfg.defaults.model;

    const dp = createClient({ gitHubToken: flags.token });
    const session = new ChatSession(dp, {
      model,
      templatePath,
      templateName,
      skillName,
      projectName: args.project,
      critiquePassesPerSlide: critiquePasses,
    });

    try {
      await session.start();
    } catch (e) {
      this.fail(
        `Failed to start Copilot session: ${(e as Error).message}`,
        'Run `deckpilot doctor` to diagnose. Auth issues? `deckpilot auth login`.',
      );
    }

    const inkApp = render(React.createElement(App, { session }));
    await inkApp.waitUntilExit();
  }
}
