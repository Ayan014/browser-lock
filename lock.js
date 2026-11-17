const pw = document.getElementById('pw'), err = document.getElementById('err');
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await chrome.runtime.sendMessage({ type: 'unlock', password: pw.value });
  if (!r.ok) { err.textContent = r.error || 'Incorrect password.'; pw.value = ''; pw.focus(); }
});
pw.focus();
