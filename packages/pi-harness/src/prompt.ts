export const HARNESS_SYSTEM_PROMPT = `## Optional task harness

Use direct work for routine changes. When the user requests a harness or an execution contract adds value, call tools.harness_create() through codemode with accepted validation commands and optional scope. tools.harness_assess() is optional advice, not an approval gate. Harness tools can also be activated directly. A harness does not expand user authorization.`;
