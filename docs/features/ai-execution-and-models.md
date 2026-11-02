# Run prompts with AI models

PromptBr0 can run one prompt with up to six connected models at once, so you
can compare answers instead of guessing which model or prompt version works
best.

## The run window

Select **Run** in the prompt header to open the **Generated prompt** window.
It shows the full text that will be sent: the prompt's content with its active
[optional blocks](prompt-management.md#optional-blocks) appended at the end.
Everything happens in this one window:

- **Edit the text.** The text is editable, and your edits apply to this run
  only — the saved prompt stays untouched. Fill `{{variable_name}}` fields by
  replacing them inline; anything left unfilled is sent to the model as-is, so
  you always see exactly what leaves the app.
- **Toggle blocks.** If the prompt has optional blocks, each one shows a
  switch. Flipping a switch rebuilds the text; if you have already edited the
  text by hand, PromptBr0 asks before discarding those edits.
- **Pick models and run.** The model picker (up to six across your connected
  providers) and the **Run** button sit at the bottom of the window. Selecting
  **Run** closes the window and streams every model's result into the compare
  view.

Use **Copy** or **Copy & Close** to take the assembled text anywhere else —
for example into the [CLI](../integrations/cli.md). Closing the window with
unedited text is immediate; with manual edits PromptBr0 asks for confirmation,
because window edits are never saved.

## Run and compare

1. Select **Run**, adjust the text and blocks as needed.
2. Choose one or more models and select **Run**.
3. Watch each model's result as it arrives.

Open the **Results** tab and select a run group to compare its outputs. Each
result shows its status, response, elapsed time, token usage when the provider
reports it, and an estimated cost when pricing is available. You can cancel
running requests; a provider may still charge for work completed before the
cancellation.

Cost is an estimate, not a bill. Local models and models without published
pricing show no estimate.

Next: [evaluate and judge results](llm-judge-and-evaluations.md).
