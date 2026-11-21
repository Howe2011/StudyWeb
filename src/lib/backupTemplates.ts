import { makeNoteId } from './noteFormat';
import { createEmptyWorkspace, makeId } from './workspaceStore';
import { WorkspaceData } from '../types';

function triggerDownload(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Generates a clean, fully-populated StudyWeb v2 JSON workspace template
 * compatible with ProfileVaultView's JSON Backup Restore (Merge or Replace).
 */
export function getWorkspaceJsonTemplate(): string {
  const base = createEmptyWorkspace();
  const today = new Date();
  const addDaysIso = (days: number) =>
    new Date(today.getTime() + days * 24 * 3600 * 1000).toISOString().slice(0, 10);

  const bioId = 'subj_template_biology';
  const histId = 'subj_template_history';
  const bioTopicId = 'top_template_osmosis';
  const histTopicId = 'top_template_weimar';

  const sampleWorkspace: WorkspaceData = {
    ...base,
    subjects: [
      {
        id: bioId,
        name: 'Biology (Template Example)',
        examBoard: 'AQA GCSE',
        color: '#1F7A4D',
        examDate: addDaysIso(42),
        weight: 3,
        targetGrade: '8',
        createdAt: today.toISOString(),
      },
      {
        id: histId,
        name: 'History (Template Example)',
        examBoard: 'Edexcel GCSE',
        color: '#A8750C',
        examDate: addDaysIso(49),
        weight: 2,
        targetGrade: '8',
        hasTimeline: true,
        createdAt: today.toISOString(),
      },
    ],
    topics: [
      {
        id: bioTopicId,
        subjectId: bioId,
        name: 'Cell Transport: Osmosis & Active Transport',
        specCode: '4.1.3',
        completed: false,
        confidence: 2,
        notes: {
          summary:
            'Cells exchange water and dissolved solutes across partially permeable membranes via diffusion, osmosis, and active transport.',
          sections: [
            {
              id: makeNoteId('sec'),
              heading: 'Passive vs Active Transport',
              points: [
                'Diffusion moves particles down a concentration gradient (no ATP required).',
                'Osmosis is the net movement of water from high water potential to low water potential across a partially permeable membrane.',
                'Active transport moves substances against a concentration gradient using ATP energy from respiration.',
              ],
            },
          ],
          keyTerms: [
            {
              id: makeNoteId('term'),
              term: 'Partially Permeable Membrane',
              definition:
                'A membrane that allows small solvent molecules like water through while blocking larger solutes.',
            },
            {
              id: makeNoteId('term'),
              term: 'Turgid',
              definition:
                'Plant cell state when water enters by osmosis and the vacuole pushes the cytoplasm against the cell wall.',
            },
          ],
          workedExample:
            'A potato cylinder of 2.40g placed in 0.5 mol/dm3 sucrose drops to 2.04g. Percentage change = ((2.04 - 2.40) / 2.40) x 100 = -15%.',
          examTip:
            'Always specify "water potential" or "dilute to concentrated solution" rather than just "concentration of water".',
          updatedAt: today.toISOString(),
        },
        createdAt: today.toISOString(),
      },
      {
        id: histTopicId,
        subjectId: histId,
        name: 'Weimar Recovery (1924-1929)',
        specCode: 'KT2',
        completed: false,
        confidence: 1,
        notes: {
          summary:
            'Gustav Stresemann stabilised the German economy and improved foreign relations after the 1923 crisis.',
          sections: [
            {
              id: makeNoteId('sec'),
              heading: 'Economic Recovery & US Loans',
              points: [
                'Rentenmark replaced the hyperinflated Papiermark in Nov 1923 to restore confidence.',
                'Dawes Plan (1924) secured 800 million gold marks in US loans and lowered annual reparations.',
                'Young Plan (1929) cut total reparations to £2 billion and extended payments to 1988.',
              ],
            },
          ],
          keyTerms: [
            {
              id: makeNoteId('term'),
              term: 'Rentenmark',
              definition:
                'Temporary German currency introduced in November 1923 backed by industrial and agricultural land values.',
            },
          ],
          workedExample:
            'Link cause & consequence: Dawes Plan loans funded German factories, raising industrial output above 1913 levels by 1928 — though Germany remained dangerously dependent on US recallable loans.',
          examTip:
            'Quote both strengths AND weaknesses ("dancing on a volcano") for high-level evaluation paragraphs.',
          updatedAt: today.toISOString(),
        },
        timelineEvents: [
          {
            id: makeId('tl'),
            date: 'Nov 1923',
            title: 'Rentenmark introduced',
            detail: 'Ended hyperinflation and stabilised prices under Stresemann.',
            era: 'Economic Stability',
          },
          {
            id: makeId('tl'),
            date: 'Aug 1924',
            title: 'Dawes Plan signed',
            detail: 'US loans restarted German industry and lowered annual reparation payments.',
            era: 'Economic Stability',
          },
        ],
        createdAt: today.toISOString(),
      },
    ],
    flashcards: [
      {
        id: makeId('fc'),
        subjectId: bioId,
        topicId: bioTopicId,
        sectionName: 'Cell Transport',
        q: 'Define osmosis in exam-mark terms.',
        a: 'Net movement of water molecules from an area of higher water potential to lower water potential across a partially permeable membrane.',
        box: 1,
        dueAt: Date.now(),
        flagged: false,
        createdAt: today.toISOString(),
      },
      {
        id: makeId('fc'),
        subjectId: histId,
        topicId: histTopicId,
        sectionName: 'Weimar Recovery',
        q: 'What were the two main terms of the 1924 Dawes Plan?',
        a: 'Reparation payments were temporarily lowered to 1 billion marks/year, and US banks loaned 800 million marks to rebuild German industry.',
        box: 1,
        dueAt: Date.now(),
        flagged: false,
        createdAt: today.toISOString(),
      },
    ],
    todos: [
      {
        id: makeId('todo'),
        title: 'Complete Osmosis past paper 6-mark question',
        subjectId: bioId,
        dueDate: addDaysIso(1),
        priority: 3,
        done: false,
        category: 'exam',
        createdAt: today.toISOString(),
      },
    ],
    calendarBlocks: [
      {
        id: makeId('blk'),
        date: addDaysIso(0),
        startTime: '17:00',
        durationMins: 25,
        title: 'Biology: Cell Transport Recall',
        subjectId: bioId,
        topicId: bioTopicId,
        kind: 'revision',
        done: false,
      },
    ],
    dailyGoalMinutes: 60,
    scratchpad: 'Template note: edit any section in this JSON file and import via Restore JSON Backup.',
  };

  return JSON.stringify(
    {
      app: 'studyweb',
      v: 2,
      exported: today.toISOString(),
      _instructions:
        'Edit subjects, topics, flashcards, todos, or calendarBlocks freely, then upload or paste this file in Account & Data -> Restore JSON Backup (choose Merge or Replace).',
      workspace: sampleWorkspace,
    },
    null,
    2
  );
}

/**
 * Clean CSV template compatible with UniversalImportModal & Quizlet/Anki CSV parsers.
 */
export function getFlashcardsCsvTemplate(): string {
  return [
    'question,answer,section,subject',
    '"What organelle performs aerobic respiration?","Mitochondria","Cell Biology","Biology"',
    '"Define active transport.","Movement of substances against a concentration gradient using ATP energy.","Cell Transport","Biology"',
    '"What year did the Dawes Plan begin?","1924 (800 million marks in US loans)","Weimar Recovery","History"',
    '"Calculate speed from distance and time.","Speed = Distance / Time","Forces & Motion","Physics"',
  ].join('\n');
}

/**
 * Clean Save My Exams-style Markdown template compatible with UniversalImportModal.
 */
export function getNotesMarkdownTemplate(): string {
  return `# Topic Title: Enzymes & Digestion
Summary: Enzymes are biological catalysts made of protein that speed up chemical reactions in cells without being used up.

## Lock and Key Model
- The active site of an enzyme has a specific 3D shape complementary to one substrate molecule.
- When substrate binds to the active site, an enzyme-substrate complex forms and products are released.
- Optimum temperature in human cells is around 37 degrees Celsius.

## Factors Affecting Enzyme Activity
- **Optimum Temperature**: Kinetic energy increases rate up to the optimum; above it, bonds break and the enzyme denatures.
- **Denaturation**: Permanent change to the shape of the active site caused by high temperature or extreme pH.
- **Optimum pH**: Most human enzymes work best at pH 7, except stomach protease (pepsin) which works best at pH 2.

Worked Example: Amylase breaks down starch into maltose. Using iodine solution, the blue-black colour stops appearing once all starch is digested.
Examiner Tip: Never say an enzyme is "killed" by heat — enzymes are not alive. Always state that the enzyme is "denatured" and its active site changes shape.
`;
}

export function downloadWorkspaceBackupTemplate(): void {
  triggerDownload(
    'studyweb-backup-template.json',
    getWorkspaceJsonTemplate(),
    'application/json'
  );
}

export function downloadFlashcardsCsvTemplate(): void {
  triggerDownload(
    'studyweb-flashcards-template.csv',
    getFlashcardsCsvTemplate(),
    'text/csv;charset=utf-8'
  );
}

export function downloadNotesMarkdownTemplate(): void {
  triggerDownload(
    'studyweb-notes-template.md',
    getNotesMarkdownTemplate(),
    'text/markdown;charset=utf-8'
  );
}
