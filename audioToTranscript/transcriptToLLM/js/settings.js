const KEY = 'ttl_settings';

const DEFAULTS = {
  modelId: 'Llama-3.2-1B-Instruct',
  chunkSize: 2000,
  overlap: 200,
  temperature: 0.3,
  maxTokens: 512,
  systemPrompt: 'Answer only what is asked. If the question is too broad or has many possible answers, either summarise the most relevant ones or ask the user to be more specific.',
};

export function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function wireSettingsForm(getSettings, onChange) {
  const chunkSlider  = document.getElementById('opt-chunk-size');
  const chunkVal     = document.getElementById('opt-chunk-size-val');
  const overlapSlider= document.getElementById('opt-overlap');
  const overlapVal   = document.getElementById('opt-overlap-val');
  const tempSlider   = document.getElementById('opt-temperature');
  const tempVal      = document.getElementById('opt-temperature-val');
  const maxTokSel    = document.getElementById('opt-max-tokens');
  const details        = document.getElementById('options-details');
  const modelDetails   = document.getElementById('model-options-details');

  const s = getSettings();
  const sysPromptEl   = document.getElementById('opt-system-prompt');

  chunkSlider.value   = s.chunkSize;
  chunkVal.textContent= s.chunkSize;
  overlapSlider.value = s.overlap;
  overlapVal.textContent = s.overlap;
  tempSlider.value    = s.temperature;
  tempVal.textContent = Number(s.temperature).toFixed(2);
  maxTokSel.value     = s.maxTokens;
  sysPromptEl.value   = s.systemPrompt;
  details.open        = false;
  if (modelDetails) modelDetails.open = false;

  chunkSlider.addEventListener('input', () => {
    chunkVal.textContent = chunkSlider.value;
    onChange(saveSettings({ chunkSize: Number(chunkSlider.value) }));
  });
  overlapSlider.addEventListener('input', () => {
    overlapVal.textContent = overlapSlider.value;
    onChange(saveSettings({ overlap: Number(overlapSlider.value) }));
  });
  tempSlider.addEventListener('input', () => {
    tempVal.textContent = Number(tempSlider.value).toFixed(2);
    onChange(saveSettings({ temperature: Number(tempSlider.value) }));
  });
  maxTokSel.addEventListener('change', () => {
    onChange(saveSettings({ maxTokens: Number(maxTokSel.value) }));
  });
  sysPromptEl.addEventListener('input', () => {
    onChange(saveSettings({ systemPrompt: sysPromptEl.value }));
  });
}
