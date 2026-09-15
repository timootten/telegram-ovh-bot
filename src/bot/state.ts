export interface DraftServerMeta {
  id?: string;
  planId: string;
  name: string;
  cpu: string;
  brand: string;
  memory: string;
  disk: string;
  storageCode?: string;
  storagePattern?: string;
  price: string;
}

export interface DraftState {
  step: "countries" | "brands" | "servers" | "summary";
  countries: Set<string>;
  brands: Set<string>;
  serverIndices: Set<number>;
  serverCatalog: Map<number, DraftServerMeta>;
  serverPage: number;
}

const userDrafts = new Map<number, DraftState>();

export function getOrCreateDraft(chatId: number): DraftState {
  let draft = userDrafts.get(chatId);
  if (!draft) {
    draft = {
      step: "countries",
      countries: new Set<string>(),
      brands: new Set<string>(),
      serverIndices: new Set<number>(),
      serverCatalog: new Map<number, DraftServerMeta>(),
      serverPage: 0,
    };
    userDrafts.set(chatId, draft);
  }
  return draft;
}

export function getDraft(chatId: number): DraftState | undefined {
  return userDrafts.get(chatId);
}

export function resetDraft(chatId: number): DraftState {
  const draft: DraftState = {
    step: "countries",
    countries: new Set<string>(),
    brands: new Set<string>(),
    serverIndices: new Set<number>(),
    serverCatalog: new Map<number, DraftServerMeta>(),
    serverPage: 0,
  };
  userDrafts.set(chatId, draft);
  return draft;
}

export function clearDraft(chatId: number): void {
  userDrafts.delete(chatId);
}
