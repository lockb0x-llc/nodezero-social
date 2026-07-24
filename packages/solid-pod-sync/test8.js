const { buildThing, createThing, setThing, mockSolidDatasetFrom, getThing, saveSolidDatasetAt } = require("@inrupt/solid-client");
const VCARD_FN = "http://www.w3.org/2006/vcard/ns#fn";
const webId = "https://example.com/profile/card#me";

async function main() {
  let t = buildThing(createThing({ url: webId })).addStringNoLocale(VCARD_FN, "Name 1").addStringNoLocale(VCARD_FN, "Name 2").build();
  let ds = setThing(mockSolidDatasetFrom("https://example.com/profile/card"), t);
  
  // Fake the changelog so it's treated as a clean dataset from a GET
  ds.internal_changeLog = { additions: [], deletions: [] };
  
  // Fake server resource info so it thinks it was fetched
  ds.internal_resourceInfo = {
    sourceIri: "https://example.com/profile/card",
    isRawData: false,
    contentType: "text/turtle",
    linkedResources: {}
  };

  let existingThing = getThing(ds, webId);
  let newThing = buildThing(existingThing).setStringNoLocale(VCARD_FN, "New Name").build();
  let newDs = setThing(ds, newThing);

  const mockFetch = async (url, options) => {
    console.log("FETCH METHOD:", options.method);
    console.log("FETCH BODY:", options.body);
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => ""
    };
  };

  await saveSolidDatasetAt("https://example.com/profile/card", newDs, { fetch: mockFetch });
}

main().catch(console.error);
