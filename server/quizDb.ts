import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

export interface StoredQuizCard {
  id: string;
  deckId: string;
  question: string;
  answer: string;
  section: string;
  position: number;
}

export interface StoredQuizDeckSummary {
  id: string;
  title: string;
  cardCount: number;
  sections: Array<{ name: string; count: number }>;
  createdAt: string;
}

export interface StoredQuizDeckDetail extends StoredQuizDeckSummary {
  cards: StoredQuizCard[];
}

export interface ParsedCsvCard {
  question: string;
  answer: string;
  section: string;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'studydeck_quiz.db');

let dbInstance: DatabaseSync | null = null;

export function getQuizDb(): DatabaseSync {
  if (dbInstance) return dbInstance;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS quiz_decks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quiz_cards (
      id TEXT PRIMARY KEY,
      deck_id TEXT NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      section TEXT NOT NULL DEFAULT 'General',
      position INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (deck_id) REFERENCES quiz_decks(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_quiz_cards_deck_pos
      ON quiz_cards (deck_id, position);
  `);
  dbInstance = db;
  return db;
}

/**
 * RFC-4180 compliant CSV parser handling commas and newlines inside quotes,
 * escaped double quotes (""), and optional header row (Question, Answer, Section).
 * Blank or omitted 3rd column defaults to "General".
 */
export function parseCsvCards(csvText: string): ParsedCsvCard[] {
  const input = String(csvText || '').replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r') {
      if (input[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const nonEmptyRows = rows.filter((r) => r.some((cell) => cell.trim().length > 0));
  if (!nonEmptyRows.length) return [];

  // Detect header row (q/question, a/answer, optional section/topic)
  const first = nonEmptyRows[0].map((c) => c.trim().toLowerCase());
  const looksLikeHeader =
    (first[0] === 'q' || first[0] === 'question' || first[0] === 'prompt') &&
    (first[1] === 'a' || first[1] === 'answer' || first[1] === 'response');

  const dataRows = looksLikeHeader ? nonEmptyRows.slice(1) : nonEmptyRows;
  const parsed: ParsedCsvCard[] = [];

  for (const r of dataRows) {
    const question = (r[0] || '').trim();
    const answer = (r[1] || '').trim();
    const rawSection = (r[2] || '').trim();
    if (!question || !answer) continue;
    parsed.push({
      question,
      answer,
      section: rawSection || 'General',
    });
  }
  return parsed;
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function listDecks(): StoredQuizDeckSummary[] {
  const db = getQuizDb();
  const deckRows = db
    .prepare('SELECT id, title, created_at FROM quiz_decks ORDER BY created_at DESC')
    .all() as Array<{ id: string; title: string; created_at: string }>;

  const secStmt = db.prepare(`
    SELECT section, COUNT(*) AS cnt
    FROM quiz_cards
    WHERE deck_id = ?
    GROUP BY section
    ORDER BY MIN(position) ASC
  `);

  return deckRows.map((d) => {
    const secRows = secStmt.all(d.id) as Array<{ section: string; cnt: number }>;
    const sections = secRows.map((s) => ({
      name: s.section || 'General',
      count: Number(s.cnt || 0),
    }));
    const cardCount = sections.reduce((sum, s) => sum + s.count, 0);
    return {
      id: d.id,
      title: d.title,
      cardCount,
      sections,
      createdAt: d.created_at,
    };
  });
}

export function getDeckById(deckId: string): StoredQuizDeckDetail | null {
  const db = getQuizDb();
  const deck = db
    .prepare('SELECT id, title, created_at FROM quiz_decks WHERE id = ?')
    .get(deckId) as { id: string; title: string; created_at: string } | undefined;

  if (!deck) return null;

  const cards = db
    .prepare(
      `SELECT id, deck_id, question, answer, section, position
       FROM quiz_cards
       WHERE deck_id = ?
       ORDER BY position ASC`
    )
    .all(deckId) as Array<{
    id: string;
    deck_id: string;
    question: string;
    answer: string;
    section: string;
    position: number;
  }>;

  const secMap = new Map<string, number>();
  const mappedCards: StoredQuizCard[] = cards.map((c) => {
    const sec = (c.section || 'General').trim() || 'General';
    secMap.set(sec, (secMap.get(sec) || 0) + 1);
    return {
      id: c.id,
      deckId: c.deck_id,
      question: c.question,
      answer: c.answer,
      section: sec,
      position: c.position,
    };
  });

  return {
    id: deck.id,
    title: deck.title,
    cardCount: mappedCards.length,
    sections: Array.from(secMap.entries()).map(([name, count]) => ({ name, count })),
    createdAt: deck.created_at,
    cards: mappedCards,
  };
}

export function createDeck(title: string, cards: ParsedCsvCard[]): StoredQuizDeckDetail {
  const cleanTitle = String(title || '').trim();
  if (!cleanTitle) {
    throw new Error('Deck title is required.');
  }
  if (!cards.length) {
    throw new Error('At least one valid flashcard row (Question, Answer) is required.');
  }

  const db = getQuizDb();
  const deckId = makeId('deck');
  const createdAt = new Date().toISOString();

  const insertDeck = db.prepare(
    'INSERT INTO quiz_decks (id, title, created_at) VALUES (?, ?, ?)'
  );
  const insertCard = db.prepare(
    'INSERT INTO quiz_cards (id, deck_id, question, answer, section, position) VALUES (?, ?, ?, ?, ?, ?)'
  );

  db.exec('BEGIN');
  try {
    insertDeck.run(deckId, cleanTitle, createdAt);
    cards.forEach((c, idx) => {
      const q = String(c.question || '').trim();
      const a = String(c.answer || '').trim();
      const sec = String(c.section || '').trim() || 'General';
      if (q && a) {
        insertCard.run(makeId('card'), deckId, q, a, sec, idx);
      }
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const created = getDeckById(deckId);
  if (!created) {
    throw new Error('Failed to load created deck.');
  }
  return created;
}

export function deleteDeck(deckId: string): boolean {
  const db = getQuizDb();
  const res = db.prepare('DELETE FROM quiz_decks WHERE id = ?').run(deckId);
  return Number(res.changes || 0) > 0;
}
