// Example opencode plugin for the Hafiz project.
//
// Plugins are loaded by opencode at startup and can mutate config, hook tool
// execution, register custom tools/providers/auth, etc. This one is a minimal
// guardrail: it ensures AGENTS.md stays in the instructions list.
//
// Auto-discovery: any *.ts/*.js file in .opencode/plugin/ or .opencode/plugins/
// is loaded automatically; no opencode.json `plugin:` entry needed.

export default async function projectGuardrailsPlugin() {
  return {
    config: (cfg: Record<string, unknown>) => {
      const instructions = Array.isArray(cfg.instructions) ? cfg.instructions : [];
      if (!instructions.includes("AGENTS.md")) {
        instructions.push("AGENTS.md");
      }
      cfg.instructions = instructions;
    },
  };
}
