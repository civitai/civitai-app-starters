---
'@civitai/components-chat': patch
---

- An option added to a panel's choice without a value is selected, so the panel shows the model the viewer asked for.
- A choice option with a long label keeps its settings: labels, their settings' keys and a value picking one are cut to 60 characters alike. Before, a long model name lost its settings and the run sent the label as the input.
- A block choice used as a field inside another option's settings (`"loras": "{{lora}}"` in a model's settings) is refused with the spread to use, and the advice for an unused block choice is to spread it beside the model, not nest it.
- Failed tool calls show no note while the reply is still running (the assistant may yet fix them); one never fixed shows once the reply ends.
- **Adjust** prices other models in rank order, four at a time, until it has eight, and asks each service for its input schema once per session, instead of firing about eighty requests at once.
- The assistant is told to make one `run_step` per thing the viewer asked for, never two versions side by side.
