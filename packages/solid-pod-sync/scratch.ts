import { buildThing, createThing } from '@inrupt/solid-client';
try {
  let thing = createThing({ url: 'https://example.com/me' });
  let builder = buildThing(thing).removeAll('http://xmlns.com/foaf/0.1/name');
  console.log("removeAll exists and ran!");
} catch (e) {
  console.log("Error:", e.message);
}
