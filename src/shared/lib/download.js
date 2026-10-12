/** Saves text content as a file through a temporary object URL. */
export function downloadTextFile(fileName, content, mimeType = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  // Revoke after the click has been handled so the download is not cancelled.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
