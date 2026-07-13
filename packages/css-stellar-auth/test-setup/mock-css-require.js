/**
 * Intercepts require('@solid/community-server') before the test suite runs
 * and redirects it to the local stub. This allows StellarLoginHandler to be
 * unit-tested without the real CSS runtime package installed.
 *
 * Usage: node --require ./test-setup/mock-css-require.js --test ...
 */
'use strict';

const Module = require('module');
const path = require('path');
const originalLoad = Module._load.bind(Module);

Module._load = function (request, parent, isMain) {
  if (request === '@solid/community-server') {
    return require(path.join(__dirname, 'css-mock.js'));
  }
  return originalLoad(request, parent, isMain);
};
