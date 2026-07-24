const { buildThing, createThing, setThing, mockSolidDatasetFrom, getThing, setStringNoLocale } = require("@inrupt/solid-client");
const VCARD_FN = "http://www.w3.org/2006/vcard/ns#fn";
const webId = "https://example.com/profile/card#me";
let t = buildThing(createThing({ url: webId })).addStringNoLocale(VCARD_FN, "Name 1").addStringNoLocale(VCARD_FN, "Name 2").build();
let ds = setThing(mockSolidDatasetFrom("https://example.com/profile/card"), t);
ds.internal_changeLog = { additions: [], deletions: [] };

let existingThing = getThing(ds, webId);
console.log("Existing thing has quads:", existingThing.predicates[VCARD_FN]);
let newThing = buildThing(existingThing).setStringNoLocale(VCARD_FN, "New Name").build();
console.log("New thing has quads:", newThing.predicates[VCARD_FN]);
let newDs = setThing(ds, newThing);
console.log(JSON.stringify(newDs.internal_changeLog, null, 2));
