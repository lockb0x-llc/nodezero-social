import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { deriveProfileViewState } from './viewState'

void test('deriveProfileViewState resolves self view by default', () => {
  const state = deriveProfileViewState('https://solid.nodezero.social/alice/profile/card#me')

  assert.equal(state.ownerWebId, 'https://solid.nodezero.social/alice/profile/card#me')
  assert.equal(state.viewedWebId, 'https://solid.nodezero.social/alice/profile/card#me')
  assert.equal(state.isPeerView, false)
})

void test('deriveProfileViewState resolves peer view when peerWebId differs', () => {
  const state = deriveProfileViewState(
    'https://solid.nodezero.social/alice/profile/card#me',
    'https://solid.nodezero.social/bob/profile/card#me',
  )

  assert.equal(state.ownerWebId, 'https://solid.nodezero.social/alice/profile/card#me')
  assert.equal(state.viewedWebId, 'https://solid.nodezero.social/bob/profile/card#me')
  assert.equal(state.isPeerView, true)
})
