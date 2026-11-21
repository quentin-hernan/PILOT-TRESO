import { describe, expect, it } from 'vitest';
import { defaultVoice, type FrenchVoice } from './voice';

const v = (name: string, lang = 'fr-FR', localService = true): FrenchVoice => ({
  voice: { name, lang, localService, voiceURI: name, default: false } as SpeechSynthesisVoice,
  label: name,
  male: /paul|henri|thomas|claude|nicolas/i.test(name),
  natural: /natural|online/i.test(name),
});

describe('voix par défaut de Pilot', () => {
  it('préfère une voix masculine naturelle', () => {
    const best = defaultVoice([v('Microsoft Hortense'), v('Microsoft Paul'), v('Microsoft Henri Online (Natural) - French (France)', 'fr-FR', false)]);
    expect(best?.voice.name).toContain('Henri');
  });
  it('à défaut, une voix masculine même non naturelle', () => {
    expect(defaultVoice([v('Google français'), v('Microsoft Hortense'), v('Thomas')])?.voice.name).toBe('Thomas');
  });
  it('sans voix masculine connue, une voix française quelconque (jamais rien)', () => {
    expect(defaultVoice([v('Google français'), v('Microsoft Julie')])).toBeDefined();
  });
  it('liste vide : aucune voix', () => {
    expect(defaultVoice([])).toBeUndefined();
  });
});
