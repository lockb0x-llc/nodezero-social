#!/usr/bin/env node

/**
 * Relay signal end-to-end probe.
 *
 * Verifies that the staging relay forwards offer/answer/ice-candidate payloads
 * between two concurrently connected peers.
 */

const relayUrl = process.env.RELAY_URL || 'wss://nodezero-social-staging-testnet-relay.azurewebsites.net';
const timeoutMs = Number(process.env.RELAY_PROBE_TIMEOUT_MS || '15000');

const token = Date.now().toString(36);
const aliceWebId = `https://relay-probe-alice-${token}.example/profile/card#me`;
const bobWebId = `https://relay-probe-bob-${token}.example/profile/card#me`;

function withWebId(url, webId) {
  const u = new URL(url);
  u.searchParams.set('webId', webId);
  return u.toString();
}

function waitForOpen(ws, label) {
  return new Promise((resolve, reject) => {
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`${label} websocket failed to open`));
    };
    const cleanup = () => {
      ws.removeEventListener('open', onOpen);
      ws.removeEventListener('error', onError);
    };

    ws.addEventListener('open', onOpen);
    ws.addEventListener('error', onError);
  });
}

function closeQuietly(ws) {
  try {
    ws.close();
  } catch {
    // Ignore close errors in probe cleanup.
  }
}

function jsonMessageHandler(label, onJson, onError) {
  return (event) => {
    try {
      const parsed = JSON.parse(String(event.data));
      onJson(parsed);
    } catch (err) {
      onError(new Error(`${label} received non-JSON message: ${String(event.data)} (${err instanceof Error ? err.message : String(err)})`));
    }
  };
}

const alice = new WebSocket(withWebId(relayUrl, aliceWebId));
const bob = new WebSocket(withWebId(relayUrl, bobWebId));

const received = {
  bobOffer: null,
  aliceAnswer: null,
  bobIce: null,
};

let done = false;
let timeout;

function finish(error) {
  if (done) return;
  done = true;
  clearTimeout(timeout);
  closeQuietly(alice);
  closeQuietly(bob);

  if (error) {
    console.error('RELAY_SIGNAL_PROBE_FAIL');
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  console.log('RELAY_SIGNAL_PROBE_PASS');
  console.log(`relayUrl=${relayUrl}`);
  console.log(`alice=${aliceWebId}`);
  console.log(`bob=${bobWebId}`);
  console.log(`bobOfferType=${received.bobOffer?.type ?? 'missing'}`);
  console.log(`aliceAnswerType=${received.aliceAnswer?.type ?? 'missing'}`);
  console.log(`bobIceType=${received.bobIce?.type ?? 'missing'}`);
}

function maybeDone() {
  if (received.bobOffer && received.aliceAnswer && received.bobIce) {
    finish();
  }
}

(async () => {
  timeout = setTimeout(() => {
    finish(new Error(`Timed out after ${timeoutMs}ms waiting for forwarded relay messages.`));
  }, timeoutMs);

  await Promise.all([waitForOpen(alice, 'alice'), waitForOpen(bob, 'bob')]);

  alice.addEventListener(
    'message',
    jsonMessageHandler(
      'alice',
      (msg) => {
        if (msg?.type === 'answer' && msg?.from === bobWebId && msg?.to === aliceWebId) {
          received.aliceAnswer = msg;
          maybeDone();
        }
      },
      finish
    )
  );

  bob.addEventListener(
    'message',
    jsonMessageHandler(
      'bob',
      (msg) => {
        if (msg?.type === 'offer' && msg?.from === aliceWebId && msg?.to === bobWebId) {
          received.bobOffer = msg;

          const answer = {
            type: 'answer',
            from: bobWebId,
            to: aliceWebId,
            payload: { type: 'answer', sdp: 'probe-answer-sdp' },
          };
          bob.send(JSON.stringify(answer));

          const ice = {
            type: 'ice-candidate',
            from: aliceWebId,
            to: bobWebId,
            payload: { candidate: 'candidate:probe 1 udp 1 127.0.0.1 3478 typ host' },
          };
          alice.send(JSON.stringify(ice));
          maybeDone();
        } else if (msg?.type === 'ice-candidate' && msg?.from === aliceWebId && msg?.to === bobWebId) {
          received.bobIce = msg;
          maybeDone();
        }
      },
      finish
    )
  );

  const offer = {
    type: 'offer',
    from: aliceWebId,
    to: bobWebId,
    payload: { type: 'offer', sdp: 'probe-offer-sdp' },
  };

  alice.send(JSON.stringify(offer));
})().catch((err) => finish(err instanceof Error ? err : new Error(String(err))));
