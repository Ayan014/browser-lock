const $ = (id) => document.getElementById(id);
const send = (m) => chrome.runtime.sendMessage(m);
function say(t, ok) { $('msg').textContent = t || ''; $('msg').className = ok ? 'ok' : ''; }

async function render() {
  const s = await send({ type: 'getState' });
  ['unlockView', 'setupView', 'mainView'].forEach((v) => $(v).classList.add('hidden'));
  if (!s.hasPassword) $('setupView').classList.remove('hidden');
  else if (s.locked) $('unlockView').classList.remove('hidden');
  else {
    $('mainView').classList.remove('hidden');
    $('idleMin').value = s.autoLockMinutes;
  }
}
async function run(msg, okText) {
  const r = await send(msg);
  say(r.ok ? okText : r.error, r.ok);
  if (r.ok) { ['unlockPw', 'newPw', 'curPw', 'chgPw'].forEach((i) => ($(i).value = '')); }
  await render();
  return r;
}
$('unlockBtn').onclick = () => run({ type: 'unlock', password: $('unlockPw').value }, '');
$('unlockPw').onkeydown = (e) => e.key === 'Enter' && $('unlockBtn').click();
$('setBtn').onclick = () => run({ type: 'setPassword', password: $('newPw').value }, 'Password set.');
$('lockBtn').onclick = async () => { const r = await send({ type: 'lock' }); r.ok ? window.close() : say(r.error); };
$('saveBtn').onclick = () => run({ type: 'saveSettings', autoLockMinutes: $('idleMin').value }, 'Settings saved.');
$('chgBtn').onclick = () => run({ type: 'setPassword', current: $('curPw').value, password: $('chgPw').value }, 'Password changed.');
$('rmBtn').onclick = () => run({ type: 'removePassword', current: $('curPw').value }, 'Password removed.');
render();
