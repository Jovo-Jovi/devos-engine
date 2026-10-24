// Model adapters. Every launch passes the model id explicitly; a CLI default model is never used.
// The permission kit is: cwd confined to the project folder, prompt contract, PATH shims, and
// adapter-specific flags below. Exact vendor flags may drift; -p/--model is the stable contract.

export const DEFAULT_USAGE_LIMIT_PATTERNS = [
  /usage limit/i,
  /rate limit/i,
  /quota/i,
  /too many requests/i,
  /\b429\b/,
  /credit(s)? (balance|exhausted)/i,
  /out of (credits|tokens)/i,
  // Claude Code weekly (and window) limits: the account stays signed in, the run
  // just stops. A wait, not a failed task — same classification as any other limit.
  /weekly (?:usage )?limit/i,
  /limit will reset/i,
  /limit resets? (?:on|at|in)\b/i,
];

export function getAdapter(agent) {
  // agent: {toolId, command, promptTemplate, modelFlag?, usageLimitPattern?}
  const toolId = agent.toolId || agent.id;
  if (agent.toolId === 'custom' || String(toolId).startsWith('custom:')) {
    return customAdapter(agent);
  }
  switch (toolId) {
    case 'claude':
      return {
        id: 'claude',
        command: agent.command || 'claude',
        promptDelivery: 'stdin',
        buildArgs(model) {
          return ['-p', '--model', model,
            '--permission-mode', 'acceptEdits',
            '--allowedTools', 'Read', 'Edit', 'Write', 'Glob', 'Grep'];
        },
        usageLimitPatterns: DEFAULT_USAGE_LIMIT_PATTERNS,
      };
    case 'cursor':
      return {
        id: 'cursor',
        command: agent.command || 'agent',
        promptDelivery: 'stdin',
        // streamJson: runOnce feeds every stdout line through the stream-json
        // interpreter, so the developer sees the model's conversation, tool
        // calls, and file writes live instead of one buffered dump at exit.
        streamJson: true,
        buildArgs(model) {
          // agent --trust --force -p [--model <id>] --output-format stream-json
          // --trust answers Cursor's one-time "Do you trust the contents of this
          // directory?" gate: DEV_OS created the project folder itself, so trusting
          // it is safe, and a fresh folder refuses to start at all without it.
          // --force ("force allow commands unless explicitly denied") is what lets
          // the run actually DO things in print mode: without it Cursor only
          // proposes edits and rejects every command (npm install, init_github),
          // which is exactly the wall that leaves a tree half-written. DEV_OS
          // created the folder and the prompt is fixed, so this is the sandbox.
          // --output-format stream-json streams one JSON event per line as the
          // model works (assistant messages, tool calls, writes) instead of
          // buffering everything until exit.
          // model 'auto' sends NO --model flag: Cursor then uses its own Auto
          // selection, which is the only thing Free plans are allowed to run.
          if (model === 'auto') return ['--trust', '--force', '-p', '--output-format', 'stream-json'];
          return ['--trust', '--force', '-p', '--model', model, '--output-format', 'stream-json'];
        },
        usageLimitPatterns: DEFAULT_USAGE_LIMIT_PATTERNS,
      };
    case 'codex':
      return {
        id: 'codex',
        command: agent.command || 'codex',
        // `codex exec -` reads the prompt from stdin. The bootstrap prompt is far
        // larger than any command-line limit and must never ride argv (this also
        // keeps it intact through cmd.exe on Windows).
        promptDelivery: 'stdin',
        buildArgs(model) {
          return ['exec', '--model', model, '-'];
        },
        usageLimitPatterns: DEFAULT_USAGE_LIMIT_PATTERNS,
      };
    case 'gemini':
      return {
        id: 'gemini',
        command: agent.command || 'gemini',
        promptDelivery: 'stdin',
        buildArgs(model) {
          return ['-p', '--model', model];
        },
        usageLimitPatterns: DEFAULT_USAGE_LIMIT_PATTERNS,
      };
    case 'muse':
      return {
        id: 'muse',
        command: agent.command || 'muse',
        promptDelivery: 'stdin',
        buildArgs(model) {
          return ['-p', '--model', model];
        },
        usageLimitPatterns: DEFAULT_USAGE_LIMIT_PATTERNS,
      };
    case 'glm':
      return {
        id: 'glm',
        command: agent.command || 'z',
        promptDelivery: 'stdin',
        buildArgs(model) {
          return ['-p', '--model', model];
        },
        usageLimitPatterns: DEFAULT_USAGE_LIMIT_PATTERNS,
      };
    default:
      return customAdapter(agent);
  }
}

function customAdapter(agent) {
  const template = agent.promptTemplate || '';
  const modelFlag = agent.modelFlag || '--model';
  return {
    id: agent.toolId || 'custom',
    command: agent.command,
    promptDelivery: template.includes('{{PROMPT_FILE}}') ? 'arg-file' : 'stdin',
    buildArgs(model, promptFile) {
      const args = [];
      const parts = template.split(/\s+/).filter(Boolean);
      for (const part of parts) {
        if (part === '{{MODEL}}') args.push(model);
        else if (part === '{{PROMPT_FILE}}') args.push(promptFile || '');
        else if (part === '{{MODEL_FLAG}}') args.push(modelFlag);
        else args.push(part.replace('{{MODEL_FLAG}}', modelFlag));
      }
      return args;
    },
    usageLimitPatterns: agent.usageLimitPattern
      ? [new RegExp(agent.usageLimitPattern, 'i'), ...DEFAULT_USAGE_LIMIT_PATTERNS]
      : DEFAULT_USAGE_LIMIT_PATTERNS,
  };
}

export function looksLikeUsageLimit(output, adapter) {
  const text = String(output || '');
  const patterns = (adapter && adapter.usageLimitPatterns) || DEFAULT_USAGE_LIMIT_PATTERNS;
  return patterns.some((re) => re.test(text));
}

// Cursor's CLI refuses to start in a folder it has never seen and prints a directory-trust
// gate instead. Detect it so the engine can answer with the exact one-time fix instead of
// a generic "fix the message above".
export const TRUST_GATE_PATTERNS = [
  /trust the contents of this directory/i,
  /\bpass\b[^\n]{0,24}(--trust|--yolo|\s-f\b)/i,
  /run ['"]?agent['"]? interactively to decide/i,
];

export function looksLikeTrustGate(output) {
  const text = String(output || '');
  return TRUST_GATE_PATTERNS.some((re) => re.test(text));
}

// Plan walls: a CLI that refuses the model id the user picked because the account's
// plan does not include named models (Cursor Free: "Free plans can only use Auto").
// Detect it so the answer names the three real ways out instead of a generic error.
export const PLAN_RESTRICTION_PATTERNS = [
  /ActionRequiredError/i,
  /named models? unavailable/i,
  /free plans? can only use auto/i,
  /switch to auto or upgrade/i,
];

export function looksLikePlanRestriction(output) {
  const text = String(output || '');
  return PLAN_RESTRICTION_PATTERNS.some((re) => re.test(text));
}

// The permission wall: the CLI refused to run the model's commands (npm install,
// init_github, file edits). In Cursor print mode this is what --force is for; an
// older CLI build without full --force support can still reject. Detect it in the
// model's own words AND in CLI errors so the answer names the real fix.
export const COMMAND_REJECTION_PATTERNS = [
  /\bcommand(?:s| execution)? (?:was|were) rejected\b/i,
  /\brejected on every attempt\b/i,
  /\bcommand (?:approval|permission) (?:was )?denied\b/i,
  /\bwasn['']?t (?:approved|allowed to run)\b/i,
  /\bcommand execution (?:is )?(?:disabled|not permitted)\b/i,
];

// The model wall: the CLI does not offer the model id it was given on this account. The answer is another model
// from the list the tool reports. In Cursor's, Claude Code's, Codex's and the Gemini API's words, in that order.
export const MODEL_REJECTION_PATTERNS = [
  /cannot use this model/i,
  /issue with the selected model/i,
  /\bmodel (?:is )?not supported\b/i,
  /\bmodels\/[\w.-]+ is not found\b/i,
  /\b(?:invalid|unknown|unsupported) model\b/i,
];

export function looksLikeModelRejection(output) {
  const text = String(output || '');
  return MODEL_REJECTION_PATTERNS.some((re) => re.test(text));
}

export function looksLikeCommandRejection(output) {
  const text = String(output || '');
  return COMMAND_REJECTION_PATTERNS.some((re) => re.test(text));
}
