import type {
  BranchRow,
  CollectionRow,
  NoteRow,
  PromptRow,
  RatingRow,
  RunRow,
  SuggestionItem,
  TagRow,
  VersionRow,
} from "@promptbr0/core";
import type {
  BranchDto,
  CollectionDto,
  CollectionTreeDto,
  NoteDto,
  PromptSummary,
  RatingDto,
  RunDto,
  SuggestionDto,
  TagDto,
  VersionDto,
} from "../shared/ipc.js";

import type { CollectionTreeItem } from "@promptbr0/core";

/** Display label for a version: "v3", custom label, or "concise v2" off-main. */
export function versionLabel(
  version: Pick<VersionRow, "number" | "label">,
  branchName: string,
): string {
  if (version.label) return version.label;
  const base = `v${version.number}`;
  return branchName === "main" ? base : `${branchName} ${base}`;
}

export function toTagDto(tag: TagRow & { usage_count?: number }): TagDto {
  return { id: tag.id, name: tag.name, color: tag.color, usageCount: tag.usage_count ?? 0 };
}

export function toCollectionDto(c: CollectionRow & { prompt_count?: number }): CollectionDto {
  return { id: c.id, name: c.name, sortOrder: c.sort_order, parentId: c.parent_collection_id, promptCount: c.prompt_count ?? 0 };
}

export function toTreeDto(node: CollectionTreeItem): CollectionTreeDto {
  return {
    id: node.id,
    name: node.name,
    sortOrder: node.sort_order,
    parentId: node.parent_collection_id,
    promptCount: node.promptCount,
    children: node.children.map((child: CollectionTreeItem) => toTreeDto(child)),
  };
}

export function toPromptSummary(
  row: PromptRow,
  tags: TagDto[],
  currentVersionLabel: string | null,
  collectionIds: string[] = [],
): PromptSummary {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    icon: row.icon,
    isStarred: row.is_starred === 1,
    versionLabel: currentVersionLabel,
    tags,
    collectionIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export function toVersionDto(
  row: VersionRow & { branch_name?: string },
  branchName: string,
  currentVersionId: string | null,
): VersionDto {
  return {
    id: row.id,
    promptId: row.prompt_id,
    branchId: row.branch_id,
    branchName,
    parentVersionId: row.parent_version_id,
    number: row.number,
    label: row.label,
    displayLabel: versionLabel(row, branchName),
    changeNote: row.change_note,
    author: row.author,
    createdAt: row.created_at,
    isCurrent: row.id === currentVersionId,
  };
}

export function toBranchDto(row: BranchRow): BranchDto {
  return { id: row.id, name: row.name, description: row.description, createdAt: row.created_at };
}

export function toRatingDto(row: RatingRow): RatingDto {
  return {
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    effectiveness: row.effectiveness,
    clarity: row.clarity,
    completeness: row.completeness,
    actionability: row.actionability,
    createdAt: row.created_at,
  };
}

export function toNoteDto(row: NoteRow, versionLabelFor: (id: string) => string | null): NoteDto {
  return {
    id: row.id,
    promptId: row.prompt_id,
    versionId: row.version_id,
    versionLabel: row.version_id ? versionLabelFor(row.version_id) : null,
    body: row.body,
    createdAt: row.created_at,
  };
}

export function toRunDto(row: RunRow, versionLabelFor: (id: string) => string | null): RunDto {  return {
    id: row.id,
    promptId: row.prompt_id,
    versionId: row.version_id,
    versionLabel: versionLabelFor(row.version_id),
    tool: row.tool,
    model: row.model,
    outcomeRating: row.outcome_rating,
    resultSummary: row.result_summary,
    startedAt: row.started_at,
    createdAt: row.created_at,
  };
}

export function toSuggestionDto(row: SuggestionItem): SuggestionDto {
  return {
    versionId: row.id,
    promptId: row.prompt_id,
    promptTitle: row.prompt_title,
    branchName: row.branch_name,
    displayLabel: versionLabel(row, row.branch_name),
    baseVersionId: row.parent_version_id,
    rationale: row.change_note,
    source: row.source,
    author: row.author,
    createdAt: row.created_at,
  };
}
