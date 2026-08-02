export interface BlockStateChangedEvent {
  ownerWebId: string
  subjectWebId: string
  blocked: boolean
}

type BlockStateListener = (event: BlockStateChangedEvent) => void
const listeners = new Set<BlockStateListener>()

export function publishBlockStateChanged(event: BlockStateChangedEvent): void {
  for (const listener of listeners) listener(event)
}

export function subscribeBlockStateChanged(listener: BlockStateListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
