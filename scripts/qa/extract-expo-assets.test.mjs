import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { extractExpoAssetPaths } from './extract-expo-assets.mjs'

void test('extracts every Expo asset scale from static registrations', () => {
  const source = `
    registry.registerAsset({
      httpServerLocation: "/assets/icons",
      name: "logo.abc123",
      type: "png",
      scales: [1, 2]
    });
    other.registerAsset({httpServerLocation:"/assets/fonts",name:"icons.def456",type:"ttf",scales:[1]});
  `
  assert.deepEqual(extractExpoAssetPaths(source), [
    '/assets/fonts/icons.def456.ttf',
    '/assets/icons/logo.abc123.png',
    '/assets/icons/logo.abc123@2x.png',
  ])
})

void test('extracts Babel sequence-wrapped registrations', () => {
  assert.deepEqual(
    extractExpoAssetPaths(
      '(0, registry.registerAsset)({httpServerLocation:"/assets",name:"x",type:"png",scales:[1]})'
    ),
    ['/assets/x.png']
  )
})

void test('rejects a dynamic registration instead of partially parsing the graph', () => {
  assert.throws(
    () => extractExpoAssetPaths('registry.registerAsset(assetMetadata)'),
    /one static object argument/
  )
})

void test('rejects empty or dynamic scale metadata', () => {
  assert.throws(
    () =>
      extractExpoAssetPaths(
        'registry.registerAsset({httpServerLocation:"/assets",name:"x",type:"png",scales:[]})'
      ),
    /nonempty literal array/
  )
  assert.throws(
    () =>
      extractExpoAssetPaths(
        'registry.registerAsset({httpServerLocation:"/assets",name:"x",type:"png",scales:[scale]})'
      ),
    /positive finite numeric literals/
  )
})

void test('rejects metadata spreads, computed overrides, getters, and unsupported calls', () => {
  for (const source of [
    'registry.registerAsset({httpServerLocation:"/assets",name:"safe",type:"png",scales:[1],...dynamic})',
    'registry.registerAsset({httpServerLocation:"/assets",name:"safe",["name"]:"actual",type:"png",scales:[1]})',
    'registry.registerAsset({httpServerLocation:"/assets",get name(){return "actual"},type:"png",scales:[1]})',
    'registry.registerAsset.call(null,{httpServerLocation:"/assets",name:"x",type:"png",scales:[1]})',
  ]) {
    assert.throws(
      () => extractExpoAssetPaths(source),
      /static initializer|Unsupported|without aliasing/
    )
  }
})

void test('rejects aliased registrations even when another direct registration is valid', () => {
  const direct =
    'registry.registerAsset({httpServerLocation:"/assets",name:"safe",type:"png",scales:[1]});'
  for (const alias of [
    'const register = registry.registerAsset; register({httpServerLocation:"/assets",name:"x",type:"png",scales:[1]});',
    'const { registerAsset } = registry; registerAsset({httpServerLocation:"/assets",name:"x",type:"png",scales:[1]});',
  ]) {
    assert.throws(
      () => extractExpoAssetPaths(`${direct}${alias}`),
      /without aliasing|must not be extracted/
    )
  }
})

void test('allows source files with no Expo asset registrations', () => {
  assert.deepEqual(extractExpoAssetPaths('console.log("no assets")'), [])
})
