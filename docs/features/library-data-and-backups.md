# Library data, backups, and transfer

Your library is stored locally. Use the data tools in **Settings → Data &
Backup** when you want an extra copy, move data, or recover from an accidental
deletion.

## Back up your library

PromptBr0 writes a backup automatically once a day and keeps the latest ten.
To create one immediately, open **Settings → Data & Backup** and select
**Back up now**.

A backup is useful before importing a large library or making irreversible
changes. Your database location is shown in the same settings section and can
be copied when you need it.

## Export and import a library

To move or copy your whole library:

1. Open **Settings → Data & Backup**.
2. Select **Export library…** and choose where to save the JSON file.
3. On the destination device, select **Import library…** and choose that file.

Import merges the export into the current library. It is separate from
multi-device sync, which keeps paired devices up to date automatically.
Prompt data and provider configuration transfer, but API keys, app settings,
and derived caches stay on the destination device.

You can also export one prompt from **More actions → Export prompt JSON**. That
file contains the prompt and its versions, notes, and run history.

## Export and import a collection

A collection — with all of its nested subfolders — can be shared as a single
`.pbrcol` file.

**Export:** right-click a collection in the sidebar and choose **Export
collection…**. The file lists the folders and which prompts belong where; it
does not contain the prompts themselves, so nothing about your prompts changes
on either device.

**Import:** select the import button next to the **Collections** heading and
choose a `.pbrcol` file. PromptBr0 shows a preview first: how many folders the
file holds, which prompts were found in your library, and which were not
(skipped ones are listed by name). The import always creates a top-level
collection and never modifies your prompts.

If a collection with the same name already exists at the top level, you choose
what happens:

- **Replace existing** — the current collection and its subfolders are removed
  and the imported one takes their place. A backup is saved automatically
  first, and prompts are never deleted.
- **Add as copy** — the import lands under a new name like "Design (2)".
- **Skip import** — nothing is imported; your library stays as it is.

Without a name conflict the collection is simply added at the top level.
Collection files are separate from both whole-library export and multi-device
sync.

## History and Trash

**History** in the left rail is a library-wide feed of recently created
versions. Select an item to open its prompt.

Deleting a prompt moves it to **Trash** first. Restore it from there if you
need it again. **Permanently empty Trash** in Settings removes every trashed
prompt and cannot be undone.
