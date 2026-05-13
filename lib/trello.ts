// Trello REST client. Auth = key + token in env. The board shortLink
// (e.g. fMONysxJ) is accepted interchangeably with full IDs.
//
// Reuses the same key/token as HAM Dashboard / Meeting Agenda Compiler.

const API_BASE = "https://api.trello.com/1";

function creds() {
  const key = process.env.TRELLO_KEY;
  const token = process.env.TRELLO_TOKEN;
  if (!key || !token) {
    throw new Error(
      "TRELLO_KEY and TRELLO_TOKEN must be set in .env.local. See .env.example.",
    );
  }
  return { key, token };
}

function authQuery(extra: Record<string, string> = {}): string {
  const { key, token } = creds();
  const params = new URLSearchParams({ key, token, ...extra });
  return params.toString();
}

async function trelloGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = `${API_BASE}${path}?${authQuery(params)}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Trello GET ${path} failed (${resp.status}): ${body.slice(0, 200)}`);
  }
  return (await resp.json()) as T;
}

async function trelloPut<T>(path: string, body: unknown): Promise<T> {
  const url = `${API_BASE}${path}?${authQuery()}`;
  const resp = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Trello PUT ${path} failed (${resp.status}): ${text.slice(0, 200)}`);
  }
  return (await resp.json()) as T;
}

// Set a text-typed custom field's value on a card. Used to write the
// public status-page URL back to the card so PMs can share it directly.
export function setCustomFieldText(
  cardId: string,
  fieldId: string,
  text: string,
): Promise<unknown> {
  return trelloPut(
    `/cards/${encodeURIComponent(cardId)}/customField/${encodeURIComponent(fieldId)}/item`,
    { value: { text } },
  );
}

// Post a comment to a Trello card. Used by the client-video-review
// feature to log first-comments / approvals / change requests, which
// double as the PM's notification channel until email lands.
export async function addCardComment(cardId: string, text: string): Promise<void> {
  const { key, token } = creds();
  const params = new URLSearchParams({ key, token, text });
  const resp = await fetch(
    `${API_BASE}/cards/${encodeURIComponent(cardId)}/actions/comments`,
    { method: "POST", body: params },
  );
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(
      `Trello addCardComment failed (${resp.status}): ${body.slice(0, 200)}`,
    );
  }
}

// Move a card to a different list. Used by the auto-card-movement
// behaviour: card jumps to "Assets Approved By Client" when all assets
// are approved, and reverts to "Assets Shared With Client" if any asset
// regresses.
export async function moveCardToList(cardId: string, listId: string): Promise<void> {
  const { key, token } = creds();
  const params = new URLSearchParams({ key, token, idList: listId });
  const resp = await fetch(
    `${API_BASE}/cards/${encodeURIComponent(cardId)}?${params.toString()}`,
    { method: "PUT" },
  );
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(
      `Trello moveCardToList failed (${resp.status}): ${body.slice(0, 200)}`,
    );
  }
}

// ---------- Types (only the fields we care about) ----------

export type TrelloList = {
  id: string;
  name: string;
  closed: boolean;
};

export type TrelloAttachment = {
  id: string;
  name: string;
  url: string;
  mimeType?: string;
  isUpload: boolean;
};

export type TrelloCustomFieldItem = {
  idCustomField: string;
  value?: {
    text?: string;
    date?: string;
    number?: string;
    checked?: string;
    option?: string;
  };
  idValue?: string; // for dropdown options
};

export type TrelloCustomField = {
  id: string;
  name: string;
  type: "text" | "number" | "date" | "checkbox" | "list";
  options?: { id: string; value: { text: string } }[];
};

export type TrelloLabel = {
  id: string;
  name: string;
  color: string | null;
};

export type TrelloCard = {
  id: string;
  name: string;
  desc: string;
  closed: boolean;
  idList: string;
  shortUrl: string;
  shortLink: string;
  due?: string | null;
  dateLastActivity: string;
  labels?: TrelloLabel[];
  idLabels?: string[];
  idMembers?: string[];
  attachments?: TrelloAttachment[];
  customFieldItems?: TrelloCustomFieldItem[];
};

// ---------- Reads ----------

export function getBoardLists(boardId: string): Promise<TrelloList[]> {
  return trelloGet<TrelloList[]>(`/boards/${encodeURIComponent(boardId)}/lists`, {
    filter: "open",
  });
}

export function getBoardCustomFields(boardId: string): Promise<TrelloCustomField[]> {
  return trelloGet<TrelloCustomField[]>(
    `/boards/${encodeURIComponent(boardId)}/customFields`,
  );
}

// All cards on the board with attachments + custom fields, in one call.
export function getBoardCards(boardId: string): Promise<TrelloCard[]> {
  return trelloGet<TrelloCard[]>(`/boards/${encodeURIComponent(boardId)}/cards/all`, {
    customFieldItems: "true",
    attachments: "true",
    fields:
      "name,desc,closed,idList,shortUrl,shortLink,due,dateLastActivity,labels,idLabels,idMembers",
  });
}

export function getCard(cardId: string): Promise<TrelloCard> {
  return trelloGet<TrelloCard>(`/cards/${encodeURIComponent(cardId)}`, {
    customFieldItems: "true",
    attachments: "true",
    fields:
      "name,desc,closed,idList,shortUrl,shortLink,due,dateLastActivity,labels,idLabels,idMembers",
  });
}

export function getList(listId: string): Promise<TrelloList> {
  return trelloGet<TrelloList>(`/lists/${encodeURIComponent(listId)}`);
}

// Card history: createCard + list-move actions. Used to derive when each
// milestone was reached.
export type TrelloAction = {
  id: string;
  type: string; // "createCard" | "updateCard" | ...
  date: string; // ISO timestamp
  data?: {
    list?: { id: string; name: string };
    listAfter?: { id: string; name: string };
    listBefore?: { id: string; name: string };
  };
};

export function getCardActions(cardId: string): Promise<TrelloAction[]> {
  return trelloGet<TrelloAction[]>(`/cards/${encodeURIComponent(cardId)}/actions`, {
    filter: "createCard,updateCard:idList",
    limit: "1000",
  });
}
