const { buildThing, createThing, setThing, mockSolidDatasetFrom, getThing, removeStringNoLocale } = require("@inrupt/solid-client");
const VCARD_FN = "http://www.w3.org/2006/vcard/ns#fn";
const webId = "https://example.com/profile/card#me";
let t = buildThing(createThing({ url: webId })).addStringNoLocale(VCARD_FN, "Name 1").build();
let ds = setThing(mockSolidDatasetFrom("https://example.com/profile/card"), t);
ds.internal_changeLog = { additions: [], deletions: [] };

let existingThing = getThing(ds, webId);
let newThing = removeStringNoLocale(existingThing, VCARD_FN, "Name 1");
let newDs = setThing(ds, newThing);
console.log(JSON.stringify(newDs.internal_changeLog, null, 2));
