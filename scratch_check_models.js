async function checkModels() {
  const cred = await fetch('https://social-automate.rifatrabbi104.workers.dev/api/settings').then(r=>r.json());
  const key = cred?.settings?.ai?.api_key || '';
  if (!key) {
    console.log('No key in settings');
    return;
  }
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
  const data = await r.json();
  if (data.models) {
    console.log('Available models:');
    data.models.filter(m => m.supportedGenerationMethods?.includes('generateContent')).forEach(m => console.log(m.name));
  } else {
    console.log('Error:', data);
  }
}
checkModels();

