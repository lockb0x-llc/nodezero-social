/**
 * Minimal stub for @solid/community-server used in unit tests.
 * Provides only the parts StellarLoginHandler needs:
 *  - ResolveLoginHandler (base class — a plain class that mirrors the
 *    constructor and interface expected by the handler)
 */
'use strict';

class ResolveLoginHandler {
  constructor(accountStore, cookieStore) {
    this._accountStore = accountStore;
    this._cookieStore = cookieStore;
  }

  /**
   * CSS base class handle() — in real CSS this generates the cookie after
   * login() returns accountId. In tests, we call login() directly.
   */
  async handle(input) {
    const result = await this.login(input);
    const { accountId } = result.json;
    const authorization = await this._cookieStore.generate(accountId);
    return { json: { ...result.json, authorization } };
  }
}

module.exports = { ResolveLoginHandler };
