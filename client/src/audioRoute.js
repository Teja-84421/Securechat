// Speaker on/off for calls.
//
// Browsers don't have one universal "speakerphone" switch, so we use the best option available:
//  1. Phones/tablets that expose both a "speaker" and an "earpiece" output (e.g. Chrome on Android):
//     really switch the sound between the loudspeaker and the earpiece with setSinkId().
//  2. Everywhere else (laptops, iPhone/Safari, Firefox): keep the user's current output device
//     (speakers or headphones are never overridden) and switch between full volume and a quieter level.
//
// Returns 'routed' when the output device was switched, or 'volume' for the fallback.

const QUIET_VOLUME = 0.35;

async function findPhoneOutputs() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outs = devices.filter((d) => d.kind === 'audiooutput');
    const earpiece = outs.find((d) => /ear\s?piece|receiver/i.test(d.label));
    const speaker = outs.find((d) => /speaker/i.test(d.label) && !/head|ear|bluetooth/i.test(d.label));
    return earpiece && speaker ? { earpiece, speaker } : null;
  } catch {
    return null;
  }
}

export async function setSpeaker(element, on) {
  if (!element) return 'volume';
  if ('setSinkId' in element) {
    const phone = await findPhoneOutputs();
    if (phone) {
      try {
        await element.setSinkId((on ? phone.speaker : phone.earpiece).deviceId);
        element.volume = 1;
        return 'routed';
      } catch {
        /* fall back to volume below */
      }
    }
  }
  element.volume = on ? 1 : QUIET_VOLUME;
  return 'volume';
}
