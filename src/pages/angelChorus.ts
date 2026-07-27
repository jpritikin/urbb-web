let sharedContext: AudioContext | null = null;

function getContext(): AudioContext {
  if (!sharedContext) {
    sharedContext = new AudioContext();
  }
  return sharedContext;
}

// A close-voiced major triad plus octave, sung by detuned sine "voices" with
// slow vibrato, evokes a hushed choir better than a single oscillator.
const VOICES_PER_NOTE = 3;
const ATTACK_SEC = 0.5;
const SUSTAIN_SEC = 0.9;
const RELEASE_SEC = 1.2;
const CHORD_GAP_SEC = 0.35;
const PAIR_PAUSE_SEC = 1.6;
const CHORD_DURATION = ATTACK_SEC + SUSTAIN_SEC + RELEASE_SEC;

const C4 = 261.63;

// Only the three major triads native to C major (I, IV, V), each voiced as a
// close four-note chord (root doubled at the octave on top).
const MAJOR_TRIADS: Record<'I' | 'IV' | 'V', number[]> = {
  I: [C4, C4 * 1.25, C4 * 1.5, C4 * 2],                 // C major (C4-E4-G4-C5)
  IV: [C4 * (4 / 3), C4 * (5 / 3), C4 * 2, C4 * (8 / 3)], // F major (F4-A4-C5-F5)
  V: [C4 * 1.5, C4 * 1.875, C4 * 2.25, C4 * 3],           // G major (G4-B4-D5-G5)
};

// Two-chord pairs, each a familiar major-only move: plagal (IV-I), authentic
// (V-I), and the reverse (I-IV), so the loop doesn't feel identical each time.
const CHORD_PAIRS: Array<[keyof typeof MAJOR_TRIADS, keyof typeof MAJOR_TRIADS]> = [
  ['IV', 'I'],
  ['V', 'I'],
  ['I', 'IV'],
];

function scheduleChord(ctx: AudioContext, master: GainNode, freqs: number[], startTime: number): void {
  freqs.forEach((freq) => {
    for (let v = 0; v < VOICES_PER_NOTE; v++) {
      const detuneCents = (v - (VOICES_PER_NOTE - 1) / 2) * 6;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.detune.value = detuneCents;

      const vibrato = ctx.createOscillator();
      vibrato.frequency.value = 4.5 + Math.random() * 1.5;
      const vibratoGain = ctx.createGain();
      vibratoGain.gain.value = 3 + Math.random() * 2;
      vibrato.connect(vibratoGain);
      vibratoGain.connect(osc.detune);

      const voiceGain = ctx.createGain();
      const peak = 0.15 / VOICES_PER_NOTE;
      voiceGain.gain.setValueAtTime(0, startTime);
      voiceGain.gain.linearRampToValueAtTime(peak, startTime + ATTACK_SEC);
      voiceGain.gain.setValueAtTime(peak, startTime + ATTACK_SEC + SUSTAIN_SEC);
      voiceGain.gain.exponentialRampToValueAtTime(0.001, startTime + CHORD_DURATION);

      osc.connect(voiceGain);
      voiceGain.connect(master);

      osc.start(startTime);
      vibrato.start(startTime);
      osc.stop(startTime + CHORD_DURATION + 0.1);
      vibrato.stop(startTime + CHORD_DURATION + 0.1);
    }
  });
}

export interface AngelChorus {
  stop(): void;
}

export function playAngelChorus(): AngelChorus {
  const ctx = getContext();
  if (ctx.state === 'suspended') {
    ctx.resume();
  }

  const master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let time = ctx.currentTime;

  function schedulePair() {
    if (stopped) return;
    const [first, second] = CHORD_PAIRS[Math.floor(Math.random() * CHORD_PAIRS.length)];

    scheduleChord(ctx, master, MAJOR_TRIADS[first], time);
    time += CHORD_DURATION + CHORD_GAP_SEC;

    scheduleChord(ctx, master, MAJOR_TRIADS[second], time);
    time += CHORD_DURATION + PAIR_PAUSE_SEC;

    const delayMs = Math.max(0, time - (CHORD_DURATION + PAIR_PAUSE_SEC) - ctx.currentTime) * 1000;
    timer = setTimeout(schedulePair, delayMs);
  }

  schedulePair();

  return {
    stop(): void {
      stopped = true;
      if (timer) clearTimeout(timer);
      const fadeEnd = ctx.currentTime + RELEASE_SEC;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
      master.gain.linearRampToValueAtTime(0, fadeEnd);
      setTimeout(() => master.disconnect(), (RELEASE_SEC + 0.2) * 1000);
    },
  };
}
