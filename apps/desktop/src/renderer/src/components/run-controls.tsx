import { useEffect, useState, type FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Copy, X } from "lucide-react";
import { projectRunVariables } from "../lib/ai-prefs";
import { t } from "../lib/i18n";
import { useToast } from "../lib/toast";

const inputClass =
  "w-full rounded-md border border-line bg-app px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-faint focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/40";

/** Collects {{variable}} values before a run; prefilled from the last run. */
export function RunVariablesDialog({
  open,
  onOpenChange,
  names,
  initialValues,
  onSubmit,
  submitLabel = "Run",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  names: string[];
  initialValues: Record<string, string>;
  onSubmit: (values: Record<string, string>) => void;
  submitLabel?: string;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) setValues(projectRunVariables(names, initialValues));
  }, [open, initialValues, names]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(projectRunVariables(names, values));
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="pb-overlay fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content
          aria-describedby={undefined}
          className="pb-dialog fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-line-strong bg-panel p-5 shadow-2xl shadow-black/50 focus:outline-none"
        >
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-sm font-semibold text-ink">{t("run_variables.title")}</Dialog.Title>
            <Dialog.Close
              aria-label={t("dialog.close")}
              className="rounded-md p-1 text-ink-faint transition-colors hover:bg-hover hover:text-ink"
            >
              <X size={15} />
            </Dialog.Close>
          </div>
          <form onSubmit={submit} className="space-y-3">
            {names.map((name, index) => (
              <label key={name} className="block space-y-1.5">
                <span className="font-mono text-xs font-medium text-ink-dim">{`{{${name}}}`}</span>
                <input
                  autoFocus={index === 0}
                  value={values[name] ?? ""}
                  onChange={(e) => setValues((current) => ({ ...current, [name]: e.target.value }))}
                  className={inputClass}
                />
              </label>
            ))}
            <p className="text-[11px] leading-relaxed text-ink-faint">
              {t("run_variables.empty_placeholder")}
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-md border border-line px-3 py-1.5 text-[13px] text-ink-dim transition-colors hover:bg-hover hover:text-ink"
              >
                {t("dialog.cancel")}
              </button>
              <button
                type="submit"
                className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-strong"
              >
                {submitLabel}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Displays the prompt after variable substitution; offers Copy / Copy & Close. */
export function GenerateResultDialog({
  open,
  onOpenChange,
  content,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  content: string;
}) {
  const { toast } = useToast();

  const copy = () => {
    navigator.clipboard.writeText(content);
    toast(t("run_controls.copied"), "success");
  };

  const copyAndClose = () => {
    copy();
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="pb-overlay fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content
          aria-describedby={undefined}
          className="pb-dialog fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-line-strong bg-panel shadow-2xl shadow-black/50 focus:outline-none"
        >
          <div className="flex items-center justify-between px-5 pt-5 pb-2">
            <Dialog.Title className="text-sm font-semibold text-ink">{t("run_controls.generated_prompt")}</Dialog.Title>
            <Dialog.Close
              aria-label={t("dialog.close")}
              className="rounded-md p-1 text-ink-faint transition-colors hover:bg-hover hover:text-ink"
            >
              <X size={15} />
            </Dialog.Close>
          </div>
          <textarea
            readOnly
            value={content}
            className="mx-5 mb-4 min-h-[200px] max-h-[50vh] w-[calc(100%-2.5rem)] resize-y overflow-y-auto rounded-md border border-line bg-app px-2.5 py-1.5 font-mono text-[13px] text-ink focus:outline-none"
          />
          <div className="flex justify-end gap-2 px-5 pb-5">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-md border border-line px-3 py-1.5 text-[13px] text-ink-dim transition-colors hover:bg-hover hover:text-ink"
            >
              {t("dialog.close")}
            </button>
            <button
              type="button"
              onClick={copy}
              className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-[13px] text-ink-dim transition-colors hover:bg-hover hover:text-ink"
            >
              <Copy size={13} />
              {t("run_controls.copy")}
            </button>
            <button
              type="button"
              onClick={copyAndClose}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-strong"
            >
              {t("run_controls.copy_close")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
