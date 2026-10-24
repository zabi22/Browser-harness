// Pure helpers for branching conversation trees (messages linked by parent_id).
export interface TreeMsg {
  id: string;
  parent_id: string | null;
  role: string;
  created_at: string;
}

const byTime = (a: TreeMsg, b: TreeMsg) => a.created_at.localeCompare(b.created_at);

export function pathTo<T extends TreeMsg>(leafId: string | null, all: T[]): T[] {
  const map = new Map(all.map((m) => [m.id, m]));
  const out: T[] = [];
  let cur = leafId ? map.get(leafId) : undefined;
  while (cur) {
    out.unshift(cur);
    cur = cur.parent_id ? map.get(cur.parent_id) : undefined;
  }
  return out;
}

export function siblingsOf<T extends TreeMsg>(msg: T, all: T[]): T[] {
  return all.filter((m) => m.parent_id === msg.parent_id && m.role === msg.role).sort(byTime);
}

/** Follow the newest child at each step down to a leaf. */
export function deepestLeaf<T extends TreeMsg>(id: string, all: T[]): string {
  let cur = id;
  for (;;) {
    const kids = all.filter((m) => m.parent_id === cur).sort(byTime);
    if (!kids.length) return cur;
    cur = kids[kids.length - 1]!.id;
  }
}

/** Newest leaf in the whole tree (fallback when no leaf is stored). */
export function latestLeaf<T extends TreeMsg>(all: T[]): string | null {
  const roots = all.filter((m) => !m.parent_id).sort(byTime);
  const last = roots[roots.length - 1];
  return last ? deepestLeaf(last.id, all) : null;
}
