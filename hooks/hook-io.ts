/**
 * stdin から hook 入力 JSON を読み取るユーティリティ
 */

export async function readHookInput<T>(): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf-8")) as T;
}
