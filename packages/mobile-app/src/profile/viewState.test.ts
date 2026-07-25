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

void test('deriveProfileViewState keeps self mode when peerWebId matches owner', () => {
  const webId = 'https://solid.nodezero.social/alice/profile/card#me'
  const state = deriveProfileViewState(webId, webId)

  assert.equal(state.ownerWebId, webId)
  assert.equal(state.viewedWebId, webId)
  assert.equal(state.isPeerView, false)
})

void test('deriveProfileViewState exposes null owner and null viewed for signed-out state', () => {
  const state = deriveProfileViewState(null)

  assert.equal(state.ownerWebId, null)
  assert.equal(state.viewedWebId, null)
  assert.equal(state.isPeerView, false)
})
