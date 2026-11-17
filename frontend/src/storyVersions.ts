import type { Session, Transaction } from './types';
import { manuscriptChanges } from './manuscriptChanges';

export interface StoryVersion { version: number; round: number; text: string; transaction?: Transaction }

// Read only committed snapshots. A generated draft is not a published version.
export function storyVersions(session: Session): StoryVersion[] {
  const committed = session.transactions.filter(tx => tx.status === 'committed' && typeof tx.after === 'string');
  const ordered = committed.map((tx, index) => ({ tx, source: tx.source_version ?? index + 1 }))
    .sort((a, b) => a.source - b.source);
  const first = ordered[0];
  return [
    { version: first?.source ?? session.version, round: 0, text: first?.tx.before ?? session.text },
    ...ordered.map(({ tx, source }, index) => ({ version: source + 1, round: index + 1, text: tx.after!, transaction: tx })),
  ];
}

export function changedCharacters(before: string, after: string) {
  // Reverse the existing code-point diff to highlight removed text as well.
  const changed = (a: string, b: string) => new Set([...manuscriptChanges(a, b)]
    .filter(([, mark]) => mark === 'rewritten').map(([index]) => index));
  return { before: changed(after, before), after: changed(before, after) };
}
