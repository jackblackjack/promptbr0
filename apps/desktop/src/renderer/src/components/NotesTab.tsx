import { useState, type FormEvent } from "react";
import { StickyNote, Trash2 } from "lucide-react";
import { t } from "../lib/i18n";
import type { NoteDto, PromptDetail, VersionDto } from "../../../shared/ipc.js";
import { useAppMutation, useNotes } from "../hooks/use-data";
import { relativeTime } from "../lib/time";
import { ConfirmDialog } from "./dialogs";
import { EmptyState, Spinner } from "./ui";

export function NotesTab({
  prompt,
  versions,
  viewingVersion,
}: {
  prompt: PromptDetail;
  versions: VersionDto[];
  viewingVersion: VersionDto | null;
}) {
  const { data: notes, isLoading } = useNotes(prompt.id);
  const [body, setBody] = useState("");
  const [attachToVersion, setAttachToVersion] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<NoteDto | null>(null);

  const addNote = useAppMutation(
    () =>
      window.promptbr0.notes.add({
        promptId: prompt.id,
        ...(attachToVersion && viewingVersion ? { versionId: viewingVersion.id } : {}),
        body: body.trim(),
      }),
    {
      toast: t("notes_tab.note_added"),
      onSuccess: () => setBody(""),
    },
  );
  const deleteNote = useAppMutation((noteId: string) => window.promptbr0.notes.delete(noteId), {
    toast: t("notes_tab.note_deleted"),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!body.trim()) return;
    addNote.mutate(undefined);
  };

  const sorted = [...(notes ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <form onSubmit={submit} className="border-b border-line px-5 py-3">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t("notes_tab.add_note_placeholder")}
          rows={3}
          className="w-full resize-y rounded-md border border-line bg-app px-2.5 py-2 text-[13px] leading-relaxed text-ink placeholder:text-ink-faint focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/40"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
          <label className="flex cursor-pointer items-center gap-2 text-[11px] text-ink-dim">
            <input
              type="checkbox"
              checked={attachToVersion}
              onChange={(e) => setAttachToVersion(e.target.checked)}
              className="accent-accent"
              disabled={!viewingVersion}
            />
            Attach to {viewingVersion ? viewingVersion.displayLabel : "version"}
          </label>
          <button
            type="submit"
            disabled={!body.trim() || addNote.isPending}
            className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("notes_tab.add_note")}
          </button>
        </div>
      </form>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-3">
        {isLoading && <Spinner />}
        {!isLoading && sorted.length === 0 && (
          <EmptyState
            icon={<StickyNote size={16} />}
            title={t("notes_tab.no_notes")}
            hint={t("notes_tab.notes_hint")}
          />
        )}
        {sorted.map((note) => (
          <div key={note.id} className="group rounded-lg border border-line bg-panel p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-ink-faint">
                {relativeTime(note.createdAt)}
                {note.versionLabel && <span className="ml-1.5 text-accent">on {note.versionLabel}</span>}
              </span>
              <button
                type="button"
                onClick={() => setDeleteTarget(note)}
                className="rounded p-1 text-ink-faint transition-colors hover:bg-hover hover:text-danger"
                aria-label={t("notes_tab.delete_note_aria")}
              >
                <Trash2 size={12} />
              </button>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-dim">{note.body}</p>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={t("notes_tab.delete_note_confirm")}
        description={t("notes_tab.delete_note_desc")}
        confirmLabel={t("notes_tab.delete_note_label")}
        danger
        onConfirm={() => {
          if (deleteTarget) deleteNote.mutate(deleteTarget.id);
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}
