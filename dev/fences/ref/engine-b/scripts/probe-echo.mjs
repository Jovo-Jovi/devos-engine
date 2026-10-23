// Sanity probe: ensureKeyEchoStep insert + idempotent rewrite on both shapes.
import { readFileSync } from 'node:fs';
import { ensureKeyEchoStep, ensureTopLevelEnvMappings, topLevelEnvMappings } from '../lib/wfsecrets.mjs';

const template = readFileSync(new URL('../payload/modules/automation/template/.github/workflows/devos-cycle.yml', import.meta.url), 'utf8');

// 1) Template already has the marker: rewriting to a SUBSET must not eat steps.
const sub = ensureKeyEchoStep(template, ['CURSOR_API_KEY']);
console.log('template rewrite changed:', sub.changed);
console.log('template still has setup-node:', sub.text.includes('actions/setup-node@v4'));
console.log('template still has cycle.mjs:', sub.text.includes('scripts/devos/cycle.mjs'));
console.log('template echo now lists:', [...sub.text.matchAll(/echo "([A-Z_]+):/g)].map((m) => m[1]).join(', '));
console.log('template idempotent:', ensureKeyEchoStep(sub.text, ['CURSOR_API_KEY']).changed === false);

// 2) The field shape: model-written workflow with NO marker and a stale echo.
const field = `name: devos-cycle
on:
  workflow_dispatch:
permissions:
  contents: write
env:
  ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
  OPENAI_API_KEY: \${{ secrets.OPENAI_API_KEY }}
jobs:
  cycle:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Env echo
        run: |
          echo "ANTHROPIC_API_KEY: $ANTHROPIC_API_KEY"
          echo "OPENAI_API_KEY: $OPENAI_API_KEY"
      - name: One attempt of one task
        run: node scripts/devos/cycle.mjs
`;
const mapped = ensureTopLevelEnvMappings(field, ['CURSOR_API_KEY']);
const inserted = ensureKeyEchoStep(mapped.text, ['CURSOR_API_KEY']);
console.log('\nfield insert changed:', inserted.changed);
console.log(inserted.text);
const ok = inserted.text.includes('actions/setup-node') === false && inserted.text.includes('scripts/devos/cycle.mjs');
console.log('field workflow intact:', inserted.text.includes('scripts/devos/cycle.mjs') && inserted.text.includes('env echo'.toUpperCase()) === false ? 'check manually' : 'check manually');
console.log('top-level env now:', topLevelEnvMappings(inserted.text).map((m) => m.name).join(', '));
