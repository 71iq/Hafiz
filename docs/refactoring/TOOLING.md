# Tooling and source provenance

New development tools are pinned in package.json and package-lock.json. Node 24.18.0 and npm 11.16.0 ran the setup. The existing app uses TypeScript 5.9.3. Its original Zod runtime was restored and pinned at 4.3.6 after npm initially deduplicated it to the newer version required by Knip. Knip retains its own compatible Zod dependency.

| Tool               | Installed version                        | Purpose                                                      |
| ------------------ | ---------------------------------------- | ------------------------------------------------------------ |
| Knip               | 6.41.0                                   | Native/web-aware unused-code and dependency triage           |
| jscpd              | 5.4.1                                    | Measured clone inventory with protected/generated exclusions |
| dependency-cruiser | 18.6.0                                   | Import boundary and cycle analysis                           |
| expo-doctor        | 1.20.4                                   | Expo package/native configuration diagnostics                |
| Santander Ralph    | 0b710b21802913fea395b7db7fa9b886518eee1b | Fresh Codex session loop, pinned unmodified vendor script    |

Tool installation also updated compatible analysis/transitive packages such as acorn, yaml, picomatch, tinyglobby, get-tsconfig and resolver WASM helpers. The lockfile records the full resolution. No audit fix or forced application upgrade ran.

The official installers were used as follows. Current upstream Git revisions are recorded in skill-sources.json; the Codex marketplace resolves its own curated plugin revision.

```sh
codex plugin add expo@openai-curated
codex plugin add superpowers@openai-curated
python3 /home/ehab/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py --repo vercel-labs/agent-skills --path skills/react-native-skills skills/composition-patterns --dest .agents/skills
npx --yes ai-agent-standards init
```

The Expo and Superpowers plugins live in the user Codex plugin cache and become available in fresh sessions. Vercel skills and the reuse-first workflow are committed project skills. The standards installer also copied its reference docs into docs and a Claude skill copy into .claude. Preserve their upstream attribution. MIT license copies are beside the project skills. Santander's Apache 2.0 license and NOTICE sit beside the vendor script.

amragl/codebase-review documents Claude-specific installation and checkpoint orchestration. Its evidence and modularization ideas were adapted into this project's audit/review procedure instead of blindly installing a Claude command into Codex. Existing TypeScript, verification, Supabase and debugging skills remain the supported equivalents for their respective tasks. jscpd is an analysis tool, not a skill.

Maestro is a planned native E2E complement to Playwright, not a replacement for web tests. No device was connected during setup, so installing it before an isolated QA target would not add verification evidence. Follow the current official quickstart when RF-040 prepares the device workflow. [Maestro quickstart](https://docs.maestro.dev/get-started/quickstart).

No iOS build can run on this Linux host. No EAS account, cloud build, paid resource, deployment connection or production credential was provisioned. Native/manual checks stay blocked until their actual infrastructure is available.

The copied Vercel skill Markdown had trailing whitespace normalized to satisfy git diff --check. Skill instructions and source code were otherwise preserved.
