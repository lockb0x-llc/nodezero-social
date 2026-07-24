import { createThing, buildThing, setStringNoLocale, getStringNoLocale, addStringNoLocale } from '@inrupt/solid-client';

const VCARD_FN = 'http://www.w3.org/2006/vcard/ns#fn';

let thing = createThing({ name: 'me' });
thing = addStringNoLocale(thing, VCARD_FN, 'Name 1');
thing = addStringNoLocale(thing, VCARD_FN, 'Name 2');

console.log('Before getString:', getStringNoLocale(thing, VCARD_FN));

thing = buildThing(thing).setStringNoLocale(VCARD_FN, 'New Name').build();

console.log('After set getString:', getStringNoLocale(thing, VCARD_FN));
