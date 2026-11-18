import { ChangeEvent, useMemo, useState } from 'react';
import {
  BookOpen,
  Calendar,
  Check,
  Database,
  Download,
  FileText,
  Layers,
  Upload,
  X,
} from 'lucide-react';
import {
  downloadFlashcardsCsvTemplate,
  downloadNotesMarkdownTemplate,
  downloadWorkspaceBackupTemplate,
} from '../lib/backupTemplates';
import { createEmptyStructuredNote } from '../lib/noteFormat';
import {
  parseBackupJsonToWorkspace,
  parseDocxFile,
  parseUniversalStudyImport,
} from '../lib/smartImporter';
import { SUBJECT_COLOR_SWATCHES } from '../lib/subjectCatalog';
import { makeId, mergeWorkspaces, normalizeWorkspace } from '../lib/workspaceStore';
import { StudyFlashcard, StudySubject, StudyTopic, WorkspaceData } from '../types';

interface UniversalImportModalProps {
  open: boolean;
  onClose: () => void;
  workspace: WorkspaceData;
  defaultSubjectId?: string;
  onApplyImport: (
    updater: (prev: WorkspaceData) => WorkspaceData,
    summaryMsg: string,
    targetSubjectId: string,
    targetTopicId: string
  ) => void;
}

const SAMPLE_SNIPPET = `# Osmosis & Active Transport
Summary: How substances move across partially permeable cell membranes.

## Key Processes
- **Osmosis**: Net movement of water molecules from a region of higher water potential to lower water potential across a partially permeable membrane.
- **Active Transport**: Movement of particles against a concentration gradient using ATP energy from respiration.
- Diffusion is passive and requires no energy from respiration.

| Process | Gradient Direction | Requires ATP? |
| --- | --- | --- |
| Diffusion | High to low | No |
| Osmosis | High water potential to low | No |
| Active Transport | Low to high | Yes |

Examiner Tip: Always state "water potential" rather than just "concentration of water" for full marks.
Worked Example: Potato cylinders placed in 0.5 mol/dm3 sucrose solution lose mass because water moves out by osmosis.`;

export function UniversalImportModal({
  open,
  onClose,
  workspace,
  defaultSubjectId,
  onApplyImport,
}: UniversalImportModalProps) {
  const [rawText, setRawText] = useState('');
  const [sourceLabel, setSourceLabel] = useState('Pasted Notes');
  const [legacyHtml, setLegacyHtml] = useState<string | undefined>(undefined);
  const [targetSubjectId, setTargetSubjectId] = useState<string>(
    defaultSubjectId || workspace.subjects[0]?.id || '__new__'
  );
  const [newSubjectName, setNewSubjectName] = useState('');
  const [topicNameOverride, setTopicNameOverride] = useState('');
  const [includeNotes, setIncludeNotes] = useState(true);
  const [includeCards, setIncludeCards] = useState(false);
  const [backupImportMode, setBackupImportMode] = useState<'merge' | 'replace'>('merge');
  const [readingFile, setReadingFile] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const backupBundle = useMemo(() => {
    const t = rawText.trim();
    if (!t.startsWith('{') && !t.startsWith('[')) return null;
    return parseBackupJsonToWorkspace(t);
  }, [rawText]);

  const preview = useMemo(() => {
    if (!rawText.trim() || backupBundle) return null;
    return parseUniversalStudyImport(rawText, { sourceLabel, legacyHtml });
  }, [rawText, sourceLabel, legacyHtml, backupBundle]);

  if (!open) return null;

  const effectiveTopicName =
    topicNameOverride.trim() || preview?.suggestedTitle || 'Imported Study Topic';

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErrorMsg(null);
    setReadingFile(true);
    try {
      setSourceLabel(file.name);
      if (/\.docx$/i.test(file.name)) {
        if (!topicNameOverride.trim()) {
          setTopicNameOverride(file.name.replace(/\.[^.]+$/, ''));
        }
        const ab = await file.arrayBuffer();
        const res = await parseDocxFile(ab);
        setLegacyHtml(res.html);
        setRawText(res.text);
      } else {
        const text = await file.text();
        setLegacyHtml(undefined);
        if (!/\.json$/i.test(file.name) && !topicNameOverride.trim()) {
          setTopicNameOverride(file.name.replace(/\.[^.]+$/, ''));
        }
        setRawText(text);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not read the selected file.');
    } finally {
      setReadingFile(false);
    }
  };

  const handleConfirmBackupAll = () => {
    if (!backupBundle) return;
    const incoming = backupBundle.workspace;
    const firstIncoming = incoming.subjects[0];
    const matchingExisting = firstIncoming
      ? workspace.subjects.find(
          (s) => s.name.toLowerCase() === firstIncoming.name.toLowerCase()
        )
      : undefined;
    const firstSubjId =
      backupImportMode === 'replace'
        ? firstIncoming?.id || ''
        : matchingExisting?.id || firstIncoming?.id || workspace.subjects[0]?.id || '';
    const firstTopicId = incoming.topics[0]?.id || '';

    onApplyImport(
      (prev) =>
        backupImportMode === 'replace'
          ? normalizeWorkspace(incoming)
          : mergeWorkspaces(prev, incoming),
      `Imported all ${backupBundle.counts.notes} notes, ${backupBundle.counts.flashcards} flashcards, and ${backupBundle.counts.timelines} timeline nodes from ${sourceLabel}.`,
      firstSubjId,
      firstTopicId
    );

    setRawText('');
    setTopicNameOverride('');
    setLegacyHtml(undefined);
    setIncludeCards(false);
    onClose();
  };

  const handleConfirmImport = () => {
    if (backupBundle) {
      handleConfirmBackupAll();
      return;
    }

    if (!preview) {
      setErrorMsg('Paste study text, Quizlet/CSV cards, JSON backup, or upload a file first.');
      return;
    }
    if (targetSubjectId === '__new__' && !newSubjectName.trim()) {
      setErrorMsg('Enter a name for the new subject.');
      return;
    }

    let resolvedSubjId = '';
    let resolvedTopicId = '';
    const finalTopicName = effectiveTopicName;

    onApplyImport(
      (prev) => {
        const nextSubjects = [...prev.subjects];
        let subj: StudySubject | undefined =
          targetSubjectId !== '__new__'
            ? nextSubjects.find((s) => s.id === targetSubjectId)
            : nextSubjects.find(
                (s) => s.name.toLowerCase() === newSubjectName.trim().toLowerCase()
              );

        if (!subj) {
          subj = {
            id: makeId('subj'),
            name: newSubjectName.trim() || 'General',
            examBoard: 'GCSE / Revision',
            color: SUBJECT_COLOR_SWATCHES[nextSubjects.length % SUBJECT_COLOR_SWATCHES.length],
            examDate: '',
            weight: 2,
            createdAt: new Date().toISOString(),
          };
          nextSubjects.push(subj);
        }
        resolvedSubjId = subj.id;

        const nextTopics = [...prev.topics];
        let topic = nextTopics.find(
          (t) =>
            t.subjectId === subj!.id &&
            t.name.toLowerCase() === finalTopicName.toLowerCase()
        );

        if (topic) {
          resolvedTopicId = topic.id;
          if (includeNotes) {
            const mergedNote = {
              ...topic.notes,
              summary: topic.notes.summary || preview.note.summary,
              sections: [...topic.notes.sections, ...preview.note.sections],
              keyTerms: [...topic.notes.keyTerms, ...preview.note.keyTerms],
              examTip: topic.notes.examTip || preview.note.examTip,
              workedExample: topic.notes.workedExample || preview.note.workedExample,
              legacyHtml: topic.notes.legacyHtml || preview.legacyHtml,
              updatedAt: new Date().toISOString(),
            };
            const idx = nextTopics.findIndex((t) => t.id === topic!.id);
            nextTopics[idx] = { ...topic, notes: mergedNote };
          }
        } else {
          resolvedTopicId = makeId('top');
          const createdTopic: StudyTopic = {
            id: resolvedTopicId,
            subjectId: subj.id,
            name: finalTopicName,
            completed: false,
            notes: includeNotes
              ? preview.note
              : createEmptyStructuredNote(
                  `Flashcard deck imported from ${preview.sourceLabel}.`
                ),
            createdAt: new Date().toISOString(),
          };
          nextTopics.push(createdTopic);
        }

        const nextCards = [...prev.flashcards];
        if (includeCards && preview.cards.length > 0) {
          const existingQ = new Set(
            nextCards
              .filter((c) => c.subjectId === subj!.id)
              .map((c) => c.q.trim().toLowerCase())
          );
          for (const c of preview.cards) {
            if (!c.q.trim() || !c.a.trim() || existingQ.has(c.q.trim().toLowerCase())) continue;
            existingQ.add(c.q.trim().toLowerCase());
            const fc: StudyFlashcard = {
              id: makeId('fc'),
              subjectId: subj.id,
              topicId: resolvedTopicId,
              sectionName:
                c.sectionName && c.sectionName !== 'Imported Deck'
                  ? c.sectionName
                  : finalTopicName,
              q: c.q.trim(),
              a: c.a.trim(),
              box: 1,
              dueAt: Date.now(),
              flagged: false,
              createdAt: new Date().toISOString(),
            };
            nextCards.push(fc);
          }
        }

        return {
          ...prev,
          subjects: nextSubjects,
          topics: nextTopics,
          flashcards: nextCards,
          updatedAt: new Date().toISOString(),
        };
      },
      `Imported "${finalTopicName}"${includeCards ? ` with ${preview.cards.length} flashcards` : ' (notes only — click Make Flashcards anytime inside Notes)'}.`,
      resolvedSubjId || targetSubjectId,
      resolvedTopicId
    );

    setRawText('');
    setTopicNameOverride('');
    setLegacyHtml(undefined);
    setIncludeCards(false);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="universal-import-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sd-card flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
          <div>
            <h2
              id="universal-import-title"
              className="font-display text-xl font-bold text-[var(--ink)]"
            >
              Smart Study Importer
            </h2>
            <p className="mt-0.5 text-xs text-[var(--mute)]">
              Import Word (.docx), full .json backups (notes + flashcards + timelines), Markdown,
              Quizlet tabs, CSV, or pasted class text — instant offline formatting.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close importer"
            className="sd-btn h-8 w-8 shrink-0 p-0"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {errorMsg && (
            <div className="rounded-xl border border-[var(--bad)] bg-[var(--bg)] px-3.5 py-2.5 text-xs font-semibold text-[var(--bad)]">
              {errorMsg}
            </div>
          )}

          {/* Step 1: Upload or Paste */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--mute)]">
                1. Paste text / JSON or upload a file
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <label className="sd-btn cursor-pointer px-3 py-1.5 text-xs whitespace-nowrap">
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>
                    {readingFile ? 'Reading…' : 'Upload .docx / .json / .txt / .csv / .md'}
                  </span>
                  <input
                    type="file"
                    accept=".docx,.json,.txt,.md,.csv,application/json,text/plain,text/csv,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    onChange={(e) => void handleFileChange(e)}
                    className="hidden"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setSourceLabel('Sample Biology Notes');
                    setLegacyHtml(undefined);
                    setRawText(SAMPLE_SNIPPET);
                    if (!topicNameOverride) setTopicNameOverride('Osmosis & Active Transport');
                  }}
                  className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
                >
                  Load Example
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-xs">
              <span className="font-semibold text-[var(--mute)]">Download template file:</span>
              <button
                type="button"
                onClick={downloadFlashcardsCsvTemplate}
                className="cursor-pointer inline-flex items-center gap-1 font-semibold text-[var(--e3)] hover:underline whitespace-nowrap"
              >
                <Download className="h-3 w-3" aria-hidden="true" />
                <span>Flashcards (.csv)</span>
              </button>
              <span className="text-[var(--line)]">·</span>
              <button
                type="button"
                onClick={downloadNotesMarkdownTemplate}
                className="cursor-pointer inline-flex items-center gap-1 font-semibold text-[var(--e3)] hover:underline whitespace-nowrap"
              >
                <Download className="h-3 w-3" aria-hidden="true" />
                <span>Notes (.md)</span>
              </button>
              <span className="text-[var(--line)]">·</span>
              <button
                type="button"
                onClick={downloadWorkspaceBackupTemplate}
                className="cursor-pointer inline-flex items-center gap-1 font-semibold text-[var(--e2)] hover:underline whitespace-nowrap"
              >
                <Download className="h-3 w-3" aria-hidden="true" />
                <span>Full Backup (.json)</span>
              </button>
            </div>

            <textarea
              rows={7}
              value={rawText}
              onChange={(e) => {
                setRawText(e.target.value);
                setErrorMsg(null);
              }}
              placeholder={
                'Paste anything here or upload a file:\n• Full StudyDeck / Revision-Site JSON backup (imports Notes + Flashcards + Timelines together)\n• Word (.docx) handouts — headings, bold terms, bullets, and tables auto-formatted\n• Markdown or plain class notes — headings, comparison tables | col | col |, **Term**: Definition\n• Quizlet Tab-separated or Q:/A: decks'
              }
              className="sd-input font-mono-num text-xs leading-relaxed"
            />
          </div>

          {/* Full Backup Bundle Mode (.json file) */}
          {backupBundle && (
            <div className="space-y-4 border-t border-[var(--line)] pt-4">
              <div className="rounded-xl border border-[var(--e3)] bg-[var(--bg)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--e3)]">
                    <Database className="h-4 w-4" aria-hidden="true" />
                    <span>{backupBundle.formatLabel} Detected</span>
                  </div>
                  <span className="font-mono-num text-xs font-semibold text-[var(--mute)]">
                    {sourceLabel}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  <div className="rounded-lg border border-[var(--line)] bg-[var(--card)] p-2.5">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--mute)]">
                      <BookOpen className="h-3.5 w-3.5 text-[var(--e3)]" aria-hidden="true" />
                      <span>Notes</span>
                    </div>
                    <div className="font-mono-num mt-1 text-lg font-bold text-[var(--ink)]">
                      {backupBundle.counts.notes}
                    </div>
                    <div className="text-[11px] text-[var(--mute)]">
                      across {backupBundle.counts.subjects} subject(s)
                    </div>
                  </div>
                  <div className="rounded-lg border border-[var(--line)] bg-[var(--card)] p-2.5">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--mute)]">
                      <Layers className="h-3.5 w-3.5 text-[var(--ok)]" aria-hidden="true" />
                      <span>Flashcards</span>
                    </div>
                    <div className="font-mono-num mt-1 text-lg font-bold text-[var(--ink)]">
                      {backupBundle.counts.flashcards}
                    </div>
                    <div className="text-[11px] text-[var(--mute)]">with box progress</div>
                  </div>
                  <div className="rounded-lg border border-[var(--line)] bg-[var(--card)] p-2.5">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--mute)]">
                      <Calendar className="h-3.5 w-3.5 text-[var(--e2)]" aria-hidden="true" />
                      <span>Timeline Nodes</span>
                    </div>
                    <div className="font-mono-num mt-1 text-lg font-bold text-[var(--ink)]">
                      {backupBundle.counts.timelines}
                    </div>
                    <div className="text-[11px] text-[var(--mute)]">
                      in {backupBundle.counts.timelineTopics} topic(s)
                    </div>
                  </div>
                  <div className="rounded-lg border border-[var(--line)] bg-[var(--card)] p-2.5">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--mute)]">
                      <FileText className="h-3.5 w-3.5 text-[var(--mute)]" aria-hidden="true" />
                      <span>Topics &amp; Plan</span>
                    </div>
                    <div className="font-mono-num mt-1 text-lg font-bold text-[var(--ink)]">
                      {backupBundle.counts.topics}
                    </div>
                    <div className="text-[11px] text-[var(--mute)]">
                      +{backupBundle.counts.planner} planner items
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <label className="text-xs font-semibold text-[var(--mute)]">
                    Import Mode:
                    <select
                      value={backupImportMode}
                      onChange={(e) =>
                        setBackupImportMode(e.target.value === 'replace' ? 'replace' : 'merge')
                      }
                      className="sd-input ml-2 inline-block w-auto py-1 text-xs font-semibold text-[var(--ink)]"
                    >
                      <option value="merge">Merge with existing workspace</option>
                      <option value="replace">Replace entire workspace</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={handleConfirmBackupAll}
                    className="sd-btn-pri px-4 py-2 text-xs whitespace-nowrap"
                  >
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Import All Notes, Flashcards &amp; Timeline</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Single Topic / Doc Preview */}
          {preview && (
            <div className="space-y-4 border-t border-[var(--line)] pt-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-semibold text-[var(--mute)]">
                  Target Subject
                  <select
                    value={targetSubjectId}
                    onChange={(e) => setTargetSubjectId(e.target.value)}
                    className="sd-input mt-1 text-sm"
                  >
                    {workspace.subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                    <option value="__new__">+ Create a new subject</option>
                  </select>
                </label>

                {targetSubjectId === '__new__' ? (
                  <label className="block text-xs font-semibold text-[var(--mute)]">
                    New Subject Name *
                    <input
                      type="text"
                      value={newSubjectName}
                      onChange={(e) => setNewSubjectName(e.target.value)}
                      placeholder="e.g. Biology"
                      className="sd-input mt-1 text-sm"
                    />
                  </label>
                ) : (
                  <label className="block text-xs font-semibold text-[var(--mute)]">
                    Topic Name
                    <input
                      type="text"
                      value={topicNameOverride}
                      onChange={(e) => setTopicNameOverride(e.target.value)}
                      placeholder={preview.suggestedTitle}
                      className="sd-input mt-1 text-sm"
                    />
                  </label>
                )}
              </div>

              {targetSubjectId === '__new__' && (
                <label className="block text-xs font-semibold text-[var(--mute)]">
                  Topic Name
                  <input
                    type="text"
                    value={topicNameOverride}
                    onChange={(e) => setTopicNameOverride(e.target.value)}
                    placeholder={preview.suggestedTitle}
                    className="sd-input mt-1 text-sm"
                  />
                </label>
              )}

              {/* Live Preview Box */}
              <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-[var(--e3)]">
                    Live Structured Preview
                  </span>
                  <div className="font-mono-num flex flex-wrap gap-3 text-xs text-[var(--mute)]">
                    <span>{preview.note.sections.length} sections</span>
                    <span>·</span>
                    <span>{preview.note.keyTerms.length} key terms</span>
                    <span>·</span>
                    <span>{preview.cards.length} extractable cards</span>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-4">
                  <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-[var(--ink)]">
                    <input
                      type="checkbox"
                      checked={includeNotes}
                      onChange={(e) => setIncludeNotes(e.target.checked)}
                      className="accent-[var(--e3)]"
                    />
                    <BookOpen className="h-3.5 w-3.5 text-[var(--e3)]" aria-hidden="true" />
                    <span>Save cleanly formatted structured notes</span>
                  </label>
                  {preview.cards.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setIncludeCards((v) => !v)}
                      className={`cursor-pointer inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                        includeCards
                          ? 'border-[var(--ok)] bg-[color-mix(in_srgb,var(--ok)_12%,var(--card))] text-[var(--ok)]'
                          : 'border-[var(--line)] bg-[var(--card)] text-[var(--ink)] hover:border-[var(--e3)]'
                      }`}
                    >
                      <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>
                        {includeCards
                          ? `Make Flashcards Enabled (${preview.cards.length})`
                          : `Make Flashcards (${preview.cards.length})`}
                      </span>
                    </button>
                  )}
                </div>

                {preview.cards.length > 0 && (
                  <div className="mt-3 space-y-1.5 border-t border-[var(--line)] pt-3">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--mute)]">
                      Sample Extracted Key Terms / Cards
                    </div>
                    {preview.cards.slice(0, 3).map((c, idx) => (
                      <div
                        key={idx}
                        className="flex items-start justify-between gap-3 rounded-lg border border-[var(--line)] bg-[var(--card)] px-3 py-2 text-xs"
                      >
                        <span className="font-semibold text-[var(--ink)]">{c.q}</span>
                        <span className="text-right text-[var(--mute)]">{c.a}</span>
                      </div>
                    ))}
                  </div>
                )}

                {preview.note.sections.length > 0 && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-[var(--mute)]">
                    <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">
                      Sections: {preview.note.sections.map((s) => s.heading).join(' · ')}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--line)] px-5 py-3.5">
          <button type="button" onClick={onClose} className="sd-btn px-4 py-2 text-xs">
            Cancel
          </button>
          {backupBundle ? (
            <button
              type="button"
              onClick={handleConfirmBackupAll}
              className="sd-btn-pri px-4 py-2 text-xs whitespace-nowrap"
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Import All Notes, Flashcards &amp; Timeline</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={!preview || (!includeNotes && !includeCards)}
              onClick={handleConfirmImport}
              className="sd-btn-pri px-4 py-2 text-xs whitespace-nowrap"
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Import into Workspace</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
