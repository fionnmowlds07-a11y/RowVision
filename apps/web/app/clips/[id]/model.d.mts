export type ModelHandle = { setView: (name: string) => void; setYours: (visible: boolean) => void; close: () => void };
export function showModel(host: HTMLElement, request: unknown, style: string, showYours: boolean): Promise<ModelHandle>;
