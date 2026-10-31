# DEV_OS adoption brief

A developer wants to add DEV_OS to a project that already exists. DEV_OS is a method that builds and reviews a
project's work on GitHub, one task at a time, with the developer merging at the gates. Nothing is decided or changed
yet. Your only job is a brief that the developer reads and confirms before anything happens.

This folder holds:

- `workspace/`: a copy of the project's tracked files at its current commit. It is a copy, so never edit it.
- `survey.json`: what DEV_OS measured. It holds a proposed stage with its reasons, the stack, the services, the
  workflows and deploys, an older copy of DEV_OS if any, the files DEV_OS would overlap, and environment variable
  names (names only, never values).

Read `survey.json`, then read the project in `workspace/` as far as you need: its README, manifests, routes and
pages, data models and migrations, tests, workflows and open TODOs.

## Write exactly two files, both in `brief/`

1. **`brief/brief.md`**, with these headings in this order, each with at least one line under it:
   - `## What it is`: the product in two or three sentences, and who uses it.
   - `## Stage`: `prototype`, `in-development` or `production`, then why. Start from the survey's proposal and its
     reasons. Disagree when the code shows otherwise, and say why.
   - `## How it is built`: the stack, the main folders, the services it uses, and how it is tested and deployed.
   - `## What is done`: the features that work today, one line each.
   - `## What is open`: unfinished work, open TODOs, failing or missing tests, things the code says are not done.
   - `## Risks`: what could break when DEV_OS starts changing this code, such as no tests around a flow, secrets
     handling, a production deploy with no gate, or a migration with no way back.
   - `## Personal data`: whether the product stores or handles personal data (accounts, emails, payments, health,
     location), and where. Say "none found" when you found none.
   - `## What DEV_OS will add`: in plain words, the method's files and workflows, added on a branch with a pull
     request the developer merges, never straight onto the default branch. Then the files that already exist and
     will be kept beside DEV_OS's (`collisions` in the survey), and a baseline: the code that exists today is
     recorded once, and only new or changed code must pass DEV_OS's checks.
   - `## Questions for you`: what you could not tell from the code. Write "none" when there is nothing to ask.
2. **`brief/brief.json`**, one JSON object:
   - `schema`: `"devos-brief/1"`;
   - `name`: the product's name, as the project calls itself;
   - `key`: a short upper-case key for it, matching `^[A-Z][A-Z0-9-]{1,31}$`;
   - `stage`: `"prototype"`, `"in-development"` or `"production"`, the same as in `## Stage`;
   - `type`: one of the catalogue types listed below, the closest one;
   - `stack`: one of the catalogue stacks listed below, or `""` when none fits;
   - `personal_data`: `true` or `false`;
   - `questions`: the questions of `## Questions for you` as an array of strings, `[]` when there are none (at most
     10).

## Rules

- Write nothing else, anywhere. Never edit `workspace/` or `survey.json`. Run no command, and do not use the network.
- Never copy a secret, key, token, password, connection string or personal detail (a real person's name, email,
  phone or address) into the brief, even when you find one in the code. Say only that one exists, and in which file.
- Say what you saw. When you are not sure, say so, and add a question.
- Plain English and short sentences. The developer may not know DEV_OS yet.
- When the developer asks for changes, change only what they ask, in both files, keeping every rule above.
