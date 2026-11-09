const apiOrigin = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${apiOrigin}/api${path}`, {method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : {'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)});
  const data = await response.json().catch(() => ({detail: 'サーバーから応答を読み取れませんでした。'}));
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'リクエストを処理できませんでした。');
  return data as T;
}
