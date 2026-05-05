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
      "name,desc,closed,idList,shortUrl,shortLink,due,dateLastActivity,labels,idLabels",
  });
}

export function getCard(cardId: string): Promise<TrelloCard> {
  return trelloGet<TrelloCard>(`/cards/${encodeURIComponent(cardId)}`, {
    customFieldItems: "true",
    attachments: "true",
    fields:
      "name,desc,closed,idList,shortUrl,shortLink,due,dateLastActivity,labels,idLabels",
  });
}

export function getList(listId: string): Promise<TrelloList> {
  return trelloGet<TrelloList>(`/lists/${encodeURIComponent(listId)}`);
}
