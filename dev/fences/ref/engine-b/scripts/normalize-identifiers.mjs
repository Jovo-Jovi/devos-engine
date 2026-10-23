// One-shot identifier normalizer. Converges variant spellings of the same
// identifiers across the keys-stage files to ONE canonical spelling.
// Strings/comments stay verbatim; inside template literals only the ${...}
// code spans are normalized.
import { readFileSync, writeFileSync } from 'node:fs';

const FILES = [
  'lib/secretsflow.mjs',
  'lib/continue.mjs',
  'lib/cli.mjs',
  'lib/server.mjs',
  'lib/secret.mjs',
  'lib/keys.mjs',
  'test/secrets-stage.test.mjs',
  'test/continue.test.mjs',
  'test/fixtures/bin/fake-cli.mjs',
];

// normalized-token -> canonical spelling
const CANON = {
  runsecretsstage: 'runSecretsStage',
  runmodelwalkthrough: 'runModelWalkthrough',
  buildwalkthroughprompt: 'buildWalkthroughPrompt',
  readkeysmode: 'readKeysMode',
  recordkeysmode: 'recordKeysMode',
  keysmodefile: 'keysModeFile',
  keysmodequestion: 'keysModeQuestion',
  keystatus: 'keyStatus',
  pushfilledsecrets: 'pushFilledSecrets',
  pushfromlocalfile: 'pushFromLocalFile',
  ensurelocalsecretsfile: 'ensureLocalSecretsFile',
  readlocalsecrets: 'readLocalSecrets',
  localsecretsfile: 'localSecretsFile',
  ensuregitignored: 'ensureGitignored',
  pushsecret: 'pushSecret',
  guidefile: 'guideFile',
  writebuiltinguide: 'writeBuiltInGuide',
  buildguideprompt: 'buildGuidePrompt',
  buildinguidemarkdown: 'builtInGuideMarkdown',
  printkeysteps: 'printKeySteps',
  runrepairmodel: 'runRepairModel',
  recordsecretstatus: 'recordSecretStatus',
  readsecretsstate: 'readSecretsState',
  keycatalog: 'keyCatalog',
  keysource: 'keySource',
  listgithubsecrets: 'listGithubSecrets',
  localsecretsrel: 'LOCAL_SECRETS_REL',
  guiderel: 'GUIDE_REL',
  keepvalue: 'KEEP_VALUE',
  keyspushed: 'keysPushed',
  keysmissing: 'keysMissing',
  keyssetthisrun: 'keysSetThisRun',
  allset: 'allSet',
  unconfirmed: 'unconfirmed',
  shouldstop: 'shouldStop',
  waitkeys: 'waitKeys',
  keysmode: 'keysMode',
  maxwaitms: 'maxWaitMs',
  pollms: 'pollMs',
  stillmissing: 'stillMissing',
  stillunconfirmed: 'stillUnconfirmed',
  setnow: 'setNow',
  walkthrough: 'walkthrough',
};

const canonToken = (tok) => {
  const c = CANON[tok.toLowerCase()];
  return c || tok;
};

// normalize identifier tokens in a code fragment
const mapCode = (frag) => frag.replace(/[A-Za-z_$][A-Za-z0-9_$]*/g, (t) => canonToken(t));

// normalize ${...} spans inside a template-literal body
const mapTemplateBody = (body) =>
  body.replace(/\$\{/g, '__DEVOS_DOLLAR__').replace(/__DEVOS_DOLLAR__/g, '${') // no-op guard, see below
;

// simpler: process the whole template token by splitting on ${ ... } spans
function normalizeTemplate(tok) {
  let out = '';
  let i = 0;
  while (i < tok.length) {
    if (tok[i] === '$' && tok[i + 1] === '{') {
      // find matching close brace, tracking quotes (one nesting level)
      let depth = 1;
      let k = i + 2;
      while (k < tok.length && depth > 0) {
        const c = tok[k];
        if (c === '{') depth += 1;
        else if (c === '}') depth -= 1;
        else if (c === '"' || c === "'" || c === '`') {
          const q = c;
          k += 1;
          while (k < tok.length) {
            if (tok[k] === '\\') { k += 2; continue; }
            if (tok[k] === q) break;
            k += 1;
          }
        }
        k += 1;
      }
      out += '${' + mapCode(tok.slice(i + 2, k - 1)) + '}';
      i = k;
    } else {
      out += tok[i];
      i += 1;
    }
  }
  return out;
}

const TOKEN = /('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`|\/\/[^\n]*|\/\*[\s\S]*?\*\/)|([A-Za-z_$][A-Za-z0-9_$]*)/g;

function processSource(src) {
  return src.replace(TOKEN, (m, lit, ident) => {
    if (lit) return lit.startsWith('`') ? normalizeTemplate(lit) : lit;
    if (ident) return canonToken(ident);
    return m;
  });
}

for (const f of FILES) {
  try {
    const before = readFileSync(f, 'utf8');
    const after = processSource(before);
    if (after !== before) {
      writeFileSync(f, after);
      console.log(`normalized: ${f}`);
    } else {
      console.log(`unchanged:  ${f}`);
    }
  } catch (e) {
    console.error(`FAILED: ${f}: ${e.message}`);
  }
}
