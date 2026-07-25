export interface ProfileViewState {
  ownerWebId: string | null
  viewedWebId: string | null
  isPeerView: boolean
}

export function deriveProfileViewState(webId: string | null, peerWebId?: string): ProfileViewState {
  const ownerWebId = webId
  const viewedWebId = peerWebId ?? webId

  return {
    ownerWebId,
    viewedWebId,
    isPeerView: Boolean(peerWebId && peerWebId !== webId),
  }
}
